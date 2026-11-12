/** A normalized, exact hostname. It carries no permission by itself. */
export interface SiteTarget {
  readonly hostname: string;
}

/** Exact entries stay exact. Optional scope bases cover themselves and all DNS-label descendants. */
export interface Policy {
  readonly whitelist: readonly string[];
  readonly blacklist: readonly string[];
  readonly whitelistSubdomains?: readonly string[];
}

/** Only ALLOW authorizes access; GREYLIST does not start a workflow. */
export type Decision =
  | { readonly outcome: "ALLOW"; readonly reason: "WHITELISTED"; readonly target: SiteTarget }
  | { readonly outcome: "ALLOW"; readonly reason: "WHITELISTED_SCOPE"; readonly target: SiteTarget; readonly scopeRoot: string }
  | { readonly outcome: "DENY"; readonly reason: "BLACKLISTED"; readonly target: SiteTarget }
  | { readonly outcome: "GREYLIST"; readonly reason: "UNLISTED"; readonly target: SiteTarget }
  | { readonly outcome: "DENY"; readonly reason: "INVALID_TARGET" | "INVALID_POLICY" };
