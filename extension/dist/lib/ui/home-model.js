import { curatedWhitelist, serviceHostnames } from '../presets/curated-whitelist.js';
/** Presentation identity only. A saved pin cannot make an inactive destination available. */
export function destinationId(entry) {
    if (entry.id !== undefined)
        return entry.id;
    for (const group of curatedWhitelist)
        for (const service of group.services) {
            if (serviceHostnames(service).includes(entry.hostname))
                return `service:${service.hostname}`;
        }
    return `host:${entry.hostname}`;
}
export function readPins(value) {
    if (!Array.isArray(value) || value.length > 200 || value.some((id) => typeof id !== 'string'
        || id.length > 260 || !/^(service|host):[a-z0-9.-]+$/.test(id)))
        return [];
    return [...new Set(value)];
}
export function pinnedDestinations(entries, pins) {
    const active = new Map(entries.map((entry) => [destinationId(entry), entry]));
    const selected = new Set();
    return pins.flatMap(id => {
        const entry = active.get(id) ?? (id.startsWith('host:') ? entries.find(item => item.hostnames.includes(id.slice(5))) : undefined);
        if (entry === undefined || selected.has(destinationId(entry)))
            return [];
        selected.add(destinationId(entry));
        return [entry];
    });
}
export function updateDestinationPin(pins, id, pinned, hosts = []) {
    const related = new Set([id, ...hosts.map(host => `host:${host}`)]);
    const next = [];
    let placed = false;
    for (const pin of pins) {
        if (!related.has(pin))
            next.push(pin);
        else if (pinned && !placed) {
            next.push(id);
            placed = true;
        }
    }
    if (pinned && !placed)
        next.push(id);
    return next;
}
/** Preserve distinct active entry points; aliases do not create duplicate service cards. */
export function destinationEntryPoints(entry) {
    for (const group of curatedWhitelist)
        for (const service of group.services) {
            if (!serviceHostnames(service).includes(entry.hostname))
                continue;
            const active = [service.hostname, ...(service.destinations ?? [])].filter((hostname) => entry.hostnames.includes(hostname));
            return active.length > 0 ? active : [entry.hostname];
        }
    return [entry.hostname];
}
