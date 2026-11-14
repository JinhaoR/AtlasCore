# Atlas 0.2.1 — startup and viewport repair

## Boundary and observed baseline

The user approves an unsigned **0.2.1** candidate because 0.2.0 has now been signed.
All 162 pre-existing release files, including signed 0.2.0, are frozen. The dirty
working tree is checkpointed in `.tools/startup-layout-0.2.1/checkpoint.zip`
(680 files, with a hash manifest). Core, authority commands, permissions, policy
storage, deadlines and saved preference/draft formats remain outside this repair.

The supplied attachment contains the written brief but no image files. Native
fixtures reproduce its startup, crowded-category and customization scenarios.
They use isolated Firefox 159 profiles and controlled credential-free icon
responses; timing/DOM instrumentation exists only in disposable runtime copies.

Confirmed before editing:

- A fresh/reopened control page reaches verified content in about 298–321 ms
  from navigation start; a process-restart sample takes 759–849 ms. Native DOM
  parsing/font arrival is separately recorded. These are small local samples.
- The first snapshot reply itself takes about 5–14 ms. Hidden Settings coverage,
  the hidden Sites directory and Home each spend about 70–100 ms in their first
  projections/render. All use the existing Core evaluator; no permission result
  may be cached to avoid that work.
- Missing initial `data-mode` and visible initial access/header content expose an
  unintended extra introduction. The loading notice disappearing moves the pin
  workspace by roughly 64 pixels. The shortcut area also lacks reserved content.
- Six pinned destinations issue twelve controlled metadata/image requests on
  every fresh page, reopening and restart. The resolved object-URL map is page-
  local. Browser HTTP caching can help only when the remote site's responses
  permit it; it does not retain the resolved/decoded UI result.
- Thirty categories produce a 10,937-pixel document at a 1586 × 992 viewport.
  Customization is a normal section at the document's end; focusing it scrolls
  the whole page. Its keyboard behavior is not modal.

## Repair design

The static HTML paints the correct control shell immediately, with reserved
loading/shortcut space and local critical-font preloads. Nothing waits for an
artificial deadline, favicon or optional data before rendering. Initial loading
does not impersonate a verified empty collection. Unavailable/stale authority
retains the existing disabling and recovery rules.

The expensive curated-coverage projection runs when its Settings section opens.
The hidden directory's keyed rows are built on entry. Existing draft/session
synchronization, legacy acknowledgement processing and visible Vault receipt
presentation retain their owners. No evaluator, Core validation, refresh loop or
background authority behavior changes.

Successful icons up to 64 KiB use the separate optional Cache API namespace
`atlas-website-icons-v1`: at most 128 entries (8 MiB of image payload), seven-day
fixed freshness, FIFO eviction, no access-time renewal. Keys contain only an exact
configured destination hostname; values are validated image bytes, MIME, size and
asset-creation time. No visited URL, credential, tab metadata, browsing history,
grant or policy data is stored. `https://atlas-assets.invalid/icons/...` is a
synthetic cache key and is never fetched. Cache failure, corruption, oversized
images and expiry fall back to the existing lookup/local icon. Private contexts
keep page-local behavior. Existing providers and credential/referrer omission
are unchanged. Cached bytes pass the same bounded image/decoder checks as remote
bytes. Unchanged image nodes/sources are retained.

At desktop widths of at least 1200 CSS pixels and heights of at least 800 CSS
pixels, the centred maximum-width frame uses the actual dynamic viewport height.
Home's introduction and complete grid-positioned compass composition share the
available workspace. Categories, additional pins, directory results, editor,
review, Vault changes and Settings have deliberate internal scroll regions.
Controls sit outside their content scroll regions; no global document clipping
or transform scaling is used. Long/error content retains an outer overflow
fallback. Short/narrow/zoomed layouts use ordinary accessible document flow.

Vault is a page section rather than a hidden-summary disclosure. Its desktop
grid stretches the proposal content within its allocated track instead of letting
start-aligned intrinsic content overflow into the outer workspace. Confirmation,
cancellation, return actions, frozen review and focus targets remain unchanged.

Navigation remembers the active CSS scroll surface instead of assuming window
scrolling. The existing Sites list position remains separately owned. Home
category switches retain local view offsets. Opening customization leaves the
underlying nodes, draft, category and scroll position intact.

