# Celestial and Parchment: composed historical margins

Development refinement, 11 November 2026. Select Settings → Pins & category icons
→ Appearance. No version change, packaging, signing, installation into the
everyday profile or deployment. Checkpoint: `.tools/theme-composition/checkpoint.zip`.

## Firefox renders

These are actual Firefox 160.0 screenshots, with synthetic pins/categories.
Desktop window: 1752 × 1202; content: 1752 × 1117. Favicons use their unchanged
normal lifecycle, so some captures include provider fallbacks.

| View | Celestial | Parchment |
| --- | --- | --- |
| Home | [Home](celestial-home.png) | [Home](parchment-home.png) |
| All Sites | [Directory](celestial-categories.png) | [Directory](parchment-categories.png) |
| Populated category | [Sites](celestial-sites.png) | [Sites](parchment-sites.png) |
| Search | [Results](celestial-search.png) | [Results](parchment-search.png) |
| Editing | [Editor](celestial-editor.png) | [Editor](parchment-editor.png) |
| Settings | [Settings](celestial-settings.png) | [Settings](parchment-settings.png) |
| Greylist | [Access summary](celestial-greylist.png) | [Access summary](parchment-greylist.png) |
| Narrow | [540px](celestial-narrow.png) | [540px](parchment-narrow.png) |
| Zoom | [200%](celestial-zoom-200.png) | [200%](parchment-zoom-200.png) |

## Art direction and iteration

The [previous artwork](../theme-art/README.md) established the approved compass
designs. Both compass assets are retained; in particular the Parchment rose is
byte-identical. This pass changes their surrounding composition, not their scale,
position or rotation behavior.

The actual Aguiar and Doppelmayr reproductions were inspected again alongside
the previous Firefox renders. Their specific Commons rights pages were rechecked.
The source JPEGs remain unchanged in their respective theme folders. All imagery
comes from these public-domain reproductions or authored SVG geometry; no AI
image generation was used. [Sources, rights and exact transformations](../../../extension/src/ui/assets/themes/ARTWORK.md).

**Parchment** now frames the rose with two independently cropped coastal ink
fragments from Aguiar's 1492 chart. Paper is separated from the photographed ink,
preserving the actual shorelines, lettering and pigments. The fragments sit at
the sides rather than washing a whole map over every control. Two marginal wind
origins, restrained colored rhumbs and a double-rule frame relate the background
to the approved rose. Home keeps a clear central field; All Sites uses a quiet
working sheet with detail toward the outer/bottom margins. Search and cards use
thin cartouche-like rules, while forms retain plain, legible surfaces.

**Celestial** crops the engraved hemisphere from Doppelmayr's 1730 map and
separates its real figures and stars as warm-gold ink. The surrounding tables and
paper are omitted. A coherent graduated plate replaces the previous unrelated
circles and random stars. The central brass instrument reads as the foreground
of that plate. All Sites moves the chart toward a subdued lower-right margin
and uses a fine marginal scale rather than lines across the directory.

1. [First Celestial render](iteration-1/celestial-home.png) connected the plate
   to the compass but put too much engraving behind the wordmark and transparent
   search. A header veil and solid search surface now protect those regions.
2. [First Parchment render](iteration-1/parchment-home.png) established distinct
   margins. Its [narrow view](iteration-1/parchment-narrow.png) crowded the pins;
   narrow/zoomed Home now uses the calmer working-page composition. Rhumbs also
   fade out around the header, rather than crossing the wordmark at full strength.
3. Directory inspection reduced Celestial's chart contrast and removed a second,
   misaligned set of foreground arcs. Category cards remain opaque enough to read.
4. Greylist inspection found engraving behind access labels. Its existing box
   now consumes the same quiet-surface token as the cards. Its geometry is unchanged.

## Implementation boundary

Three visual values: `--page-home-background`, `--page-workspace-background` and
`--search-surface`. The existing body `data-section`/`data-mode` and shared narrow
media query select the background; no new attributes or application code.
The access box reuses `--surface-quiet`. Themes still declare variables only.
Default/Light retain their backgrounds and transparent search treatment.

Historical source copies:

- `extension/src/ui/assets/themes/parchment/aguiar-1492.jpg`
- `extension/src/ui/assets/themes/celestial/doppelmayr-1730.jpg`

`theme-fragments.py` records crop coordinates and deterministic ink separation;
Pillow is offline authoring tooling only. Builds copy ready local assets and do
not run that script. `theme-artwork.py` authors the geometric SVG plates. No
runtime image filters, new animation, polling, network or dependency is added.

## Verification

- Development build and both TypeScript compilers pass; distribution assets verified.
- 691 extension and 253 Core tests pass; focused theme/font/contrast/Home checks:
  46 passed. Palette contrast checks are not accessibility certification.
- [Native results](results.json): separate Home/directory artwork, valid local
  assets, search, populated categories, dialogs, Settings, Greylist, 540px and
  200% zoom. No horizontal document overflow in the responsive checks.
- Real pointer activation reaches the existing `OPEN_DESTINATION` gate. Relative
  pin rectangles match between themes; native rotation changes the existing SVG
  transform. No new navigation or authority path is involved.
- First captured animation-frame theme after reload is correct in both themes;
  full process restart retains Parchment from its first captured frame. This
  checks theme/base-color selection, not the instant at which every image finishes
  decoding. Warm switches retain pins/SVG with zero child replacements, background
  commands, JS fetches or image-src assignments during the selection transaction.
- [Greylist geometry](greylist-layout.json): the logo, search and compass remain
  stationary through 0 → 1 → 2 → 5 → 0 rows in all four themes. Two-row limit and
  internal scroll remain. Checks include 1300px, 980px, 540px and 125%/200% zoom.
  These are paint fixtures with the existing refresh owner paused, not new grant
  workflow tests. The final subsequent change only paints the existing box surface.
- [Integrity](integrity.json): 438 prior release files unchanged, including the
  prepared 0.3.0 candidate. Core/application source, generated JS/JSON, original
  JPEG sources and approved compass artwork are unchanged. No everyday profile,
  browser enterprise policy, extension identity or saved-state format changed.

Commands (Node 24 and the existing locked dependencies):

```text
npm --prefix extension run build
npm --prefix extension run test:built
npm --prefix packages/core run test:built
python extension/scripts/firefox_compact_home.py --theme-prototypes-only --signed-baseline 0.2.8
python extension/scripts/firefox_compact_home.py --greylist-layout-only --signed-baseline 0.2.8
```

## Costs and limits

Artwork totals 1,483,360 bytes, including unchanged source JPEG copies. The three
lossless WebP derivatives total 556,690 bytes; originals are retained for source
provenance but are no longer loaded as runtime backgrounds. This is a modest
bundle increase, not a measured performance improvement. There are no added
runtime processing tasks; ordinary image decoding still has a cost.

Historical detail is intentionally softer than the SVG foreground, and may look
softer at very large sizes. The background is decorative: fragments are recomposed,
not a geographically faithful whole chart. Cropping varies with aspect ratio.
Physical 144Hz/low-powered hardware, non-Windows rendering and screen-reader
behavior were not newly verified. Existing favicon failures remain possible.
The historical INTERNAL_ERROR remains outside this work and unresolved.

Task-created Firefox profiles/runtime copies are removed after preserving this
evidence. No release was packaged or deployed.
