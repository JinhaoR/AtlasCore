"""Build a local art-review gallery and contact sheets; check protected files."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import hashlib,json,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[1]
studies=[('01-astronomers-court','The Astronomer’s Court','Celestial','Engraved figures, constellation margins and a deep blue working field.'),('02-celestial-cabinet','The Celestial Cabinet','Celestial','Star-chart wings and an instrument-maker’s engraved brass details.'),('03-pilots-vellum','The Pilot’s Vellum','Parchment','Manuscript coasts, open sea, colored bearings and Blaeu’s sailing ships.'),('04-blaeus-sea-atlas','Blaeu’s Sea Atlas','Parchment','A richly illustrated folio of planetary figures and antique ornament.')]
font=ImageFont.truetype('C:/Windows/Fonts/georgia.ttf',22)
small=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',14)
for context,output in [(True,'comparison.jpg'),(False,'backgrounds.jpg')]:
    sheet=Image.new('RGB',(1920,1352),'#e4e0d7');d=ImageDraw.Draw(sheet)
    for i,(slug,title,theme,desc) in enumerate(studies):
        p=ROOT/('previews' if context else 'compositions')/(slug+('-context' if context else '')+'.png')
        im=Image.open(p).convert('RGB').resize((960,600),Image.Resampling.LANCZOS)
        x=(i%2)*960;y=(i//2)*676;sheet.paste(im,(x,y))
        d.text((x+22,y+612),f'{i+1:02}  {title}',font=font,fill='#272e31')
        d.text((x+22,y+645),theme+' — '+desc,font=small,fill='#5b5e5b')
    sheet.save(ROOT/output,quality=94)

cards=[]
for slug,title,theme,desc in studies:
    cards.append(f'''<article><div class="caption"><span>{theme}</span><h2>{title}</h2><p>{desc}</p></div>
      <a class="art-link" href="previews/{slug}-context.png" target="_blank"><img width="1920" height="1200" loading="lazy" src="previews/{slug}-context.png" data-slug="{slug}" alt="{title} composition with a static Atlas overlay"></a>
      <footer><a href="compositions/{slug}.png" target="_blank">Background PNG</a><a href="compositions/{slug}.svg" target="_blank">Layered SVG</a><a href="previews/{slug}-context.png" target="_blank">Context preview</a></footer></article>''')
html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas · Background studies</title>
<style>*{box-sizing:border-box}body{margin:0;background:#e4e0d7;color:#263038;font:16px/1.5 system-ui,sans-serif}header{padding:40px 4vw 26px;border-bottom:1px solid #b8b4aa}h1{font:44px Georgia,serif;margin:5px 0 12px}header p{max-width:820px;margin:0 0 20px}small,.caption>span{text-transform:uppercase;letter-spacing:.13em;font-size:12px}nav{display:flex;align-items:center;gap:20px;flex-wrap:wrap}button{background:#20323e;border:0;border-radius:4px;color:#fff;padding:12px 18px;font:inherit;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #bd7726;outline-offset:4px}a{color:#354b54}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:36px;padding:30px 4vw 50px}article{min-width:0}.caption{min-height:128px}h2{font:28px Georgia,serif;margin:6px 0}.caption p{margin:0 0 18px;color:#5c625f}img{width:100%;height:auto;display:block;box-shadow:0 8px 24px #24313a20}footer{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;padding-top:14px}.note{padding:0 4vw 40px;max-width:1000px;color:#5c625f}@media(max-width:900px){main{grid-template-columns:1fr}.caption{min-height:0}h1{font-size:34px}}</style>
<header><small>Atlas · Independent art studies · 11 November 2026</small><h1>Four ways to navigate.</h1><p>Actual historical engravings, coastal fragments and ornament, composed as standalone artwork. Compare the backgrounds on their own, or with the same static instrument overlay.</p><nav><button id="toggle" aria-pressed="true">Showing: Atlas context</button><a href="comparison.jpg" target="_blank">Four-way comparison</a><a href="SOURCES.md">Sources & rights</a></nav></header><main>'''+''.join(cards)+'''</main><p class="note">The overlay is a static composition study with neutral specimen shortcuts, not a working extension or a claim about final UI layout. The existing application and both approved compass assets are unchanged. All images and fonts are local; no generative imagery was used.</p>
<script>let context=true;document.getElementById('toggle').onclick=function(){context=!context;this.setAttribute('aria-pressed',String(context));this.textContent=context?'Showing: Atlas context':'Showing: Background only';for(const im of document.querySelectorAll('img[data-slug]')){im.src=(context?'previews/':'compositions/')+im.dataset.slug+(context?'-context':'')+'.png';im.parentElement.href=im.src;im.alt=im.dataset.slug+(context?' with static Atlas context':' background only');}};</script></html>'''
(ROOT/'index.html').write_text(html,encoding='utf-8')

before=json.loads((ROOT/'process/protected-before.json').read_text())
changed=[p for p,digest in before.items() if not (REPO/p).is_file() or hashlib.sha256((REPO/p).read_bytes()).hexdigest()!=digest]
current={str(p.relative_to(REPO)) for d in ['extension','packages/core'] for p in (REPO/d).rglob('*') if p.is_file() and not any(s in p.parts for s in ['node_modules','.git'])}
added=sorted(current-set(before))
assert not changed and not added,(changed,added)
svgs=list((ROOT/'compositions').glob('*.svg'))+list((ROOT/'previews').glob('*-context.svg'))
for p in svgs:
    tree=ET.parse(p)
    for node in tree.iter():
        assert node.tag.split('}')[-1] not in ('script','foreignObject')
        for key,value in node.attrib.items():
            if key.split('}')[-1]=='href':assert value.startswith('data:'),(p,value)
    assert Image.open(p.with_suffix('.png')).size==(1920,1200)
assets={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for d in ['compositions','previews','sources','reference'] for p in (ROOT/d).glob('*') if p.is_file()}
(ROOT/'process/integrity.json').write_text(json.dumps({'protectedFiles':len(before),'changed':changed,'added':added,'releaseFiles':sum(1 for p in before if 'release' in Path(p).parts),'selfContainedSvgs':len(svgs),'rasterSize':[1920,1200],'hashes':assets},indent=2))
print(json.dumps({'protectedUnchanged':len(before),'releaseFilesUnchanged':sum(1 for p in before if 'release' in Path(p).parts),'svgValidated':len(svgs),'totalMiB':round(sum(p.stat().st_size for p in ROOT.rglob('*') if p.is_file())/1048576,1)}))
