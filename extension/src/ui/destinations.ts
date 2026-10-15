import { evaluate, type Policy } from '@atlas/core';
import { parse } from 'tldts';
import { curatedWhitelist, serviceHostnames } from '../presets/curated-whitelist.js';
import type { DestinationMetadata } from './destination-metadata.js';
import { canonicalCategory, categorySuggestions } from './categories.js';

export interface DestinationEntry { readonly id?: string; readonly label: string; readonly hostname: string; readonly hostnames: readonly string[]; readonly category: string }

/** Local display index of effective Whitelist hosts, never an authorization cache. */
export function destinationIndex(policy: Policy, metadata: readonly DestinationMetadata[] = []): readonly DestinationEntry[] {
  const active = new Set(policy.whitelist.filter((hostname) => evaluate({ hostname }, policy).outcome === 'ALLOW'));
  const entries: DestinationEntry[] = [];
  for (const item of metadata) {
    const hostnames = item.hostnames.filter(host => active.has(host));
    if (hostnames.length === 0) continue;
    entries.push({ id: item.id, label: item.label, category: item.category,
      hostname: hostnames.includes(item.primaryHostname) ? item.primaryHostname : hostnames[0]!, hostnames });
    hostnames.forEach(host => active.delete(host));
  }
  for (const group of curatedWhitelist) for (const service of group.services) {
    const hostnames = serviceHostnames(service).filter((hostname) => active.has(hostname));
    if (hostnames.length === 0) continue;
    entries.push({ id: `service:${service.hostname}`, label: service.label, hostname: hostnames[0]!, hostnames, category: group.label });
    hostnames.forEach((hostname) => active.delete(hostname));
  }
  for (const hostname of [...active].sort()) entries.push({ label: hostname, hostname, hostnames: [hostname], category: 'Your destinations' });
  const curatedIds = curatedWhitelist.flatMap(group => group.services.map(service => `service:${service.hostname}`));
  const order = (entry: DestinationEntry) => { const index = curatedIds.indexOf(entry.id ?? ''); return index < 0 ? curatedIds.length : index; };
  const categories = categorySuggestions(metadata.map(item => item.category));
  return entries.sort((a, b) => order(a) - order(b)).map(entry => ({ ...entry, category: canonicalCategory(entry.category, categories) }));
}

/** All committed terms, including Blacklist, are visible; metadata supplies no terms. */
export function policyDestinationIndex(policy: Policy, metadata: readonly DestinationMetadata[] = []): readonly DestinationEntry[] {
  return destinationIndex({ whitelist: [...new Set([...policy.whitelist, ...policy.blacklist])], blacklist: [] }, metadata);
}

export function searchDestinations(entries: readonly DestinationEntry[], query: string): readonly DestinationEntry[] {
  const words = query.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return entries.filter((entry) => words.every((word) => `${entry.label} ${entry.hostnames.join(' ')}`.toLocaleLowerCase('en').includes(word)));
}

export interface DestinationSearchResult {
  readonly entry: DestinationEntry; readonly hostname: string;
  readonly match: 'NAME' | 'EXACT_HOST' | 'ALIAS' | 'ENTRY_POINT' | 'HOST';
}

/** Search chooses an address from known exact terms; the adapter must still authorize opening it. */
export function searchDestinationTargets(entries: readonly DestinationEntry[], query: string): readonly DestinationSearchResult[] {
  const term = query.trim().toLocaleLowerCase('en');
  if (!term) return [];
  const exact = entries.flatMap(entry => entry.hostnames.includes(term) ? [{ entry, hostname: term, match: 'EXACT_HOST' as const }] : []);
  if (exact.length) return exact;
  // A complete unknown address must not silently turn into a similar known hostname.
  const address = parse(term, { allowPrivateDomains: true });
  if (address.domain !== null && (address.isIcann || address.isPrivate) && !term.endsWith('.')) return [];
  const words = term.split(/\s+/);
  return searchDestinations(entries, query).flatMap<DestinationSearchResult>(entry => {
    if (words.every(word => entry.label.toLocaleLowerCase('en').includes(word))) return [{ entry, hostname: entry.hostname, match: 'NAME' as const }];
    const service = curatedWhitelist.flatMap(group => group.services).find(item => serviceHostnames(item).includes(entry.hostname));
    const points = [service?.hostname ?? entry.hostname, ...(service?.destinations ?? [])];
    const hosts = entry.hostnames.filter(host => words.every(word => host.includes(word)));
    if (!hosts.length) return [{ entry, hostname: entry.hostname, match: 'NAME' as const }];
    return hosts.map(hostname => ({ entry, hostname, match: points.includes(hostname) ? 'ENTRY_POINT' as const
      : service?.aliases?.includes(hostname) ? 'ALIAS' as const : 'HOST' as const }));
  });
}
