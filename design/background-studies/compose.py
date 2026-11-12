"""Four independent layered SVG art studies. No extension files are written.

WebP illustrations are documented historical crops. Frames, bearings, masks and
layout are explicitly drawn vector geometry. 'Context' files are static design
mockups, not screenshots or working implementations of Atlas.
"""
from pathlib import Path
import base64, math, shutil
from xml.sax.saxutils import escape
from PIL import Image

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[1]
W,H=1920,1200
for d in ['compositions','previews','reference']:(ROOT/d).mkdir(exist_ok=True)

# The approved compass is copied, byte-for-byte, only into the study references.
THEMES=REPO/'extension/src/ui/assets/themes'
for theme,files in [('celestial',['instrument.svg','mark.svg']),('parchment',['rose.svg','mark.svg'])]:
    for f in files:shutil.copyfile(THEMES/theme/f,ROOT/'reference'/f'{theme}-{f}')
FONTS=REPO/'extension/src/ui/assets/fonts'
for f in ['cormorant-garamond-normal-latin.woff2','source-sans-3-normal-latin.woff2','Cormorant-Garamond-OFL.txt','Source-Sans-3-OFL.txt']:
    shutil.copyfile(FONTS/f,ROOT/'reference'/f)

def uri(path,mime='image/png'):
    return 'data:'+mime+';base64,'+base64.b64encode(path.read_bytes()).decode()

def image(name,x,y,width,height=None,opacity=1,extra=''):
    p=ROOT/'fragments'/f'{name}.webp'
    if height is None:
        im=Image.open(p);height=width*im.height/im.width
    return f'<image data-source="{name}" x="{x}" y="{y}" width="{width}" height="{height}" opacity="{opacity}" preserveAspectRatio="none" href="{uri(p,"image/webp")}" {extra}/>'

def line(x1,y1,x2,y2,c,w=1,opacity=1):return f'<path d="M{x1:.2f},{y1:.2f} L{x2:.2f},{y2:.2f}" fill="none" stroke="{c}" stroke-width="{w}" opacity="{opacity}"/>'
def circle(x,y,r,c,w=1,opacity=1,fill='none'):return f'<circle cx="{x}" cy="{y}" r="{r}" stroke="{c}" stroke-width="{w}" opacity="{opacity}" fill="{fill}"/>'
def text(x,y,s,size,color,spacing=0,anchor='middle',family='Folio',extra=''):return f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" fill="{color}" letter-spacing="{spacing}" text-anchor="{anchor}" {extra}>{escape(s)}</text>'

def frame(color,opacity=.6,ornate=False):
    result=f'<g id="engraved-frame" opacity="{opacity}" fill="none" stroke="{color}"><rect x="27" y="27" width="1866" height="1146" stroke-width="1.2"/><rect x="34" y="34" width="1852" height="1132" stroke-width=".5"/>'
    for x,y,rotation in [(42,42,0),(1878,42,90),(1878,1158,180),(42,1158,270)]:
        result+=f'<g transform="translate({x},{y}) rotate({rotation})"><path d="M0,38 V0 H38 M5,27 V5 H27 M-15,12 H12 V-15"/>'
        if ornate:result+='<path d="M13,13 Q32,13 32,32 Q13,32 13,13 M13,13 Q45,2 51,18 Q38,29 30,16 M13,13 Q2,45 18,51 Q29,38 16,30" stroke-width=".6"/>'
        result+='</g>'
    return result+'</g>'

def edge_scale(color,opacity=.4):
    out='<g id="marginal-scale">'
    for y in range(130,1080,12):
        length=12 if (y-130)%60==0 else 5
        out+=line(48,y,48+length,y,color,.7,opacity)+line(1872-length,y,1872,y,color,.7,opacity)
    return out+'</g>'

def bearings(origins,opacity=.18):
    out='<g id="rhumb-network" clip-path="url(#sheet)">'
    for cx,cy in origins:
        for i in range(16):
            a=i*math.pi/16;dx=2600*math.cos(a);dy=2600*math.sin(a)
            out+=line(cx-dx,cy-dy,cx+dx,cy+dy,['#9b7040','#826a45','#aa5141','#517f76'][i%4],.65 if i%2 else .9,opacity)
    return out+'</g>'

