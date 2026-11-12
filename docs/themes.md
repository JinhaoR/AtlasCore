# Bundled themes

Atlas exposes visual values through CSS custom properties. Themes do not own
layout, components, event handlers, authority, storage migrations or navigation.
The initial refactor preserves the existing default appearance and includes one
small **Light (test)** palette to exercise the boundary. The subsequent design
prototypes, **Celestial** and **Parchment**, use that same boundary and preference.

## Map and audit

- `extension/src/ui/assets/themes/default.css`: complete visual contract and
  default fallback. Palette, typography, surfaces, radii/shadows, compass styling.
- `themes/light-test.css`: one root selector overriding only visual variables.
- `themes/celestial.css`, `themes/parchment.css`: complete design prototypes;
  historical reproductions and static vector artwork live in their same-named
  subdirectories. `themes/ARTWORK.md` owns asset provenance and rights.
- `assets/fonts.css`: shared existing local OFL font faces; unchanged font bytes.
- `assets/style.css`: application layout, responsive rules, component selectors,
  interactive geometry, overflow, focus behavior and motion. `popup.css` owns the
  separate small popup layout and consumes the same palette/fonts.
- `ui/theme.ts`: closed ID selection and acknowledged presentation writes.
  `theme-startup.ts` applies the saved ID to `<html data-theme>` synchronously
  **before styles/content** in both control and popup HTML.
- `ui/ui-text.ts`: selector labels and save/read failure copy.

Previously most main UI colors already used custom properties, but the root
palette/fonts were mixed into the large layout stylesheet. Icon disks, button
contrast, category borders, modal backdrops, Greylist signals and cancellation
had literal colors. The popup maintained an independent literal palette. The
compass inherited one color, with stroke details in its markup. There was no
saved theme preference. Application TypeScript contained no literal UI palette.

The extraction removes those literal colors from both component stylesheets,
removes the duplicate popup font declaration and superseded root text-size
values, and removes an empty media rule. It does not rewrite the historical
layout cascade or introduce a rendering/theme framework.

## Contract

`default.css` is the authoritative, readable list of supported values. Main roles:

| Role | Properties |
| --- | --- |
| Page and text | `--page`, `--page-background`, `--ink`, `--muted`, `--link` |
| Surfaces and interaction | `--surface`, `--surface-disabled`, `--surface-quiet` (categories and Home access summary), `--hover`, `--selected`, `--accent`, `--accent-muted`, `--accent-hover`, `--on-accent`, `--focus` |
| Borders | `--border`, `--border-soft`, `--control-border`, `--border-width` |
| Semantic state | `--success*`, `--warning*`, `--error*`, `--unavailable*`; `--access-wait-*`, `--access-active-*`, `--cancel-*` |
| Type | `--font-title`, `--font-body`, `--font-mono`, `--font-search`, `--search-font-style`, `--search-font-weight`, `--text-*`, `--weight-*`, `--heading-*`, `--subtitle-size`, `--wordmark-spacing` |
| Shape/elevation | `--radius`, `--radius-card`, `--radius-dialog`, `--radius-panel`, `--radius-search`, `--backdrop`, `--popover-shadow`, `--floating-shadow`, `--category-shadow`, `--search-shadow`, `--search-surface` |
| Icons and pins | `--icon-surface`, `--icon-border`, `--pin-surface`, `--pin-hover`, `--pin-ink`, `--pin-border`, `--pin-border-width`, `--pin-shadow` |
| Compass | `--compass-ring`, `--compass-ring-width`, `--compass-ring-dash`, `--compass-tick`, `--compass-tick-length`, `--compass-tick-dash`, `--compass-rose`, `--compass-rose-secondary`, `--compass-rose-outline`, `--compass-cardinal`, `--compass-font`, `--compass-weight`, `--compass-text-size`, `--compass-opacity` |
| Decoration | `--page-background` accepts a static background, with `--page-attachment` controlling its scroll treatment. Optional `--page-home-background` and `--page-workspace-background` use the existing body page identity for separate artwork composition. Narrow Home uses the quieter workspace treatment. `--compass-decoration` accepts a local static image/gradient behind the existing compass; `--compass-artwork` paints inside the existing rotating SVG box; `--brand-artwork` optionally replaces the brand image's visual content. None changes hit targets or layout. |

Shared components consume these values. Themes contain variable declarations
under `:root[data-theme="id"]`, not arbitrary component selectors. All definitions
ship with the extension. Stored values are a closed ID, never CSS or a resource URL.
There is no remote theme code, arbitrary user CSS, inheritance graph, event bus,
new dependency, timer or dynamic script loading.

App-owned: DOM, pin count/positions/hit targets, angle/physics, responsive sizes,
scroll regions, ordering/visibility, search/editor/dialog state, deadlines,
confirmation, error wording and disabled controls. Small fonts used in dense
special-purpose controls remain app-sized; the shared family still changes.
Preserve semantic words/icons as well as status colors. Verify contrast after any
palette/font change; the current tests are not accessibility certification.

