# AtlasCore agent instructions

## Current theme development

Current development adds the Celestial and Parchment design prototypes through
the existing bundled CSS theme mechanism, preserving the default appearance.
See [themes.md](docs/themes.md) and [native evidence](docs/evidence/theme-prototypes/README.md).
Theme values are presentation only;
layout/interaction geometry and Core authority remain application-owned. Preserve
prepared 0.3.0 and every prior release. No version bump, packaging, signing,
deployment or everyday-profile changes are authorized for this work. The release
and earlier refinement paragraphs below retain their historical status.


## Start here

Read [README.md](README.md) for current status and commands, and the requirements
in [foundation.md](docs/foundation.md). Then read the owning contract and relevant
architecture/acceptance sections for the change. Use the task map in
[development.md](docs/development.md) to find them. Read
[lessons-from-zenith.md](docs/lessons-from-zenith.md) when touching enforcement,
correlation or persistence. [first-steps.md](docs/first-steps.md) is historical;
do not restart completed milestones or run its old setup steps.

Current user instructions supersede historical guidance. Keep important decisions
in the owning repository document; do not depend on conversation memory. Identify
conflicting current contracts before changing behavior. Resolve only blocking
product questions, and never request renewed approval for an already approved rule.

## Invariants

- AtlasCore decides; adapters execute. Keep one pure TypeScript Core package and
  one Firefox adapter. Core contains no browser, UI, filesystem, networking or
  real-clock calls. It does not implement TLS, OAuth, cookies or authentication.
- Preserve default Greylist, manual Blacklist precedence, explicit confirmation,
  fixed deadlines, scoped grants, current revisions and successful persistence.
  Invalid/unavailable authority fails closed; never initialize over damaged state.
- Keep website-origin data outside privileged commands. A library import, claimed
  origin or cached UI collection is not authority. All frontends use Core decisions.
- A candidate or pure domain success is not a committed policy. Keep atomic CAS,
  unknown-outcome reconciliation and explicit confirmation; never auto-replay it.
- Presentation metadata, pins, usage, Home layout and draft previews never grant
  permission. Failed saves retain unsaved work and truthful recovery feedback.
- Exact hostnames remain the default. No implicit apex/www equivalence, wildcard
  rules, provider trust, supporting-domain database, learned relationships,
  Context Whitelist or link inheritance. Electron remains deferred.
- Do not copy Zenith code. Do not add workflow frameworks, UI frameworks,
  unrelated packages or dependencies without a demonstrated need.
- Never log credentials, cookies, tokens, private profiles or credential URLs.
  Diagnostics use closed codes and bounded hostname-only navigation history.

## Current contracts (use these, not older milestone descriptions)

