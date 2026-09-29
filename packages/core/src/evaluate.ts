import type { Decision } from "./models.js";
import { normalizePolicy } from "./policy.js";
import { normalizeTarget } from "./target.js";

/** Pure evaluation of plain input data. No state, time, storage, or side effects. */
export function evaluate(requestedSite: unknown, currentPolicy: unknown): Decision {
  const policy = normalizePolicy(currentPolicy);
  if (policy === null) return { outcome: "DENY", reason: "INVALID_POLICY" };

  const target = normalizeTarget(requestedSite);
  if (target === null) return { outcome: "DENY", reason: "INVALID_TARGET" };

  if (policy.blacklist.includes(target.hostname)) {
    return { outcome: "DENY", reason: "BLACKLISTED", target };
  }
  if (policy.whitelist.includes(target.hostname)) {
    return { outcome: "ALLOW", reason: "WHITELISTED", target };
  }
  return { outcome: "GREYLIST", reason: "UNLISTED", target };
}
