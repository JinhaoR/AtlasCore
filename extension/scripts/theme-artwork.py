"""Build static vector theme artwork, offline. No application/runtime dependency.

Parchment's nested wind roses adapt Jorge de Aguiar's 1492 chart (public domain).
Celestial's engraved geometry interprets the Met's 1291 astrolabe and Doppelmayr.
See src/ui/assets/themes/ARTWORK.md for the specific sources and reproduction rights.
This writes SVG geometry only; historical JPEG reproductions are bundled unchanged.
"""
from pathlib import Path
from math import sin, cos, pi

ROOT = Path(__file__).resolve().parents[1] / 'src/ui/assets/themes'

def svg(body, box='0 0 600 600'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" fill="none">{body}</svg>\n'

def write(theme, name, body, box='0 0 600 600'):
    (ROOT/theme/name).write_text(svg(body, box), encoding='utf8')

def point(r, a, cx=300, cy=300):
    return (cx+r*sin(a*pi/180), cy-r*cos(a*pi/180))

def xy(p): return f'{p[0]:.2f},{p[1]:.2f}'

def circle(r, color, width=1, fill='none', cx=300, cy=300):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" stroke="{color}" stroke-width="{width}" fill="{fill}"/>'

def path(d, color, width=1, fill='none', **attrs):
    return f'<path d="{d}" stroke="{color}" stroke-width="{width}" fill="{fill}" '+ ' '.join(f'{k}="{v}"' for k,v in attrs.items())+'/>'

def ticks(inner, outer, count, color, major=5, cx=300, cy=300):
    d=''.join(f'M{xy(point(inner if i%major==0 else inner+5,i*360/count,cx,cy))}L{xy(point(outer,i*360/count,cx,cy))}' for i in range(count))
    return path(d,color,.75)

def label(text, r, a, color, size=14, rotate=False):
    x,y=point(r,a)
    transform=f' transform="rotate({a},{x:.2f},{y:.2f})"' if rotate else ''
    return f'<text x="{x:.2f}" y="{y:.2f}" fill="{color}" font-family="Georgia,serif" font-size="{size}" text-anchor="middle" dominant-baseline="central"{transform}>{text}</text>'

# Aguiar: the large central rose is not a single modern eight-point star. It is
# a blue cardinal rose, red half-winds, interlaced ink arcs and a green inner rose.
ink='#423e30'; blue='#254e65'; red='#a84f38'; green='#526c50'; cream='#f2e4c4'; gold='#b79a58'
rose='<defs><radialGradient id="vellum"><stop stop-color="#fbf1d8"/><stop offset=".8" stop-color="#e9d5aa"/><stop offset="1" stop-color="#d6bd8c"/></radialGradient></defs>'
rose+=circle(232,ink,1.1,'url(#vellum)')+circle(227,ink,.6)+circle(220,ink,1.2)
rose+=ticks(221,227,128,ink,4)
# 32 wind marks outside the rose, in the three traditional chart pigments.
for i in range(32):
    a=i*11.25; c=blue if i%8==0 else red if i%4==0 else green if i%2==0 else ink
    rose+=path(f'M{xy(point(232,a))}L{xy(point(248 if i%4==0 else 239,a))}',c,1.1)
for i in range(16):
    a=i*22.5
    # Outer petal intersections visibly preserve the manuscript's woven ring.
    p1,p2=point(211,a-22.5),point(211,a+22.5)
    rose+=path(f'M{xy(p1)}Q{xy(point(143,a))} {xy(p2)}',ink,.9)
    p1,p2=point(182,a-22.5),point(182,a+22.5)
    rose+=path(f'M{xy(p1)}Q{xy(point(242,a))} {xy(p2)}',ink,.65)
for i in range(16):
    a=i*22.5; r=217 if i%4==0 else 207 if i%2==0 else 185
    c=blue if i%4==0 else red if i%2==0 else green
    left,right,tip,base=point(153,a-11.25),point(153,a+11.25),point(r,a),point(143,a)
    rose+=path(f'M{xy(base)}L{xy(left)} {xy(tip)}Z',ink,.8,c)
    rose+=path(f'M{xy(base)}L{xy(right)} {xy(tip)}Z',ink,.8,cream)
    # Hairline hatching gives each pigmented half an engraved edge.
    rose+=path(f'M{xy(point(159,a-5))}L{xy(point(r-8,a))}',cream,.65)
rose+=circle(151,ink,1.3,cream)+circle(145,gold,3)+circle(140,ink,.9)
for i in range(32):
    a=i*11.25
    rose+=path(f'M{xy(point(112,a-5.625))}L{xy(point(138,a))} {xy(point(112,a+5.625))}Z',ink,.65,red if i%2==0 else cream)
rose+=circle(112,ink,1.2)+circle(105,ink,.6)
for i in range(16):
    a=i*22.5;r=102 if i%2==0 else 85
    c=blue if i%4==0 else green if i%2==0 else gold
    rose+=path(f'M300,300L{xy(point(38,a-11.25))} {xy(point(r,a))}Z',ink,.8,c)
    rose+=path(f'M300,300L{xy(point(38,a+11.25))} {xy(point(r,a))}Z',ink,.8,cream)
rose+=circle(29,ink,1,cream)+circle(23,red,1)+circle(18,ink,.7)
for i in range(8):
    a=i*45
    rose+=path(f'M300,300Q{xy(point(22,a-20))} {xy(point(19,a))}Q{xy(point(22,a+20))} 300,300',ink,.6,gold)
rose+=circle(4,ink,.8,red)
# The north fleur is an actual portolan convention, not a UI target.
rose+=path('M300 30C287 44 287 53 297 66C281 53 270 59 276 72C279 79 286 80 291 76L295 84H305L309 76C314 80 321 79 324 72C330 59 319 53 303 66C313 53 313 44 300 30Z',ink,.9,blue)
rose+=path('M290 83H310M294 88H306',ink,1.5)
write('parchment','rose.svg',rose)
# A compact related mark for the existing brand box; no new layout.
mark=circle(211,ink,2,cream)+circle(196,ink,1)
for i in range(16):
    a=i*22.5;r=230 if i%2==0 else 152;c=blue if i%4==0 else red if i%2==0 else green
    mark+=path(f'M300,300L{xy(point(70,a-11.25))} {xy(point(r,a))}Z',ink,2,c)
    mark+=path(f'M300,300L{xy(point(70,a+11.25))} {xy(point(r,a))}Z',ink,2,cream)
mark+=circle(27,ink,2,gold)
write('parchment','mark.svg',mark)

# Celestial: an astrolabe-like limb, fine divisions, stereographic curves and
# an eccentric ecliptic. Atlas's existing eight-point rose paints over the center.
brass='#bb995b'; light='#ecd39b'; cool='#69949c'
instrument='<defs><radialGradient id="enamel"><stop stop-color="#153b4c"/><stop offset=".7" stop-color="#0a2434"/><stop offset="1" stop-color="#071923"/></radialGradient><linearGradient id="brass" x2="1" y2="1"><stop stop-color="#f0d6a0"/><stop offset=".35" stop-color="#96753e"/><stop offset=".7" stop-color="#e5c68a"/><stop offset="1" stop-color="#806135"/></linearGradient><clipPath id="plate"><circle cx="300" cy="300" r="190"/></clipPath></defs>'
instrument+=circle(244,'#03111b',6,'url(#enamel)')+circle(240,'#e6ca91',.8,'url(#brass)')+circle(219,'#8d7246',1,'url(#enamel)')
instrument+=ticks(224,238,180,'#433d2b')+circle(221,'#f3daa7',.6)+circle(213,brass,.7)+circle(190,brass,1.3)
for i in range(24):instrument+=label(str(i or 24),202,i*15,light,9,True)
instrument+='<g clip-path="url(#plate)" stroke="'+cool+'" stroke-width=".65" opacity=".35">'
for r in [50,80,120,170,230,310]:instrument+=circle(r,cool,.65,cx=300,cy=360)
for x in [90,160,230,370,440,510]:instrument+=f'<ellipse cx="{x}" cy="300" rx="{abs(300-x)+40}" ry="245"/>'
instrument+='</g>'
instrument+=circle(132,brass,1.5,cx=331,cy=266)+circle(126,brass,.7,cx=331,cy=266)
instrument+=ticks(126,132,72,brass,6,cx=331,cy=266)
instrument+=circle(144,'#173749',1,'#0a2030')+circle(140,brass,.7)+circle(126,brass,.45)
# Hairline alignment marks and a jewel-like central boss.
for i in range(8):
    a=i*45
    instrument+=path(f'M{xy(point(152,a))}L{xy(point(181,a))}',light,.7)
    if i%2:instrument+=circle(2.2,light,.5,brass,*point(174,a))
instrument+=circle(9,brass,1,'#183847')+circle(3,light,.8,light)
write('celestial','instrument.svg',instrument)
orbit='<defs><radialGradient id="halo"><stop offset=".4" stop-color="#5794a1" stop-opacity=".12"/><stop offset="1" stop-color="#071320" stop-opacity="0"/></radialGradient></defs><circle cx="300" cy="300" r="300" fill="url(#halo)"/>'
orbit+=circle(286,brass,.55)+circle(292,brass,.3)+ticks(284,290,120,brass,10)
for a in [45,135,225,315]:
    x,y=point(285,a);orbit+=path(f'M{x-5:.2f},{y:.2f}h10M{x:.2f},{y-5:.2f}v10',light,.9)
write('celestial','orbit.svg',orbit)

# Page compositions use the source-derived ink fragments below these vector
# plates. Detail is concentrated at the margins, never a repeated star wallpaper.
def frame(color, opacity=.35):
    return f'<g stroke="{color}" stroke-width=".6" opacity="{opacity}"><path d="M28 108V28H1772V108M28 1092V1172H1772V1092M35 100V35H1765V100M35 1100V1165H1765V1100"/><path d="M20 52H52V20M1748 20V52H1780M20 1148H52V1180M1748 1180V1148H1780"/></g>'

# Marginal declination rulings replace the enormous graduated circular plate.
# No additional instrument, decorative headings or invented constellation stars.
chart=frame(brass,.35)
chart+='<g opacity=".23">'
for x, direction in [(92,1),(1708,-1)]:
    chart+=path(f'M{x},330V950',brass,.7)
    for y in range(330,951,10):
        chart+=path(f'M{x},{y}h{direction*(9 if y%50==30 else 4)}',brass,.65)
    for y in range(380,951,100):
        chart+=path(f'M{x+direction*18},{y}h{direction*48}',brass,.4)
chart+='</g>'
write('celestial','chart.svg',chart,'0 0 1800 1200')
# The directory plate is peripheral: no rays or dense grid behind its controls.
directory=frame(brass,.30)
directory+='<g opacity=".30">'+path('M1772 140V1060',brass,.6)
for y in range(140,1061,10):directory+=path(f'M1772 {y}h{-9 if y%50==40 else -4}',brass,.6)
directory+='</g>'
write('celestial','directory.svg',directory,'0 0 1800 1200')

# Paper and a quiet marginal frame. The foreground-centered wind field below
# replaces the disconnected fixed-viewport wind origins from the previous pass.
paper='<defs><pattern id="fiber" width="170" height="170" patternUnits="userSpaceOnUse"><path d="M12 16l8 2M96 39l4-1M42 82l6 1M137 121l10-2M65 152l5 1" stroke="#79684a" stroke-width=".5" opacity=".15"/></pattern></defs><rect width="1800" height="1200" fill="url(#fiber)"/>'
paper+=frame('#806344',.5)
write('parchment','paper.svg',paper,'0 0 1800 1200')
# Center is tied to the existing launcher region, never viewport coordinates.
# The actual rose stays untouched and rotates independently above this chart.
field='<defs><radialGradient id="winds"><stop offset=".12" stop-color="white" stop-opacity="0"/><stop offset=".28" stop-color="white" stop-opacity=".26"/><stop offset=".72" stop-color="white" stop-opacity=".23"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient><mask id="field"><rect width="1800" height="800" fill="url(#winds)"/></mask></defs><g mask="url(#field)">'
for i in range(32):
    a=i*11.25; c=blue if i%8==0 else red if i%4==0 else green if i%2==0 else ink
    field+=path(f'M{xy(point(235,a,900,400))}L{xy(point(1300,a,900,400))}',c,1 if i%4==0 else .6)
# Cross bearings add chart structure without another decorative compass.
for cx,cy in [(40,680),(1760,120)]:
    for a in range(0,360,45):field+=path(f'M{cx},{cy}L{xy(point(1800,a,cx,cy))}',ink,.4)
field+='</g>'
write('parchment','bearings.svg',field,'0 0 1800 800')
# The working-page margin is a chartmaker's ruled sheet. Sparse diagonal winds
# remain below the directory instead of intersecting its labels.
directory=frame('#806344',.50)
directory+='<g opacity=".13">'
for x in range(-500,2400,180):directory+=path(f'M{x},1200L{1800 if x<900 else 0},900',blue if x%360 else red,.6)
directory+='</g>'
write('parchment','directory.svg',directory,'0 0 1800 1200')
