# Everyday rendering polish — 2026-11-09

The working development tree was preserved in `.tools/ui-polish/checkpoint.zip`.
Native comparisons use copied Firefox 159.0.1 runtimes and disposable profiles,
the same six-pin curated fixture and numeric/geometry-only probes. No measurement
instrumentation enters the development bundle.

## Reproduced and corrected

| Observation | Correction and verification |
| --- | --- |
| The pin area briefly shrank from 312px to 120px while loading. The footer moved up 35px, then back down. Font settling also changed the customization button width. | Reserve desktop pin space, distinguish unknown membership from an empty group, and reserve button width. Three final reload traces retain identical search/pin/footer rectangles from their first measurable layout. |
| Home prepared 122 category cards while every category was closed. | Initial Home creates zero category cards. Opening University creates its 32 cards and shows its normal 12-item preview. Previously visited cards remain available for stable state/focus and normal updates. |
| Routine LOADING/COMMITTING projections added “Access unverified” to every pin label, although the same acknowledged snapshot remained usable for queued intent. | Labels retain acknowledged presentation. Synthetic unavailable projections still disable every pin and show recovery. This tests display handling, not a claim to reproduce the historical runtime fault. |
| Category contents could enlarge Home because an older display rule overrode the flex shell. | Correct the Home flex rule and basis. Category, search-results and empty-search views retain the exact search/compass/footer geometry. |
| 10:00 → 9:59 and 100:00 → 99:59 resized the text column beside the countdown. | Reserve countdown width. All four native samples now have identical copy/time/action/footer rectangles. No deadline or permission changes. |
| Management-page reloads first displayed Home for about one frame. | A 592-byte development startup script selects the same closed URL route before the main bundle. The final Sites, Vault and Settings traces contain no measurable Home view. |
| At intermediate widths the Home-specific stationary breakpoint disagreed with its parent desktop shell. | Align the breakpoints; small and zoomed viewports consistently use document scrolling. No horizontal overflow in the six tested viewport/zoom combinations, including 125%, 150% and 200%. |

## Timing and idle limits

Two checkpoint runs populated categories at 73–79ms and 59–62ms. Three updated
runs ranged from 53–63ms. The final three samples were 55/53/59ms. Startup Home
render work peaked at 8–17ms in the checkpoints and 4–7ms after lazy card creation.
These small local samples show reduced initial work, not a universal speed promise.

Sites/Home round trips were variable: checkpoint medians were about 21ms and
13ms; the final median was 12.5ms. Evidence does **not** establish a consistent
large navigation speedup. These timings include Marionette/frame scheduling.

Five-second idle windows, both before and after, had zero Home node replacements,
attribute changes and extra resource requests; pin identity was retained. Each had
five GET_VIEW and five presentation reads through the existing refresh owners.
This pass does not claim an idle-request reduction.

## Verification and boundaries

- 597 extension tests and 249 Core tests pass; development build and both
  TypeScript compilers pass. New tests cover first-paint URL routing and pin status
  during housekeeping, unavailable authority, expiry and Blacklist precedence.
- Native focused regression covers reload geometry, delayed startup phases,
  closed-category work, active/unavailable presentation, category/search layout,
  countdown widths, all management-page reloads and viewport/zoom checks.
- The existing everyday native regression also passes: popup command boundaries
  and draft retention, optional bookmark connection, two-way changes, dirty-editor
  conflicts and restart/reconnection, keyboard scrolling, exact-URL gated launches,
  Blacklist denial, real Greylist wait/confirmation/expiry and unavailable state.
  Physical toolbar-click and popup-keyboard activation remain unverified by the
  headless harness, as recorded in its result.
- The probe initially counted an invisible parser frame, before any Home nodes
  existed, as a wrong-page render. The assertion now checks measurable page content;
  it still rejects the original visible Home flash.
- Core source, existing release artifacts, extension ID/version and everyday
  Firefox profile/policies are unchanged. No signing, packaging or deployment.
- Existing local fonts can still settle during the first frame; exact layout for
  every label, font-failure environment or physical monitor is not claimed.
  Native headless tests are not physical-trackpad or accessibility certification.
- The historical intermittent INTERNAL_ERROR remains unresolved.

Reproduce: `python extension/scripts/firefox_compact_home.py --polish-only
--signed-baseline 0.2.2`; add `--polish-baseline` to use the preserved checkpoint.
Raw numeric JSON and representative screenshots are retained alongside this file.
All seven task-created profile/runtime directories were removed after preserving
the evidence. The checkpoint archive remains available locally. The 270-file
protected inventory (246 release files and 24 Core source files) is unchanged.
