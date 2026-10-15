import { evaluate } from '@atlas/core';
import { parse } from 'tldts';
import { curatedWhitelist, serviceHostnames } from '../presets/curated-whitelist.js';
import { canonicalCategory, categorySuggestions } from './categories.js';
/** Local display index of effective Whitelist hosts, never an authorization cache. */
export function destinationIndex(policy, metadata = []) {
    const active = new Set(policy.whitelist.filter((hostname) => evaluate({ hostname }, policy).outcome === 'ALLOW'));
    const entries = [];
    for (const item of metadata) {
        const hostnames = item.hostnames.filter(host => active.has(host));
        if (hostnames.length === 0)
            continue;
        entries.push({ id: item.id, label: item.label, category: item.category,
            hostname: hostnames.includes(item.primaryHostname) ? item.primaryHostname : hostnames[0], hostnames });
        hostnames.forEach(host => active.delete(host));
    }
    for (const group of curatedWhitelist)
        for (const service of group.services) {
            const hostnames = serviceHostnames(service).filter((hostname) => active.has(hostname));
            if (hostnames.length === 0)
                continue;
            entries.push({ id: `service:${service.hostname}`, label: service.label, hostname: hostnames[0], hostnames, category: group.label });
            hostnames.forEach((hostname) => active.delete(hostname));
        }
    for (const hostname of [...active].sort())
        entries.push({ label: hostname, hostname, hostnames: [hostname], category: 'Your destinations' });
    const curatedIds = curatedWhitelist.flatMap(group => group.services.map(service => `service:${service.hostname}`));
    const order = (entry) => { const index = curatedIds.indexOf(entry.id ?? ''); return index < 0 ? curatedIds.length : index; };
    const categories = categorySuggestions(metadata.map(item => item.category));
    return entries.sort((a, b) => order(a) - order(b)).map(entry => ({ ...entry, category: canonicalCategory(entry.category, categories) }));
}
/** All committed terms, including Blacklist, are visible; metadata supplies no terms. */
export function policyDestinationIndex(policy, metadata = []) {
    return destinationIndex({ whitelist: [...new Set([...policy.whitelist, ...policy.blacklist])], blacklist: [] }, metadata);
}
export function searchDestinations(entries, query) {
    const words = query.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
    if (words.length === 0)
        return [];
    return entries.filter((entry) => words.every((word) => `${entry.label} ${entry.hostnames.join(' ')}`.toLocaleLowerCase('en').includes(word)));
}
/** Search chooses an address from known exact terms; the adapter must still authorize opening it. */
export function searchDestinationTargets(entries, query) {
    const term = query.trim().toLocaleLowerCase('en');
    if (!term)
        return [];
    const exact = entries.flatMap(entry => entry.hostnames.includes(term) ? [{ entry, hostname: term, match: 'EXACT_HOST' }] : []);
    if (exact.length)
        return exact;
    // A complete unknown address must not silently turn into a similar known hostname.
    const address = parse(term, { allowPrivateDomains: true });
    if (address.domain !== null && (address.isIcann || address.isPrivate) && !term.endsWith('.'))
        return [];
    const words = term.split(/\s+/);
    return searchDestinations(entries, query).flatMap(entry => {
        if (words.every(word => entry.label.toLocaleLowerCase('en').includes(word)))
            return [{ entry, hostname: entry.hostname, match: 'NAME' }];
        const service = curatedWhitelist.flatMap(group => group.services).find(item => serviceHostnames(item).includes(entry.hostname));
        const points = [service?.hostname ?? entry.hostname, ...(service?.destinations ?? [])];
        const hosts = entry.hostnames.filter(host => words.every(word => host.includes(word)));
        if (!hosts.length)
            return [{ entry, hostname: entry.hostname, match: 'NAME' }];
        return hosts.map(hostname => ({ entry, hostname, match: points.includes(hostname) ? 'ENTRY_POINT'
                : service?.aliases?.includes(hostname) ? 'ALIAS' : 'HOST' }));
    });
}
