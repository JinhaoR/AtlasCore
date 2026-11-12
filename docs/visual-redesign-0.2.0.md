# Atlas 0.2.0 — celestial interface

This records the first pass. The subsequent user-requested
[visual refinement](visual-refinement-0.2.0.md) supersedes its category placement,
system-font choice and shortcut surfaces. Its historical measurements remain here.

## Scope and initial inventory (2026-11-01)

The user authorizes a presentation-only redesign. This supersedes the parchment
palette and fixed side rail for this version, not their workflows. The current
working tree includes pre-existing uncommitted work, so it is preserved in
place with a separate pre-change runtime and source copy for comparison. Every
existing release directory, including the signed 0.1.19 artifacts found during
inspection, is frozen.

| Surface | Existing capabilities to retain |
| --- | --- |
| Home | Search with exact entry points, keyboard selection, pins in explicit order, grouped variants, category order/visibility/collapse, show all/fewer, specific-address launcher. |
| Access summaries | Pending wait/confirmation, fixed grant deadlines, owned Journeys, links into existing access workflows; truthful unavailable/empty states. |
| Sites & Access | Complete searchable/filterable directory, selected row, editor, aliases/scopes, pins/category metadata, durable batch draft/review, conflicts, submission receipts and display retry. |
| Vault | Frozen policy/settings review, wait, explicit confirm/cancel, return to Sites; review creates no permission. |
| Settings | Protected timing fields, curated proposal, managed blocking, policy/recovery and independent diagnostics/export. |
| Access page | Exact destination/scope, wait/ready/allow/deny/expired/unavailable, existing start/confirm/cancel/open/restart actions and owning tab selection. |
| Browser surfaces | Toolbar/options open the same control page; there is no separate popup or side-panel app. The content Journey badge is passive. |

Shared native controls, feedback tones, cards, SVG symbols and typography retain
their state bindings. Core, controller, adapter and storage are outside the design
boundary. One visible-page refresh owner, keyed cards, quiet setters, coalesced
draft saves, focus/caret/scroll handling and diagnostic epoch fences remain.

## Design

Flat midnight navy, cream and antique gold tokens cover every control-page view.
A top navigation bar uses existing Home/Sites/Settings/Vault routes. Home pairs
introduction/search/category shortcuts with a static inline SVG compass. The first
six saved pins occupy fixed positions; remaining pins continue in a grid. Small
windows and zoom use an ordinary grid without the compass. No pin is dropped or
reordered by the layout. Full category sections remain below the hero, including
their existing collapse and show-all controls. Shortcuts scroll/focus those same
sections without changing saved collapse preferences. Additional shortcuts use a
native disclosure. Hidden categories remain searchable/manageable as before.

No Frequent tab, new usage tracking, routing framework, confirmation mechanism,
storage schema, preference or polling owner is introduced. No photography,
generated images, texture, gradients, glow or continuous animation.

## Assets

Compass, emblem and category/control SVGs are original repository-native geometry.
The existing favicon loader/cache/fallback stays in place: it can use browser site
metadata and its already-supported public lookups. No new remote icon provider is
added. The user explicitly confirms retaining online website favicons while all
new design assets stay local. System serif (Georgia/Times) and system UI/monospace stacks require no font
download or redistribution; no new third-party asset licence is needed. Decorative
SVGs are aria-hidden, unfocusable and pointer-inert. Labels remain native controls.

## Verification

Actual Firefox 159 control-page and editor screenshots were inspected before
editing. Verification uses disposable profiles and synthetic policy/presentation
fixtures, never the everyday profile. Previous release evidence is historical,
not evidence of the new design. Machine-readable results are retained in
[visual-redesign-0.2.0.json](evidence/visual-redesign-0.2.0.json).

The new regression tests cover keyed category shortcuts, order/overflow,
rename/hide/reordering without changing category state, quiet rerenders, and
text/status/focus colour contrast. Existing behavioral assertions stay intact;
the old rail dimensions/card heights and active Vault navigation assertions were
updated to the explicitly requested layout. Native icon checks wait for existing
navigation scroll restoration before scrolling their fixture into view.

Native coverage includes 14 pins, 298 exact destinations, 30 custom categories,
long labels, missing-icon fallback, unavailable UI with independent diagnostics,
real pending Greylist access and frozen Vault review. Requested window widths
360–1440 and actual 125/200% browser zoom have no horizontal overflow. Firefox on
this Windows runner clamps outer windows below 500 px; results record actual
content widths rather than claiming a 360 px outer window was achieved. At
500 px / 200% zoom the actual content viewport is 250 px; Home, Sites and Settings
all remain within it. The Home
organization suite additionally checks 5/15/30 categories, widths through 1800,
150% zoom, hide/collapse/reorder, explicit pin order, full Firefox restart, two
control-page conflicts, failed saves/retry, exact hidden-destination search,
existing grant/Journey links and browser Back/editor context. The persistent
batch suite covers three restarts, one real Vault cycle, frozen receipts,
display-only retry and stale reconciliation. Keyboard/caret/scroll and editor
save-failure checks also pass in the quality fixture.

