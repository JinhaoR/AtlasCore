# Direct historical artwork for Atlas

Independent art-selection experiment. Open **index.html** in a browser. Its
three comparison buttons switch all four candidates between the same unsoftened
viewport crop, center-only blur and static Atlas placement. Each candidate links
its full uncropped reproduction and file-specific public-domain source record.

This follows the request to use whole historical maps directly and blur their
centers a little. It does not continue the earlier collage strategy. The
extension, Core, themes, version and release packages are unchanged.

## My selection

- **Oliva** is the strongest direct nautical fit: almost the whole chart survives
  a wide viewport, and its actual compass roses, red/green rhumb lines and lower
  cartouche give the page a coherent historical identity. It is also the busiest.
- **De Wit** is the strongest astronomical image found for this approach. The
  natural blue clouds and illustrated hemispheres are compelling without any
  extraction. It makes a light astronomical page, however; a navy Celestial
  background would need a separate treatment rather than pretending blur alone
  produces it.
- **Prunes** is a quieter alternative for Parchment: softer ink, darker vellum,
  little cities and beautifully colored roses. The upper/lower crop removes
  some of the sheet and the paper's dark patches remain visible after blur.
- **Blaeu** provides the richest engraved frame. It is less suitable as a direct
  wide background because the crop clips portions of the top and bottom friezes.
  It is included as a useful comparison rather than presented as equally strong.

Vlasbloem's complete 1675 celestial print is also retained and linked, but rejected
from the main four because a wide crop sacrifices too much of its tall layout.

## Visual evaluation

The first native Firefox render used a 22-pixel Gaussian blur with a 62-pixel mask
feather. It cleared the middle, but looked like a soft patch placed over the map.
`process/iteration-1-comparison.jpg` retains that result. The final render uses a
14-pixel blur with a 96-pixel feather: more map structure survives and the
transition is gentler. Original colors and illustrations remain unchanged.

Final images were rendered and inspected at 1,920 × 1,200. The gallery's image
load and comparison controls were checked in disposable native Firefox. All
task-created runtime/profile copies were removed after rendering. No extension
was installed. The six identical mock shortcuts make these comparisons fair;
they are not a claim about actual application behavior.

Blur removes small detail, but **does not remove large color patches or make a
busy map a quiet interface automatically**. The search is readable because it has
its own surface; the compass has a solid face. Logo/nav/status contrast and
responsive crops would need further design checks if one image is chosen for
integration. These are deliberately artwork previews, not completed app themes.

## Contents

- `index.html`: offline comparison gallery.
- `comparison.jpg`: four static Atlas placement previews together.
- `backgrounds.jpg`: four softened background assets together.
- `sources/`: full source reproductions or explicitly documented full-frame copy.
- `fitted/`: unsoftened viewport crops.
- `softened/`: actual background assets, with no interface baked in.
- `previews/`: self-contained static SVG mockups and Firefox-rendered PNGs.
- `reference/`: existing compass/mark SVGs and local fonts with licenses.
- `SOURCES.md`: creators, source URLs, rights records and processing details.
- `process/`: crop/blur metadata, earlier iteration, render and integrity evidence.

## Reproduce locally

Requires the existing local Python/Pillow tooling; no project dependencies added.

```powershell
python design/direct-art-studies/prepare.py
python design/direct-art-studies/gallery.py
python design/direct-art-studies/render.py
python design/direct-art-studies/gallery.py
python design/direct-art-studies/validate.py
```

`fetch.py` downloads the four specifically selected public-domain reproductions
when absent. `prepare.py` reuses the prior study's retained Blaeu scan and local
reference assets. The finished gallery is self-contained within this folder;
opening it does not fetch any artwork or fonts from the internet. Source-credit
links only open if deliberately selected.

The source copies are review/archive material, not a proposed runtime payload.
No packaging, version bump, signing, deployment or everyday-profile changes are
part of this experiment.