Customize Home is a native bounded dialog, outside conditional page containers.
Its heading/Close and acknowledged-save/error/retry feedback remain visible while
the category list scrolls. Native modality supplies inert background and focus
containment; explicit Close/Escape returns focus without scrolling. Closing does
not discard unsaved arrangement state. No Apply step or new persistence workflow
is added, and errors never automatically dismiss it.

## Verification

Native Firefox 159 evidence is retained under
[`evidence/startup-layout-0.2.1/`](evidence/startup-layout-0.2.1/verified/result.json).
The baseline is a checkpoint runtime, not a production alteration. These small
local samples use the same 1586 × 992 content viewport and controlled no-store
icon responses (450 ms homepage + 450 ms image); they are not a general browser
benchmark. A representative measured run reports:

| Case | Before verified content | After | Before/after icon requests |
| --- | ---: | ---: | ---: |
| Fresh tab | 301 ms | 135 ms | 12 / 12 |
| Reopen, running background | 298 ms | 122 ms | 12 / 0 |
| Full Firefox restart | 759 ms | 623 ms | 12 / 0 |

An earlier repaired run measured 132/117/616 ms; the two before runs measured
301–321/298–308/759–849 ms. DOM parsing and local font readiness are separately
recorded: final fresh DOM at 44 ms, fonts at 49 ms; reopen 33/37 ms; restart
542/547 ms. No font gate or artificial delay exists in production.
The staged-runtime repeat measured 136/122/648 ms with the same 12/0/0 icon
request counts. Its repeated-category image source assignments also stayed
unchanged. Browser process startup remains a separate cost from the UI projection.

The first and last sampled pin boxes now match exactly. The baseline moved up
64 pixels. Thirty categories formerly stretched the document to 10,937 pixels;
it now stays at 992, with 10,572 pixels of category content inside a 633-pixel
pane. Native coarse-wheel, fine 32-pixel deltas and keyboard PageDown scroll the
pane while the introduction and toolbar remain stationary. Fourteen pins retain
six primary/eight additional launchers and the overflow region scrolls.

The final repeat test separates entering new views (40 legitimate icon requests)
from revisiting the same category (still 40, same image nodes). The before revisit
counter included new view entry and must not be described as repeat-only traffic.
The optional cache also works across a complete process restart. A separate
fixture delays only the first view reply and fails favicon fetches, photographing
the actual loading shell (`delayed-shell.png`), followed by ready content with
cached/local icons (`offline-ready.png`). That controlled delay is excluded from
timing comparisons and never ships.

The modal test cycles 110 native Tabs without reaching underlying page controls
(Firefox chrome remains keyboard accessible), verifies Escape/focus/scroll return,
injects a presentation-only save failure, closes/reopens with requested changes
retained, and retries successfully without dismissal. Feedback/Close remain in
the viewport. Native Home regressions additionally verify real CAS conflicts
between two Atlas pages, reload/restart, hidden/search/pin compatibility, pending
and active access links, Journey ownership, and truthful unavailable/recovery UI.
Sites list position is restored to 600 pixels before/after reload.

Windows sizes include 1586, 1280 and 500 pixels, a 650-pixel content-height case,
and real Firefox 125/150/200% zoom. Home, directory, Settings, Vault and modal
bounds show no horizontal overflow. Dedicated management checks verify editor,
complete two-change review, Vault changes and Settings scroll ownership, keyboard
End access, real waiting/explicit confirmation, save failure/retry and history.

Unit/adapter regressions cover bounded/expired/corrupt/unavailable icon caching,
readonly asset reuse, navigation scroll ownership and hidden directory deferral.
Full suites, type checks, staged-runtime verification, isolated upgrade/rollback
and reviewer reproduction are recorded in
[release evidence](version-history.md#v0-2-1). This report never substitutes
development results for the packaged-runtime checks.

Limits: native evidence is Windows Firefox 159 with synthetic data, not physical
trackpad testing, screen-reader conformance, non-Windows rendering or private
authenticated daily sessions. Asset caches can be evicted/disabled; large/failed
icons keep the existing fallback and may look up again in a new page. Local
resolved-icon validation still has decoding cost. Huge errors/content can use the
outer overflow fallback; short/narrow/zoomed layouts intentionally scroll normally.
The historical intermittent INTERNAL_ERROR remains unresolved; no internal-fault
auto-recovery, pruning or authorization change is introduced. The later,
separately verified [Home/new-tab integration](firefox-home-newtab-poc.md) is now
approved for this unsigned release; it is independent of the startup/layout repair.
