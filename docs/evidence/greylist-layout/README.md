# Greylist layout stability

The desktop workspace used automatic vertical margins to center its entire
intrinsic height. Hiding the empty access wrapper removed its height; adding
Greylist rows then recentered the logo, search and compass upwards.

The shared application stylesheet now reserves 146px for the two-row access
footprint on centered desktop Home. Boxes align to the top, so a single visible
row stays compact and two rows show without scrolling; further rows scroll inside
the existing 128px region. A verified-empty Greylist remains invisible. The
reservation is not a theme value, permission or stored preference. Narrow/short
layouts retain normal document flow and hide the empty wrapper.

## Verification

Build, both TypeScript compilers and bundle validation pass. The affected
Home/Greylist/organization/rendering/theme test families pass **70 tests**.

Native Firefox **160.0**, disposable profiles, six pins, unchanged signed 0.2.8
baseline with development overlay. `firefox_greylist_layout.py` measures actual
rectangles using presentation-only row fixtures; it creates no requests/grants.

```text
python extension/scripts/firefox_compact_home.py --greylist-layout-only --signed-baseline 0.2.8
```

For Default, Light (test), Celestial and Parchment, measured maximum logo/search/
compass movement across **0 -> 1 -> 2 -> 5 -> 0 rows**:

| Build | Movement |
| --- | --- |
| Checkpoint | 81px |
| Repaired | 0px |

[Before measurements](before.json) / [after measurements](after.json).

The two-row viewport is 128px; five rows retain that height and overflow
internally. Parchment also passes position/overflow checks at 1300x950, 980x850,
540x900 and real Firefox 125%/200% zoom. The accessible document-scroll fallback
remains available. These are geometry checks, not a physical display/FPS test.

- Celestial: [empty](celestial-0-rows.png), [two rows](celestial-2-rows.png).
- Parchment: [empty](parchment-0-rows.png), [two rows](parchment-2-rows.png).

Only application CSS changes in production; generated development dist is rebuilt.
Core, adapter commands, themes, state and deadlines are unchanged. All **438**
existing release-file hashes match the pre-task inventory. No version, signing,
installation or everyday-profile changes. The checkpoint remains under
`.tools/greylist-layout/checkpoint.zip`; only this task's disposable runtime copies
and profiles were removed after retaining evidence.
