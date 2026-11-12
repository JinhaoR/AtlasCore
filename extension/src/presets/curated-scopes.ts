import { normalizeTarget, validateAtlasSnapshot, type AtlasSnapshot } from '@atlas/core';
import { parse } from 'tldts';
import { curatedUpgradeHosts } from './curated-upgrade.js';

// Frozen v3 exact catalog, not a live list that can grow under an existing receipt.
export const curatedScopeId = 'curated-subdomains-2026-11-v1';
export const curatedScopeKey = `curated:${curatedScopeId}`;
export const curatedScopeHosts = curatedUpgradeHosts;
const coveredBy = (host: string, root: string) => host === root || host.endsWith(`.${root}`);

/** Source-level preset compilation only. Never infer a parent or authorize a request. */
export function curatedScopeRoots(hosts: readonly string[]): readonly string[] {
  const unique = [...new Set(hosts)];
  for (const host of unique) {
    const p = parse(host, { allowPrivateDomains: true });
    if (normalizeTarget({ hostname: host })?.hostname !== host || p.isIp || !p.domain
      || !(p.isIcann || p.isPrivate) || p.publicSuffix === host
      || host === 'google.com' || host === 'www.google.com') throw new TypeError('INVALID_CURATED_SCOPE');
  }
  return unique.filter(host => !unique.some(root => root !== host && coveredBy(host, root))).sort();
}

export const initialCuratedScopes = Object.freeze(curatedScopeRoots(curatedScopeHosts));
export interface CuratedScopeReceipt {
  readonly id: typeof curatedScopeId;
  readonly kind: 'INITIALIZED' | 'UPGRADED';
  readonly policyRevisionBefore: number;
  readonly policyRevisionAfter: number;
  readonly added: readonly string[];
  readonly alreadyPresent: readonly string[];
  readonly covered: readonly string[];
  readonly skippedBlacklisted: readonly string[];
  readonly skippedNotAllowed: readonly string[];
}
export type CuratedScopeResult = { readonly type: 'APPLIED' | 'ALREADY_APPLIED'; readonly receipt: CuratedScopeReceipt }
  | { readonly type: 'UNAVAILABLE' | 'UNINITIALIZED' };
const lists = ['added', 'alreadyPresent', 'covered', 'skippedBlacklisted', 'skippedNotAllowed'] as const;
const fields = ['id', 'kind', 'policyRevisionBefore', 'policyRevisionAfter', ...lists];

export function readCuratedScopeReceipt(input: unknown): CuratedScopeReceipt | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const r = input as CuratedScopeReceipt;
  if (Object.keys(r).length !== fields.length || !fields.every(key => Object.hasOwn(r, key))
    || r.id !== curatedScopeId || !['INITIALIZED', 'UPGRADED'].includes(r.kind)
    || !Number.isSafeInteger(r.policyRevisionBefore) || r.policyRevisionBefore < 0
    || !Number.isSafeInteger(r.policyRevisionAfter) || r.policyRevisionAfter < 0
    || !lists.every(key => Array.isArray(r[key]) && r[key].every(host => typeof host === 'string'))) return null;
  const hosts = lists.flatMap(key => r[key]);
  if (hosts.length !== curatedScopeHosts.length || new Set(hosts).size !== hosts.length
    || hosts.sort().some((host, i) => host !== curatedScopeHosts[i])) return null;
  if (r.kind === 'INITIALIZED') {
    if (r.policyRevisionBefore !== 0 || r.policyRevisionAfter !== 0 || r.alreadyPresent.length
      || r.skippedBlacklisted.length || r.skippedNotAllowed.length
      || JSON.stringify([...r.added].sort()) !== JSON.stringify(initialCuratedScopes)) return null;
  } else if (r.policyRevisionAfter !== r.policyRevisionBefore + (r.added.length ? 1 : 0)) return null;
  if (r.covered.some(host => !r.added.some(root => root !== host && coveredBy(host, root)))) return null;
  return Object.freeze({ ...r, ...Object.fromEntries(lists.map(key => [key, Object.freeze([...r[key]])])) });
}

export function initialCuratedScopeReceipt(): CuratedScopeReceipt {
  return readCuratedScopeReceipt({ id: curatedScopeId, kind: 'INITIALIZED', policyRevisionBefore: 0, policyRevisionAfter: 0,
    added: initialCuratedScopes, covered: curatedScopeHosts.filter(host => !initialCuratedScopes.includes(host)),
    alreadyPresent: [], skippedBlacklisted: [], skippedNotAllowed: [] })!;
}

/** One fixed maintenance operation. No commands, URLs or arbitrary candidate roots. */
export function planCuratedScopes(input: unknown): { snapshot: AtlasSnapshot; receipt: CuratedScopeReceipt } | null {
  const validated = validateAtlasSnapshot(input);
  if (!validated.ok) return null;
  const snapshot = validated.snapshot, policy = snapshot.policy;
  const existing = policy.whitelistSubdomains ?? [];
  const skippedBlacklisted = curatedScopeHosts.filter(host => policy.blacklist.includes(host));
  const eligible = curatedScopeHosts.filter(host => !skippedBlacklisted.includes(host)
    && (policy.whitelist.includes(host) || existing.includes(host)));
  const skippedNotAllowed = curatedScopeHosts.filter(host => !skippedBlacklisted.includes(host) && !eligible.includes(host));
  const alreadyPresent = eligible.filter(host => existing.some(root => coveredBy(host, root)));
  const needed = eligible.filter(host => !alreadyPresent.includes(host));
  const added = curatedScopeRoots(needed), covered = needed.filter(host => !added.includes(host));
  const revision = snapshot.policyRevision + (added.length ? 1 : 0);
  const next = validateAtlasSnapshot({ ...snapshot, policyRevision: revision,
    policy: added.length ? { ...policy, whitelistSubdomains: [...existing, ...added] } : policy });
  const receipt = readCuratedScopeReceipt({ id: curatedScopeId, kind: 'UPGRADED',
    policyRevisionBefore: snapshot.policyRevision, policyRevisionAfter: revision,
    added, alreadyPresent, covered, skippedBlacklisted, skippedNotAllowed });
  return next.ok && receipt ? { snapshot: next.snapshot, receipt } : null;
}
