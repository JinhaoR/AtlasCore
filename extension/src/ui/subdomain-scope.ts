import { normalizeTarget } from '@atlas/core';
import { parse } from 'tldts';

/** Presentation validation for an explicit Vault proposal, never authorization.
 * The private PSL section prevents selecting a whole hosting provider suffix. */
export function canUseSubdomainScope(hostname: string): boolean {
  const target = normalizeTarget({ hostname: hostname.trim() });
  if (!target) return false;
  const parsed = parse(target.hostname, { allowPrivateDomains: true });
  return !parsed.isIp && (parsed.isIcann === true || parsed.isPrivate === true) && parsed.domain !== null
    && parsed.publicSuffix !== target.hostname;
}

export function subdomainScopeDescription(hostname: string): string {
  const target = normalizeTarget({ hostname: hostname.trim() });
  if (!target) return 'Enter a hostname such as example.com, without https:// or a path, before including its subdomains.';
  const parsed = parse(target.hostname, { allowPrivateDomains: true });
  if (parsed.publicSuffix === target.hostname && (parsed.isPrivate || parsed.isIcann)) {
    const kind = parsed.isPrivate ? 'a shared hosting suffix' : 'a public suffix';
    return `${target.hostname} is ${kind}, not one site's domain. Allowing all its subdomains would include unrelated sites. Enter your site's hostname, such as your-site.${target.hostname}. You can still add ${target.hostname} as an exact hostname with this option off.`;
  }
  if (!canUseSubdomainScope(hostname)) return 'Choose a registered hostname before including all subdomains.';
  return `Includes ${target.hostname} and every current or future subdomain at any depth. This is broad permission; enable it only when you deliberately trust the whole scope. Manual and managed blocking rules still apply to this scope.`;
}
