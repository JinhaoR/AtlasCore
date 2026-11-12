# Home motion and access overview

Development verification on 2026-11-10, Firefox 159.0.1 on Windows in disposable
profiles. Signed 0.2.6 was the isolated baseline; no everyday profile or installed
release was changed. The working runtime was checkpointed before editing.

## Results

- Core: 249 tests passed. Extension: 631 tests passed, including five new angular
  motion regressions. TypeScript compilation and the development build passed.
- Native pointer input turns the compass artwork and pin positions together;
  logos remain upright. Release coasts, a held release does not, and Escape and
  reduced motion stop/prevent the coast. Pin activation still works afterwards.
- Normal Home launches do not change the access selection. An explicit request
  link selects its owner. A previously selected Journey is still listed on Home.
- Two Greylist rows fit completely. Five rows scroll inside the same box: the
  heading, search, launcher and access-box rectangles are exactly unchanged.
- At a 1752 × 1117 content viewport, the introduction starts at y=111.4 below a
  header ending at y=83.4. The checkpoint started at y=188.5 without a selected
  tab. At 1280 × 915, the final access box ends at y=889 and Home fits without
  main-page scrolling. Smaller/zoomed layouts use the document-scroll fallback.
- Normal/short desktop, 500-pixel-wide and Firefox 125%, 150%, 200% zoom checks
  show no horizontal overflow. Screenshots were inspected for spacing and surface
  hierarchy; these checks do not claim accessibility conformance.
- After settling, both checkpoint and final wheel observations recorded zero DOM
  mutations and zero new resource requests over 2.2 seconds. No startup/load-time
  improvement is claimed.
- Policy, revisions, settings, access permission terms, pins, bookmark pages and
  category layout were preserved. The normal observed-time field may advance.
  Core, adapter, background and storage source bytes match the task checkpoint.
  All 342 pre-existing release-file hashes remain unchanged.

## Evidence

- [Final native result](result.json), [checkpoint result](before.json).
- [Checkpoint Home](before.png), [final Home with two rows](home-two-greylist.png).
- [Turned compass](home-compass-turned.png), [scrolling Greylist](home-greylist-overflow.png).
- [Separate Journey overview](home-greylist-and-journey.png).
- [Short window](home-1280-1.png), [200% zoom](home-1488-2.png),
  [narrow window](home-500-1.png).

The native fixture uses headless Firefox and WebDriver mouse actions. Pending
requests, Journeys, unavailable status and launch replies are injected in the
test control page only, never in the shipped build or Core. Existing regression
suites cover real authorization. Physical touch/trackpad feel and other platforms
were not separately verified. The historical INTERNAL_ERROR is outside this work.

Run after a development build:

```text
npm --prefix packages/core run test:built
npm --prefix extension run test:built
python extension/scripts/firefox_compact_home.py --home-motion-only --signed-baseline 0.2.6
```

The earlier UX native fixture now allows the intentionally longer four-second
settle window. No release version or permission changed; no signing, submission
or live installation/deployment was performed. Task-created native profiles and
runtime copies are removed after retaining this evidence. See the
[checkpoint integrity comparison](integrity.json).
