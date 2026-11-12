import type { Decision, Policy } from "./models.js";
import { normalizePolicy } from "./policy.js";
import { normalizeTarget } from "./target.js";

/** Pure evaluation of plain input data. No state, time, storage, or side effects. */
export function evaluate(requestedSite: unknown, currentPolicy: unknown): Decision {
  return evaluateNormalized(requestedSite, normalizePolicy(currentPolicy));
}

/** Evaluate a collection against one fully validated policy. No retained authority or cache. */
export function evaluateMany(requestedSites: readonly unknown[], currentPolicy: unknown): readonly Decision[] {
  const policy = normalizePolicy(currentPolicy);
  return requestedSites.map(site => evaluateNormalized(site, policy));
}

function evaluateNormalized(requestedSite: unknown, policy: Policy | null): Decision {
  if (policy === null) return { outcome: "DENY", reason: "INVALID_POLICY" };

  const target = normalizeTarget(requestedSite);
  if (target === null) return { outcome: "DENY", reason: "INVALID_TARGET" };

  if (policy.blacklist.includes(target.hostname)) {
    return { outcome: "DENY", reason: "BLACKLISTED", target };
  }
  if (policy.whitelist.includes(target.hostname)) {
    return { outcome: "ALLOW", reason: "WHITELISTED", target };
  }
  let scopeRoot: string | undefined;
  for (const root of policy.whitelistSubdomains ?? []) {
    if ((target.hostname === root || target.hostname.endsWith(`.${root}`))
      && (scopeRoot === undefined || root.length > scopeRoot.length)) scopeRoot = root;
  }
  if (scopeRoot !== undefined) return { outcome: "ALLOW", reason: "WHITELISTED_SCOPE", target, scopeRoot };
  return { outcome: "GREYLIST", reason: "UNLISTED", target };
}
