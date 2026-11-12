# Home hierarchy and compass pointer repair

Development work after signed 0.2.8. No version change, packaging or signing.

## Cause and implementation

Every pin center hit `compass-handle` in the pre-change native Firefox test.
Rotating `#pinned-primary` made it a stacking context below that transparent
handle, regardless of each pin's own z-index. The repair lifts the parent layer
above the handle, makes its empty area pointer-transparent, and explicitly
enables pointer events on the buttons. Clicks reach pins; bare ring areas still
rotate. This is unrelated to authorization or the prior busy-opacity flash.

Production changes are localized to `extension/src/ui/assets/style.css`:

- Centered 1140px Home content, approximately 35/65 category/compass columns,
  420–460px desktop panel, and more deliberate heading proportions.
- Centered compass with responsive scale, existing upright site icons, rotation,
  folders and overflow behavior. No extra decoration or animation.
- Five complete 52px category rows at rest, with all other visible categories
  available through the same scroll area. CSS proximity snapping; no JS sizing.
- Readable opened-category rows adapting to available width instead of a fixed
  three-column grid in the narrow workspace.
- Quieter category frames, subtle navy panel surface, prominent search outline,
  and a Greylist strip that shrinks when empty and scrolls after one full row.

## Verification

Development build and both TypeScript checks passed. All 662 extension regression
tests passed. Core source and behavior were not changed or rebuilt into a release;
the Core suite was not separately rerun for this CSS-only production change.

`firefox_home_hierarchy.py`, invoked through the existing compact Home harness,
uses isolated native Firefox 160.0 profiles. It covers:

- Before/after pointer hit tests; actual mouse activation of a single pin and a
  Firefox folder chooser; exact chosen URL sent through OPEN_DESTINATION.
- Keyboard chooser activation, Escape focus restoration, ring dragging/coasting,
  and pin hit targets after rotation. No drag accidentally launches a site.
- 1920×1080, 1440×900, 1100×800, 800×750 and 500×750 content viewports, plus 125%
  and 200% Firefox zoom. No horizontal overflow or partially clipped category row
  at rest in those checks. Narrow widths use labelled shortcuts/document scroll.
- 0, 1, 6, 8, 10 and 12 pins, including overflow; no overlapping pin targets.
- Existing categories plus synthetic 2/30-category DOM fixtures with a long label.
  These fixtures are geometry checks, not saved-metadata migration tests.
- Stable main-panel geometry while opening/closing a large category; keyboard
  access to the final category; readable category result widths.
- Real pending, ready, active, cancelled and empty Greylist states using the
  previous cancellation regression. Two genuine pending requests scroll within
  the strip. Explicit confirmation and acknowledged cancellation remain required.

See `before.json`, `after.json` and the retained screenshots. The before result
records the failure as an expected baseline observation, not a passing pin UI.
Visual review included the desktop, narrow, populated-category, single-pin and
multiple-request screenshots. One intermediate native run timed out after the
fixture returned focus before an asynchronous site launch had completed. The
fixture now waits for the real launch response before switching back to Home;
the complete final run passed. This changes test sequencing, not production code.
Reproduce with:

```text
python extension/scripts/firefox_compact_home.py --home-hierarchy-only --signed-baseline 0.2.8
```

## Boundaries and limitations

All existing release-file hashes and Core source bytes match the pre-task
checkpoint. No production TypeScript, permissions, bookmark sync, policy, timing,
persistence format, extension identity or installed profile was changed.

Screenshots and native interaction checks are headless Firefox evidence, not a
claim of assistive-technology conformance, physical-display frame pacing or faster
page loads. The visual change prioritizes relative scale and fit rather than a
uniform 30–40% wheel enlargement at every viewport. Categories can pass partially
through the scroll edge while scrolling; their resting initial layout is complete.
The historical INTERNAL_ERROR remains outside this repair.
