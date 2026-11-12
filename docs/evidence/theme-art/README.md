# Celestial / Parchment: historical-chart art direction

Development refinement, 11 November 2026. Select **Settings → Pins & category
icons → Appearance**. No release was packaged, versioned, signed or installed.
The pre-change working tree is preserved in `.tools/theme-art/checkpoint.zip`.

## Actual Firefox screenshots

1752 × 1202 browser window; 1752 × 1117 content. These are rendered application
screenshots, not design mockups. The fixture pins and categories are synthetic;
normal website favicon loading is retained and may produce temporary fallbacks.

| View | Celestial | Parchment |
| --- | --- | --- |
| Home | [Astronomical instrument](celestial-home.png) | [Portolan wind rose](parchment-home.png) |
| All Sites | [Category directory](celestial-categories.png) | [Category directory](parchment-categories.png) |
| Populated category | [University sites](celestial-sites.png) | [University sites](parchment-sites.png) |
| Editor | [Site editor](celestial-editor.png) | [Site editor](parchment-editor.png) |
| Settings | [Timing controls](celestial-settings.png) | [Timing controls](parchment-settings.png) |
| Greylist | [Two-row sample](celestial-greylist.png) | [Two-row sample](parchment-greylist.png) |
| Narrow / zoom | [540px window](celestial-narrow.png) | [Firefox 200% zoom](parchment-zoom-200.png) |

## Research and artistic decisions

The actual images were downloaded and visually inspected, including a larger
3840px Aguiar reproduction for the compass construction. Research included:

