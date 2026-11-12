import { evaluate, isWhitelistRemoval, normalizeTarget, planAtlasOperation, type AtlasSnapshot, type Policy } from '@atlas/core';
import { policyDestinationIndex } from './destinations.js';
import { destinationId, pinnedDestinations } from './home-model.js';
import { readDestinationPreferences, validDestinationId, type DestinationMetadata, type DestinationPreferences } from './destination-metadata.js';
import { canUseSubdomainScope } from './subdomain-scope.js';

export type DraftClassification = 'WHITELIST' | 'BLACKLIST' | 'PRESERVE';
export interface DraftDestination { readonly metadata: DestinationMetadata; readonly classification: DraftClassification; readonly pinned: boolean; readonly includeSubdomains?: boolean }
export interface DraftChange { readonly id: string; readonly before: DraftDestination | null; readonly after: DraftDestination | null }
export interface DraftBaseline {
  readonly policyRevision: number; readonly policy: Policy;
  readonly metadata: readonly DestinationMetadata[]; readonly pins: readonly string[];
  readonly entries: readonly DraftDestination[];
}
export interface DestinationEditor {
  readonly id: string | null; readonly name: string; readonly hostname: string; readonly category: string;
  readonly access: DraftClassification; readonly www: boolean; readonly extra: string; readonly pinned: boolean;
  readonly includeSubdomains?: boolean;
}
export interface DestinationDraft {
  readonly version: 1; readonly id: string; readonly baseline: DraftBaseline;
  readonly changes: readonly DraftChange[]; readonly editor: DestinationEditor | null;
}
export interface DraftConflict { readonly id: string; readonly message: string }
export interface DraftAssessment {
  readonly dirty: boolean; readonly stale: readonly string[]; readonly conflicts: readonly DraftConflict[];
  readonly candidatePolicy: Policy | null; readonly policyChanged: boolean;
}
export const samePolicy = (a: Policy, b: Policy): boolean => (['whitelist', 'blacklist', 'whitelistSubdomains'] as const).every(key => {
  const left = a[key] ?? [], right = b[key] ?? [];
  return Array.isArray(left) && Array.isArray(right)
    && JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
});
export const metadataFingerprint = (entries: readonly DestinationMetadata[]): string => JSON.stringify(entries);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const canonicalHosts = (hosts: unknown): hosts is readonly string[] => Array.isArray(hosts) && hosts.length <= 10000
  && hosts.every(host => typeof host === 'string' && normalizeTarget({ hostname: host })?.hostname === host) && new Set(hosts).size === hosts.length;

export function draftBaseline(snapshot: AtlasSnapshot, preferences: DestinationPreferences, pins: readonly string[]): DraftBaseline {
  return structuredClone({ policyRevision: snapshot.policyRevision, policy: snapshot.policy, metadata: preferences.destinations, pins,
    entries: baselineEntries(snapshot.policy, preferences.destinations, pins) });
}
function baselineEntries(policy: Policy, metadata: readonly DestinationMetadata[], pins: readonly string[], mergeSubdomains = true): readonly DraftDestination[] {
  const entries = policyDestinationIndex(policy, metadata, pins, mergeSubdomains);
  const pinned = new Set(pinnedDestinations(entries, pins).map(destinationId));
  return entries.map(entry => ({ metadata: { id: destinationId(entry), label: entry.label, category: entry.category,
    primaryHostname: entry.hostname, hostnames: entry.hostnames }, classification: 'PRESERVE' as const,
    pinned: pinned.has(destinationId(entry)), ...(policy.whitelistSubdomains?.includes(entry.hostname) ? { includeSubdomains: true } : {}) }));
}
export function newDestinationDraft(id: string, baseline: DraftBaseline): DestinationDraft {
  return { version: 1, id, baseline: structuredClone(baseline), changes: [], editor: null };
}

/** Each ID describes one desired result relative to the baseline, never an action replay. */
export function stageDestination(draft: DestinationDraft, id: string, after: DraftDestination | null): DestinationDraft {
  const before = draft.changes.find(item => item.id === id)?.before ?? draft.baseline.entries.find(item => item.metadata.id === id) ?? null;
  const change = { id, before, after: after ? structuredClone(after) : null };
  const changes = draft.changes.filter(item => item.id !== id);
  // Removing a never-committed addition cancels it. Exact presentation no-ops also disappear.
  if (before !== null || after !== null) {
    if (!same(before, after)) changes.splice(Math.min(draft.changes.findIndex(item => item.id === id) < 0 ? changes.length
      : draft.changes.findIndex(item => item.id === id), changes.length), 0, change);
  }
  return { ...draft, changes, editor: null };
}
export function unstageDestination(draft: DestinationDraft, id: string): DestinationDraft {
  return { ...draft, changes: draft.changes.filter(item => item.id !== id), editor: draft.editor?.id === id ? null : draft.editor };
}

