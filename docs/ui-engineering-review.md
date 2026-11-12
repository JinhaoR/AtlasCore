# Rendering and architecture review after 0.2.1

This is a development change, not a release. Signed 0.2.1 and all older artifacts
remain frozen. No manifest, permissions, dependencies, policy schema, settings,
migration, version number or installed Firefox configuration changes.

## Findings and implementation

**Directory geometry (reproduced).** The constrained, scrolling grid allocated
40px automatic tracks to Firefox grid buttons. Each button contained two text
lines, padding and a 48px icon: native measurements found 61px of overflowing
content. The list now uses content-sized implicit rows (`grid-auto-rows:
max-content`). Rows grow for wrapped text instead of squeezing into the available
viewport; the existing pane owns scrolling. This fixes track sizing without
imposing another fixed row height or redesigning the cards.

**Repeated policy processing (measured).** Home's Whitelist index evaluated each
hostname separately. Directory filtering and badges did the same. Each call
normalized and copied the entire policy. In the first native directory sample,
297 calls consumed 83ms of a 103ms render. Core now exposes `evaluateMany`, which
normalizes one complete policy and runs the same private decision function for
each target. Individual `evaluate` calls share that function too. There is no
retained evaluator, authority cache or validation bypass. Invalid policies deny
every requested target; normalization, Blacklist precedence and optional scope
matching are unchanged.

Home uses one batch for its display index. Sites records display outcomes with
its existing policy/metadata-keyed collection, rather than evaluating again for
every filter or badge. A changed policy, including Blacklist changes, rebuilds
that projection. Navigation and protected edits still go through the controller;
neither a cached row nor a batch result grants browser access.

**Startup flash (confirmed presentation path).** The recovery-style destination
banner was visible in static HTML and during every initial pending read, then
removed on success. Initial loading now uses the existing header status, reserved
category placeholder and `aria-busy`. The banner is initially hidden and appears
for an actual unavailable result with the same recovery actions. No timer conceals
slow loading, and no stale collection is made actionable.

Category rendering previously used default order/visibility before the saved Home
layout finished loading. It now waits for the existing acknowledged layout. Pins
and search remain independent. Layout failure retains its warning/retry surface;
no preference is reset or written merely to display the page.

**Icons (negative evidence).** Repeated navigation retained existing icon nodes.
The controlled fixture made twelve requests for six initial icons (metadata and
image), zero on warm reopen and zero after restart. Repeated category visits did
not change icon sources. The existing bounded Cache API asset store, page-local
object URLs, IntersectionObserver and lifecycle cleanup remain; another cache or
rendering framework would not address a demonstrated problem. A new document can
briefly display the local fallback while asynchronous cached bytes resolve. Live
sites can change favicon metadata; this test does not prove universal icon stability.

## Architecture assessment

| Boundary | Assessment |
| --- | --- |
| Core planner/controller | Complete snapshot validation, owned frozen data, serialized operations, CAS and commit-before-publication remain necessary. The batch helper removes duplicate presentation validation without changing these gates. |
| Firefox adapter | `GET_VIEW` projects current state; it does not execute navigation or initiate policy writes. Browser correlation and actual navigation effects remain in the adapter. No Journey/download expansion was warranted. |
| Repository | Ordinary loads are readonly; migration and commits retain strict transactions and outcome reconciliation. UI performance is not a reason to remove authoritative reloads. |
| UI refresh | One visible-page refresh owner, stale-reply fences and independent diagnostics already exist. Repeated section navigation retained nodes and listeners; no additional scheduler or event bus is introduced. |
| Draft and Home persistence | Revisioned draft and layout saves solve different user-visible conflict/recovery requirements. Keeping their existing owners is simpler and safer than merging them into a new state framework. |
| Presentation | Repeated per-host normalization was the costly duplicated work. The existing collection key now also bounds display outcome reuse. Search and grouping remain display-only. |
| Diagnostics/assets | Bounded fault retention and optional icon storage are separate from authority. Neither is used to recover permission or hide an unavailable state. |

Small unchanged-page renders still run, and category ranking still occurs during
Home rendering. The measured cost is small relative to the removed validation;
another cache or broad controller rewrite is not justified by these observations.
`main.ts` remains a substantial coordinator, but its existing editor, layout,
diagnostic and icon owners have concrete lifecycle responsibilities.

## Evidence and limits

