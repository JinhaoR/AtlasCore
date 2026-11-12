import { normalizeTarget } from '@atlas/core';
import { parse } from 'tldts';
/** Presentation validation for an explicit Vault proposal, never authorization.
 * The private PSL section prevents selecting a whole hosting provider suffix. */
export function canUseSubdomainScope(hostname) {
    const target = normalizeTarget({ hostname: hostname.trim() });
    if (!target)
        return false;
    const parsed = parse(target.hostname, { allowPrivateDomains: true });
    return !parsed.isIp && (parsed.isIcann === true || parsed.isPrivate === true) && parsed.domain !== null
        && parsed.publicSuffix !== target.hostname;
}
export function subdomainScopeDescription(hostname) {
    const target = normalizeTarget({ hostname: hostname.trim() });
    if (!target || !canUseSubdomainScope(hostname))
        return 'Choose a registered hostname before including all subdomains.';
    return `Includes ${target.hostname} and every current or future subdomain at any depth. This is broad permission; enable it only when you deliberately trust the whole scope. Manual and managed blocking rules still apply to this scope.`;
}
