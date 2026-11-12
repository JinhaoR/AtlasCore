# Whole-artwork study: sources and rights

Research checked on 11 November 2026. These studies use actual historical
reproductions. No image generation, reconstruction, inpainting or invented
historical ornament was used. No figures or map elements were relocated.

## Selected works

| Study | Work and reproduction | Specific rights record |
| --- | --- | --- |
| 01 · Oliva | A member of the Oliva family, Mediterranean portolan, dated between 1621 and 1665. Reproduction credited to Barry Lawrence Ruderman Antique Maps. `sources/oliva-17c.jpg` is Wikimedia's listed 3,840-pixel JPEG rendition. | [Image description](https://commons.wikimedia.org/wiki/File:17th-century_Portolan_chart_of_the_Mediterranean_Sea_by_a_member_of_the_Oliva_family.jpg): PD-Art, PD-old-100-expired and Public Domain Mark 1.0. |
| 02 · De Wit | Frederik de Wit, *Planisphaerium Coeleste*, 1680. Reproduction credited to Barry Lawrence Ruderman Antique Maps. `sources/de-wit-1680.jpg` is Wikimedia's listed 3,840-pixel rendition. | [Image description](https://commons.wikimedia.org/wiki/File:1680_Planisphaerium_Coeleste_by_Frederik_de_Wit.jpg): faithful reproduction of a public-domain work, PD-old-100-expired and Public Domain Mark 1.0. |
| 03 · Prunes | Mateus Prunes, chart of the Mediterranean, Black Sea, western Europe and northwest Africa, 1559. Library of Congress Geography and Map Division, G5672.M4P5 1559 .P7, digital ID g5672m.ct002457. `sources/prunes-1559.jpg` is Wikimedia's listed 1,920 × 2,701 rendition of the LoC scan. | [Specific reproduction](https://commons.wikimedia.org/wiki/File:(Chart_of_the_Mediterranean,_Black_Sea,_and_the_coasts_of_western_Europe_and_northwest_Africa)_LOC_2014588812.jpg): PD-Art, PD-old-100-expired and Public Domain Mark 1.0. [LoC catalog](https://www.loc.gov/item/2014588812/); [LoC exhibition identifying the 1559 work](https://www.loc.gov/exhibits/world/earth). |
| 04 · Blaeu | Willem and Johannes Blaeu, *Nova totius terrarum orbis geographica ac hydrographica tabula*, file dated 1630. Reproduction credited to Barry Lawrence Ruderman Antique Maps. Full-frame JPEG review copy in `sources/blaeu-world.jpg`; derived without cropping from the unchanged 3,840 × 2,885 PNG downloaded in the preceding study. | [Specific reproduction](https://commons.wikimedia.org/wiki/File:Willem_Blaeu_-_Nova_totius_terrarum_orbis_geographica_ac_hydrographica_tabula.png): public-domain faithful reproduction, Public Domain Mark; author-life-plus-70 notice. The page also carries a missing-US-tag maintenance notice; the listed 1630 publication is well before the US publication cutoff. |

The Blaeu input is `../background-studies/sources/blaeu-world.png`, SHA-256
`75be1991dd942fc19f8ac56bab33d2658e434b188efb0b2b87df341e6230aaf1`.
It is preserved there. The new JPEG is explicitly a quality-96, no-subsampling
review derivative, not represented as the downloaded original. This avoids
duplicating a 26 MB PNG in the new study folder.

## Considered, not forced into a background

Johannes van Keulen / Louis Vlasbloem, *Stellatum Planisphaerium*, 1675:
[specific image and rights page](https://commons.wikimedia.org/wiki/File:1675_double_hemisphere_celestial_chart_by_Louis_Vlasbloem.jpg).
Commons marks this faithful reproduction PD-Art, PD-old-100-expired and PDM 1.0.
The downloaded 4,397 × 3,709 original is retained as
`sources/vlasbloem-1675.jpg`. Its tall layout makes it a weaker direct fit for a
wide background: covering 16:10 loses about 26% of its area. No context mockup
was made for it, but the gallery links the complete image for review.

## Scope of the rights records

These are checks of the specific digital reproductions, not an assumption that
every photograph of an old object is unrestricted. Public Domain Mark is a
rights-status mark, not a new copyright license from a map dealer. Commons' PD-Art
records explain the faithful-reproduction basis and jurisdictional caveat. Source
and collection credits are retained even where attribution is not required.

The Prunes record explicitly identifies its scan orientation as north to the
right. The study rotates that whole scan 90 degrees counterclockwise to put north
up; this does not move individual elements.

`sources/downloads.json` preserves the exact four new download URLs and file
hashes. `process/candidates.json` records each input hash, orientation, crop
retention and blur settings. Source copies are never overwritten by preparation.

## Image processing

1. Retain the full reproduction in `sources/`.
2. Proportionally fit to 1,920 × 1,200 by a centered cover crop. No stretching.
3. Retain that crop separately in `fitted/`.
4. Blend a Gaussian-blurred copy into the center only, using a feathered mask
   covering the search/logo and compass locations. Final radius: 14 output pixels;
   mask feather: 96 pixels. No hue, saturation, exposure, tint or opacity grading
   is applied to the background. The mask is retained in `process/blur-mask.png`.
5. Save the softened image independently in `softened/`.

The originals are full maps; the wide-screen derivatives are not facsimiles of
the entire sheet. The gallery states the percentage retained and links every
uncropped source. The Oliva chart loses the least at this aspect ratio (2.7%).

## Static Atlas context

Reference compass SVGs and marks are byte-identical copies from the prior study.
Their owning attribution remains `extension/src/ui/assets/themes/ARTWORK.md`.
The Parchment rose is not altered. The Celestial mockup uses the existing brass
instrument and its central compass geometry, on a solid navy instrument face
to make it legible against light paper. That backing belongs to the static UI
overlay; it is absent from the background asset.

Six neutral local glyphs represent shortcut locations, not the user's bookmarks
or real website icons. These are nonfunctional placement mockups, not screenshots
of a modified extension. Existing Cormorant Garamond and Source Sans 3 fonts are
copied with their SIL Open Font License files in `reference/`.
