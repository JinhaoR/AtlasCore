/** A normalized, exact hostname. It carries no permission by itself. */
export interface SiteTarget {
  readonly hostname: string;
}

/** Entries are bare hostnames. Greylist is the default, never a stored list. */
export interface Policy {
  readonly whitelist: readonly string[];
  readonly blacklist: readonly string[];
}

/** Only ALLOW authorizes access; GREYLIST does not start a workflow. */
export type Decision =
  | { readonly outcome: "ALLOW"; readonly reason: "WHITELISTED"; readonly target: SiteTarget }
  | { readonly outcome: "DENY"; readonly reason: "BLACKLISTED"; readonly target: SiteTarget }
  | { readonly outcome: "GREYLIST"; readonly reason: "UNLISTED"; readonly target: SiteTarget }
  | { readonly outcome: "DENY"; readonly reason: "INVALID_TARGET" | "INVALID_POLICY" };
