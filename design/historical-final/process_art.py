"""Offline historical artwork editing. Pillow/NumPy only; no generated imagery.

Whole-source compositions retain their original relationships. Local masks remove
competing diagrams/figures. Parchment is repaired with sampled paper; astronomy
separates engraving density into brass, copper and blue over midnight enamel.
The runtime receives only finished WebPs. Existing compass artwork is untouched.
"""
from pathlib import Path
from PIL import Image, ImageOps, ImageFilter, ImageDraw
import hashlib, json, shutil, sys
import numpy as np

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[1]
SOURCES=ROOT.parent/'direct-art-studies/sources'
W,H=2560,1600
YY,XX=np.mgrid[0:H,0:W].astype(np.float32); U=XX/W; V=YY/H

def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)

def array(im):return np.asarray(im,dtype=np.float32)/255
def picture(a):return Image.fromarray(np.uint8(np.clip(a,0,1)*255+.5))

def source(name,rotate=False):
    im=Image.open(SOURCES/name).convert('RGB')
    if rotate:im=im.transpose(Image.Transpose.ROTATE_90)
    return im

def fitted(im):return ImageOps.fit(im,(W,H),method=Image.Resampling.LANCZOS)

def field(kind,workspace=False):
    # A softly irregular vertical reading field, not an oval blur. No residual
    # scan survives in the central core: unwanted figures are actually removed.
    waviness=.009*np.sin(V*11)+.007*np.sin(V*25+.8)
    distance=np.abs(U-.5)+waviness
    lo,hi=(.30,.48) if workspace else (.19,.37)
    edges=smooth(lo,hi,distance)
    # Visible lower corners keep the sheet grounded, while the lower central
    # diagram/cartouche remains removed. Navigation has its own quiet upper band.
    vertical=smooth(.07,.28,V)*(1-.22*smooth(.82,1,V))
    opacity=edges*vertical
    if kind=='sky':opacity*=.75
    else:opacity*=.84
    # Management copy reaches the margins. Preserve the same source identity
    # there as a low-contrast watermark rather than behind editable content.
    if workspace:opacity*=.22
    return opacity

def paper(im,tone):
    # Non-repeating scan grain: suppress ink with a local upper envelope, then
    # retain only bounded high-frequency paper variation. No mirrored tile,
    # procedural noise, recognizable figures or enlarged blurry paper patch.
    p=fitted(im).convert('L').filter(ImageFilter.MaxFilter(5))
    tex=array(p)-array(p.filter(ImageFilter.GaussianBlur(5)))
    tex=np.clip(tex,-.016,.016)[:,:,None]*.35
    edge=(np.abs(U-.5)*2)**1.6
    shade=(edge*.022+V*.009)[:,:,None]
    return np.clip(np.array(tone)/255+tex-shade,0,1)

def parchment(name,rotate=False,workspace=False):
    src=source(name,rotate)
    if name.startswith('oliva'):
        # Crop inside the vellum: photographic backing is not map artwork.
        src=src.crop((int(src.width*.04),int(src.height*.075),int(src.width*.94),int(src.height*.89)))
    im=fitted(src); a=array(im)
    base=paper(src,(241,228,200))
    # Preserve pigments with a gentle illumination normalization. Detail is not
    # desaturated into beige. Uneven scans remain visibly manuscript-like.
    illumination=array(im.filter(ImageFilter.GaussianBlur(65)))
    corrected=np.clip(a + np.maximum(0,np.array([.89,.84,.72])-illumination)*.35,0,1)
    # Remove the dark photographic support exposed at the torn vellum edges.
    lum=corrected.mean(axis=2)
    support=np.ones((H,W),np.float32)
    border=(U<.075)|(U>.925)|(V<.04)|(V>.96)
    support[border]=smooth(.18,.38,lum[border])
    alpha=field('paper',workspace)*support
    # Keep characteristic colored winds at the left margin, but tame their
    # dark fill relative to Atlas's approved centerpiece.
    alpha*=.85+.15*smooth(.3,.7,V)
    return picture(base*(1-alpha[:,:,None])+corrected*alpha[:,:,None])