Native Firefox 159.0.1 uses disposable profiles, a copied runtime and synthetic
credential-free icon responses. Before/after copies contain numeric test probes;
development bundles do not. The ordinary curated fixture contains 124 grouped
destinations; the crowded scenario assigns the exact saved hosts to thirty
categories with long labels. Timings include native browser scheduling and are
not universal performance guarantees. See [recorded results](evidence/ui-engineering-review/after.json)
and the [baseline](evidence/ui-engineering-review/before.json).

Two serial paired runs on the same machine measured:

| Measurement | Checkpoint | Development |
| --- | ---: | ---: |
| First populated directory render, JS work | 96–103ms | 13–14ms |
| New Home document, initialized background, ready sample | 145–162ms | 73–75ms |
| Warm reopen, ready sample | 144ms | 64–72ms |
| Full Firefox restart, ready sample | 631–646ms | 564–565ms |
| First-install ready sample | 893–2540ms | 2237–2439ms |
| Ordinary directory row | 40px, overflowing | about 74px, contained |

First-install startup varies substantially while the signed baseline, temporary
overlay and first authority initialization settle. These samples do **not** show
a consistent cold-install improvement; no such claim is made. The repeat
[before](evidence/ui-engineering-review/before-repeat.json) and
[after](evidence/ui-engineering-review/after-repeat.json) runs preserve the raw
timings. Readiness is sampled every 50ms, not a precise paint measurement.
Round-trip interaction times include Marionette overhead; render durations are
instrumented JavaScript work. Concurrent correctness runs are excluded from this table.

In the post-change three-second visible idle sample there were three GET_VIEWs,
three readonly layout and three readonly draft transactions, one owned timer,
nine global listeners, one tabs listener, zero new elements and zero subtree
replacements. Twenty section switches created no elements and retained icon nodes.
These bounded counts are not a heap or multi-day memory-leak test. Readonly
presentation polling remains intentional so another control page's edits appear.

Verification completed:

- 249 Core tests and 546 extension tests, both TypeScript checks and development
  build pass. Added batch parity/mutation tests and directory policy-key
  invalidation/Blacklist-filter regression. Existing conflict, failed/unknown
  commit, staleness, managed precedence, Vault, grants, Journey and download suites
  remain intact.
- Native before/after plus repeat runs; [final layout regression](evidence/ui-engineering-review/layout-regressions.json)
  verifies saved category visibility through reload without a default-layout
  flash, current policy unchanged, full Firefox restart, icon reuse, delayed/offline
  shell, explicit unavailable-query recovery, failed layout save/retry, thirty
  categories, long labels, pin overflow, wheel/fine scroll, PageDown, 110 modal
  Tab cycles, Escape and focus restoration.
- Twenty-eight page/viewport checks cover Home, directory, Settings and Vault at
  1586×1077, 1280×900, 1440×735 and 500×900 outer windows and real Firefox
  125/150/200% zoom. All directory rows contain their children at these sizes.
- [Native interaction regressions](evidence/ui-engineering-review/interactions.json)
  retain selected entry-point DOM/focus, exact launcher target, dirty draft/caret
  across stale replies, one retry timer, diagnostic reply fencing, layout retry,
  existing-tab toolbar reuse and a fixed-deadline Journey indicator over 60 seconds.
  The old test initially attempted to focus a hidden category under the 0.2.0
  workspace composition; it was corrected to open All categories/expand through
  real controls before making the same focus assertions. An intermediate attempt
  assumed the literal category label `Research`, which normalization did not retain;
  the final fixture locates the category through its destination instead.
- All 190 pre-existing release files match their checkpoint SHA-256 hashes.
  No test probes occur in development bundles. Everyday profiles and enterprise
  policies were not accessed or modified. Test installs were confined to disposable
  profiles. No release was packaged, signed, submitted or deployed.

Changed production sources: `packages/core/src/{evaluate,index}.ts`,
`extension/src/ui/{destinations,sites,main,home-organization}.ts` and
`extension/src/ui/assets/{index.html,style.css}`, plus generated development output.
The original source/runtime checkpoint is retained in
`.tools/ui-engineering-review/checkpoint.zip`; task-owned profiles/runtime copies
are removed after retaining these results. No dependency or new state framework
was added.

Cleanup removed eleven identified task directories (1.45 GiB), retaining the
checkpoint, logs and sanitized evidence. Other `.tools` work was left alone.

The historical intermittent INTERNAL_ERROR remains unresolved. No finding here
establishes its cause or changes fail-closed behavior. Physical trackpad behavior,
screen-reader conformance, production multi-day memory use and every live website's
favicon behavior are not certified by these bounded tests.
