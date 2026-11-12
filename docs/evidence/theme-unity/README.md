# Compass-led Celestial and connected Parchment

Development refinement, 11 November 2026. Select Settings → Pins & category icons
→ Appearance. No version change, packaging, signing, deployment or everyday
Firefox profile changes. The starting working tree is preserved in
`.tools/theme-unity/checkpoint.zip`.

## Rendered outcome

These are native Firefox 160.0 screenshots, using disposable profiles and
synthetic sites. Desktop content size: 1752 × 1117.

| View | Celestial | Parchment |
| --- | --- | --- |
| Home | [Home](celestial-home.png) | [Home](parchment-home.png) |
| All Sites | [Categories](celestial-categories.png) | [Categories](parchment-categories.png) |
| Populated category | [Sites](celestial-sites.png) | [Sites](parchment-sites.png) |
| Search | [Search](celestial-search.png) | [Search](parchment-search.png) |
| Greylist | [Greylist](celestial-greylist.png) | [Greylist](parchment-greylist.png) |
| Editor | [Editor](celestial-editor.png) | [Editor](parchment-editor.png) |
| Settings | [Settings](celestial-settings.png) | [Settings](parchment-settings.png) |
| Narrow window | [540px](celestial-narrow.png) | [540px](parchment-narrow.png) |
| Zoom | [200%](celestial-zoom-200.png) | [200%](parchment-zoom-200.png) |

## Decisions and visual iterations

**Celestial:** removed the complete, giant circular chart from Home. It competed
with the brass instrument instead of supporting it. Smaller engraved figures
and chart fragments now sit at the sides, separated from the foreground by a
quiet enamel-blue field. Fine marginal rulings replace the second graduated
plate. The original brass instrument and its surrounding orbit are byte-identical.
All Sites keeps its previously quieter working-page composition.

The [first revision](iteration-1/celestial-home.png) still enlarged the historical
fragments too much. After inspecting it, their scale and ink opacity were reduced.
A finer 1280px reproduction of the same source supplies the final crops; the
previous source remains intact. No constellation details or stars were invented.

**Parchment:** keeps the exact approved rose and authentic coastal fragments.
Removed the fixed-viewport wind origins that felt disconnected from the compass.
The three-color rhumb field now originates at the actual launcher/compass center
and fades toward the coastal margins. This static background stays separate from
the rotating rose. The center remains quiet enough for pins and their labels.

**Shared materials:** cream disks have restrained inner rules and warmer edge
tones, matched to the search borders and the compass pigments/brass. Heavy dark
disk outlines are removed. Parchment's search uses the existing italic Cormorant
face with a stronger weight after the first render appeared too thin. Celestial
keeps readable sans-serif controls with slightly tighter wordmark spacing.
Forms, hostnames, warnings and search results retain their existing UI typography.

The supplied references guided hierarchy, not a literal reproduction. No clouds,
ships, celestial figures or other raster details were generated. Historical
figures are direct crops/tonal separations of the documented source. Geometry is
authored as static SVG. [Source copies, rights and exact transformations](../../../extension/src/ui/assets/themes/ARTWORK.md).

## Small presentation boundary

- Existing theme variables own surfaces, borders, shadows and type.
- One new `--compass-field` background is painted behind the existing launcher
  region. Its center follows the compass without JS measurements, polling or
  viewport-coordinate guesses. It contributes no layout size, catches no pointer
  input and is omitted for zero/one pins and narrow labelled layouts.
- Search family/style/weight tokens preserve application-owned sizes and line
  heights. Default/Light keep their existing appearance.
- Theme IDs, preference storage, pinned-site coordinates, callbacks, rotation,
  authorization and navigation owners are unchanged.
- Offline authoring scripts are outside the runtime. No dependency is added.

## Verification

- Development build and both TypeScript compilers pass.
- Complete suites: **691 extension tests, 253 Core tests**, all pass.
- Focused theme/font/contrast/Home checks: 57 pass on the first iteration;
  the final full suite includes these families. Contrast checks do not establish
  accessibility conformance.
- [Native results](results.json): Home, All Sites, search, category, editor,
  Settings, Greylist, 540px and 200% zoom. Local artwork loads; no horizontal
  document overflow in the checked responsive states.
- New native assertions verify that field/compass centers agree within one pixel
  (measured **0px** in both themes), the painter is pointer-transparent, and it
  disappears in the narrow layout. Actual pin clicks reach `OPEN_DESTINATION`;
  relative pin geometry agrees between themes and native rotation still works.
- Warm theme switches retain nodes with **0** child replacements,
  background commands, JS fetches or image-src assignments during the selection
  transaction. Full Firefox restart retains the theme from the first captured
  frame. This does not measure cold image-decode completion or display FPS.
- [Greylist geometry](greylist-layout.json): logo, search and compass excursions
  are **0px** through 0 → 1 → 2 → 5 → 0 rows in all four themes. Two-row scrolling,
  narrow windows and 125%/200% zoom pass. These use paint fixtures, not new grant
  semantics.
- [Integrity](integrity.json): all **438** existing release files unchanged;
  Core and non-asset application source unchanged; generated JS/JSON/maps/HTML
  unchanged. The approved compass assets are byte-identical. Built theme assets
  match source. No normal profile, browser policy or extension identity changes.

Commands:

```text
npm --prefix extension run build
npm --prefix extension run test:built
npm --prefix packages/core run test:built
python extension/scripts/firefox_compact_home.py --theme-prototypes-only --signed-baseline 0.2.8
python extension/scripts/firefox_compact_home.py --greylist-layout-only --signed-baseline 0.2.8
```

## Costs and limits

Artwork totals **2,267,256 bytes**, including the original JPEG copies. The new
1280px source copy is 697,268 bytes, retained for provenance and not loaded at
runtime. The two new marginal WebPs total 96,182 bytes. They replace Home's
134,056-byte hemisphere image; this byte difference is not a measured speedup.
The new bearings SVG is static; no animation loop or image processing is added.

Historical detail is intentionally subordinate and can soften under large zoom.
Fragments are decorative adaptations, not a scientific atlas or whole-map
reconstruction. Existing favicon failures/fallbacks remain possible. Physical
144Hz hardware, non-Windows rendering and screen-reader behavior were not newly
verified. The historical INTERNAL_ERROR remains outside this pass and unresolved.

Only this task's three disposable Firefox runtimes/profiles are removed after
retaining the screenshots and results. No release is prepared by this work.
