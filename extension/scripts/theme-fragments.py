"""Offline crops/ink separation of the bundled public-domain scans (no generated imagery).

Optional art-authoring tool: Pillow, not an application/build dependency. Originals
remain unchanged beside the derivatives. Coordinates refer to those exact JPEGs.
See themes/ARTWORK.md for rights and the deliberately decorative adaptations.
"""
from pathlib import Path
from math import hypot
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'src/ui/assets/themes'

def clamp(value):
    return max(0., min(1., value))

def smooth(value):
    x = clamp(value)
    return x*x*(3-2*x)

def fragment(source, crop, output, celestial=False, marginal=False):
    image = Image.open(ROOT/source).convert('RGB').crop(crop)
    w,h = image.size
    result = Image.new('RGBA', image.size)
    pixels = []
    for y in range(h):
        for x in range(w):
            r,g,b = image.getpixel((x,y))
            light = .2126*r + .7152*g + .0722*b
            # Separate manuscript ink from photographed paper, retaining the
            # source's actual outlines; do not invent coastlines or stars.
            strength = clamp((195-light)/130)
            if marginal:
                # Rectangular pieces of the actual engraved sky, with no
                # complete circular limb competing with the foreground compass.
                edge = smooth(min(x,y,w-1-x,h-1-y)/64)
                alpha = round(255*strength*edge*.30)
                color = (185,159,110)
            elif celestial:
                radius = hypot(x-w/2,y-h/2)/(w/2)
                edge = smooth((1-radius)/.025)
                # Preserve the chart's figures and stars in the outer annulus.
                field = smooth((radius-.30)/.28)
                alpha = round(255*strength*edge*field*.48)
                color = (185,159,110)
            else:
                edge = smooth(min(x,y,w-1-x,h-1-y)/34)
                alpha = round(255*strength*edge*.8)
                # Ink and pigments retain their relative colors; paper has
                # been removed so the fragment sits on the theme's vellum.
                color = (int(r*.72), int(g*.68), int(b*.62))
            pixels.append((*color,alpha))
    result.putdata(pixels)
    result.save(ROOT/output,'WEBP',lossless=True,method=6)
    print(output, (ROOT/output).stat().st_size)

fragment('parchment/aguiar-1492.jpg',(310,100,610,955),'parchment/atlantic-ink.webp')
fragment('parchment/aguiar-1492.jpg',(805,95,1245,655),'parchment/mediterranean-ink.webp')
fragment('celestial/doppelmayr-1730.jpg',(157,112,803,758),'celestial/hemisphere-ink.webp',True)
fragment('celestial/doppelmayr-1730-detail.jpg',(300,193,647,540),'celestial/western-figures.webp',marginal=True)
fragment('celestial/doppelmayr-1730-detail.jpg',(713,400,1047,853),'celestial/eastern-figures.webp',marginal=True)