def definitions():
    a=uri(ROOT/'reference/cormorant-garamond-normal-latin.woff2','font/woff2');b=uri(ROOT/'reference/source-sans-3-normal-latin.woff2','font/woff2')
    return f'''<defs>
      <style>@font-face{{font-family:Folio;src:url({a})}}@font-face{{font-family:Interface;src:url({b})}}</style>
      <clipPath id="sheet"><rect x="36" y="36" width="1848" height="1128"/></clipPath>
      <radialGradient id="night"><stop stop-color="#102d3d"/><stop offset=".6" stop-color="#0a202e"/><stop offset="1" stop-color="#050f1b"/></radialGradient>
      <radialGradient id="vellum"><stop stop-color="#f7ecd0"/><stop offset=".6" stop-color="#efddb5"/><stop offset="1" stop-color="#d4b880"/></radialGradient>
      <radialGradient id="ivory"><stop stop-color="#faf3df"/><stop offset=".7" stop-color="#f0e5ca"/><stop offset="1" stop-color="#d8c7a5"/></radialGradient>
      <radialGradient id="clear-center"><stop stop-color="black"/><stop offset=".45" stop-color="black"/><stop offset=".76" stop-color="#888"/><stop offset="1" stop-color="white"/></radialGradient>
      <mask id="margins"><rect width="1920" height="1200" fill="url(#clear-center)"/></mask>
      <pattern id="paper" width="688" height="488" patternUnits="userSpaceOnUse"><image width="688" height="488" href="{uri(ROOT/'fragments/paper-sample.jpg','image/jpeg')}"/></pattern>
      <filter id="medallion-shadow" x="-.4" y="-.4" width="1.8" height="1.8"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity=".25"/></filter>
    </defs>'''

def observatory():
    out='<g id="ground"><rect width="1920" height="1200" fill="url(#night)"/><rect width="1920" height="1200" fill="url(#paper)" opacity=".022"/></g>'
    out+='<g id="historical-constellation-margins">'
    out+=image('sky-west',52,135,435,opacity=.29)+image('sky-east',1467,140,402,opacity=.29)
    out+='</g>'
    # Instrument ruling connects the marginal chart to the central working field.
    out+='<g id="observatory-ruling" stroke="#b18c51" fill="none" opacity=".19">'
    for y in [205,510,815,1100]:out+=f'<path d="M60,{y} H445 M1475,{y} H1860" stroke-width=".6"/>'
    out+='<path d="M430,175 Q250,560 430,1090 M1490,175 Q1670,560 1490,1090" stroke-width=".8"/></g>'
    out+=image('astronomer-night',66,708,413,opacity=.84)
    out+=image('urania-night',1487,596,371,opacity=.82)
    out+=line(65,1125,1855,1125,'#b69355',1,.45)
    out+=text(960,1137,'A T L A S   C O E L E S T I S',16,'#ac8b51',2)
    out+=frame('#c5a061',.61,True)+edge_scale('#bf9a59',.4)
    out+=text(256,110,'FIGVRÆ  CŒLESTES',17,'#a08450',2)+text(1660,110,'HARMONIA  MACROCOSMICA',17,'#a08450',1)
    return out

def cabinet():
    out='<rect width="1920" height="1200" fill="#081b29"/><rect width="1920" height="1200" fill="url(#paper)" opacity=".025"/>'
    out+=image('northern-hemisphere',-455,110,1000,opacity=.31,extra='clip-path="url(#sheet)"')
    out+='<g clip-path="url(#sheet)">'+image('northern-hemisphere',1370,70,1050,opacity=.26,extra='transform="rotate(180 1895 595)"')+'</g>'
    out+='<g id="celestial-equator" opacity=".32" fill="none" stroke="#ae915b">'
    out+='<path d="M42,962 Q960,1310 1878,962 M42,949 Q960,1289 1878,949" stroke-width=".7"/>'
    out+='</g>'
    out+=image('instruments-left-etch',90,910,380,opacity=.62)+image('instruments-right-etch',1440,900,370,opacity=.59)
    out+=frame('#a58c58',.7)+edge_scale('#a58c58',.38)
    # Quiet measured graduations below the central instrument, never a competing rose.
    for x in range(540,1390,10):out+=line(x,1113,x,1100 if x%50==0 else 1107,'#ac8e54',.7,.6)
    out+=text(960,1145,'TABVLÆ · NAVIGATIONIS · CŒLESTIS',16,'#b29765',2)
    return out

def pilots():
    out='<rect width="1920" height="1200" fill="url(#vellum)"/><rect width="1920" height="1200" fill="url(#paper)" opacity=".20"/>'
    out+=bearings([(960,703),(215,250),(1740,922)],.14)
    out+=image('atlantic-coast',52,126,315,height=900,opacity=.95)
    out+=image('mediterranean-coast',1470,140,416,height=680,opacity=.9)
    out+=image('ship-running',1485,867,300,opacity=.96)
    out+=image('ship-distant',386,937,224,opacity=.78)
    out+=image('blaeu-scale',885,1060,150,opacity=.84)
    out+=frame('#8e5c39',.75,True)+edge_scale('#775c3b',.5)
    out+=text(960,71,'M A R E   I N C O G N I T V M',17,'#8c6740',2)
    for x,y in [(215,250),(1740,922)]:
        out+=circle(x,y,15,'#8e5c39',.6,.45)+circle(x,y,3,'#8e5c39',1,.6)
    return out

