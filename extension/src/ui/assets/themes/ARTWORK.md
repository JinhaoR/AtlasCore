# Celestial and Parchment artwork

Research and rights checked 11 November 2026. All assets are local. These are
decorative interpretations, not functional astronomical or navigational instruments.

## Bundled historical reproductions

### `parchment/aguiar-1492.jpg`

Jorge de Aguiar, chart of the Mediterranean, Western Europe and African coast,
1492. Original: Beinecke Rare Book and Manuscript Library, Yale University.

- Specific reproduction and rights: https://commons.wikimedia.org/wiki/File:Jorge_Aguiar_1492_MR.jpg
- Download: https://thumb.wikimedia.org/wikipedia/commons/thumb/2/21/Jorge_Aguiar_1492_MR.jpg/1280px-Jorge_Aguiar_1492_MR.jpg
- Commons marks this file **Public Domain Mark 1.0**, PD-old-100, free of known
  copyright and related-right restrictions. The rights statement is for this
  reproduction, not an assumption that every photograph of an old map is free.
- Bundled thumbnail bytes are unchanged and retained in this theme folder as
  the source copy. The current composition uses the derived fragments below,
  rather than stretching the entire scan across the viewport. No original
  manuscript text is UI copy.

### `celestial/doppelmayr-1730.jpg`

Johann Gabriel Doppelmayr, *Hemisphaerium Coeli Boreale*, northern celestial
hemisphere, 1730; published by Johann Baptist Homann's workshop. Digitized map
source recorded by Commons: Barry Lawrence Ruderman Antique Maps.

- Specific reproduction and rights: https://commons.wikimedia.org/wiki/File:1730_celestial_map_of_the_Northern_Hemisphere_Sky.jpg
- Download: https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d6/1730_celestial_map_of_the_Northern_Hemisphere_Sky.jpg/960px-1730_celestial_map_of_the_Northern_Hemisphere_Sky.jpg
- Commons explicitly identifies a faithful two-dimensional public-domain
  reproduction (PD-Art / PD-old-100-expired), Public Domain Mark 1.0, and US
  publication before 1931. Its reproduction notice also notes jurisdictional
  differences; this is not a new CC0 grant from the map dealer.
- Bundled thumbnail bytes are unchanged and retained in this theme folder as
  the source copy. The current background uses a cropped ink separation below.
- `celestial/doppelmayr-1730-detail.jpg` retains the 1280 x 1096 reproduction
  of this same file for the finer marginal crops. Its source is
  https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d6/1730_celestial_map_of_the_Northern_Hemisphere_Sky.jpg/1280px-1730_celestial_map_of_the_Northern_Hemisphere_Sky.jpg
  The same file-specific public-domain reproduction notice applies. This source
  copy is bundled for provenance, not loaded as a runtime background.

Public Domain Mark: https://creativecommons.org/publicdomain/mark/1.0/
These credits are retained for provenance although the identified public-domain
files do not impose an attribution licence. No Wikimedia page text is bundled.

## Current whole-chart backgrounds (November 2026)

Both approved compass artworks remain unchanged. The current page backgrounds
use the following specific public-domain reproductions, researched on 11 November
2026. These replace the earlier CSS assemblies of fragments and vector page
decoration. Those earlier assets remain documented below for their provenance.

### Celestial: Frederik de Wit, 1680

- Work: *Planisphaerium Coeleste*, Frederik de Wit, 1680.
- Reproduction credited to Barry Lawrence Ruderman Antique Maps.
- Exact image/rights record:
  https://commons.wikimedia.org/wiki/File:1680_Planisphaerium_Coeleste_by_Frederik_de_Wit.jpg
- Commons marks this faithful reproduction PD-Art, PD-old-100-expired and
  **Public Domain Mark 1.0**. PDM describes rights status; it is not a new CC0
  licence granted by the reproduction's supplier.
- Downloaded 3840 x 2645 input is preserved in the repository at
  `design/direct-art-studies/sources/de-wit-1680.jpg`, SHA-256
  `752f8db2a8af9523f2bc57ca3f8f981de2b5580fcc58b01619ab30b8519f7578`.
- Bundled `celestial/de-wit-1680.jpg` is a bounded, full-frame 960px review
  derivative, not the untouched download. It is not loaded by the interface.
- `celestial/historical-home.webp`: centered crop; local paper/engraving
  separation; brass, restrained copper and blue treatment; selective removal
  of central figures and diagrams. Original hatching and shaded figures survive
  at the margins. No new constellation, figure or historical instrument is drawn.
- `celestial/historical-workspace.webp`: the same work with a wider quiet field
  for site names, category controls and editing. No additional source artwork.

### Parchment: Oliva family, 1621–1665

- Work: Mediterranean portolan by a member of the Oliva family, dated between
  1621 and 1665; reproduction credited to Barry Lawrence Ruderman Antique Maps.
- Exact image/rights record:
  https://commons.wikimedia.org/wiki/File:17th-century_Portolan_chart_of_the_Mediterranean_Sea_by_a_member_of_the_Oliva_family.jpg
- This specific reproduction is marked PD-Art, PD-old-100-expired and
  **Public Domain Mark 1.0**; the faithful-reproduction basis is recorded by Commons.
- Downloaded 3840 x 2467 input is preserved at
  `design/direct-art-studies/sources/oliva-17c.jpg`, SHA-256
  `0a423bfd70a2bb35a88bc8acf1c26be8a164096ad0acdbac5ad1e186d8ef40b7`.
- Bundled `parchment/oliva-17c.jpg` is a full-frame 960px review derivative,
  retained beside the theme assets but not loaded as a background.
