# Compass hover and drag feedback

Development-only fix, 2026-11-15. No version bump or new release package.
The prepared and signed releases remain unchanged.

## Finding and repair

Native Firefox 160.0 reproduced both issues in the unchanged 0.3.2 development
bundle, using an isolated profile over signed 0.3.1. The drag handle acquired a
solid outline only after movement. On hover, the pin's gradient disappeared while
its replacement background color animated from transparent to opaque. Both
themes produced 23 sampled hover frames with no background image and an RGBA
background color. Pin opacity stayed at 1 and the pin/image nodes were retained.
This was a CSS transition, not evidence of icon reloading or a background restart.
The baseline is retained in [baseline.json](baseline.json).

Shared extension CSS removes the drag-only outline, keeps the same pin surface
on hover and excludes backgrounds from pin transitions. The hover border and
keyboard focus indicators remain. Unused pin-hover color variables were removed
from the themes and their contract. No interaction JavaScript, Core logic,
persistence schema, fonts or artwork changed.

## Verification

- Development build passed, including both TypeScript compilers and bundle/asset
  checks. The sandbox blocked the first bundler attempt; the same build succeeded
  outside it, without changing build configuration.
- All 135 focused Home, compass, theme, icon and UI stability/reliability tests
  passed. See [tests.json](tests.json) for the exact test files.
- [Native theme checks](native.json) passed for Celestial and Parchment. Repeated
  hover entry/exit retained a single gradient/color/opacity combination across
  541 sampled frames in normal and reduced-motion modes, with identical pin/image
  nodes. All eight drag sequences retained a transparent handle and no outline;
  rotation and grab/grabbing cursors worked. Keyboard focus remained visible.
- A synthetic GET_VIEW rejection still disabled/dimmed pins to 0.6; restored reads
  returned them to 1. This tests failure presentation, not the cause of a real
  authority failure. [Existing Greylist controls](greylist.json) separately check
  real access actions, fixed waits, explicit confirmation, cancellation, failed
  cancellation and opacity 1 while busy, with duplicate actions disabled.
- The existing theme scenario also passed gated pointer opening, narrow/zoomed
  layouts, local artwork loading, saved theme reload/restart and warm switching
  without replaced nodes, new fetches or icon assignments.
- [Folder/Home checks](folders.json) passed nested and overflow menus, keyboard
  dismissal, ordinary gated opening, icon-save failure/retry, zoom and restart
  persistence. Two outdated navigation steps were corrected to the existing
  Greylist & Journeys and All Sites pages. The idle check now uses resource start
  times to separate older requests completing during the observation from new
  requests; it still requires zero compass mutations and zero observed new
  requests. These are test corrections, not application behavior changes.
- [Integrity checks](integrity.json) compare all 238 protected Core source/output,
  retained release, theme artwork and font files against pre-change SHA-256 hashes.

The native checks use headless Firefox, real pointer/key input and synthetic
profile state. They are not a physical-display GPU measurement or a claim of
improved runtime performance. The everyday Firefox profile was not used.
After retaining these results, this task's disposable profiles and runtime copies
were removed; see [cleanup.json](cleanup.json).

## Reproduce

Build once with `npm.cmd --prefix extension run build`, then run the focused test
files listed in `tests.json` with `node --test`.

```text
python extension/scripts/firefox_compact_home.py --theme-prototypes-only --signed-baseline 0.3.1
python extension/scripts/firefox_compact_home.py --greylist-controls-only --signed-baseline 0.3.1
python extension/scripts/firefox_compact_home.py --simplify-only --signed-baseline 0.3.1
```

Screenshots during an active drag: [Celestial](celestial-held-compass.png) and
[Parchment](parchment-held-compass.png). The existing decorative compass rings are
preserved; only the transient drag outline was removed.
