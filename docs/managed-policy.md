# Curated defaults and managed deny data (D17)

Authorized on 2026-10-01. This milestone adds an initial curated Whitelist and the official StevenBlack unified hosts variant with fakenews, gambling, porn, and social. It preserves Access, Vault, Journey, exact-host matching, and Firefox's navigation protocol.

## Curated services

`extension/src/presets/curated-whitelist.ts` owns the preset. Each service appears once with its group, label, primary hostname, explicit equivalent aliases, and any distinct service entry points. The compiler expands these into ordinary exact `Policy.whitelist` entries. It never infers `www`, parent domains, subdomains, or wildcards. UI groups show service entries rather than duplicating alias rows. Google Search and authentication intermediates are not preset destinations. Other Canvas institution roots must be added explicitly; login continuation uses Journey.

D27 (2026-10-03) seeds this preset automatically in genuinely empty development installations for friend testing. The user supplied their current 51 exact Whitelist hostnames and empty Blacklist; they exactly match the current compiler output. Only policy contents are bundled, with fresh revision/counters and no waits, grants, Journeys, history or browser profile. `extension/src/background/bootstrap.ts` attempts initialization only after the repository explicitly reports `UNINITIALIZED`; its atomic guard prevents replacing existing, concurrently initialized, missing or damaged authority. This supersedes D15's initial setup requirement for this development build. Failed writes cannot publish initialized authority. Reload and already initialized empty policies remain unchanged. Later changes still use Vault; future onboarding is deferred.

### Applying defaults to an existing profile

Reload restores saved authority; rebuilding/reloading extension files does not reset IndexedDB or reinitialize policy. The user reported that this left the new preset inaccessible in an existing profile on 2026-10-01. Add a narrow **Add curated destinations** action under Policy & recovery. It proposes the union of the current Whitelist and the current preset and retains the complete manual Blacklist. Core freezes and reviews the candidate, supplies the existing Vault wait/window, and commits only after explicit confirmation. UI must show additions/removals and classification consequences before confirmation; it never derives permission from its countdown. Cancellation, expiry, failed writes, and restart retain existing Core behavior. That D17 increment did not add a general policy editor or schema migration. D19 adds protected policy/settings forms and a known schema-1 conversion; saved Whitelist entries still expand only through explicit Vault commitment.

Only the private extension page can propose this action or review/confirm/cancel a proposal. The bridge exposes closed commands and forwards every transition through the controller. A saved policy confirmation triggers ordinary retained-content rechecks, not automatic navigation. Pending proposals stay frozen across updates/reload; a changed preset requires cancellation and a fresh proposal.

## Core boundary and precedence

The existing two-list `Policy` and snapshot schema stay unchanged. A separately compiled `ManagedBlacklist` is an immutable, opaque Core-owned set, validated once when built. It is not serialized into every policy snapshot. Its identity and exact-host membership checks are constant-time; ordinary snapshot validation still scans only small human policy/workflow state.

The aggregate planner accepts an optional compiled managed list. A controller may receive an injected supplier of the current compiled list. Omitting the dependency preserves existing standalone consumers; supplying invalid or unavailable managed authority fails closed. Core applies:

1. Complete state validation, time/revision observations, and valid context binding.
2. Explicit/manual Blacklist.
3. Explicit Whitelist.
4. Managed Blacklist.
5. Access Grant / Journey.
6. Greylist / waiting / explicit confirmation.

Managed denial is identified by `MANAGED_BLACKLISTED`. It prevents request creation, confirmation, and navigation through a grant or Journey. Cancellation and Vault operations remain available. Existing standalone Policy/Access/Journey functions retain their documented scope; applications using managed data must use the aggregate planner/controller. A managed refresh does not reclassify user policy or renew workflow deadlines.

The controller samples one compiled identity per operation and checks it again before publishing its result. If it changed while a save was pending, the old result cannot execute navigation; reevaluation is required. The next gate always uses current data. Feed activation follows successful atomic cache persistence. Firefox schedules that cache commit and identity publication through its existing operation queue, so activation cannot race a held request between Core's result and release. Download and compilation stay outside this queue. Firefox contains no independent managed-denial or precedence check.

## Firefox data lifecycle

Use only `https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-gambling-porn-social/hosts`. Fetch data with a bounded size and timeout, reject unexpected redirects, and never execute remote code. Bundle a pinned known-good hosts snapshot, provenance, digest, and upstream notices for offline first use. The official project documents this combined variant and its source licenses. [Upstream](https://github.com/StevenBlack/hosts).

The parser accepts sinkhole hosts records, strips comments, ignores IP fields and reserved/local names, validates ASCII hostnames with Core normalization, and deduplicates exact domains. Updates require the expected upstream identity/header, advertised count matching unique nonlocal names before normalization, at least 50,000 usable domains, at least 80% of the previous usable count, and well-formed hosts records. Unsupported names are skipped and counted separately; more than 0.1% (or 20 names for smaller lists) rejects the update. The pinned snapshot has six underscore-bearing names outside Core's input contract: 163,856 upstream names yield 163,850 usable domains. Truncation, a malformed response, or an empty response never replaces last good data. The advertised count and retention threshold detect ordinary truncation and major loss; they do not prove upstream correctness or authenticity beyond the HTTPS source.

The bundled revision is `06260f056c5d682e8fb099099ff70f5421daab10`, with upstream date 27 September 2026. Its digest and exact pinned URL live in `extension/data/stevenblack/metadata.json`. The bundled notices retain upstream source attribution and the variant's license table; aggregated source terms are not replaced by the project's MIT license.

A separate extension-origin IndexedDB cache atomically retains the last good feed, metadata, and refresh attempt time. Load and compile once at startup. If cached data is missing or corrupt, use the verified bundled snapshot; never silently substitute an empty list. Refresh when stale, with at most one attempt per 24 hours, including failures and across restart. A timer checks staleness outside the navigation gate. Updates are coalesced; navigation performs no network requests or dataset scans. Failed fetch/validation/storage leaves active data intact.

UI shows active source, domain count, categories, upstream date/version when available, successful fetch time, bundle/cache origin, refresh state, and failure reason. Diagnostics report exact Whitelist/managed conflicts as review information; an explicit Whitelist exception changes no managed dataset. The curated preset is a product default, not a final policy or provider database.

## Evidence required

Test preset coverage and exact aliases, missing Google Search/auth infrastructure, all precedence levels, managed denial before Greylist confirmation and during Journey, failed and malformed updates, persistence/restart/throttling, and a 200,000-domain compiled lookup without reading its input array again. Run Core and extension checks plus the native Firefox scenario. Native evidence must exercise the bundled list and setup UI separately from Core tests. Authenticated-provider compatibility remains outside this milestone.