- `parchment/historical-home.webp`: crop inside the photographed vellum;
  preserve actual red/green/blue pigments, winds, lettering, coastlines and
  rhumb lines. Remove central artwork using a gradual irregular mask and a
  reconstructed warm paper field with bounded, non-repeating scan grain.
  No tiled paper patch and no blurred duplicate compass beneath Atlas's rose.
- `parchment/historical-workspace.webp`: wider quiet field from the same source.
  The previous geometric bearings overlay is no longer painted; the original
  chart provides the linework. `rose.svg` remains byte-identical.

All four finished backgrounds are 2560 x 1600 WebPs, encoded at quality 85. They
are decorative adaptations, not complete or scientifically faithful facsimiles.
The offline reproducible authoring script is
`design/historical-final/process_art.py` (Pillow and NumPy). It downloads nothing;
the ordinary build only copies finished files. No AI generation, runtime image
processing, remote assets or new JavaScript dependency is involved. Whole-sheet
source relationships are retained; no figures are relocated. The source-specific
public-domain status applies to the derivatives; source/collection credits are
retained for provenance.

The comparison also uses the public-domain Prunes 1559 and Vlasbloem 1675
reproductions documented in `design/historical-final/README.md`. These alternate
studies and their high-resolution inputs are not bundled into the extension.

## Vector adaptations and reference material

### Source-derived historical fragments

These are ordinary crops/tonal separations of the two source JPEGs, not AI images
or invented historical details. `scripts/theme-fragments.py` records all crop
coordinates and pixel operations. Pillow is optional offline authoring tooling;
it is not a runtime or build dependency. No downloads occur in this script.

- `parchment/atlantic-ink.webp`: crop `(310,100)-(610,955)` from Aguiar's bundled
  1280px reproduction: Atlantic/Iberian/west African coast and manuscript details.
- `parchment/mediterranean-ink.webp`: crop `(805,95)-(1245,655)` from that same
  reproduction: eastern Mediterranean nautical detail. These two fragments have
  paper tones separated into transparency, tapered crop edges and restrained
  pigment darkening; they are recomposed as margins, not presented as a whole map.
- `celestial/hemisphere-ink.webp`: circular crop `(157,112)-(803,758)` from the
  bundled 960px northern-sky reproduction. The paper and surrounding reference
  tables are omitted; actual engraved marks become warm-gold transparent ink.
  A quiet inner region keeps the instrument clear. This is a decorative tonal
  adaptation, not a scientific reconstruction or a literal reproduction.
- `celestial/western-figures.webp` and `eastern-figures.webp`: respectively
  `(300,193)-(647,540)` and `(713,400)-(1047,853)` from the 1280px detail JPEG.
  Rectangular crops of the original engraved figures and chart lines, with
  tapered edges and gold ink separation. They replace the complete hemisphere
  on Home; the names refer to their placement, not new scientific chart labels.
  No stars, figures or other historical details are invented or generated.

All derivatives use lossless WebP; the JPEG source copies remain unchanged.
The source-specific public-domain notices above apply to these adaptations.

### Geometric artwork

- `parchment/rose.svg`: redrawn adaptation of the large central compass in the
  above Aguiar chart. Preserves the nested blue cardinal winds, vermilion half
  winds, green inner rose, interlaced ink rings and contrasting paper halves.
  Geometry is regularized for browser scale; the outer graduations and north
  fleur are composed for Atlas. It is not a facsimile or a claim of historical
  scientific accuracy. `mark.svg` is a related compact adaptation.
- `parchment/paper.svg`: static fiber and marginal frame. `bearings.svg` supplies
  the three-pigment rhumb network, centered on the actual Home compass region.
  It replaces the disconnected fixed-viewport wind origins. The approved rose
  is unchanged; bearings are a separate, stationary background. `directory.svg` is the
  corresponding working-sheet frame with sparse marginal winds. No noise filter.
- `celestial/instrument.svg`: original brass limb, stereographic-inspired
  curves and eccentric ecliptic. The existing Atlas eight-point rose remains
  visible above it. Reference inspected: ‘Umar ibn Yusuf's 1291 Yemen astrolabe,
  Met accession 91.1.535a–h:
  https://www.metmuseum.org/art/collection/search/444408
  The object page explicitly marks the photographed object **Public Domain**;
  Met Open Access policy: https://www.metmuseum.org/hubs/open-access
  The photograph was inspected but is **not bundled**.
- Additional inspected reference: Doppelmayr, *Theoria Planetarum Primariorum*,
  plate in *Atlas Novus Coelestis* (1742):
  https://commons.wikimedia.org/wiki/File:Atlas_Novus_Coelestis_by_Johann_Gabriel_Doppelmayr_(1742)_007.jpg
  Specific file marked PD-old-70-expired / Public Domain Mark. Reference only.
- `celestial/chart.svg`: marginal declination-style ruling and a quiet frame,
  replacing the large circular background plate. `orbit.svg` retains the
  existing surrounding instrument decoration. `directory.svg` is a restrained border and marginal
  scale for working pages. No random star wallpaper. `mark.svg` retains Atlas's
  original star.

Vector sources are reproducible offline with `python scripts/theme-artwork.py`
from `extension/`. This authoring script is not shipped in the runtime. It makes
SVGs only; it never downloads, modifies or synthesizes a historical scan.

Existing local Cormorant Garamond and Source Sans 3 fonts retain their SIL Open
Font Licences in `../fonts/`. No new font, icon service, remote resource, image
generator output or third-party JavaScript is introduced.