def sea_atlas():
    out='<rect width="1920" height="1200" fill="url(#ivory)"/><rect width="1920" height="1200" fill="url(#paper)" opacity=".18"/>'
    out+=image('blaeu-geography',190,210,1540,opacity=.3,extra='mask="url(#margins)"')
    out+=bearings([(960,703),(90,590),(1830,590)],.09)
    out+=image('planet-frieze',250,43,1420,height=120,opacity=.83)
    out+=image('wonder-frieze',250,1052,1420,height=116,opacity=.78)
    out+=image('element-water',73,410,159,height=322,opacity=.85)
    out+=image('element-air',1688,426,159,height=303,opacity=.85)
    # The antique panels are housed within deliberate engraved margins.
    for x in [65,1680]:
        out+=f'<rect x="{x}" y="397" width="175" height="349" fill="none" stroke="#796947" stroke-width=".7"/>'
    for y in [175,1040]:out+=line(63,y,1857,y,'#9d6441',1,.65)+line(63,y+4,1857,y+4,'#557b6f',.7,.55)
    out+=frame('#81633e',.7,True)
    return out

def preview(dark):
    # Deliberately minimal context overlay; no interaction or state/permission claim.
    cream='#f5e6c0' if dark else '#473a27';muted='#c5ba9d' if dark else '#7b6749';gold='#c9a15b' if dark else '#91642f';field='#0b2231' if dark else '#f6e8c6'
    out='<g id="static-atlas-context">'
    out+=text(1004,248,'A T L A S',66,cream,5)
    mark=ROOT/'reference'/('celestial-mark.svg' if dark else 'parchment-mark.svg')
    out+=f'<image x="737" y="196" width="62" height="62" href="{uri(mark,"image/svg+xml")}"/>'
    out+=f'<rect x="466" y="302" width="988" height="66" rx="9" fill="{field}" stroke="{gold}" stroke-width="1.4"/>'
    out+=circle(499,333,8,gold,1.5)+line(505,339,513,347,gold,1.5)
    out+=text(531,345,'Search your sites…',23,muted,0,'start','Interface')
    compass=ROOT/'reference'/('celestial-instrument.svg' if dark else 'parchment-rose.svg')
    out+=f'<image x="610" y="360" width="700" height="700" href="{uri(compass,"image/svg+xml")}"/>'
    if dark:
        out+='<g transform="translate(610 360) scale(1.1666666667)">'
        out+='<path d="m300 230 13 57 57 13-57 13-13 57-13-57-57-13 57-13z" fill="#d0ac65"/><path d="m254 254 46 34 46-34-34 46 34 46-46-34-46 34 34-46z" fill="#8e7442"/><circle cx="300" cy="300" r="5" fill="#e4c98c"/>'
        for x,y,t in [(300,195,'N'),(410,309,'E'),(300,421,'S'),(190,309,'W')]:out+=text(x,y,t,24,'#c2a367')
        out+='</g>'
    # Neutral specimen pin glyphs avoid loading any external website assets.
    glyphs=[('mail','M'),('library','L'),('research','R'),('notes','N'),('code','C'),('tools','T')]
    for i,(name,label) in enumerate(glyphs):
        a=math.radians(i*60-90);x=960+(232*7/6)*math.cos(a);y=710+(232*7/6)*math.sin(a)
        out+=f'<g data-specimen="{name}" filter="url(#medallion-shadow)">'
        out+=circle(x,y,38,gold,1.6,1,'#f8ebcc')+circle(x,y,33,'#c9ad7c',.55,.75)
        if name=='mail':out+=f'<path d="M{x-14},{y-10}h28v20h-28z M{x-14},{y-10}l14,12 14,-12" fill="none" stroke="#735a34" stroke-width="1.8"/>'
        elif name=='code':out+=f'<path d="M{x-7},{y-10}l-9,10 9,10 M{x+7},{y-10}l9,10 -9,10 M{x+3},{y-13}l-6,26" fill="none" stroke="#735a34" stroke-width="1.8"/>'
        elif name=='library':out+=f'<path d="M{x},{y-9}q-10,-7 -16,-2v23q8,-4 16,2q8,-6 16,-2v-23q-8,-5 -16,2v23" fill="none" stroke="#735a34" stroke-width="1.8"/>'
        else:out+=text(x,y+10,label,29,'#735a34')
        out+='</g>'
    return out+'</g>'

STUDIES=[('01-astronomers-court','Celestial · The Astronomer’s Court',True,observatory),('02-celestial-cabinet','Celestial · The Celestial Cabinet',True,cabinet),('03-pilots-vellum','Parchment · The Pilot’s Vellum',False,pilots),('04-blaeus-sea-atlas','Parchment · Blaeu’s Sea Atlas',False,sea_atlas)]

def main():
    defs=definitions()
    for slug,title,dark,make in STUDIES:
        header=f'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1200" viewBox="0 0 1920 1200"><title>{escape(title)}</title><desc>Independent Atlas background composition. Documented public-domain engravings, photographic crops and explicit vector geometry. No generated image content. See SOURCES.md.</desc>'
        art=make()
        (ROOT/'compositions'/f'{slug}.svg').write_text(header+defs+art+'</svg>',encoding='utf-8')
        (ROOT/'previews'/f'{slug}-context.svg').write_text(header+defs+art+preview(dark)+'</svg>',encoding='utf-8')
        print(slug)

if __name__=='__main__':main()