def celestial(name,workspace=False):
    im=fitted(source(name)); a=array(im)
    lum=np.sum(a*np.array([.2126,.7152,.0722]),axis=2)
    local=np.asarray(im.convert('L').filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(6)),dtype=np.float32)/255
    # Engraved strokes and broad hatch shadows have different contributions.
    ink=np.clip((local-lum)*3.1,0,1)
    shading=np.clip((.78-lum)/.7,0,1)*.22
    strength=np.maximum(ink,shading)
    warm=np.clip((a[:,:,0]-a[:,:,2]-.06)*3,0,1)
    blue=np.clip((a[:,:,2]-a[:,:,0]+.04)*4,0,1)
    brass=np.array([.64,.54,.35]);copper=np.array([.66,.40,.26]);silver=np.array([.39,.54,.60])
    pigment=brass[None,None,:]*(1-warm[:,:,None]*.34)+copper*warm[:,:,None]*.34
    pigment=pigment*(1-blue[:,:,None]*.45)+silver*blue[:,:,None]*.45
    depth=(1-np.abs(U-.5)*1.4)*(.7+.3*np.sin(V*np.pi))
    base=np.array([7,20,31])/255+depth[:,:,None]*np.array([4,10,13])/255
    alpha=field('sky',workspace)*strength
    return picture(base*(1-alpha[:,:,None])+pigment*alpha[:,:,None])

CASES=[
    ('celestial-a','de-wit-1680.jpg',celestial,{}),
    ('celestial-b','vlasbloem-1675.jpg',celestial,{}),
    ('parchment-a','oliva-17c.jpg',parchment,{}),
    ('parchment-b','prunes-1559.jpg',parchment,{'rotate':True}),
]

def main():
    (ROOT/'candidates').mkdir(exist_ok=True);(ROOT/'process').mkdir(exist_ok=True)
    records=[]
    for id,name,fn,kwargs in CASES:
        for workspace in [False,True]:
            im=fn(name,workspace=workspace,**kwargs)
            p=ROOT/'candidates'/f'{id}{"-workspace" if workspace else ""}.webp'
            im.save(p,quality=85,method=6)
            records.append({'file':p.name,'bytes':p.stat().st_size,'size':[W,H],'source':name,'sourceSha256':hashlib.sha256((SOURCES/name).read_bytes()).hexdigest()})
            print(p.name,p.stat().st_size,flush=True)
    (ROOT/'process/assets.json').write_text(json.dumps(records,indent=2))
    # Source-specific material and processing boundaries remain easy to inspect.
    for name,kind in [('sky','sky'),('paper','paper')]:
        Image.fromarray(np.uint8(field(kind)*255)).save(ROOT/'process'/f'{name}-retained-detail-mask.png')
    board=Image.new('RGB',(1600,1060),'#15212b');d=ImageDraw.Draw(board)
    for i,(id,_,_,_) in enumerate(CASES):
        im=Image.open(ROOT/'candidates'/f'{id}.webp');im.thumbnail((784,490))
        x=8+(i%2)*800;y=34+(i//2)*530;board.paste(im,(x,y));d.text((x,y-22),id,fill='white')
    board.save(ROOT/'backgrounds.jpg',quality=94)

    if '--install-assets' in sys.argv:
        installed=[]
        for theme,name in [('celestial','de-wit-1680.jpg'),('parchment','oliva-17c.jpg')]:
            dest=REPO/'extension/src/ui/assets/themes'/theme
            for suffix,filename in [('', 'historical-home.webp'),('-workspace','historical-workspace.webp')]:
                target=dest/filename
                shutil.copy2(ROOT/'candidates'/f'{theme}-a{suffix}.webp',target)
                installed.append({'file':f'{theme}/{filename}','bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
            # A bounded full-frame reference copy beside the finished theme.
            # The exact downloaded input remains in direct-art-studies/sources.
            review=source(name);review.thumbnail((960,960),Image.Resampling.LANCZOS)
            target=dest/name;review.save(target,quality=82,subsampling=2,optimize=True)
            installed.append({'file':f'{theme}/{name}','bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'role':'full-frame review derivative; not the downloaded original'})
        (ROOT/'process/installed-assets.json').write_text(json.dumps(installed,indent=2))

if __name__=='__main__':main()
