# Atlas — independent background compositions

Open **[the local gallery](index.html)**. It switches between background-only art
and a common static Atlas overlay, so the compositions can be compared directly.
All four are rendered at **1920 × 1200**. SVGs are layered and self-contained;
PNGs are ready to inspect in an ordinary image viewer.

| Study | Direction | Background | Static context |
| --- | --- | --- | --- |
| 01 · The Astronomer's Court | A theatrical celestial folio: hand-colored engraved figures anchor the lower corners, with quieter constellation fragments above. The strongest figurative Celestial option. | [PNG](compositions/01-astronomers-court.png) · [SVG](compositions/01-astronomers-court.svg) | [PNG](previews/01-astronomers-court-context.png) |
| 02 · The Celestial Cabinet | An instrument-maker's working atlas: opposing star-chart margins, a measured horizon and extracted brass-colored instrument engraving. More restrained than 01. | [PNG](compositions/02-celestial-cabinet.png) · [SVG](compositions/02-celestial-cabinet.svg) | [PNG](previews/02-celestial-cabinet-context.png) |
| 03 · The Pilot's Vellum | An open portolan sea: authentic manuscript coasts at the edges, colored bearings converging through the instrument, two engraved ships and a small heraldic scale. | [PNG](compositions/03-pilots-vellum.png) · [SVG](compositions/03-pilots-vellum.svg) | [PNG](previews/03-pilots-vellum-context.png) |
| 04 · Blaeu's Sea Atlas | A formal illustrated folio: planetary and architectural friezes, allegorical side panels and a pale geographical underdrawing. The richest and busiest option. | [PNG](compositions/04-blaeus-sea-atlas.png) · [SVG](compositions/04-blaeus-sea-atlas.svg) | [PNG](previews/04-blaeus-sea-atlas-context.png) |

My preferred starting pair is **01 and 03**: both have historical character while
leaving the central instrument legible. 02 offers a less figurative alternative;
04 intentionally tests a more ornamental direction.

## What was actually made

This is an art-development folder outside the extension. Historical scans were
researched, inspected, cropped and recomposed using ordinary Pillow/NumPy pixel
operations and explicit SVG editing. No AI-generated imagery. Rights, original
reproductions and transformation records are retained in [SOURCES.md](SOURCES.md).

The backgrounds themselves contain no search field, compass or buttons. The
separate `previews/*-context.svg` files overlay the same reference instrument and
specimen shortcuts to show visual hierarchy. They are **not working UI or native
extension screenshots**. They do not test responsive UI, menu placement, Greylist
space or real bookmark interactions. Those would be integration decisions after
selecting a composition.

## Iteration and verification

Three rendering rounds were inspected. The first review identified an undersized
context compass and instrument fragments that looked pasted on. The next round
used extracted engraved linework, corrected a transformed clipping mask, reduced
its contrast and separated the lower ornament from the bottom shortcut. The
final SVG and PNG sets reflect those corrections.

- `comparison.jpg`: final four-way static context comparison.
- `backgrounds.jpg`: the four independent backgrounds without the UI overlay.
- `process/round-01.jpg`: first-round comparison, retained to show iteration.
- `process/extractions.jpg`: source-fragment contact sheet.
- `process/extractions.json`: reproducible source masks and crops.
- `process/render.json`: Firefox rasterization record.
- `process/integrity.json`: protected application/release file verification.

Firefox rendered the SVGs into PNGs in isolated headless profiles with **no
extension installed**. Only the task-created profiles and runtime copies were
removed. The everyday profile, application code, CSS, saved state, versions and
release assets were not changed. No application regression suite was rerun for
this standalone artwork-only task.

## Reproduce

Python with the already available Pillow and NumPy packages is used only for
offline authoring. These are not added to Atlas's dependencies.

```powershell
python design/background-studies/fetch_sources.py  # only if source copies are missing
python design/background-studies/extract.py
python design/background-studies/compose.py
python design/background-studies/render.py        # disposable Firefox rasterizer
python design/background-studies/gallery.py
```

The rasterizer uses the repository's existing Marionette client read-only and a
temporary copy of installed Firefox without its enterprise distribution folder.
It serves only this study folder on loopback, never the application. The local
gallery also works directly from disk without a server.

These are review masters, not an extension payload. Source scans are retained at
research resolution, including the larger Blaeu scan. If a composition is chosen,
runtime derivatives should be sized separately; the research archive should not
be copied wholesale into an extension release.