Website favicons retain their provider colors and existing fetching lifecycle.
The Atlas brand defaults to the original local logo; a bundled theme can substitute
local artwork within the same image box and accessible name. Browser chrome/native popup dimensions
and the small indicator injected into websites are outside the control-page
contract. The content indicator remains self-contained so website CSS cannot
alter it. They are not alternate application layouts.

## Add a bundled theme

1. Copy the small root-selector pattern from `light-test.css`. Override visual
   values from `default.css`; omitted values fall back to the default. Use local
   assets only, with their licences. URLs inside custom properties resolve at
   their consuming stylesheet. Use
   `url("themes/my-theme/asset.svg")`, relative to the shared `ui/style.css`
   and `ui/popup.css`, not relative to the theme definition.
2. Register its closed ID in `ui/theme.ts`, add its labelled option in
   `assets/index.html`/`ui-text.ts`, and link its stylesheet after the default in
   both `index.html` and `popup.html`. No Home/Sites component changes are needed.
3. Add its files to distribution verification. At the next separately authorized
   release, extend the version-specific runtime allowlist in `scripts/release.mjs`
   without changing frozen inventories. This development pass deliberately does
   not rebuild or revise the already prepared 0.3.0 package.
4. Run build, contrast/contract tests and native screenshots, including forms,
   Greylist states, popovers, focused controls, narrow windows and zoom. Test that
   typography/background changes cannot clip controls or obscure status text.

## Preference and failures

Settings -> Pins & category icons -> Appearance selects a bundled ID. Only
`atlas-theme-v1` in extension-origin `localStorage` is written. The existing
`savePresentation` helper acknowledges writes or reconciles a thrown write.
Failed/uncertain saves retain the requested selection, keep the last acknowledged
appearance active and show a retry. A native `storage` event rereads the latest
saved scalar across open control pages/popups. Last acknowledged write wins;
unsaved local selection is retained and explicitly retryable after another window
changes the saved value. Unrelated records and authority are never written.

Startup reads the preference once before visual content. Unknown/missing IDs use
the default; an unavailable read uses default and exposes the read failure in
Appearance. Subsequent failed reads retain the last verified appearance. The
module updates only the root attribute and its selector/feedback. No component
re-render, navigation, icon fetch, data command or refresh loop is requested.
Listeners are removed on page hide. Theme selection survives a normal Firefox
restart and is included in a closed-profile backup; portable policy export and
Firefox bookmark sync do not carry it. Removing this key resets appearance only.

## Evidence

See [native verification](evidence/themes/README.md). Default-theme measurements
are compared with the preserved checkpoint, not an older release. The light
palette remains a contrast proof. See [prototype designs and native evidence](evidence/theme-prototypes/README.md)
for Celestial and Parchment. Layout variants remain outside the theme boundary.
Historical INTERNAL_ERROR is unchanged and unresolved.

## Historical-chart design refinement

The [first prototypes](evidence/theme-prototypes/README.md) were deliberately
restrained. The subsequent [art direction and screenshots](evidence/theme-art/README.md)
replace their artwork and surface treatment while preserving their theme IDs,
preference path and application behavior.

**Celestial** is a layered astronomical instrument: a graduated brass limb,
enamel-blue interior, eccentric ecliptic and fine geometric curves surround
Atlas's existing eight-point compass. The page uses an actual public-domain
Doppelmayr northern-sky reproduction beneath a dark vignette, with a static vector
chart overlay. Quiet blue panels, fine gold borders and local Cormorant Garamond
headings carry that instrument language into All Sites and the management pages.

**Parchment** is based on Jorge de Aguiar's 1492 portolan. A local reproduction
provides authentic coastlines, manuscript marks and paper variations. The compass
is a vector adaptation of that chart's central nested wind roses: blue cardinal
winds, vermilion half-winds, green intermediate points, woven ink rings and a
floral hub. This is a different artwork, not a palette swap of Celestial.
Warm vellum surfaces, double-rule cartouche borders and heavier Cormorant headings
support readable modern controls. Source Sans 3 remains the interface font in both.

The two historical thumbnails are bundled unchanged; scaling, cropping and color
veils happen in CSS. Specific file rights, creators, URLs and adaptation details
are in [ARTWORK.md](../extension/src/ui/assets/themes/ARTWORK.md), which ships with
the runtime. Vector geometry is reproducible offline through
`extension/scripts/theme-artwork.py`. No network calls are added at runtime.

The authoring script is outside the runtime. SVGs contain no scripts, filters or
animation. Backgrounds stay stationary; artwork inside the existing SVG rotates
with the existing rotation owner. Pin coordinates, upright icons and hit targets
are unchanged. All Sites continues to use the existing category grid and rows.

