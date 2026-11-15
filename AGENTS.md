# AtlasCore agent instructions

## Current work and retention

The latest user request authorizes preparing unsigned **0.3.3** for signing,
including the preceding compass, hostname-validation and clock-recovery work.
It supersedes their earlier development-only/no-package limits for this candidate.
Keep site review and Vault in All Sites, timing review in Settings, one shared
Vault renderer, compact summaries and stable controls. Preserve all review,
waiting, explicit confirmation, stale/conflict and failed-save boundaries.
Validate both themes, native workflow/restart/rollback, packaging and independent
source reproduction. Preserve every retained release; do not sign, submit, deploy,
commit, push or change the everyday Firefox profile.

The user-authorized clock fix is development-only. Core's OBSERVE_TIME may recover
only UNAVAILABLE/CLOCK_ROLLBACK with no pending commit, after the actual supplied
clock catches up to the same owner's in-memory and persisted floors. Use full
open/revalidation/persistence; preserve fixed deadlines and end interrupted
Journeys. No clock clamping, command replay, automatic internal-fault recovery,
profile changes or new release package. Preserve all retained release bytes.
The existing Firefox timer supplies observations; no second recovery timer.

The 0.3.2 crash follow-up localizes the exported VALIDATE_LOAD/InternalError stack
to hostname regexp validation while reading a Journey. Bounded ASCII/label checks
remove that operation without changing accepted hostnames. This is a targeted
mitigation: the user's underlying Firefox trigger has not been reproduced.
Keep full validation, fail-closed latching, explicit Recovery and all saved history;
do not prune records or add automatic internal-fault retries. This is development
only; preserve all retained releases and the preceding compass work. See
[storage reliability](docs/firefox-storage-reliability.md) for evidence and limits.

The completed compass follow-up is development-only: remove the drag-only outline
and keep pin faces steady on hover, with a subtle border highlight. Preserve
keyboard focus and disabled-state feedback. Do not bump the version or replace
any prepared/signed release files; the user explicitly chose no new package.

The preceding follow-up fixes the missing compass in fresh/one-pin and narrow
0.3.1 profiles, adds ordinary gated site opening and direct pin controls in All
Sites, and simplifies everyday wording. Prepare unsigned **0.3.2** for signing;
preserve signed 0.3.1 and all retained release bytes. Use isolated fresh-profile,
upgrade/restart/rollback and source-reproduction checks. Do not sign, submit,
deploy, commit, push or change the everyday Firefox profile.

The user requests simpler themes and docs, removal of old background artwork,
and a clearer Add Site subdomain explanation. Keep the compass assets, theme
colors and shared interactions. Background authoring handoff lives in
[themes/README.md](themes/README.md); no historical scans or design studies are
needed. All Sites and Settings use plain theme colors.

The user's cleanup request supersedes earlier instructions to retain every
release. Keep signed 0.2.8 and prepared unsigned 0.3.0 unchanged; older local
release copies can be removed. Consolidate release notes in
[version-history.md](docs/version-history.md).

The preceding request added a Greylist & Journeys page beside All Sites, a dedicated
Appearance section in Settings, and a larger Home compass using the existing
colors and compass assets. It authorizes preparing unsigned **0.3.1**, packaging,
verification, source reproduction and isolated signed-0.2.8 upgrade/restart/
rollback checks. Preserve 0.2.8 and 0.3.0. Do not sign, submit, deploy, commit,
push or change the everyday Firefox profile.

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

## Release boundaries

Preserve extension ID `atlas-development@atlas.invalid`. Release tooling stays
outside Core. [firefox-private-release.md](docs/firefox-private-release.md) owns
packaging, reviewer-source reproduction and offline verification. Never rebuild
or resubmit a signed version to repair verification. Keep strict runtime hashes
and the existing limited signing-metadata/manifest-formatting exceptions.
The retained signed 0.2.8 is the native upgrade baseline; prepared 0.3.0 is not
the later development tree. Older native historical scenarios require an
explicit externally retained baseline, not a silent substitute.
[firefox-backup.md](docs/firefox-backup.md) and
[windows-deployment.md](docs/windows-deployment.md) own migration/deployment.
Live deployment needs separate authorization; tests use isolated synthetic state.

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
