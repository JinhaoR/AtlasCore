# Historical artwork backgrounds — final exploration

11 November 2026. Development artwork only; no version or release change.

Open [the visual comparison](index.html). It contains four real Firefox Home
screenshots, source links, finished backgrounds and the integrated selections.
The interface in these images is Atlas itself, not a drawn approximation.

## Selection

| Candidate | Visual assessment | Result |
| --- | --- | --- |
| Celestial A — Frederik de Wit, 1680 | Dense, shaded engraving and astronomical details make a convincing brass-and-midnight atlas. The two marginal hemispheres frame a clear center; their centers are removed rather than blurred beneath Atlas. More tonal variation than B. | Selected |
| Celestial B — Louis Vlasbloem / Johannes van Keulen, 1675 | Attractive crisp figures, stars and ribbon ornament. The continuous hemisphere outlines read as much larger competing instruments, and the tall source loses more ornament in a wide crop. | Retained as an alternative |
| Parchment A — Oliva family, 1621–1665 | Rich red/green/blue pigments, winds, lettering, coastlines and rhumb networks relate to the approved nautical rose. Cropping inside the vellum removes the photographic backing. | Selected |
| Parchment B — Mateus Prunes, 1559 | Strong castles, rulers and manuscript detail, but the irregular photographed sheet silhouette and secondary rose distract from the central instrument. North-up orientation turns the original figures sideways. | Retained as an alternative |

These are compositional judgements, not claims that one historical work is better
than another. Both alternatives remain inspectable. Whole-source relationships
are retained: no figure was moved or invented. The existing Celestial brass
instrument and Parchment rose remain byte-identical.

## Sources and specific reproduction rights

All four exact reproductions are marked by Wikimedia Commons as faithful
reproductions of public-domain works (PD-Art, PD-old-100-expired, **Public Domain
Mark 1.0**). These file-specific records were checked, rather than assuming that
every photograph of an old map is unrestricted. PDM is a rights-status mark,
not a new licence granted by the scan supplier. Credits are retained for provenance.