Three additional visual values were sufficient: background attachment and
category/search surface shadows. Default values preserve the default appearance.
In the existing narrow/zoomed labelled-pin layout, circular elevation and compass
ornaments are suppressed; they do not become rectangular borders behind labels.
No new state, timer, event owner, authorization input or dependency is introduced.

The shared desktop Greylist slot still reserves its two-row footprint even when
empty. Appearance changes cannot recenter Home as Greylist entries appear or
disappear. The empty Greylist box itself remains hidden. Responsive document
scroll remains available at narrow widths and high zoom.

## Composed historical margins (previous refinement)

The [composition refinement](evidence/theme-composition/README.md) supersedes the
full-viewport faded-scan backgrounds above. The approved Parchment rose remains
byte-identical. Historical JPEG source copies remain in each theme directory.

Parchment now separates the actual Aguiar ink into two coastal fragments,
placed at the margins. Pigmented rhumb networks, fine double rules and quiet
vellum around the wordmark/search/rose compose Home as a portolan sheet. All
Sites has a calmer reading field with coastline and ruling outside the main
controls. Celestial extracts the northern hemisphere engraving as transparent
warm-gold ink, framed by a graduated plate related to the central instrument.
The chart is quieter behind the header and relocates to a subdued marginal
position on working pages. No random starfield is used.

This adds only two optional background values and a search-surface value. The
application's existing `data-section`/`data-mode` and narrow-width rules select
them. Themes still consist entirely of visual variables; no extra attribute,
DOM, state, event handler, timer or theme-specific navigation is needed. Default
and Light retain the existing background and transparent search treatment.

`scripts/theme-fragments.py` documents reproducible offline crop/ink separation
with Pillow. It is optional artwork-authoring tooling, not part of npm build or
runtime, and downloads nothing. Lossless WebP derivatives are locally bundled
alongside unchanged JPEG sources. No AI imagery is used. The ordinary build
copies these ready assets; static SVG authoring remains in `theme-artwork.py`.
Specific reproduction rights and transformations are in the shipped ARTWORK.md.

## Instrument hierarchy and shared materials (previous refinement)

The [current refinement and Firefox renders](evidence/theme-unity/README.md)
retain both compass artworks byte-for-byte. Celestial removes the giant circular
Home backdrop: two smaller, quieter crops of the same historical astronomical
engraving sit at the sides. Fine marginal rulings replace the extra graduated
plate. The brass compass remains the single main instrument. The higher-resolution
source copy for these crops is retained beside them and never loaded at runtime.

Parchment keeps its authentic coastline fragments. Its former fixed-viewport wind
origins are removed. A `--compass-field` background on the existing launcher
region connects the actual rose center to those margins through restrained
three-pigment bearings. The painter is bounded, static, behind the controls and
pointer-transparent. It contributes no layout size and disappears in zero/one-pin
and narrow labelled-pin layouts. It is outside the rotating SVG: the chart does
not spin and the approved compass, icon coordinates and rotation owner do not change.

Matching fine rules and layered cream disks connect the search and pins to their
instrument materials. Parchment's search uses the existing local italic title
face at a readable weight; Celestial retains its sans-serif control typography.
Search family/style/weight are visual tokens; text size, line height and control
geometry remain application-owned. Default/Light fallbacks preserve their
previous type and have no compass field. All Sites retains its quieter page
composition. No generated image details, new font, runtime dependency, event,
state field or authorization input is introduced.

## Whole historical artworks (current refinement)

[Four native Firefox comparisons and the selected pair](../design/historical-final/README.md)
replace the fragment-and-overlay page compositions above. Celestial uses Frederik
de Wit's 1680 sky chart, recolored into midnight blue and engraved brass.
Parchment uses an Oliva-family Mediterranean portolan (1621–1665), retaining
manuscript pigments, winds, coastline detail and rhumb lines. Central artwork is
actually suppressed, not left as an out-of-focus duplicate under the compass.
Parchment's repaired paper uses restrained non-repeating grain from its scan.

Each theme supplies two finished local WebPs through the existing
`--page-home-background` and `--page-workspace-background` variables. Working
pages use a wider quiet field. Existing responsive rules select that quiet
version in narrow Home layouts; no new component or presentation hook is needed.
The old Parchment `--compass-field` overlay is disabled because the historical
chart now supplies the surrounding lines. All compass artwork, palette, controls,
layout, pin geometry, rotation, preference storage and authority remain unchanged.
Default and Light are unchanged. The empty Greylist reservation is unchanged.

Source-specific rights and transformations ship in
[ARTWORK.md](../extension/src/ui/assets/themes/ARTWORK.md). Bounded full-frame
review copies sit beside the selected assets; exact downloaded inputs remain
under `design/direct-art-studies/sources`. The offline Python script and candidate
studies are authoring evidence, not runtime tooling. No generated images, added
dependencies, remote asset requests, version bump or release packaging.
