# Historical sources and reuse

Specific reproduction rights reviewed on 11 November 2026. These compositions
use actual historical scans, cropped fragments and hand-specified SVG geometry.
No image generator, inpainting, generative fill or invented engraved figure was
used. These are decorative collages, not geographical or astronomical facsimiles.

`sources/` retains the downloaded reproductions without changing their bytes.
`sources/downloads.json` records the exact URLs and SHA-256 hashes. Some downloads
are Wikimedia's explicitly listed high-resolution thumbnails rather than the
largest original. No remote resource is needed to view the compositions.

## Sources used

| Local reproduction | Creator / work | Specific rights page | Application |
| --- | --- | --- | --- |
| `aguiar-1492.jpg` | Jorge de Aguiar, nautical chart, 1492. Original held by Yale's Beinecke Library. | [Reproduction and Public Domain Mark](https://commons.wikimedia.org/wiki/File:Jorge_Aguiar_1492_MR.jpg) | The Pilot's Vellum: coastal fragments, manuscript ink and pigments. |
| `doppelmayr-1730.jpg` | Johann Gabriel Doppelmayr, *Hemisphaerium Coeli Boreale*, 1730. Reproduction credited to Barry Lawrence Ruderman Antique Maps. | [PD-Art / PD-old-100-expired / Public Domain Mark](https://commons.wikimedia.org/wiki/File:1730_celestial_map_of_the_Northern_Hemisphere_Sky.jpg) | Both Celestial studies: constellation engravings and chart ruling. |
| `cellarius-copernican.jpg` | Andreas Cellarius, *Scenographia Systematis Copernicani*, plate 5 of *Harmonia Macrocosmica*, file dated 1661. Reproduction sourced by Commons from Utrecht University. | [Specific reproduction marked public domain / PDM](https://commons.wikimedia.org/wiki/File:Cellarius_Harmonia_Macrocosmica_-_Scenographia_Systematis_Copernicani.jpg) | The Astronomer's Court: two lower marginal figures; all studies: a small sample of real scan paper. |
| `doppelmayr-systems.jpg` | Johann Gabriel Doppelmayr, *Atlas Novus Coelestis*, 1742, frontispiece in the scanned opening numbered 001. Reproduction credited to Barry Lawrence Ruderman Antique Maps. | [PD-old-70-expired / Public Domain Mark](https://commons.wikimedia.org/wiki/File:Atlas_Novus_Coelestis_by_Johann_Gabriel_Doppelmayr_(1742)_001.jpg) | The Celestial Cabinet: telescope, armillary and measuring-instrument engravings extracted from the lower corners. |
| `blaeu-capitanata.jpg` | Willem Blaeu, *Capitanata olim Mesapiae et Iapygiae pars*, c. 1630. Scan supplied to Commons by Geographicus Rare Antique Maps. | [PD-Art / PD-old-100-expired / Public Domain Mark](https://commons.wikimedia.org/wiki/File:1630_Blaeu_Map_of_Capitanata_(_Foggia_),_Italy_-_Geographicus_-_Capitanata-blaeu-1630.jpg) | The Pilot's Vellum: two actual ships and the decorated distance scale. |
| `blaeu-world.png` | Willem and Johannes Blaeu, *Nova totius terrarum orbis geographica ac hydrographica tabula*, file dated 1630. Scan credited to Barry Lawrence Ruderman Antique Maps. | [Specific reproduction marked public domain / PDM](https://commons.wikimedia.org/wiki/File:Willem_Blaeu_-_Nova_totius_terrarum_orbis_geographica_ac_hydrographica_tabula.png) | Blaeu's Sea Atlas: planetary procession, Wonders of the World frieze, allegorical panels and geographical underdrawing. |

These are file-specific public-domain assertions, not a blanket assumption about
all photographs of old objects. The Cellarius and Blaeu-world description pages
also have a missing-US-tag maintenance notice; their listed seventeenth-century
publication dates precede the US public-domain publication cutoff. PDM is a
rights-status mark, not a new CC0 licence from a map dealer. Credits are retained
for provenance. Wikimedia's notices discuss jurisdictional differences for
faithful reproductions; this project does not claim a universal legal ruling.

## Adaptation records

`extract.py` and `process/extractions.json` contain the source coordinates, polygon
masks, sampled paper colors and transformations. Operations are crop, mask,
transparency extraction, tone reduction and color separation. The Cabinet's
instrument linework is extracted by local luminance contrast from actual engraved
strokes. The paper texture is a mirrored tile of a small unillustrated scan area.
Review derivatives are bounded in resolution and encoded as quality-95 WebP;
the original reproduction copies are unchanged. SVGs embed those derivatives.

`compose.py` owns all placement, scale, opacity, rhumb lines, frames, gradients and
labels. The Cabinet's right hemisphere is rotated for decorative balance; it is
not labelled as a different astronomical hemisphere. The new Latin captions are
decorative editorial labels, not quotations attributed to a historic mapmaker.

The internal fragment name `urania` identifies the female astronomical figure
for authoring convenience; no new historical attribution is asserted.

## Atlas reference material in the static previews

`reference/` contains byte-identical copies of the existing Celestial brass
instrument, Parchment rose and Atlas marks. The Parchment rose is unchanged.
The Celestial preview adds the application's existing central eight-point rose.
The reference images do not introduce navigation logic or alter actual pin positions.

The six disks are **neutral specimen shortcuts**, not the user's bookmarks or
website favicons. These are static visual studies, not extension screenshots.

Cormorant Garamond and Source Sans 3 are copied from the existing local font
bundle, with their SIL Open Font Licence texts in `reference/`. They are embedded
in the standalone SVGs for consistent rendering. The application files remain
unchanged. Reference geometry provenance remains in
`extension/src/ui/assets/themes/ARTWORK.md`.