Final automated checks: **247 Core tests and 524 extension tests pass**, including
the five new shortcut/contrast regressions. The development build and TypeScript
checks pass. The native general gate suite verifies manual/managed denial,
unrelated navigation blocked before server contact, the correlated Journey
round-trip, explicit Greylist confirmation and duplicate rejection, closed-tab
actions and background restart with original deadlines. Productization checks
cover online/observed favicons, pin/unpin focus and failed saves, exact search,
protected timing settings and preserved old terms through extension restart.

The first long-list run caught browser scroll anchoring competing with Atlas's
explicit saved offset when the directory changes between two columns and the
editor's single column. `overflow-anchor: none` on that scroll container preserves
the existing restoration owner. The unchanged reload assertion then passed at
exactly 600 px before and after. No navigation/storage redesign was needed.

| Measurement | Preserved UI | New UI |
| --- | --- | --- |
| Sites → Home, 12 samples per run | median 9.5 ms | medians 9–10 ms across final runs |
| Five-second idle pin subtree | 0 mutations; same node | 0 mutations; same node |
| Five-second idle localStorage writes | 0 | 0 |
| Ordinary native gated navigation | median 125 ms | median 125 ms |
| 2,500-record history navigation | medians 359 ms (initial baseline mode), 593 ms (same full setup) | median 437 ms |

These are local small-sample measurements, not a speedup claim. The large-history
variation does not establish a redesign regression or a reliability fix. The
background bundle is byte-identical to the pre-change runtime. Control-page JS
increases by about 2.2 KB and CSS by about 4 KB uncompressed; no new font/image
download paths, dependencies, polling loops or background tasks are added. The
favicon provider/cache code and existing resource paths are unchanged. This is
source/bundle verification plus native idle evidence, not a whole-browser CPU or
heap benchmark.

## Screenshots and retained workflows

- Before: [Home](evidence/visual-redesign-0.2.0/before-home.png),
  [Sites](evidence/visual-redesign-0.2.0/before-sites.png).
- [Home / six saved pins](evidence/visual-redesign-0.2.0/home.png),
  [many pins](evidence/visual-redesign-0.2.0/home-many-pins.png),
  [narrow Home](evidence/visual-redesign-0.2.0/home-small.png).
- [Populated category](evidence/visual-redesign-0.2.0/category.png),
  [complete directory](evidence/visual-redesign-0.2.0/directory.png),
  [298 destinations](evidence/visual-redesign-0.2.0/directory-crowded.png).
- [Vault proposal](evidence/visual-redesign-0.2.0/vault.png),
  [settings](evidence/visual-redesign-0.2.0/settings.png),
  [waiting access request](evidence/visual-redesign-0.2.0/access-wait.png).
- [Unavailable state](evidence/visual-redesign-0.2.0/unavailable.png),
  [independent diagnostics](evidence/visual-redesign-0.2.0/diagnostics.png).

Every capability in the inventory retains its original handler/state model.
`All destinations` opens the existing Sites & Access directory. `Vault` is a
shortcut to the existing Settings/Vault route. The full category directory stays
below Home rather than replacing the compass area: this retains saved collapse,
show-all, focus and scroll behavior. No Frequent tab, popup or side panel was
invented. Destination labels retain secondary exact hosts and variant controls.
The existing passive content Journey indicator only changes colours.

## Changed owners and limits

Production changes are confined to `extension/src/ui/assets/` (shared styles,
markup, original SVGs), `ui/main.ts` (presentation wiring), the small keyed
`ui/home-shortcuts.ts` presenter, the content indicator's style literal, and the
development version in manifest/package/lockfile. Generated `extension/dist`
is rebuilt normally. Tests live in `tests/home-shortcuts.test.mjs`,
`tests/visual-contrast.test.mjs` and the native `firefox_visual_redesign.py`
scenario; existing native Home/productization fixtures retain their functional
checks. There is no test instrumentation in the shipped modules.

No policy, adapter command, Core semantics, persisted schema, permission,
new-tab/startup override or migration changes. All 134 inventoried files under
the existing release directories remain hash-identical. Nothing was signed,
submitted, deployed, committed or pushed. The extension ID remains
`atlas-development@atlas.invalid`; 0.2.0 is a development build only.
After retaining the sanitized results/screenshots, the 16 profiles and two
comparison copies created for this task were removed (about 1.63 GB reclaimed).
Other `.tools` contents and Firefox profiles were left untouched.

Keyboard and measured palette contrast are verified, but this is not a complete
screen-reader/accessibility audit. Fonts use available system metrics, and
existing online favicon availability varies. Windows Firefox is the native
verification platform; other operating-system font rendering is unverified.
The user's intermittent `INTERNAL_ERROR` remains unresolved; this presentation
pass makes no claim to fix it. Existing diagnostics/recovery remain available.