export function assessDraft(draft: DestinationDraft, baseline: DraftBaseline): DraftAssessment {
  const stale: string[] = [];
  if (draft.baseline.policyRevision !== baseline.policyRevision || !samePolicy(draft.baseline.policy, baseline.policy)) stale.push('Committed policy changed');
  if (metadataFingerprint(draft.baseline.metadata) !== metadataFingerprint(baseline.metadata)) stale.push('Committed destination details changed');
  if (!same(draft.baseline.pins, baseline.pins)) stale.push('Saved pins changed');
  const conflicts: DraftConflict[] = [];
  const touched = new Set(draft.changes.map(change => change.id));
  const desired = [...baseline.entries.filter(entry => !touched.has(entry.metadata.id)), ...draft.changes.flatMap(item => item.after ? [item.after] : [])];
  const owners = new Map<string, string>();
  for (const item of desired) for (const host of item.metadata.hostnames) {
    const other = owners.get(host);
    if (other && other !== item.metadata.id) {
      conflicts.push({ id: item.metadata.id, message: `${host} also belongs to ${other}. Edit or remove the conflicting draft item.` });
      conflicts.push({ id: other, message: `${host} also belongs to ${item.metadata.id}.` });
    }
    owners.set(host, item.metadata.id);
  }
  const removed = new Set(draft.changes.flatMap(item => [...(item.before?.metadata.hostnames ?? []), ...(item.after?.metadata.hostnames ?? [])]));
  const whitelist = baseline.policy.whitelist.filter(host => !removed.has(host));
  const blacklist = baseline.policy.blacklist.filter(host => !removed.has(host));
  const scopes = (baseline.policy.whitelistSubdomains ?? []).filter(host => !removed.has(host));
  for (const change of draft.changes) {
    const after = change.after;
    if (!after) continue;
    if (after.classification === 'PRESERVE') {
      if (!change.before || !same([...change.before.metadata.hostnames].sort(), [...after.metadata.hostnames].sort()))
        conflicts.push({ id: change.id, message: 'Choose Allowed or Blocked when changing exact addresses.' });
      if (!!change.before?.includeSubdomains !== !!after.includeSubdomains)
        conflicts.push({ id: change.id, message: 'Choose Allowed to change access for all subdomains; display-only edits cannot change permission.' });
      after.metadata.hostnames.forEach(host => {
        if (baseline.policy.whitelist.includes(host)) whitelist.push(host);
        if (baseline.policy.blacklist.includes(host)) blacklist.push(host);
      });
      scopes.push(...(baseline.policy.whitelistSubdomains ?? []).filter(host => after.metadata.hostnames.includes(host)));
    } else {
      (after.classification === 'WHITELIST' ? whitelist : blacklist).push(...after.metadata.hostnames);
      if (after.classification === 'WHITELIST') {
        // Changing this primary must not erase another explicitly stored scope
        // that happens to share the same presentation service.
        scopes.push(...(baseline.policy.whitelistSubdomains ?? []).filter(host => host !== after.metadata.primaryHostname && after.metadata.hostnames.includes(host)));
        if (after.includeSubdomains) {
          if (!canUseSubdomainScope(after.metadata.primaryHostname)) conflicts.push({ id: change.id, message: 'Choose a registered hostname for all-subdomain access; public and hosting suffixes cannot be trusted as a whole.' });
          else scopes.push(after.metadata.primaryHostname);
        }
      } else if (after.includeSubdomains) conflicts.push({ id: change.id, message: 'All-subdomain access is available only for allowed-site changes.' });
    }
  }
  const candidatePolicy: Policy = { whitelist: [...new Set(whitelist)].sort(), blacklist: [...new Set(blacklist)].sort(),
    ...(scopes.length || baseline.policy.whitelistSubdomains !== undefined ? { whitelistSubdomains: [...new Set(scopes)].sort() } : {}) };
  if (evaluate('draft-validation.example', candidatePolicy).reason === 'INVALID_POLICY') conflicts.push({ id: '', message: 'Core rejected the complete candidate policy.' });
  // Pins organize only effective Whitelist destinations, including mixed existing exact rules.
  for (const item of draft.changes) if (item.after?.pinned && !item.after.metadata.hostnames.some(host => evaluate({ hostname: host }, candidatePolicy).outcome === 'ALLOW'))
    conflicts.push({ id: item.id, message: 'This site editor cannot pin a blocked site. Existing bookmark shortcuts do not change access.' });
  return { dirty: draft.changes.length > 0 || draft.editor !== null, stale, conflicts,
    candidatePolicy: conflicts.length ? null : candidatePolicy, policyChanged: !samePolicy(candidatePolicy, baseline.policy) };
}

