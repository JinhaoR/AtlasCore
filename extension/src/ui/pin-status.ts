import { evaluate } from '@atlas/core';
import type { AdapterView } from '../adapter/firefox-adapter.js';
import { hasCommittedCollection } from './data-view.js';

/** Display of acknowledged rules only. Opening always obtains a fresh Core decision. */
export function pinAccessStatus(view: AdapterView | null, url: string, now: number): string {
  const state = view?.controller;
  if (!hasCommittedCollection(state) || !state?.snapshot) return 'Access unverified';
  const result = evaluate(url, state.snapshot.policy);
  if (result.outcome === 'DENY') return 'Blocked';
  if (result.outcome === 'ALLOW') return result.reason === 'WHITELISTED_SCOPE' ? 'Domain rule · safety checks apply' : 'Allowed';
  if ('target' in result) {
    const host = result.target.hostname;
    if (view?.temporaryAccess?.some(g => g.hostnames.includes(host) && g.expiresAt > now)) return 'Temporary access';
    if (view?.pendingAccess?.some(g => g.hostnames.includes(host) && g.confirmBy > now)) return 'Access request in progress';
  }
  return 'No saved access rule · checked when opened';
}
