# Optional Whitelist subdomain scopes

Development 0.1.19 added an explicitly selected long-term permission for a hostname
and its DNS-label descendants. It remains off by default for manually added sites.
The approved [bundled-site subdomain update](curated-subdomains.md) now enables it
for curated defaults and once for still-allowed bundled hosts on upgrade. This
supersedes the earlier exact-only curated default; other additions still use Vault.

## Core policy contract

`Policy` retains `whitelist` and `blacklist`, and accepts an optional
`whitelistSubdomains: readonly string[]`. Values are ordinary normalized hostnames,
not wildcard expressions. A term `su.se` covers `su.se`, `fysik.su.se` and
`deep.fysik.su.se`; it does not cover `not-su.se` or `su.se.other.example`.
There is no inferred organization membership, supporting-domain relationship or
global apex/`www` equivalence. A `www` hostname falls inside an opted-in scope
because it is a DNS descendant, not because Atlas treats those names as aliases.

The optional collection can exist independently of exact entries. Missing and
empty collections mean no broad scopes. Legacy missing fields remain missing
when decoded; this avoids rewriting older frozen policy data merely to introduce
an empty field. Overlapping roots are permitted. The most specific matching root
is returned as `scopeRoot`.

Compatibility is forward: new code accepts legacy policies. Older Atlas versions
do not understand the optional field and reject a policy containing it rather
than dropping its terms. Downgrading after a scope has been saved is not a
supported conversion; an older release must never silently strip broad rules or
replace that state with defaults.

```ts
const policy = {
  whitelist: ['su.se'],
  blacklist: ['blocked.su.se'],
  whitelistSubdomains: ['su.se'],
};

evaluate('su.se', policy);          // ALLOW / WHITELISTED
evaluate('fysik.su.se', policy);    // ALLOW / WHITELISTED_SCOPE, scopeRoot: 'su.se'
evaluate('blocked.su.se', policy);  // DENY / BLACKLISTED
evaluate('not-su.se', policy);     // GREYLIST / UNLISTED
```

`evaluate()` answers policy classification only. Actual browser effects still use
the controller/planner, complete state validation, current managed policy and
successful required persistence. A cached card, scope checkbox or matching suffix
does not independently authorize navigation.

## Precedence

The manual Blacklist for the exact requested hostname wins over both exact and
broad Whitelist permission. Blacklist matching itself remains exact; this feature
does not introduce a new Blacklist-subtree model.

An explicit exact Whitelist entry retains its established exception to the managed
list. A broad scope does **not** create that exception for additional hosts.
Consequently a managed-blocked child of `su.se` remains denied unless that exact
hostname is separately and deliberately Whitelisted. A broad-only base is also
subject to managed blocking. The interface preserves explicitly listed exact
hostnames while adding the optional descendant scope; their exact precedence is
shown separately from the additional broad permission.

Default restoration and the one-time curated expansion preserve existing scopes.
Already-covered hosts are not silently converted into exact Whitelist exceptions.
No scope is introduced by a preset, category, alias, migration or usage ranking.

## Selection and review

Sites & Access offers an explicit all-subdomains option for a Whitelist change.
The selected primary hostname is the scope root. Other explicitly listed aliases
and entry points remain exact terms; selecting one root does not make unrelated
listed hosts into additional broad roots.

The description states that permission covers **every current and future
subdomain at any depth**. It is not limited to university departments, login
services or websites currently known to Atlas. That namespace can change owners,
host unrelated content, delegate tenant space or acquire new services. Users
should enable the option only when they deliberately accept that whole scope.

Preparing or reviewing a draft changes no permission. Adding a scope or replacing
it with a new root uses the existing frozen Vault proposal, current cooldown and
explicit confirmation. The [2026-10-30 removal rule](whitelist-removal.md) allows
strict subtraction of an existing root after review without waiting; mixed batches
keep Vault. Only successful commit activates the complete policy. Policy
revision changes retain the established invalidation rules for access requests,
grants and Journeys. Display-only edits cannot change scope authority, and existing
temporary grants never grow to cover subdomains or gain another deadline.

The Firefox presentation helper uses the existing Public Suffix List library,
including its private section, to reject bare registries and hosting suffixes such
as `com`, `se`, `co.uk` and `github.io`. Registered roots such as `su.se` and more
specific bases such as `courses.su.se` are eligible. A tenant such as
`alice.github.io` is distinct from the whole provider suffix. Core remains free
of browser APIs and PSL dependencies: it validates normal hostname syntax and
matches DNS labels. Trusted frontends must apply the corresponding selection
guard rather than claiming Core knows ownership or public registration boundaries.

## Navigation and presentation

Home and Sites index only saved exact terms and declared scope bases. They do not
enumerate possible children or create synthetic destinations. Saved pins and exact
entry-point selection retain their identities. A deliberate child launch can update
the declared base's local usage score; this creates no permission.

A newly authorized child still passes the ordinary adapter/controller gate.
Journey source evidence may recognize a fresh `WHITELISTED_SCOPE` result, but the
actual loaded destination remains the Journey root. For example an attempt from
`courses.su.se` returns to that destination, not automatically to `su.se`.
Context ownership, fixed deadlines, bounded redirects/POST continuations and
Blacklist precedence remain. Removed scopes cannot use stale loaded-page evidence
to start an unfamiliar Journey. Download Intent constraints remain unchanged.

## Defaults and forward compatibility

The current [0.1.19 catalog](curated-destinations.md) has 294 exact hosts across
122 services. It removes `wikipedia.org`, `www.wikipedia.org`, `en.wikipedia.org`
and `sv.wikipedia.org` from defaults; YouTube remains omitted. Existing saved
Wikipedia rules are not silently removed. A reviewed Whitelist-only removal can
withdraw them without waiting under the current removal contract.

Signed 0.1.18 used 298 fixed v2 migration terms. Those terms and old receipt
validation remain frozen independently of the current preset. A valid v2 marker
means the expansion already ran: 0.1.19 does not apply it again, write a replacement
receipt, re-add later removals or advance policy revision. Fresh installations and
installations without either marker use v3's 294 terms. The same atomic union,
Blacklist/configuration preservation and conservative invalid-data handling apply.

Wikipedia's legacy display definition remains available only to recognize saved
service IDs, pins, entry points and frozen draft baselines. Keeping that metadata
does not put Wikipedia back into the current preset or authorize an unknown host.

This work targets development 0.1.19. Signed 0.1.18 and earlier artifacts are
preserved. No signing, package publication, deployment, enterprise-policy change
or ordinary Firefox profile modification is authorized by this change.