| Area | Owning contract and essential boundary |
| --- | --- |
| Policy/planner/controller | [architecture.md](docs/architecture.md), [foundation.md](docs/foundation.md): complete state validation, explicit time, commit before publication. |
| Whitelist subtraction | [whitelist-removal.md](docs/whitelist-removal.md): explicitly reviewed strict removal of existing exact/scope terms can commit without waiting. Additions, mixed batches, Blacklist and timing changes retain Vault. Pending proposals remain frozen and become stale; do not silently split batches or create a general bypass. |
| Optional subdomain scope | [whitelist-scopes.md](docs/whitelist-scopes.md): default off, explicit choice; additions use Vault. Manual Blacklist wins. Broad scope cannot bypass managed blocking; only a separate exact Whitelist entry can. Legacy rules remain exact. |
| Firefox gate | [firefox-adapter.md](docs/firefox-adapter.md): top-level navigation, actual effects, context/request generations, ordinary gated launchers. Resources are not user navigation. |
| Journey | [firefox-journey-polish.md](docs/firefox-journey-polish.md): bounded browser-attested first departure from a loaded Whitelisted root; subsequent unfamiliar steps require HTTP redirect or attested POST from the loaded current intermediate. Preserve fixed lifetime/hops/context. No provider trust. Expiry return has a renewal veto. |
| Download Intent | [firefox-downloads.md](docs/firefox-downloads.md): separate ephemeral operation with browser-attested activation and response correlation; unfamiliar HTML needs ordinary authorization. No shared Journey, permanent grant or inheritance. |
| Greylist aliases | [firefox-stabilization.md](docs/firefox-stabilization.md): explicit aliases or bounded credential-free HTTPS apex/www discovery before Start; disclose/freeze exact scope. Saved requests/grants never widen. |
| Managed blocking/defaults | [managed-policy.md](docs/managed-policy.md): pinned feed bytes verified at build/startup, Core owns precedence. Missing initialized authority is not first run. |
| Curated migration | [curated-expansion.md](docs/curated-expansion.md): user-approved one-time additive union for all installs, no device IDs; preserve custom hosts, Blacklist and settings. Current v3 excludes Wikipedia/YouTube. Frozen v2 receipts remain valid without reapplying. Previously removed entries may return only in the expressly approved initial expansion; saved permissions are never automatically removed. |
| Draft/Vault editing | [destination-polish.md](docs/destination-polish.md), [editor-reliability-0.1.19.md](docs/editor-reliability-0.1.19.md): persistent editable batches and separate frozen receipts. Preserve dirty fields, stale/conflict checks, acknowledgement-only saves and display-only retry. |
| Home and controls | [home-organization.md](docs/home-organization.md): one scrollable category grid, drag/keyboard ordering, icons and visibility in Settings; replaces the separate directory, address form and customization modal. Stable pins and category identity/order/visibility/collapse stay independent of authority. [ui-design.md](docs/ui-design.md) and [visual-polish.md](docs/visual-polish.md) retain earlier presentation history. |
| Everyday controls / bookmarks | [everyday-controls.md](docs/everyday-controls.md): read-only toolbar popup with closed shortcuts; stationary desktop category/search panel; optional native bookmark sync under one serialized presentation owner. Durable external-operation intent, CAS and explicit conflict review; no bookmark-based authorization. Supersedes the earlier no-popup and expanding-category layout. |
| Rendering | [ui-stability.md](docs/ui-stability.md): one visible-page refresh owner, quiet unchanged reads/setters, stable DOM identity, epoch-fenced replies and cleanup on close. [quality-pass-0.1.19.md](docs/quality-pass-0.1.19.md) owns the final owner extraction, compact editing/review, structural comparison and bounded diagnostic retention. |
| Storage/recovery | [firefox-storage-reliability.md](docs/firefox-storage-reliability.md): readonly ordinary loads; strict atomic migration/commit. One same-owner recovery only for confirmed transient LOAD/COMMIT abort, never unknown outcomes. Do not clamp clocks. The user's idle INTERNAL_ERROR trigger remains unknown; closed stage/class diagnostics are diagnosis, not a proven fix. No speculative history pruning or internal-fault auto-recovery. |

## Current development refinement

Current work after the prepared 0.3.0 candidate refines Home balance and the
All Sites category ordering. Keep all release artifacts, including 0.3.0, frozen.
Home centers below navigation with a logo/title and up to two Greylist rows.
All Sites supports Custom, Alphabetical and Most used via a separate CAS
presentation record; dropping a category selects Custom. See the current section
of `docs/home-organization.md` and `docs/evidence/home-balance/README.md`.
No version change, packaging, signing, deployment or everyday-profile edits.
The following preparation instructions describe completed work.

Prepare unsigned **0.3.0** from the completed Home/All Sites redesign and post-0.2.8
interaction repairs. The user authorizes versioning, packaging, verification and
isolated signed-0.2.8 upgrade/restart/rollback tests. Preserve every previous release.
Do not sign, submit, deploy, commit, push or change the everyday Firefox profile.
See `docs/release-candidate-0.3.0.md`. Development boundaries below are historical.


Current work separates Home (search, compass, access summaries) from All Sites
(category directory and contextual native editor dialog). See the current section
of `docs/home-organization.md` and `docs/evidence/home-directory/README.md`.
Preserve saved layout/pin/draft data and existing Core gates. Signed 0.2.8 and all
older release files are frozen; this task does not authorize a version bump,
packaging, signing, deployment or everyday-profile changes. Earlier preparation
instructions below are historical.


