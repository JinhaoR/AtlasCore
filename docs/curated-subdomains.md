# Bundled site subdomains

The November 2026 developer-approved update enables the existing subdomain scope
for bundled sites. Core matching and precedence are unchanged. Scope starts at a
literal catalog hostname, never its inferred registrable parent: `drive.google.com`
includes descendants of that host, not `google.com` or `www.google.com`. No global
apex/www equivalence is introduced. Public/private suffixes cannot be scope roots.

Fresh installations keep the catalog's exact terms and add its minimal set of
covering scope roots. Existing installations receive one startup migration,
`curated-subdomains-2026-11-v1`, before the controller opens. It widens only catalog
hosts still explicitly allowed, skips manually Blacklisted and removed hosts,
and preserves all custom terms and configuration. Existing broader scopes remain.
Skipping a removed hostname means not adding a scope rooted there. A removed child
can still become covered by its retained parent's new scope; that is the expressly
requested descendant coverage. An exact manual Blacklist still blocks that child.
The complete outcome receipt and authority envelope commit in one strict IndexedDB
transaction. Subsequent startups only read it; removing a scope later is respected.
Frozen expansion v2/v3 receipts remain unchanged and independently validated.

Exact child terms are retained internally: deleting them would remove their
explicit exceptions to managed blocking. Broad scopes never override managed
blocking, and exact manual Blacklist rules continue to win. No new exact hosts are
added by this migration. Ordinary later additions still require Vault.

Plain duplicate child entries are grouped with the closest eligible bundled parent
in Home and Sites. Named/categorized entries and pinned shortcuts remain separate.
Grouping changes no saved identity or permission; exact search targets remain
available. Existing drafts and frozen Vault proposals are not rewritten. A policy
revision change makes old protected workflows stale under the usual Core rules;
no waiting period, confirmation, grant or Journey is reset or renewed.

The migration is independent of UI polish and release preparation. No version bump,
signed artifact changes, deployment or normal-profile mutation is part of this work.

## Verification and limits

The catalog remains **294 exact hosts / 122 services**, with **132 minimal scope
roots** on a fresh installation. No new exact destinations were added. Each
catalog host's descendants are checked, including deep DNS-label boundaries and
Google service siblings. Manual Blacklist and managed-block precedence are tested
through the Core planner. Existing exact exceptions are retained.

An isolated signed-0.2.7 upgrade fixture widens `kth.se` and `drive.google.com`,
skips manually blocked `github.com` and removed defaults, groups a plain physics
child, retains named/pinned children and survives a complete Firefox restart.
Pins, named pages, categories/layout, settings, staged drafts and frozen proposal
contents remain saved. The draft becomes stale as expected when policy revision
changes. Native Firefox confirms `www.google.com` still enters Greylist.

Evidence and commands: [verification record](evidence/curated-scopes/README.md).
Storage tests cover aborted writes, corrupted/orphan markers, concurrent startup,
stale-controller conflicts, lost replies, subsequent removal and read-only repeat
startup. Historical broad-scope draft baselines remain readable; invalid fabricated
entries do not. Very large parent groups retain overflow as separate entries at
the existing 100-host editor bound. All customized names/categories, pins and
explicit child scopes remain separate. Grouping never deletes underlying terms.

This intentionally trusts every current/future descendant of each included root,
including user-hosted pages under university domains, subject to blocking precedence.
It is not limited to academic or login content. New manual sites still default to
exact matching; they are not widened by this migration. Existing user-added Google
permissions are neither removed nor expanded to an inferred parent.
