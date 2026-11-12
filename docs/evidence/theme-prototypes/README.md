# Celestial and Parchment design prototypes

Development prototypes, November 11, 2026. Select either under **Settings ->
Pins & category icons -> Appearance**. Default and Light (test) remain available.
This work does not update the prepared 0.3.0 candidate or install a release.
The local pre-change checkpoint is `.tools/theme-prototypes/checkpoint.zip`.

## Visual comparison

| View | Celestial | Parchment |
| --- | --- | --- |
| Home | [Midnight chart](celestial-home.png) | [Paper and nautical rose](parchment-home.png) |
| All Sites categories | [Celestial directory](celestial-categories.png) | [Parchment directory](parchment-categories.png) |
| Populated category | [Site rows](celestial-sites.png) | [Site rows](parchment-sites.png) |
| Search | [Results overlay](celestial-search.png) | [Results overlay](parchment-search.png) |
| Editor | [Focused form](celestial-editor.png) | [Focused form](parchment-editor.png) |
| Settings | [Timing controls](celestial-settings.png) | [Timing controls](parchment-settings.png) |
| Greylist | [State samples](celestial-greylist.png) | [State samples](parchment-greylist.png) |
| Narrow window | [Labelled pins](celestial-narrow.png) | [Labelled pins](parchment-narrow.png) |
| Firefox 200% zoom | [Celestial](celestial-zoom-200.png) | [Parchment](parchment-zoom-200.png) |

Celestial retains the familiar compass and local Cormorant display type, with
midnight surfaces, ivory text and brass chart marks. Parchment changes the visual
world through warm paper, ink, Georgia display type, engraved rings and a
sixteen-wind nautical rose. Both keep the exact pin geometry and app hierarchy.
Visual inspection led to moving Parchment's cardinal letters inward so they do
not sit beneath pin disks, and removing the navy brand backing in both themes.

## Files and visual hooks

- `src/ui/assets/themes/{celestial,parchment}.css`: the two variable-only themes.
- Six original local SVGs: Celestial `chart.svg`, `orbit.svg`, `mark.svg`;
  Parchment `paper.svg`, `rose.svg`, `mark.svg`. Together with the two CSS files:
  **18,497 bytes**, uncompressed. No scripts, animation, expensive SVG filters,
  external artwork, bitmap downloads or new fonts/dependencies.
- Three shared visual hooks: `--compass-artwork` paints inside the existing
  rotating SVG; `--brand-artwork` replaces only the brand's image content;
  `--surface-quiet` supplies the category-card surface. Defaults preserve the
  prior appearance; existing component geometry and event handling still own
  interactions. The compass decoration behind the SVG remains stationary.
- Closed IDs and labels in `ui/theme.ts` / `ui/ui-text.ts`; stylesheet links and
  selector options in existing HTML; bundle verification covers the new assets.
- `themes.test.mjs`, `visual-contrast.test.mjs` and
  `scripts/firefox_theme_prototypes.py` provide the focused regression checks.

The [theme contract](../../themes.md) documents ownership, persistence and asset
origins. A native check caught and corrected relative-URL resolution: image URLs
in variables resolve from the shared consuming stylesheet, not the theme file.

## Verification

Development build, both TypeScript compilers and distribution verification pass.
Complete extension suite: **691 passed**. Complete Core suite: **253 passed**.
New checks cover both prototype IDs through acknowledged save/restart, visual-only
theme declarations, local static asset paths/size, tested 4.5:1 text contrast and
3:1 focus/control-border contrast. These checks are not accessibility certification.

Native **Firefox 160.0**, isolated profiles and copied runtime, signed 0.2.8 base
with the development overlay:

```text
python extension/scripts/firefox_compact_home.py --theme-prototypes-only --signed-baseline 0.2.8
```

[Results](results.json) record:

- Standard selector switches both themes; each survives page reload. A full
  browser restart preserves the final Parchment selection.
- Screenshots at a 1752 x 1202 browser window (1752 x 1117 content), plus 540px
  narrow windows and real Firefox 200% zoom. No horizontal document overflow.
- Home, categories, site list, detail/editor dialogs, search, Settings and empty
  Vault use the theme. Focus rings, controls and state text remain visible.
- Identical relative pin rectangles between themes; all pin centers hit their
  original controls. Real mouse clicks on GitHub reach the ordinary
  `OPEN_DESTINATION` gate in both themes. Real pointer rotation still changes the
  existing SVG transform, including Parchment's replacement rose.
- Two warmed theme switches retain pin/SVG identities and produce **0 child-list
  mutations, 0 background messages, 0 JavaScript fetches and 0 image-src writes**
  in the sampled interval. This is a bounded observation, not an FPS benchmark
  or a browser-wide network trace. Cold selection reads small local theme assets.

Greylist screenshots are paint-only fixtures using real UI classes; they do not
create grants or test a new access transition. Earlier theme-boundary evidence
covers native cross-page updates, dirty editor/focus retention, failed-save retry,
popup-document selection and first-frame initialization. Those mechanisms are
unchanged; they are not represented as newly rerun tests in this prototype pass.

## Compatibility and limits

[Integrity checks](integrity.json) confirm **438 existing release files** and
**120 protected Core/adapter/background/storage/bookmark/manifest/package files**
are byte-for-byte unchanged against the task checkpoint. There is no version,
extension ID, permission, policy format or authorization change. No signing,
deployment, installed-policy edit or everyday-profile access occurred. Task-created
disposable profiles/runtime copies were removed after retaining this evidence.

These are visual evaluation prototypes. Parchment uses system Georgia/Times, so
fallback metrics may vary on other operating systems; those are not bundled font
files. Long category names retain existing ellipsis behavior, which can occur
earlier with the wider typeface. Website favicons keep provider colors and their
existing lazy loading/fallback behavior; screenshot icons can differ by timing.
Browser chrome and the website-injected Journey indicator are outside this theme
boundary. Physical high-refresh rendering, screen readers and non-Windows font
fallbacks were not verified. The historical INTERNAL_ERROR remains unresolved
and outside this task.
