import { normalizeTarget, type AtlasSnapshot, type Policy } from '@atlas/core';

export interface DestinationMetadata {
  readonly id: string; readonly label: string; readonly category: string;
  readonly primaryHostname: string; readonly hostnames: readonly string[];
}
export interface DestinationPreferences {
  readonly version: 1;
  readonly destinations: readonly DestinationMetadata[];
  readonly pending: null | {
    readonly proposalId: number; readonly basePolicyRevision: number; readonly candidatePolicy: Policy;
    readonly destination: DestinationMetadata | null; readonly removedId: string | null; readonly pin: boolean;
  };
}
export const destinationPreferencesKey = 'atlas-destinations-v1';
export const emptyDestinationPreferences = (): DestinationPreferences => ({ version: 1, destinations: [], pending: null });
export const validDestinationId = (id: unknown): id is string => typeof id === 'string' && /^(host|service):[a-z0-9.-]{1,253}$/.test(id);
const hostname = (value: unknown): value is string => typeof value === 'string' && normalizeTarget({ hostname: value })?.hostname === value;

function metadata(value: unknown): DestinationMetadata | null {
  if (value === null || typeof value !== 'object') return null;
  const item = value as DestinationMetadata;
  if (!validDestinationId(item.id) || typeof item.label !== 'string' || item.label.trim().length === 0 || item.label.length > 100
    || typeof item.category !== 'string' || item.category.trim().length === 0 || item.category.length > 64
    || !hostname(item.primaryHostname) || !Array.isArray(item.hostnames) || item.hostnames.length === 0 || item.hostnames.length > 100
    || !item.hostnames.every(hostname) || new Set(item.hostnames).size !== item.hostnames.length
    || !item.hostnames.includes(item.primaryHostname)) return null;
  return { id: item.id, label: item.label, category: item.category, primaryHostname: item.primaryHostname, hostnames: [...item.hostnames] };
}

export function readDestinationPreferences(value: unknown): DestinationPreferences {
  if (value === null || typeof value !== 'object') return emptyDestinationPreferences();
  const stored = value as DestinationPreferences;
  if (stored.version !== 1 || !Array.isArray(stored.destinations) || stored.destinations.length > 2000) return emptyDestinationPreferences();
  const destinations = stored.destinations.map(metadata);
  if (destinations.some(item => item === null) || new Set(destinations.map(item => item!.id)).size !== destinations.length) return emptyDestinationPreferences();
  const hosts = destinations.flatMap(item => item!.hostnames);
  if (new Set(hosts).size !== hosts.length) return emptyDestinationPreferences();
  let pending: DestinationPreferences['pending'] = null;
  if (stored.pending != null) {
    const item = stored.pending;
    const destination = item.destination === null ? null : metadata(item.destination);
    const policy = item.candidatePolicy;
    if (Number.isSafeInteger(item.proposalId) && item.proposalId > 0 && Number.isSafeInteger(item.basePolicyRevision) && item.basePolicyRevision >= 0
      && (item.destination === null || destination !== null) && (item.removedId === null || validDestinationId(item.removedId))
      && typeof item.pin === 'boolean' && policy && Array.isArray(policy.whitelist) && Array.isArray(policy.blacklist)
      && policy.whitelist.length + policy.blacklist.length <= 10000 && [...policy.whitelist, ...policy.blacklist].every(hostname)) {
      pending = { proposalId: item.proposalId, basePolicyRevision: item.basePolicyRevision,
        candidatePolicy: { whitelist: [...policy.whitelist], blacklist: [...policy.blacklist] }, destination, removedId: item.removedId, pin: item.pin };
    }
  }
  return { version: 1, destinations: destinations as DestinationMetadata[], pending };
}

const samePolicy = (a: Policy, b: Policy) => ['whitelist', 'blacklist'].every(key =>
  JSON.stringify([...a[key as keyof Policy]].sort()) === JSON.stringify([...b[key as keyof Policy]].sort()));

/** An explicit display edit owns its named terms, including any retired metadata. */
export function replaceDestinationMetadata(entries: readonly DestinationMetadata[], destination: DestinationMetadata | null, removedId: string | null): readonly DestinationMetadata[] {
  const claimed = new Set(destination?.hostnames ?? []);
  const next = entries.flatMap(item => {
    if (item.id === removedId || item.id === destination?.id) return [];
    const hostnames = item.hostnames.filter(host => !claimed.has(host));
    if (hostnames.length === 0) return [];
    return [{ ...item, hostnames, primaryHostname: hostnames.includes(item.primaryHostname) ? item.primaryHostname : hostnames[0]! }];
  });
  if (destination === null) return next;
  // Ordinary renames/categories retain their position; this is not category ordering.
  const index = entries.findIndex(item => item.id === removedId || item.id === destination.id);
  if (index < 0) return [...next, destination];
  const preceding = entries.slice(0, index).filter(item => next.some(entry => entry.id === item.id)).length;
  return [...next.slice(0, preceding), destination, ...next.slice(preceding)];
}

/** Only a verified matching Vault commit activates proposed presentation. No permissions come from this store. */
export function reconcileDestinationPreferences(preferences: DestinationPreferences, snapshot: AtlasSnapshot): {
  preferences: DestinationPreferences; pinChange: { id: string; pinned: boolean } | null;
} {
  const pending = preferences.pending;
  if (pending === null || snapshot.vaultState.pendingProposal?.id === pending.proposalId) return { preferences, pinChange: null };
  const committed = snapshot.vaultState.lastApplied?.proposalId === pending.proposalId
    && (snapshot.policyRevision === pending.basePolicyRevision || snapshot.policyRevision === pending.basePolicyRevision + 1)
    && samePolicy(snapshot.policy, pending.candidatePolicy);
  if (!committed) return { preferences: { ...preferences, pending: null }, pinChange: null };
  const removedId = pending.removedId ?? pending.destination?.id;
  const destinations = replaceDestinationMetadata(preferences.destinations, pending.destination, removedId ?? null);
  return { preferences: { version: 1, destinations, pending: null }, pinChange: removedId == null ? null
    : { id: removedId, pinned: pending.destination !== null && pending.pin } };
}
