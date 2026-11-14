import { normalizeTarget } from '@atlas/core';
import { parse } from 'tldts';
/** Suggest two disclosed exact terms; this never supplies an authorization decision. */
export function commonWwwCounterpart(input) {
    const host = normalizeTarget({ hostname: input })?.hostname;
    if (host === undefined)
        return null;
    const base = host.startsWith('www.') ? host.slice(4) : host;
    const parsed = parse(base, { allowPrivateDomains: true });
    if (parsed.isIp || !parsed.isIcann && !parsed.isPrivate || parsed.domain !== base)
        return null;
    return host === base ? `www.${base}` : base;
}
export function explicitDestinationHosts(hostname, includeWww, extra) {
    const input = [hostname, ...extra.split(/[\s,]+/).filter(Boolean)];
    const hosts = input.map(value => normalizeTarget({ hostname: value })?.hostname);
    if (hosts.some(value => value === undefined))
        return null;
    const counterpart = commonWwwCounterpart(hostname);
    if (includeWww && counterpart !== null)
        hosts.push(counterpart);
    const unique = [...new Set(hosts)];
    return unique.length <= 100 ? unique : null;
}
