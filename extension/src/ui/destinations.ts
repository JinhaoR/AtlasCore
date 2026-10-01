import { evaluate, type Policy } from '@atlas/core';
import { curatedWhitelist, serviceHostnames } from '../presets/curated-whitelist.js';

export interface DestinationEntry { readonly label: string; readonly hostname: string; readonly hostnames: readonly string[]; readonly category: string }

/** Local display index of effective Whitelist hosts, never an authorization cache. */
export function destinationIndex(policy: Policy): readonly DestinationEntry[] {
  const active = new Set(policy.whitelist.filter((hostname) => evaluate({ hostname }, policy).outcome === 'ALLOW'));
  const entries: DestinationEntry[] = [];
  for (const group of curatedWhitelist) for (const service of group.services) {
    const hostnames = serviceHostnames(service).filter((hostname) => active.has(hostname));
    if (hostnames.length === 0) continue;
    entries.push({ label: service.label, hostname: hostnames[0]!, hostnames, category: group.label });
    hostnames.forEach((hostname) => active.delete(hostname));
  }
  for (const hostname of [...active].sort()) entries.push({ label: hostname, hostname, hostnames: [hostname], category: 'Your destinations' });
  return entries;
}

export function searchDestinations(entries: readonly DestinationEntry[], query: string): readonly DestinationEntry[] {
  const words = query.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return entries.filter((entry) => words.every((word) => `${entry.label} ${entry.hostnames.join(' ')}`.toLocaleLowerCase('en').includes(word)));
}