/** Preview only; this never publishes a controller candidate or supplies a navigation decision. */
export function validateDraftCandidate(draft: DestinationDraft, baseline: DraftBaseline, snapshot: AtlasSnapshot): DraftAssessment {
  if (!readDestinationDraft(draft)) return { dirty: true, stale: [], conflicts: [{ id: '', message: 'Local draft is invalid. It cannot be submitted.' }], candidatePolicy: null, policyChanged: false };
  const assessment = assessDraft(draft, baseline);
  if (!assessment.candidatePolicy || !assessment.policyChanged || assessment.stale.length) return assessment;
  const removal = isWhitelistRemoval(snapshot.policy, assessment.candidatePolicy);
  if (snapshot.vaultState.pendingProposal && !removal) return assessment;
  const now = Math.max(snapshot.accessState.lastObservedAt, snapshot.vaultState.lastObservedAt, snapshot.journeyState.lastObservedAt);
  const operation = removal ? { kind: 'REMOVE_WHITELIST', candidatePolicy: assessment.candidatePolicy, basePolicyRevision: baseline.policyRevision }
    : { kind: 'PROPOSE_POLICY', candidatePolicy: assessment.candidatePolicy };
  const plan = planAtlasOperation(operation, { snapshot, now, configuration: snapshot.configuration });
  return plan.candidateSnapshot ? assessment : { ...assessment, candidatePolicy: null,
    conflicts: [...assessment.conflicts, { id: '', message: 'Core cannot prepare this candidate against the current snapshot.' }] };
}

export function reconcileDraft(draft: DestinationDraft, baseline: DraftBaseline): { draft: DestinationDraft; conflicts: readonly DraftConflict[] } {
  const conflicts: DraftConflict[] = [];
  const changes = draft.changes.map(change => {
    const current = baseline.entries.find(entry => entry.metadata.id === change.id) ?? null;
    // An affected destination changed elsewhere: retain the user's intent and require an explicit resolution.
    if (!same(current, change.before)) conflicts.push({ id: change.id, message: 'Committed destination details changed. Review current and proposed values, then explicitly accept this result, edit the item or remove it.' });
    else if (change.before && !samePolicy({ whitelist: draft.baseline.policy.whitelist.filter(h => change.before!.metadata.hostnames.includes(h)),
      blacklist: draft.baseline.policy.blacklist.filter(h => change.before!.metadata.hostnames.includes(h)), whitelistSubdomains: draft.baseline.policy.whitelistSubdomains?.filter(h => change.before!.metadata.hostnames.includes(h)) ?? [] },
    { whitelist: baseline.policy.whitelist.filter(h => change.before!.metadata.hostnames.includes(h)), blacklist: baseline.policy.blacklist.filter(h => change.before!.metadata.hostnames.includes(h)), whitelistSubdomains: baseline.policy.whitelistSubdomains?.filter(h => change.before!.metadata.hostnames.includes(h)) ?? [] }))
      conflicts.push({ id: change.id, message: 'Committed exact rules changed. Review current and proposed classifications, then explicitly accept this result, edit the item or remove it.' });
    return { ...change, before: current };
  });
  const next = { ...draft, baseline: structuredClone(baseline), changes };
  return { draft: next, conflicts: [...conflicts, ...assessDraft(next, baseline).conflicts] };
}

export function destinationChangeSummary(change: DraftChange, beforePolicy: Policy, afterPolicy: Policy): readonly string[] {
  const before = change.before, after = change.after;
  const remaining = after === null ? before?.metadata.hostnames.filter(host => evaluate({ hostname: host }, afterPolicy).reason === 'WHITELISTED_SCOPE') ?? [] : [];
  const classification = (item: DraftDestination | null, policy: Policy) => item ? [...new Set(item.metadata.hostnames.map(host => evaluate({ hostname: host }, policy).outcome
    === 'ALLOW' ? 'Whitelist' : evaluate({ hostname: host }, policy).outcome === 'DENY' ? 'Blacklist' : 'Greylist'))].join(' / ') : 'No explicit rule';
  return [after?.metadata.label ?? before?.metadata.label ?? change.id,
    `${before === null ? 'Addition' : after === null ? 'Removal' : 'Modification'} · ${classification(before, beforePolicy)} → ${classification(after, afterPolicy)}`,
    `Exact hosts: ${before?.metadata.hostnames.join(', ') ?? '(none)'} → ${after?.metadata.hostnames.join(', ') ?? '(none)'}`,
    ...(remaining.length ? [`Still allowed by another saved scope: ${remaining.join(', ')}. Removing these exact entries does not remove the parent scope.`] : []),
    ...((beforePolicy.whitelistSubdomains ?? []).some(host => before?.metadata.hostnames.includes(host)) || (afterPolicy.whitelistSubdomains ?? []).some(host => after?.metadata.hostnames.includes(host))
      ? [`Domain + all subdomains: ${(beforePolicy.whitelistSubdomains ?? []).filter(host => before?.metadata.hostnames.includes(host)).join(', ') || '(none)'} → ${(afterPolicy.whitelistSubdomains ?? []).filter(host => after?.metadata.hostnames.includes(host)).join(', ') || '(none)'}. All current/future descendants; manual and managed blocking still apply to additional subdomains.`] : []),
    ...(before && after && before.metadata.label !== after.metadata.label ? [`Name: ${before.metadata.label} → ${after.metadata.label}`] : []),
    `Category: ${before?.metadata.category ?? '(none)'} → ${after?.metadata.category ?? '(removed)'} · Pin: ${before?.pinned ? 'Pinned' : 'Not pinned'} → ${after?.pinned ? 'Pinned' : 'Not pinned'}`];
}

