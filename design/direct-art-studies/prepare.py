"""Whole historical artwork + feathered central blur. No generative processing.

All operations stay in this study folder. Full scan copies are retained; viewport
derivatives use proportional cover cropping. Context SVGs are static mockups.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageOps
import base64, hashlib, json, math, shutil
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent
PREVIOUS = ROOT.parent/'background-studies'
W, H = 1920, 1200
CASES = [
    dict(id='01-oliva', title='The Mediterranean on vellum', creator='Oliva family · 1621–1665', source='oliva-17c.jpg', theme='parchment', rotation=0,
         note='Best nautical fit. Multicolored wind roses and the lower cartouche survive around the softened center. The red and green rhumb lines remain strong.',
         page='https://commons.wikimedia.org/wiki/File:17th-century_Portolan_chart_of_the_Mediterranean_Sea_by_a_member_of_the_Oliva_family.jpg'),
    dict(id='02-de-wit', title='An illustrated sky', creator='Frederik de Wit · 1680', source='de-wit-1680.jpg', theme='celestial', rotation=0,
         note='Strongest astronomy candidate: blue cloudwork, paired heavens and richly colored constellations. Original colors are retained; this is a light astronomical theme, not the existing navy treatment.',
         page='https://commons.wikimedia.org/wiki/File:1680_Planisphaerium_Coeleste_by_Frederik_de_Wit.jpg'),
    dict(id='03-prunes', title='The navigator’s manuscript', creator='Mateus Prunes · 1559', source='prunes-1559.jpg', theme='parchment', rotation=90,
         note='A quieter, darker vellum with miniature cities and ornate roses. Turned north-up as a whole; no figures are moved. The upper and lower edges are cropped in the wide-screen preview.',
         page='https://commons.wikimedia.org/wiki/File:(Chart_of_the_Mediterranean,_Black_Sea,_and_the_coasts_of_western_Europe_and_northwest_Africa)_LOC_2014588812.jpg'),
    dict(id='04-blaeu', title='A world framed by allegory', creator='Willem and Johannes Blaeu · 1630', source='blaeu-world.jpg', theme='parchment', rotation=0,
         note='An alternative to a portolan: engraving, maritime geography and an architectural border. A wide-screen crop sacrifices parts of the top and bottom friezes; the original is worth viewing too.',
         page='https://commons.wikimedia.org/wiki/File:Willem_Blaeu_-_Nova_totius_terrarum_orbis_geographica_ac_hydrographica_tabula.png'),
]

def data(path, mime):
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()

def txt(x, y, value, size=24, color='#3f3324', font='Folio', anchor='middle', extra=''):
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="{font}" font-size="{size}" fill="{color}" {extra}>{escape(value)}</text>'

def context(case):
    dark = case['theme'] == 'celestial'
    font = data(ROOT/'reference/cormorant-garamond-normal-latin.woff2', 'font/woff2')
    sans = data(ROOT/'reference/source-sans-3-normal-latin.woff2', 'font/woff2')
    bg = data(ROOT/'softened'/f'{case["id"]}.jpg', 'image/jpeg')
    instrument = data(ROOT/'reference'/('celestial-instrument.svg' if dark else 'parchment-rose.svg'), 'image/svg+xml')
    mark = data(ROOT/'reference'/('celestial-mark.svg' if dark else 'parchment-mark.svg'), 'image/svg+xml')
    out = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
      <title>{escape(case['title'])} — static Atlas placement study</title>
      <desc>Public-domain complete artwork with a proportional viewport crop and central blur. No recoloring or collage. Atlas controls are nonfunctional reference overlays, not an extension screenshot.</desc>
      <defs><style>@font-face{{font-family:Folio;src:url({font})}}@font-face{{font-family:Interface;src:url({sans})}}</style>
      <filter id="disk-shadow" x="-.5" y="-.5" width="2" height="2"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#241a0d" flood-opacity=".25"/></filter></defs>
      <image width="1920" height="1200" href="{bg}"/>
      <g id="static-reference-overlay">'''
    # Identical placement across candidates makes the artwork comparison fair.
    out += f'<image x="782" y="197" width="52" height="52" href="{mark}"/>'
    out += txt(1005,243,'A T L A S',62,extra='letter-spacing="5" font-weight="600"')
    field, ink = ('#0d2431','#f5e9cc') if dark else ('#f5e8cb','#443522')
    out += f'<rect x="470" y="296" width="980" height="66" rx="8" fill="{field}" fill-opacity=".96" stroke="#927344" stroke-width="1.5"/>'
    out += f'<circle cx="502" cy="327" r="8" fill="none" stroke="{ink}" stroke-width="1.5"/><path d="M508 333l8 8" stroke="{ink}" stroke-width="1.5"/>'
    out += txt(535,338,'Search your sites…',23,ink,'Interface','start')
    # Existing approved compass artwork, unchanged. A navy instrument face is an
    # explicit UI backing in the celestial mockup, not a recolor of the source.
    if dark:
        out += '<circle cx="960" cy="705" r="235" fill="#0b202d" stroke="#b38c4b" stroke-width="1.4"/>'
    out += f'<image x="660" y="405" width="600" height="600" href="{instrument}"/>'
    if dark:
        out += '<g transform="translate(660 405)"><path d="m300 230 13 57 57 13-57 13-13 57-13-57-57-13 57-13z" fill="#d0ac65"/><path d="m254 254 46 34 46-34-34 46 34 46-46-34-46 34 34-46z" fill="#8e7442"/><circle cx="300" cy="300" r="5" fill="#e4c98c"/>'
        for x,y,label in [(300,195,'N'),(410,309,'E'),(300,421,'S'),(190,309,'W')]:
            out += txt(x,y,label,24,'#c2a367')
        out += '</g>'
    for i,label in enumerate(['mail','book','code','notes','globe','tools']):
        a = math.radians(i*60-90); x=960+232*math.cos(a); y=705+232*math.sin(a)
        out += f'<g transform="translate({x:.3f} {y:.3f})" filter="url(#disk-shadow)"><circle r="35" fill="#f9edcf" stroke="#a58245" stroke-width="1.5"/><circle r="30.5" fill="none" stroke="#cdb58b" stroke-width=".7"/>'
        paths = {
            'mail':'M-14 -10H14V10H-14Z M-14 -10L0 2 14 -10',
            'book':'M0 -8Q-9 -14 -16 -9V13Q-8 8 0 14Q8 8 16 13V-9Q8 -14 0 -8V14',
            'code':'M-7 -10L-16 0 -7 10 M7 -10L16 0 7 10 M3 -13L-3 13',
            'notes':'M-10 -14H5L12 -7V14H-10Z M5 -14V-7H12 M-5 -2H7 M-5 4H7 M-5 10H4',
            'globe':'M-15 0H15 M0 -15C-12 -6 -12 6 0 15C12 6 12 -6 0 -15 M-12 -8H12 M-12 8H12',
            'tools':'M-11 11L7 -7 M-6 -12L12 6 M-10 -8L-6 -12 M8 10L12 6',
        }
        if label == 'globe':out += '<circle r="15" fill="none" stroke="#665031" stroke-width="1.6"/>'
        out += f'<path d="{paths[label]}" stroke="#665031" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" fill="none"/></g>'
    return out+'</g></svg>'

def main():
    for folder in ['fitted','softened','previews','reference','process']:(ROOT/folder).mkdir(exist_ok=True)
    for source in (PREVIOUS/'reference').iterdir():
        if source.is_file():shutil.copyfile(source, ROOT/'reference'/source.name)
    # Preserve a full-frame, bounded review copy, not another 26 MB PNG download.
    blaue = ROOT/'sources/blaeu-world.jpg'
    if not blaue.exists():
        im=Image.open(PREVIOUS/'sources/blaeu-world.png').convert('RGB')
        im.save(blaue, quality=96, subsampling=0)
    # Smooth local blur, not a painted/tinted blank patch. Nothing outside the
    # mask is color-graded, re-illustrated, sharpened or reconstructed.
    mask=Image.new('L',(W,H),0);draw=ImageDraw.Draw(mask)
    draw.rounded_rectangle((550,184,1370,360),radius=75,fill=255)
    draw.ellipse((610,355,1310,1055),fill=255)
    mask=mask.filter(ImageFilter.GaussianBlur(96))
    mask.save(ROOT/'process/blur-mask.png')
    results=[]
    for case in CASES:
        source=ROOT/'sources'/case['source']
        im=Image.open(source).convert('RGB')
        if case['rotation']:im=im.transpose(Image.Transpose.ROTATE_90)
        fitted=ImageOps.fit(im,(W,H),method=Image.Resampling.LANCZOS,centering=(.5,.5))
        fitted.save(ROOT/'fitted'/f'{case["id"]}.jpg',quality=95,subsampling=0)
        blurred=Image.composite(fitted.filter(ImageFilter.GaussianBlur(14)),fitted,mask)
        blurred.save(ROOT/'softened'/f'{case["id"]}.jpg',quality=95,subsampling=0)
        (ROOT/'previews'/f'{case["id"]}-context.svg').write_text(context(case),encoding='utf-8')
        scale=max(W/im.width,H/im.height)
        result={**case,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'orientedSize':list(im.size),'viewport':[W,H],
                'sourceAreaRetainedPercent':round(W*H/(scale*scale*im.width*im.height)*100,1),'blurRadiusPx':14,'maskFeatherPx':96}
        results.append(result)
        print(case['id'],result['sourceAreaRetainedPercent'],'% source area retained',flush=True)
    (ROOT/'process/candidates.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__':main()