Current development refines Home proportions and repairs pointer activation of
compass pins. The transformed pin layer must sit above the rotation handle while
empty ring space passes through to it. See `docs/evidence/home-hierarchy/README.md`.
This is presentation-only work after signed 0.2.8; no version bump, packaging,
signing or everyday-profile changes are authorized. Earlier work follows.

Current work after signed **0.2.8** is the Greylist cancellation/compass-flash
presentation repair. Separate red Cancel controls dismiss an unstarted prompt,
cancel a pending request, or end an active grant using existing commands.
Committed cancellation clears the original selected route; failed/uncertain
outcomes stay visible. Core and release artifacts are unchanged. Do not package,
bump the version, sign, deploy or touch the everyday profile for this repair.
See `docs/evidence/greylist-controls/README.md`. The paragraphs below are history.

Prepare unsigned **0.2.8** from the completed Home simplification, curated
subdomain scopes and early grant termination. The user's signing-preparation
request authorizes packaging, verification and isolated signed-0.2.7 upgrade,
restart and rollback checks. Signed 0.2.7 and all earlier artifacts remain frozen.
Do not sign, submit, deploy, commit, push or change the everyday Firefox profile.
See `docs/release-candidate-0.2.8.md`. The development paragraphs below are history.

The current development refinement supersedes the older toolbar-only/optional
bookmark scope: bookmarks permission is required with automatic connection;
Firefox toolbar folders are mirrored read-only, with local icon choices. Explicit
disconnect/conflicts are preserved. Home has one category column and inline
Greylist controls; legacy access URLs resolve to Home, never a replacement tab.
Core commands, release assets and version remain unchanged. See the latest
sections of `home-organization.md` and `everyday-controls.md`.


Current work: the user explicitly approves [curated subdomain scopes](docs/curated-subdomains.md)
for all bundled sites and a one-time existing-install migration, excluding any
expansion to `www.google.com`. Preserve customized/pinned subdomain shortcuts and
merge plain display duplicates. Preserve exact managed-block exceptions internally.
This overrides the historical exact-only curated default, not Core precedence.
Signed 0.2.7 and earlier releases remain frozen. No packaging/version/signing is
authorized by this development task.

The current user request is development polish after signed **0.2.7**: show entire
opened categories, expand local icons, investigate wheel hover glitches, investigate
Firefox suggestions and MyAnimeList reCAPTCHA, and explicitly end temporary grants.
Early grant termination is now authorized; see `docs/architecture.md`. No version
change, packaging, signing or deployment is authorized in this pass. Signed 0.2.7
and every earlier artifact are frozen. The release instructions below are history.

Prepare unsigned **0.2.7** from the completed Home motion/access overview and
navigation-failure presentation fix. The user's signing-preparation request
authorizes packaging, verification and isolated signed-0.2.6 upgrade/restart/
rollback tests. Signed **0.2.6** and every older artifact are frozen. Do not sign,
submit, deploy, commit, push or change the everyday Firefox profile. See
`docs/release-candidate-0.2.7.md`. The following paragraphs retain earlier history.

The latest user request authorizes UI interaction refinement only: animated
category drag previews, outer-ring dragging with bounded friction, visual icon
selection, Vault inside Settings and centralized UI copy. Direct toolbar bookmarks
replace new folder connections; the user explicitly selected toolbar-only scope
and deletion of synchronized toolbar bookmarks on unpin. Folders stay untouched.
See the current sections in `home-organization.md` and `everyday-controls.md`.
The user's subsequent signing-preparation request authorizes unsigned **0.2.6**
packaging, verification and isolated signed-0.2.5 upgrade/rollback tests. Signed
0.2.5 and all older artifacts remain frozen. Do not sign, submit, install into the
everyday profile, deploy, commit or push. See `docs/release-candidate-0.2.6.md`.
The release boundaries below retain their preparation history.

## Release boundaries

Prepare unsigned **0.2.5** from the completed Home category grid and direct
Firefox bookmark connection, following [release notes](docs/release-candidate-0.2.5.md).
Signed **0.2.4** and all earlier artifacts are frozen. Packaging, verification
and isolated signed-0.2.4 upgrade/rollback are authorized; signing, submission,
deployment, commits and everyday-profile changes are not. Earlier instructions
below describe their historical preparation.