| Work | Specific source and rights record | Retained downloaded input |
| --- | --- | --- |
| Frederik de Wit, *Planisphaerium Coeleste*, 1680. Reproduction credited to Barry Lawrence Ruderman Antique Maps. | [Commons file](https://commons.wikimedia.org/wiki/File:1680_Planisphaerium_Coeleste_by_Frederik_de_Wit.jpg) | [3840 × 2645 JPEG](../direct-art-studies/sources/de-wit-1680.jpg) |
| Oliva family member, Mediterranean portolan, between 1621 and 1665. Reproduction credited to Barry Lawrence Ruderman Antique Maps. | [Commons file](https://commons.wikimedia.org/wiki/File:17th-century_Portolan_chart_of_the_Mediterranean_Sea_by_a_member_of_the_Oliva_family.jpg) | [3840 × 2467 JPEG](../direct-art-studies/sources/oliva-17c.jpg) |
| Louis Vlasbloem / Johannes van Keulen, *Stellatum Planisphaerium*, 1675. Reproduction credited to Barry Lawrence Ruderman Antique Maps. | [Commons file](https://commons.wikimedia.org/wiki/File:1675_double_hemisphere_celestial_chart_by_Louis_Vlasbloem.jpg) | [4397 × 3709 JPEG](../direct-art-studies/sources/vlasbloem-1675.jpg) |
| Mateus Prunes, Mediterranean, Black Sea and western European/northwest African coasts, 1559. Library of Congress Geography and Map Division, G5672.M4P5 1559 .P7, digital ID g5672m.ct002457. | [Specific reproduction](https://commons.wikimedia.org/wiki/File:(Chart_of_the_Mediterranean,_Black_Sea,_and_the_coasts_of_western_Europe_and_northwest_Africa)_LOC_2014588812.jpg), [LoC catalog](https://www.loc.gov/item/2014588812/) | [1920 × 2701 JPEG](../direct-art-studies/sources/prunes-1559.jpg) |

Exact input hashes and all eight processed candidate assets are recorded in
[process/assets.json](process/assets.json). The original downloads are shared
with the preceding study and remain untouched. Full-frame 960px reference JPEGs
for the selected pair are also retained in their respective theme directories;
these are explicitly review derivatives, not the untouched downloads. Rights,
credits and transformations ship in
[ARTWORK.md](../../extension/src/ui/assets/themes/ARTWORK.md).

## Processing and iteration

[process_art.py](process_art.py) is a small offline Pillow/NumPy authoring script.
It downloads nothing and is not part of the application build or runtime.

1. Fit source crops proportionally to 2560 × 1600. Crop Oliva inside the vellum
   edges; rotate the complete Prunes scan 90 degrees counterclockwise, north-up.
2. Use a softly irregular vertical retention mask. Fully remove artwork in the
   central reading field; taper adjoining details gradually. Keep the upper
   navigation band quiet. There is no blurred second compass beneath Atlas.
3. Celestial separates local engraved strokes from paper and retains a smaller
   broad-shadow contribution. Brass, restrained copper and blue values preserve
   variation in original pigments and hatching over a midnight field.
4. Parchment retains its source pigments with gentle illumination normalization.
   Repair the center with warm paper and bounded high-frequency grain from the
   scan. The first sampled-tile attempt repeated visibly and was discarded.
   The final grain is non-repeating; no generated noise or AI inpainting is used.
5. Inspect all four candidates in real Firefox. Select A for each theme.
6. Integrate two finished WebPs per theme. The first working-page render still
   competed with headings near the edges; reduce that variant to 22% of the
   Home retention strength and keep its wider quiet field. Re-render and inspect.

Parchment no longer paints the separate geometric `bearings.svg` overlay; its
historical chart supplies the linework. This does not alter `rose.svg`, its
geometry, the pin layers, or the rotation owner. No extra historical ornament
was added merely to fill the center.

To reproduce the studies: `python design/historical-final/process_art.py`.
`--install-assets` additionally copies the selected finished assets and creates
the bounded review JPEGs in the source theme directories. An ordinary development
build copies those prepared assets; it performs no image processing.

## Final local assets

| Theme / file | Dimensions | Bytes |
| --- | --- | ---: |
| Celestial `historical-home.webp` | 2560 × 1600 | 412,774 |
| Celestial `historical-workspace.webp` | 2560 × 1600 | 34,304 |
| Celestial `de-wit-1680.jpg` review copy | 960 × 661 | 189,691 |
| Parchment `historical-home.webp` | 2560 × 1600 | 449,534 |
| Parchment `historical-workspace.webp` | 2560 × 1600 | 75,750 |
| Parchment `oliva-17c.jpg` review copy | 960 × 617 | 207,590 |

The four painted backgrounds total **972,362 bytes**. Including the two new
review copies adds **1,369,643 bytes** to the local asset bundle. Old source
copies and artwork are retained for provenance; the replacement theme tokens
no longer paint the older background assemblies. No new background request
leaves the extension. Website favicons retain their existing online lifecycle.
File hashes are in [installed-assets.json](process/installed-assets.json).

## Native screenshots and verification

| Theme | Home | All sites directory | Populated category |
| --- | --- | --- | --- |
| Celestial | [Screenshot](native-final/celestial-home.png) | [Screenshot](native-final/celestial-categories.png) | [Screenshot](native-final/celestial-sites.png) |
| Parchment | [Screenshot](native-final/parchment-home.png) | [Screenshot](native-final/parchment-categories.png) | [Screenshot](native-final/parchment-sites.png) |

The `native-final` directory also retains search, editor, Settings, Vault,
Greylist, narrow-window, 1366-wide, 2560-wide and 200%-zoom renders.
[Native results](native-final/result.json): **PASS**, Firefox 160.0, isolated
runtime and disposable profile. The existing signed 0.2.8 test baseline was
overlaid only inside that profile. This was not a new release-upgrade audit.

- Development build passed, including Core and extension TypeScript compilation
  and bundled-file/feed verification. The first sandboxed esbuild invocation
  could not traverse a parent directory; the normal permitted build passed.
- **43 focused tests passed:** theme validation, acknowledged saves, failure and
  uncertain-write handling, cross-page preference changes, asset safety/budgets,
  palette contrast, category identity/ordering, directory/editor behavior,
  Greylist controls and compass motion.
- Native checks: local background URLs actually load; Home and management pages
  select different artwork; no horizontal overflow at the checked sizes; pin
  hit-testing, ordinary gated pointer launch and rotation work; theme reload and
  full background restart restore the selected theme on the first observed frame.
- Warm theme transaction: **0 DOM child replacements, 0 adapter messages,
  0 fetch calls and 0 favicon source assignments**, with pin/SVG nodes retained.
  This is a scoped warm-switch observation, not a cold-load benchmark or FPS claim.
- Policy/configuration and their revisions, pending requests, grants and Vault
  proposal data remain unchanged. The test's real gated launches advance Core's
  `lastObservedAt` watermark normally. An initial overly strict whole-state
  assertion was corrected to account only for that expected monotonic field.
- [Checkpoint integrity](process/integrity.json): **1,039 prior files checked;
  438 release files unchanged**. All Core/application source, generated JS/maps,
  manifest and HTML are unchanged. Both approved compass artworks and marks are
  unchanged. Native pin geometry exactly matches the previous refinement.
- Only this task's identified Firefox profiles and runtime copies were removed
  after retaining evidence. The prior working-tree checkpoint remains at
  `.tools/historical-final/checkpoint.zip`. No everyday profile or policy touched.

The selected assets use only existing theme variables. No runtime library,
DOM owner, timer, permission, preference field or authorization input was added.
No version bump, release packaging, signing, Mozilla submission or deployment.

## Limits

These are adapted decorative charts, not complete map facsimiles: central
artwork is deliberately removed and wide crops omit portions of the sheets.
The historical marginal circles/roses remain recognizable secondary features.
Very narrow or highly zoomed views intentionally show much less artwork through
the existing quiet-background/labelled-pin layout. The center stays calmer and
more open on very wide screens because the approved UI geometry is unchanged.

2560px backgrounds are suitable for the checked desktop sizes, but are not a
promise of print-resolution detail on 4K high-DPI displays. One decoded RGBA
image is roughly 15.6 MiB; encoded size is not decoded-memory use. No measured
rendering speedup or high-refresh-rate guarantee is claimed. Some early screenshots
show the existing globe favicon fallback while remote icons load.

The historical INTERNAL_ERROR remains unrelated and unresolved. Full release
regressions, live deployment and an accessibility-conformance audit were outside
this artwork-only task.
