import { evaluate, evaluateMany } from '@atlas/core';
import { parse } from 'tldts';
import { curatedServiceCatalog, serviceHostnames } from '../presets/curated-whitelist.js';
import { canonicalCategory, categorySuggestions } from './categories.js';
/** Local display index of effective Whitelist hosts, never an authorization cache. */
export function destinationIndex(policy, metadata = [], pins = []) {
    // Scope roots are saved destinations. Their children are never enumerated or
    // manufactured as launchers; every actual navigation still goes through Core.
    const hosts = [...policy.whitelist, ...(policy.whitelistSubdomains ?? [])];
    const decisions = evaluateMany(hosts, policy);
    const active = new Set(hosts.filter((_, index) => decisions[index].outcome === 'ALLOW'));
    return groupDestinationHosts(active, metadata, policy, pins);
}
/** Group already-selected display terms. This function makes no access decision. */
function groupDestinationHosts(active, metadata, policy, pins, mergeSubdomains = true) {
    const entries = [];
    const scoped = new Set(mergeSubdomains ? policy.whitelistSubdomains ?? [] : []);
    const initialHosts = new Set(active);
    const pinnedHost = (host) => pins.includes(`host:${host}`) || pins.includes(`service:${host}`);
    const catalogHosts = new Set(curatedServiceCatalog.flatMap(group => group.services.flatMap(service => serviceHostnames(service))));
    const possibleParent = (host) => [...scoped].some(root => catalogHosts.has(root) && initialHosts.has(root)
        && !policy.blacklist.includes(root) && host.endsWith(`.${root}`));
    for (const item of metadata) {
        const hostnames = item.hostnames.filter(host => active.has(host));
        if (hostnames.length === 0)
            continue;
        // Unannotated defaults may be folded into a broad bundled parent. Never
        // swallow named/categorized services, pins, explicit scopes or blocked terms.
        if (item.label === item.primaryHostname && item.category === 'Your destinations'
            && !pins.includes(item.id) && hostnames.every(host => !pinnedHost(host) && !catalogHosts.has(host)
            && !scoped.has(host) && !policy.blacklist.includes(host) && possibleParent(host)))
            continue;
        entries.push({ id: item.id, label: item.label, category: item.category,
            hostname: hostnames.includes(item.primaryHostname) ? item.primaryHostname : hostnames[0], hostnames });
        hostnames.forEach(host => active.delete(host));
    }
    for (const group of curatedServiceCatalog)
        for (const service of group.services) {
            const hostnames = serviceHostnames(service).filter((hostname) => active.has(hostname));
            if (hostnames.length === 0)
                continue;
            entries.push({ id: `service:${service.hostname}`, label: service.label, hostname: hostnames[0], hostnames, category: group.label });
            hostnames.forEach((hostname) => active.delete(hostname));
        }
    // Presentation only: keep exact child rules (including managed-list exceptions)
    // in policy, and expose their literal addresses under the closest scoped site.
    const parents = entries.flatMap((entry, index) => entry.hostnames.filter(host => catalogHosts.has(host)
        && scoped.has(host) && !policy.blacklist.includes(host)).map(root => ({ root, index })))
        .sort((a, b) => b.root.length - a.root.length);
    for (const host of [...active].sort()) {
        if (pinnedHost(host) || scoped.has(host) || policy.blacklist.includes(host))
            continue;
        const parent = parents.find(({ root, index }) => host.endsWith(`.${root}`) && entries[index].hostnames.length < 100);
        if (!parent)
            continue;
        const entry = entries[parent.index];
        entries[parent.index] = { ...entry, hostnames: [...entry.hostnames, host] };
        active.delete(host);
    }
    for (const hostname of [...active].sort())
        entries.push({ label: hostname, hostname, hostnames: [hostname], category: 'Your destinations' });
    const curatedIds = curatedServiceCatalog.flatMap(group => group.services.map(service => `service:${service.hostname}`));
    const order = (entry) => { const index = curatedIds.indexOf(entry.id ?? ''); return index < 0 ? curatedIds.length : index; };
    const categories = categorySuggestions(metadata.map(item => item.category));
    return entries.sort((a, b) => order(a) - order(b)).map(entry => ({ ...entry, category: canonicalCategory(entry.category, categories) }));
}
/** All committed terms, including Blacklist, are visible; metadata supplies no terms. */
export function policyDestinationIndex(policy, metadata = [], pins = [], mergeSubdomains = true) {
    // Sites and draft baselines display BOTH lists. Re-evaluating each term as a
    // fabricated Whitelist repeatedly normalized the entire policy (quadratic).
    // Keep Core's full validation, then group the literal committed display terms.
    if (evaluate('presentation-validation.invalid', policy).reason === 'INVALID_POLICY')
        return [];
    return groupDestinationHosts(new Set([...policy.whitelist, ...policy.blacklist, ...(policy.whitelistSubdomains ?? [])]), metadata, policy, pins, mergeSubdomains);
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
        const service = curatedServiceCatalog.flatMap(group => group.services).find(item => serviceHostnames(item).includes(entry.hostname));
        const points = [service?.hostname ?? entry.hostname, ...(service?.destinations ?? [])];
        const hosts = entry.hostnames.filter(host => words.every(word => host.includes(word)));
        if (!hosts.length)
            return [{ entry, hostname: entry.hostname, match: 'NAME' }];
        return hosts.map(hostname => ({ entry, hostname, match: points.includes(hostname) ? 'ENTRY_POINT'
                : service?.aliases?.includes(hostname) ? 'ALIAS' : 'HOST' }));
    });
}