Prepare unsigned **0.2.4** from completed Everyday controls and rendering polish,
following [release notes](docs/release-candidate-0.2.4.md). Signed **0.2.3** and all
older artifacts are frozen. Packaging, verification and isolated signed-0.2.3
upgrade/rollback are authorized; signing, submission, deployment, commits and
everyday-profile changes are not. Older instructions below retain their history.

Prepare unsigned **0.2.3** from completed [Compact Home](docs/compact-home.md),
following the [release notes](docs/release-candidate-0.2.3.md). Signed **0.2.2** and
every older artifact are frozen. Packaging, verification and isolated signed-0.2.2
upgrade/rollback tests are authorized; signing, submission, deployment and everyday
profile changes are not. Earlier release preparation guidance follows.

Prepare unsigned **0.2.2** from the completed
[rendering/architecture review](docs/ui-engineering-review.md), following the
[release notes](docs/release-candidate-0.2.2.md). The user authorizes packaging,
verification and isolated signed-0.2.1 upgrade/rollback tests. Signed **0.2.1** and
every older artifact are frozen. Do not sign, submit, deploy, edit enterprise
policies or touch the everyday profile. The following 0.2.1 instructions describe
the completed earlier task.

Develop **0.2.1** for the focused [startup/viewport repair](docs/startup-layout-0.2.1.md)
and the now-approved [Firefox Home/new-tab overrides](docs/firefox-home-newtab-poc.md).
The user's signing-preparation request promotes the verified manifest-only experiment
into the unsigned candidate. Use bare extension-relative `ui/index.html` paths;
Firefox owns notices and startup/session-restore settings. No signing is authorized.
Signed **0.2.0** and every older release are frozen. The user approves a new
unsigned 0.2.1 candidate after verification; do not rebuild signed 0.2.0.
The **0.2.0** presentation-only visual redesign is owned by
[visual-redesign-0.2.0.md](docs/visual-redesign-0.2.0.md). The new flat navy/cream/gold
top navigation and static compass supersede the older palette/rail presentation;
all authorization, persistence and interaction outcomes remain unchanged. Preserve
every prior release, including the signed **0.1.19–0.2.0** assets. The user authorizes
unsigned 0.2.1 signing-candidate packaging, verification and isolated upgrade/rollback
tests. This does not authorize signing, Mozilla submission, deployment, enterprise-policy edits,
or access/modification of the user's everyday Firefox profile. Do not commit/push
without instruction. Use isolated profiles and synthetic fixtures for native tests.

Preserve extension ID `atlas-development@atlas.invalid`. Release tooling stays
outside Core. [firefox-private-release.md](docs/firefox-private-release.md) owns
packaging, reviewer-source reproduction and offline `release:verify-signed`.
Never rebuild/resubmit a signed version to repair verification. Signing comparison
permits only known signature metadata, manifest whitespace outside strings, and
local `.amo-upload-uuid` in post-sign staging; all runtime hashes remain enforced.
[firefox-backup.md](docs/firefox-backup.md) and
[windows-deployment.md](docs/windows-deployment.md) own migration/deployment.
Live deployment is a separate authorized action; tests never edit installed policy.

## Working method and evidence

1. State the bounded result and responsible layer. Inspect before editing.
2. Reproduce and measure performance defects before claiming an optimization.
3. Make the smallest supported change; avoid speculative refactors/caches.
4. Test behavior with fake time/isolated storage, including affected failure paths.
5. Follow the verification tiers in [development.md](docs/development.md). Build
   once per code revision; focused tests during iteration, full regressions for a
   completed cross-subsystem pass/release. Do not weaken release checks.
6. Browser claims require native evidence. Separate unit, mocked adapter, native,
   historical and unverified observations. Synthetic faults do not prove user causes.
7. Review the diff, preserve unrelated work, update the owning document and report
   results/limits. Avoid duplicating whole contracts or old test counts everywhere.
8. After retaining sanitized results, remove only this task's identified disposable
   profiles/runtime copies. Never broadly delete `.tools` or other sessions' work.
