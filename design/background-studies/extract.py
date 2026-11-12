"""Ordinary, reproducible image processing. No generated pictorial content.

Coordinates refer to the inspected study thumbnails; source scans stay untouched.
Polygon masks isolate engravings. Paper removal uses measured paper color; no
inpainting, content-aware fill, neural segmentation or synthesized details.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'fragments'
OUT.mkdir(exist_ok=True)
records = []

def cut(name, source, ref, box, polygon=None, mode='pigment', paper=(236,230,207), fade=0):
    im = Image.open(ROOT/'sources'/source).convert('RGB')
    sx,sy = im.width/ref[0], im.height/ref[1]
    rect = tuple(round(v*(sx if i%2==0 else sy)) for i,v in enumerate(box))
    cropped = im.crop(rect)
    a = np.array(cropped,dtype=np.float32)
    mask = Image.new('L',cropped.size,255 if polygon is None else 0)
    if polygon:
        ImageDraw.Draw(mask).polygon([((x-box[0])*sx,(y-box[1])*sy) for x,y in polygon],fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(.7*sx))
    alpha = np.array(mask,dtype=np.float32)/255
    if fade:
        yy,xx=np.mgrid[:cropped.height,:cropped.width]
        edge=np.minimum.reduce([xx,yy,cropped.width-1-xx,cropped.height-1-yy])/(fade*sx)
        alpha*=np.clip(edge,0,1)
    ratio=np.clip(a/np.array(paper,dtype=np.float32),0,1)
    strength=1-np.min(ratio,axis=2)
    if mode in ('pigment','brass','ink'):
        # Remove the scan's yellow paper without discarding pigment/hatching.
        strength=np.clip((strength-.045)/.88,0,1)
        alpha*=strength
        if mode=='brass':
            lum=(a@np.array([.2126,.7152,.0722]))/255
            rgb=np.stack([168+lum*49,130+lum*49,76+lum*43],axis=-1)
        elif mode=='ink':
            rgb=np.zeros_like(a)+np.array([92,76,53])
        else:
            # Unmultiply the light paper, yielding reusable colored ink.
            rgb=np.clip((ratio-(1-strength[:,:,None]))/np.maximum(strength[:,:,None],.02),0,1)*255
            rgb=rgb*.8+np.array([39,29,14])
    elif mode=='etch':
        lum=np.array(cropped.convert('L'),dtype=np.float32)
        nearby=np.array(cropped.convert('L').filter(ImageFilter.MaxFilter(9)),dtype=np.float32)
        alpha*=np.clip((nearby-lum-4)/95,0,1)
        rgb=np.zeros_like(a)+np.array([195,159,101])
    elif mode=='night':
        # Retain engraved tonal relief and restrained original pigment on navy.
        lum=a@np.array([.2126,.7152,.0722])
        grey=lum[:,:,None]
        rgb=(a*.40+grey*.60)*np.array([.85,.76,.62])
    else:rgb=a
    arr=np.dstack([np.clip(rgb,0,255),np.clip(alpha*255,0,255)]).astype('uint8')
    result=Image.fromarray(arr)
    # Review-size derivatives; untouched high-resolution scans remain in sources.
    maxwidth={'blaeu-geography':1920,'planet-frieze':1800,'wonder-frieze':1800,'atlantic-coast':500,'mediterranean-coast':650,'blaeu-scale':400}.get(name,1600)
    result.thumbnail((maxwidth,3000),Image.Resampling.LANCZOS)
    result.save(OUT/(name+'.webp'),'WEBP',quality=95,method=6)
    records.append(dict(name=name,source=source,referenceSize=ref,crop=box,polygon=polygon,mode=mode,paper=paper,fade=fade,size=result.size))

# Historic astronomers / allegorical figures at the foot of Cellarius's plate.
left=[(110,1085),(110,859),(118,840),(129,812),(120,799),(122,784),(129,785),(136,801),(133,782),(139,783),(143,799),(144,778),(151,783),(153,800),(165,788),(165,795),(157,812),(161,827),(177,813),(186,809),(186,795),(179,790),(181,777),(185,764),(184,750),(194,745),(199,742),(199,728),(205,735),(209,727),(215,733),(222,725),(219,743),(226,748),(226,757),(230,769),(230,780),(232,791),(234,809),(252,815),(260,826),(262,804),(270,801),(280,847),(284,871),(298,884),(302,902),(300,913),(290,916),(292,929),(312,935),(323,931),(335,929),(349,932),(358,943),(362,962),(370,976),(388,974),(402,978),(416,988),(417,1013),(426,1024),(425,1038),(412,1044),(415,1060),(470,1071),(478,1085)]
right=[(1317,633),(1295,626),(1281,615),(1266,605),(1264,594),(1259,600),(1259,610),(1230,624),(1225,638),(1215,643),(1218,628),(1212,634),(1211,650),(1205,683),(1194,730),(1180,763),(1164,798),(1141,835),(1114,873),(1079,914),(1042,951),(1006,983),(967,1010),(967,1078),(1317,1082)]
for mode in ['night','brass']:
    cut('astronomer-'+mode,'cellarius-copernican.jpg',(1423,1200),(106,710,485,1091),left,mode)
    cut('urania-'+mode,'cellarius-copernican.jpg',(1423,1200),(956,585,1327,1090),right,mode)
# Telescope and armillary / measuring instruments from the atlas frontispiece.
cut('instruments-left','doppelmayr-systems.jpg',(1440,1172),(827,994,1001,1086),[(827,1027),(858,1007),(934,1013),(955,993),(993,1014),(975,1064),(944,1085),(828,1085)],'night')
cut('instruments-right','doppelmayr-systems.jpg',(1440,1172),(1234,988,1386,1080),[(1251,991),(1302,1007),(1352,997),(1385,1018),(1384,1076),(1234,1076)],'night')
cut('instruments-left-etch','doppelmayr-systems.jpg',(1440,1172),(827,994,1001,1086),[(827,1027),(858,1007),(934,1013),(955,993),(993,1014),(975,1064),(944,1085),(828,1085)],'etch',fade=3)
cut('instruments-right-etch','doppelmayr-systems.jpg',(1440,1172),(1234,988,1386,1080),[(1251,991),(1302,1007),(1352,997),(1385,1018),(1384,1076),(1234,1076)],'etch',fade=3)
# Actual ship engravings and the decorated scale from Blaeu's Capitanata.
cut('ship-running','blaeu-capitanata.jpg',(1440,1113),(1190,215,1380,353),[(1212,303),(1231,297),(1260,270),(1279,253),(1295,228),(1311,237),(1325,218),(1334,235),(1350,239),(1347,266),(1370,298),(1363,317),(1378,331),(1328,346),(1260,338),(1190,316)],'pigment',paper=(245,241,218),fade=4)
cut('ship-distant','blaeu-capitanata.jpg',(1440,1113),(1152,72,1340,184),[(1160,150),(1199,143),(1205,107),(1209,77),(1224,77),(1228,95),(1241,87),(1246,99),(1242,116),(1255,119),(1261,146),(1318,148),(1336,162),(1269,182),(1180,175)],'pigment',paper=(245,241,218),fade=3)
cut('blaeu-scale','blaeu-capitanata.jpg',(1440,1113),(137,853,440,1067),[(173,882),(202,880),(220,895),(246,861),(274,865),(285,853),(301,870),(329,871),(333,887),(352,872),(379,884),(394,914),(405,932),(383,951),(372,994),(419,1012),(437,1025),(435,1048),(411,1065),(156,1065),(138,1044),(143,1019),(169,1011),(196,985),(194,950),(170,942)],'pigment',paper=(245,241,218))
# Longitude-table figures; ink-only copies deliberately retain historic hatching.
cut('sky-west','doppelmayr-1730.jpg',(1280,1096),(255,180,635,716),mode='brass',paper=(228,226,194),fade=45)
cut('sky-east','doppelmayr-1730.jpg',(1280,1096),(705,245,1056,851),mode='brass',paper=(228,226,194),fade=45)
cut('northern-hemisphere','doppelmayr-1730.jpg',(1280,1096),(213,152,1072,1014),mode='brass',paper=(228,226,194),fade=50)
# Portolan shorelines from Aguiar, normalized against the 1280px reference.
cut('atlantic-coast','aguiar-1492.jpg',(1280,990),(310,100,610,955),mode='pigment',paper=(211,211,187),fade=32)
cut('mediterranean-coast','aguiar-1492.jpg',(1280,990),(805,95,1245,655),mode='pigment',paper=(211,211,187),fade=32)
# Engraved panels and native ornamental border from Blaeu's world map.
cut('planet-frieze','blaeu-world.png',(1440,1082),(35,31,1405,147),mode='pigment',paper=(235,227,199),fade=3)
cut('wonder-frieze','blaeu-world.png',(1440,1082),(35,942,1405,1054),mode='pigment',paper=(235,227,199),fade=3)
cut('element-water','blaeu-world.png',(1440,1082),(39,574,122,742),mode='pigment',paper=(235,227,199),fade=2)
cut('element-air','blaeu-world.png',(1440,1082),(39,405,122,557),mode='pigment',paper=(235,227,199),fade=2)
cut('america-cartouche','blaeu-world.png',(1440,1082),(279,219,562,406),[(282,294),(321,272),(334,241),(351,223),(366,255),(385,250),(405,224),(431,227),(454,255),(486,270),(507,265),(526,280),(544,302),(551,351),(540,384),(487,403),(393,404),(340,382),(312,336)],'pigment',paper=(235,227,199))
cut('blaeu-geography','blaeu-world.png',(1440,1082),(164,193,1278,918),mode='pigment',paper=(235,227,199),fade=28)
# Real scan paper, without landmarks. Seamless mirrored tiles are a texture,
# not invented painting. Keep it very low contrast in the final composition.
paper=Image.open(ROOT/'sources/cellarius-copernican.jpg').convert('RGB').crop((3,3,175,125)).resize((344,244))
tile=Image.new('RGB',(688,488));tile.paste(paper,(0,0));tile.paste(paper.transpose(Image.Transpose.FLIP_LEFT_RIGHT),(344,0));tile.paste(tile.crop((0,0,688,244)).transpose(Image.Transpose.FLIP_TOP_BOTTOM),(0,244))
tile.save(OUT/'paper-sample.jpg',quality=90)
(ROOT/'process/extractions.json').write_text(json.dumps(records,indent=2))
sheet=Image.new('RGB',(1500,420*((len(records)+4)//5)), '#142733')
d=ImageDraw.Draw(sheet)
for i,r in enumerate(records):
    im=Image.open(OUT/(r['name']+'.webp'));im.thumbnail((280,370));x=(i%5)*300;y=(i//5)*420
    if r['mode']=='pigment':d.rectangle((x,y,x+299,y+419),fill='#e9d9b8')
    sheet.paste(im,(x+(300-im.width)//2,y+35),im);d.text((x+10,y+10),r['name'],fill='#b29459' if r['mode']!='pigment' else '#342d22')
sheet.save(ROOT/'process/extractions.jpg',quality=92)
# Remove only superseded task-created derivative files with these exact names.
for r in records:
    old=OUT/(r['name']+'.png')
    if old.exists():old.unlink()
print('Extracted',len(records),'documented fragments')