- Jorge de Aguiar's 1492 portolan, Beinecke/Yale, via its rights-labelled
  [Wikimedia reproduction](https://commons.wikimedia.org/wiki/File:Jorge_Aguiar_1492_MR.jpg).
  Its structure is a network of wind lines with nested colored roses, not a
  generic eight-point icon. The large central rose combines blue cardinal winds,
  red half-winds, green inner points and interlaced fine inkwork.
- Doppelmayr's [1730 northern sky](https://commons.wikimedia.org/wiki/File:1730_celestial_map_of_the_Northern_Hemisphere_Sky.jpg)
  and [1742 planetary diagrams](https://commons.wikimedia.org/wiki/File:Atlas_Novus_Coelestis_by_Johann_Gabriel_Doppelmayr_(1742)_007.jpg).
  The observed circular hierarchy, graduated limbs, eccentric orbits and fine
  engraved lines informed Celestial. The northern-sky scan is actually bundled.
- The Met's [1291 astrolabe by ‘Umar ibn Yusuf](https://www.metmuseum.org/art/collection/search/444408),
  explicitly labelled Public Domain. Its layered brass limb and geometric
  interior informed the instrument; its photograph is reference-only.

Library of Congress and some secondary reference pages rejected requests; no
claim is made to have inspected those inaccessible scans. No unverified asset
from those sources was bundled. Specific reproduction rights, source URLs,
creators and adaptations are recorded in the shipped
[ARTWORK.md](../../../extension/src/ui/assets/themes/ARTWORK.md).

**Celestial** uses a tangible brass rim around enamel blue, an eccentric ecliptic,
engraved divisions, quiet stars and the actual historical northern-sky chart.
Atlas's original eight-point center remains. The hierarchy is instrument first,
historical field second: the middle darkens to keep the controls readable while
the engraving emerges toward the margins. Blue surfaces and gold edges continue
the same language on All Sites, rather than creating a separate management skin.

**Parchment** uses the actual Aguiar chart as its paper/ink backdrop. Its compass
is a regularized vector adaptation of the manuscript's nested roses, with
vermilion, deep blue, green and paper-colored facets. The ink rings, petal
intersections and floral center remain crisp as it turns. Warm cartouche-like
double rules, rust accents and firmer Cormorant headings distinguish it from
Celestial without moving any interface component.

Both use the existing locally bundled OFL fonts. Their source files and licences
are unchanged. The new vector authoring script is offline tooling, not runtime.

## Visual iteration

1. [First Celestial render](iteration-1/celestial-home.png): the chart competed
   with the controls and the instrument rim was too insubstantial. Darkened the
   engraving and replaced the hairline-only rim with a graduated brass annulus.
2. [First Parchment render](iteration-1/parchment-home.png): the nested pigments
   read clearly at the existing pin radius. Strengthened the quiet paper area
   around the center, retaining visible coastlines and manuscript ink at the edges.
3. Native narrow/200% screenshots exposed rectangular pin-shadow outlines and
   leftover orbit decoration in the labelled-row fallback. Suppressed those
   purely visual treatments in that existing layout. No targets were resized.
4. Inspected final Home, category directory, populated rows, editor, Settings,
   Greylist, narrow and zoom screenshots. Preserved fixed Home geometry as the
   Greylist appears, changes height and disappears.

## Verification

- Development build, both TypeScript compilers and bundle verification pass.
- **691 extension tests and 253 Core tests pass.** Focused theme/font/contrast
  checks: 18 passed. Palette contrast checks are not accessibility certification.
- Native Firefox **160.0**, copied runtime and disposable profiles, signed
  0.2.8 fixture base with a development overlay. [Results](results.json).
- Real pin-center hits and mouse activation reach `OPEN_DESTINATION` in both
  themes. Relative pin rectangles are identical; the original rotation owner
  rotates the artwork. Reload and full browser restart preserve selection.
- Warm theme selection retains pin/SVG identity with **0 DOM child replacements,
  0 background commands, 0 JS fetches and 0 image-src assignments** in the
  isolated selection transaction. CSS images are local and separately checked
  to load. This does not claim zero cold image decoding or 144Hz performance.
- The first measurement accidentally included an independent scheduled
  `PRESENTATION_READ`. The fixture now samples selection in one browser task
  plus its microtasks; production refresh logic was not changed.
- [Greylist geometry](greylist-layout.json): **0px excursion** for logo, search
  and compass through 0 → 1 → 2 → 5 → 0 rows in all four themes. Rows are capped
  at 128px then scroll. 1300px, 980px, 540px and Firefox 125%/200% checks pass
  without horizontal document overflow. These are paint-only fixtures, not new
  grant/cancellation workflow tests. Their existing refresh owner is paused only
  in the disposable test page while the synthetic rows are photographed.

Commands:

```text
npm --prefix extension run build
npm --prefix extension run test:built
npm --prefix packages/core run test:built
python extension/scripts/firefox_compact_home.py --theme-prototypes-only --signed-baseline 0.2.8
python extension/scripts/firefox_compact_home.py --greylist-layout-only --signed-baseline 0.2.8
```

## Integrity, cost and limits

[Integrity evidence](integrity.json): **438 previous release files** and **175
source/runtime implementation files** are byte-identical to the checkpoint.
Core authorization, commands, manifest/identity, pin positions, navigation,
saved preferences and persistence formats are unchanged. No everyday Firefox
profile or enterprise policy was accessed. Task-created disposable profiles and
runtime copies were removed after preserving this evidence.

The two historical thumbnails plus seven static SVGs total **914,438 bytes**
uncompressed. The scans are deliberately reduced provider thumbnails rather than
multi-megabyte originals. This is more artwork than the conservative prototypes;
there is an additional local decode/rasterization cost on cold selection. No new
polling, runtime generation, SVG filters, animation owner or remote request is
introduced. The one-time background render has not been profiled on a physical
144Hz display or low-powered hardware; no performance improvement is claimed.

Historical geometry is adapted for decorative browser use, not a functioning
astrolabe or faithful facsimile. Background crop varies with viewport aspect
ratio. Existing favicon providers can yield inconsistent/missing icons; their
fallback behavior is unchanged. Screen readers and non-Windows native rendering
were not reverified. The historical INTERNAL_ERROR remains unresolved and outside
this presentation task. The prepared 0.3.0 signing candidate remains untouched.