/** Decode local drafts conservatively. Malformed drafts are retained by storage for explicit discard. */
export function readDestinationDraft(value: unknown): DestinationDraft | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as DestinationDraft;
  if (item.version !== 1 || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.id) || !item.baseline
    || !Number.isSafeInteger(item.baseline.policyRevision) || item.baseline.policyRevision < 0
    || !item.baseline.policy || !canonicalHosts(item.baseline.policy.whitelist) || !canonicalHosts(item.baseline.policy.blacklist)
    || item.baseline.policy.whitelistSubdomains !== undefined && !canonicalHosts(item.baseline.policy.whitelistSubdomains)
    || evaluate('draft-validation.example', item.baseline.policy).reason === 'INVALID_POLICY'
    || !Array.isArray(item.baseline.pins) || item.baseline.pins.length > 200 || !item.baseline.pins.every(validDestinationId)
    || !Array.isArray(item.baseline.metadata) || !Array.isArray(item.baseline.entries) || item.baseline.entries.length > 10000
    || !Array.isArray(item.changes) || item.changes.length > 2000) return null;
  const validEntry = (entry: DraftDestination | null): boolean => entry !== null && typeof entry === 'object'
    && ['WHITELIST', 'BLACKLIST', 'PRESERVE'].includes(entry.classification) && typeof entry.pinned === 'boolean'
    && (entry.includeSubdomains === undefined || typeof entry.includeSubdomains === 'boolean')
    && readDestinationPreferences({ version: 1, destinations: [entry.metadata], pending: null }).destinations.length === 1;
  if (!item.baseline.entries.every(validEntry) || new Set(item.baseline.entries.map(e => e.metadata.id)).size !== item.baseline.entries.length
    || readDestinationPreferences({ version: 1, destinations: item.baseline.metadata, pending: null }).destinations.length !== item.baseline.metadata.length
    || item.changes.some(change => !change || !validDestinationId(change.id) || change.before === null && change.after === null
      || change.before !== null && (!validEntry(change.before) || change.before.metadata.id !== change.id)
      || change.after !== null && (!validEntry(change.after) || change.after.metadata.id !== change.id))
    || new Set(item.changes.map(c => c.id)).size !== item.changes.length) return null;
  const expected = baselineEntries(item.baseline.policy, item.baseline.metadata, item.baseline.pins);
  // Frozen pre-grouping baselines remain readable. Reconciliation still checks
  // the current policy/revision and never rewrites a saved proposal in place.
  const legacy = !same(expected, item.baseline.entries)
    && same(baselineEntries(item.baseline.policy, item.baseline.metadata, item.baseline.pins, false), item.baseline.entries);
  if (!same(expected, item.baseline.entries) && !legacy || item.changes.some(change => !same(change.before,
    item.baseline.entries.find(entry => entry.metadata.id === change.id) ?? null))) return null;
  if (item.editor !== null) {
    const e = item.editor;
    if (!e || e.id !== null && !validDestinationId(e.id) || typeof e.name !== 'string' || e.name.length > 100
      || typeof e.hostname !== 'string' || e.hostname.length > 253 || typeof e.category !== 'string' || e.category.length > 64
      || typeof e.extra !== 'string' || e.extra.length > 4000 || !['WHITELIST', 'BLACKLIST', 'PRESERVE'].includes(e.access)
      || typeof e.www !== 'boolean' || typeof e.pinned !== 'boolean'
      || e.includeSubdomains !== undefined && typeof e.includeSubdomains !== 'boolean') return null;
  }
  return structuredClone(item);
}
