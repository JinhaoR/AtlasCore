import { evaluate, isManagedBlacklist, managedBlacklistContains, validateAtlasSnapshot,
  type AtlasSnapshot, type ManagedBlacklist } from '@atlas/core';
import { legacyCuratedUpgradeHosts, legacyCuratedUpgradeId } from './curated-upgrade-v2.js';

/** Fixed release maintenance operation. Never accepts destinations from a command. */
export const curatedUpgradeId = 'research-infrastructure-2026-10-v3';
export const curatedUpgradeKey = `curated:${curatedUpgradeId}`;
// This revision only withdraws Wikipedia from default additions. Already-applied
// v2 receipts remain valid and prevent any later reapplication to existing users.
const withdrawn = new Set(['wikipedia.org', 'www.wikipedia.org', 'en.wikipedia.org', 'sv.wikipedia.org']);
export const curatedUpgradeHosts: readonly string[] = Object.freeze(legacyCuratedUpgradeHosts.filter(host => !withdrawn.has(host)));
export interface CuratedUpgradeReceipt {
  readonly id: typeof curatedUpgradeId | typeof legacyCuratedUpgradeId;
  readonly kind: 'INITIALIZED' | 'UPGRADED';
  readonly policyRevisionBefore: number;
  readonly policyRevisionAfter: number;
  readonly added: readonly string[];
  readonly alreadyPresent: readonly string[];
  readonly skippedBlacklisted: readonly string[];
  readonly skippedManaged: readonly string[];
}
export type CuratedUpgradeResult = { readonly type: 'APPLIED' | 'ALREADY_APPLIED'; readonly receipt: CuratedUpgradeReceipt }
  | { readonly type: 'UNINITIALIZED' | 'UNAVAILABLE' };

const fields = ['id', 'kind', 'policyRevisionBefore', 'policyRevisionAfter', 'added', 'alreadyPresent', 'skippedBlacklisted', 'skippedManaged'];
/** Receipt validity includes complete fixed-catalog coverage. Changing this catalog needs a new ID. */
export function readCuratedUpgradeReceipt(input: unknown): CuratedUpgradeReceipt | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))
    || (value.id !== curatedUpgradeId && value.id !== legacyCuratedUpgradeId) || (value.kind !== 'INITIALIZED' && value.kind !== 'UPGRADED')
    || !Number.isSafeInteger(value.policyRevisionBefore) || (value.policyRevisionBefore as number) < 0
    || !Number.isSafeInteger(value.policyRevisionAfter) || (value.policyRevisionAfter as number) < 0) return null;
  const lists = [value.added, value.alreadyPresent, value.skippedBlacklisted, value.skippedManaged];
  if (!lists.every(list => Array.isArray(list) && [...list].every(host => typeof host === 'string'))) return null;
  const hosts = (lists as string[][]).flat();
  const expected = value.id === curatedUpgradeId ? curatedUpgradeHosts : legacyCuratedUpgradeHosts;
  if (hosts.length !== expected.length || new Set(hosts).size !== hosts.length
    || [...hosts].sort().some((host, index) => host !== expected[index])) return null;
  const before = value.policyRevisionBefore as number, after = value.policyRevisionAfter as number;
  if (value.kind === 'INITIALIZED' ? before !== 0 || after !== 0
    : after !== before + ((value.added as string[]).length ? 1 : 0)) return null;
  if (value.kind === 'INITIALIZED' && ((value.added as string[]).length !== expected.length
    || (lists.slice(1) as string[][]).some(list => list.length))) return null;
  return Object.freeze({ id: value.id, kind: value.kind,
    policyRevisionBefore: before, policyRevisionAfter: after,
    added: Object.freeze([...(value.added as string[])]), alreadyPresent: Object.freeze([...(value.alreadyPresent as string[])]),
    skippedBlacklisted: Object.freeze([...(value.skippedBlacklisted as string[])]), skippedManaged: Object.freeze([...(value.skippedManaged as string[])]) });
}

export function planCuratedUpgrade(input: unknown, managed?: ManagedBlacklist):
  { readonly snapshot: AtlasSnapshot; readonly receipt: CuratedUpgradeReceipt } | null {
  const validated = validateAtlasSnapshot(input);
  if (!validated.ok || (managed !== undefined && !isManagedBlacklist(managed))) return null;
  const snapshot = validated.snapshot;
  const existing = new Set(snapshot.policy.whitelist), denied = new Set(snapshot.policy.blacklist);
  const added: string[] = [], alreadyPresent: string[] = [], skippedBlacklisted: string[] = [], skippedManaged: string[] = [];
  for (const host of curatedUpgradeHosts) {
    if (denied.has(host)) skippedBlacklisted.push(host);
    else if (existing.has(host) || snapshot.policy.whitelistSubdomains?.length
      && evaluate({ hostname: host }, snapshot.policy).outcome === 'ALLOW') alreadyPresent.push(host);
    else if (managed !== undefined && managedBlacklistContains(managed, host)) skippedManaged.push(host);
    else added.push(host);
  }
  const policyRevision = snapshot.policyRevision + (added.length ? 1 : 0);
  if (!Number.isSafeInteger(policyRevision)) return null;
  const candidate = validateAtlasSnapshot({ ...snapshot, policyRevision,
    policy: { ...snapshot.policy, whitelist: [...snapshot.policy.whitelist, ...added], blacklist: snapshot.policy.blacklist } });
  if (!candidate.ok) return null;
  const receipt = readCuratedUpgradeReceipt({ id: curatedUpgradeId, kind: 'UPGRADED',
    policyRevisionBefore: snapshot.policyRevision, policyRevisionAfter: policyRevision,
    added, alreadyPresent, skippedBlacklisted, skippedManaged });
  return receipt ? { snapshot: candidate.snapshot, receipt } : null;
}

export function initialCuratedReceipt(): CuratedUpgradeReceipt {
  return readCuratedUpgradeReceipt({ id: curatedUpgradeId, kind: 'INITIALIZED', policyRevisionBefore: 0,
    policyRevisionAfter: 0, added: curatedUpgradeHosts, alreadyPresent: [], skippedBlacklisted: [], skippedManaged: [] })!;
}
