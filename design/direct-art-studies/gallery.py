"""Local review gallery and contact sheets; no app integration or remote assets."""
from pathlib import Path
from html import escape
import json
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent

def main():
    cases=json.loads((ROOT/'process/candidates.json').read_text(encoding='utf-8'))
    cards=[]
    for c in cases:
        cards.append(f'''<article id="{c['id']}">
        <div class="caption"><div><span class="number">{c['id'][:2]}</span><h2>{escape(c['title'])}</h2><p class="creator">{escape(c['creator'])}</p></div><a class="full" href="previews/{c['id']}-context.png" target="_blank">Open full size ↗</a></div>
        <a class="art-link" href="previews/{c['id']}-context.png" target="_blank"><img data-art="{c['id']}" src="previews/{c['id']}-context.png" width="1920" height="1200" alt="{escape(c['title'])}: a historical map with the center blurred and static Atlas controls over it"></a>
        <div class="notes"><p>{escape(c['note'])}</p><p><a href="sources/{c['source']}" target="_blank">Full uncropped reproduction</a> · <a href="{escape(c['page'])}" target="_blank" rel="noreferrer">Source &amp; public-domain statement</a><br><span class="detail">Wide-screen crop retains {c['sourceAreaRetainedPercent']}% of source area. No recoloring, collage or generated artwork.</span></p></div></article>''')
    html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas · Whole-artwork studies</title>
    <style>@font-face{font-family:Folio;src:url(reference/cormorant-garamond-normal-latin.woff2)}@font-face{font-family:Interface;src:url(reference/source-sans-3-normal-latin.woff2)}
    *{box-sizing:border-box}body{margin:0;background:#101b23;color:#f1e7d3;font-family:Interface,system-ui,sans-serif}main,header{width:min(1540px,calc(100% - 64px));margin:auto}header{padding:48px 0 28px}h1{font:500 clamp(36px,4vw,58px)/1.05 Folio,serif;margin:12px 0 18px}header p{max-width:850px;color:#c0c7c9;line-height:1.5}.eyebrow{letter-spacing:.16em;color:#c9ad7b;font-size:13px}a{color:#e5c587;text-underline-offset:4px}nav{display:flex;gap:10px;flex-wrap:wrap}nav a{padding:8px 14px;border:1px solid #43515b;border-radius:5px;text-decoration:none}button{font:inherit;padding:10px 20px;border:1px solid #6e7b83;border-radius:5px;color:inherit;background:transparent;cursor:pointer}button[aria-pressed=true]{background:#ecdbb7;color:#27343d;border-color:#ecdbb7}button:focus-visible,a:focus-visible{outline:3px solid #f2c86b;outline-offset:4px}.toolbar{position:sticky;top:0;background:#101b23f5;border-block:1px solid #43515b;padding:14px max(32px,calc((100% - 1540px)/2));z-index:3;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.toolbar span{margin-right:10px;color:#b6c0c5}article{scroll-margin-top:100px;margin:38px 0 64px}.caption{display:flex;align-items:end;justify-content:space-between;gap:24px;padding:0 0 14px}.number{display:inline-block;color:#c9ad7b;margin-right:14px;font-size:15px}h2{display:inline;font:500 36px/1.1 Folio,serif}.creator{margin:8px 0 0 34px;color:#aebbc2}.art-link{display:block;border:1px solid #4d5557;background:#23282b}.art-link img{display:block;width:100%;height:auto}.notes{display:grid;grid-template-columns:1fr 1fr;gap:32px;line-height:1.5;color:#c3c9ca}.detail{color:#97a4aa;font-size:14px}.aside{border-top:1px solid #43515b;padding:28px 0 45px;color:#b8c1c4}footer{padding:0 0 50px;color:#97a4aa;font-size:14px}@media(max-width:700px){header,main{width:calc(100% - 28px)}.toolbar{padding:12px 14px}.toolbar span{display:none}.toolbar button{padding:8px 11px}.notes{display:block}.caption{display:block}.full{display:inline-block;margin-top:14px}h2{font-size:29px}}
    </style><header><div class="eyebrow">ATLAS / INDEPENDENT ART STUDIES / 11 NOVEMBER 2026</div><h1>Let the historical artwork be the background.</h1><p>Four real maps, used as complete source images. The only background treatment is a wide-screen crop and a feathered blur behind the search and compass. No extracted figures, new scenery, recoloring or AI-generated imagery.</p><nav>'''
    html+=''.join(f'<a href="#{c["id"]}">{c["id"][:2]} · {escape(c["creator"].split(" · ")[0])}</a>' for c in cases)
    html+='''</nav></header><div class="toolbar"><span>Compare the same crop:</span><button type="button" data-mode="fitted" aria-pressed="false">Original artwork</button><button type="button" data-mode="softened" aria-pressed="false">Center softened</button><button type="button" data-mode="context" aria-pressed="true">With Atlas</button></div><main>'''+''.join(cards)
    html+='''<section class="aside"><h2>Also considered</h2><p><a href="sources/vlasbloem-1675.jpg" target="_blank">Van Keulen / Vlasbloem’s Stellatum Planisphaerium (1675)</a> has excellent constellation engravings. I did not force it into a fifth background: its tall proportions would lose roughly a quarter of the composition in this viewport, including much of the title and lower ornament. <a href="https://commons.wikimedia.org/wiki/File:1675_double_hemisphere_celestial_chart_by_Louis_Vlasbloem.jpg" target="_blank" rel="noreferrer">Source and public-domain record</a>.</p></section><footer>Static visual studies, not extension screenshots. Six neutral shortcut icons indicate placement; no real bookmarks, site access or navigation are represented. Existing compass reference art and locally bundled fonts are retained. See SOURCES.md and README.md for rights and processing details.</footer></main>
    <script>document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{const mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-art]').forEach(img=>{const id=img.dataset.art,path=mode==='context'?`previews/${id}-context.png`:`${mode}/${id}.jpg`;img.src=path;img.alt=`${id}: ${mode==='context'?'softened historical artwork with static Atlas controls':mode==='softened'?'historical artwork with center-only blur':'unsoftened historical artwork, cropped to viewport'}`;img.closest('article').querySelectorAll('.art-link,.full').forEach(a=>a.href=path)});}));</script></html>'''
    (ROOT/'index.html').write_text(html,encoding='utf-8')
    if not all((ROOT/'previews'/f'{c["id"]}-context.png').exists() for c in cases):return
    # Four fair, equally sized comparisons. Full-size art remains separately available.
    font_path=Path(r'C:\Windows\Fonts\georgia.ttf')
    font=ImageFont.truetype(str(font_path),23)
    small=ImageFont.truetype(str(font_path),16)
    for mode in ['context','softened']:
        sheet=Image.new('RGB',(1800,1280),'#101b23');d=ImageDraw.Draw(sheet)
        for i,c in enumerate(cases):
            p=ROOT/'previews'/f'{c["id"]}-context.png' if mode=='context' else ROOT/'softened'/f'{c["id"]}.jpg'
            im=Image.open(p).convert('RGB').resize((876,548),Image.Resampling.LANCZOS)
            x=12+(i%2)*900;y=62+(i//2)*640;sheet.paste(im,(x,y))
            d.text((x,y-50),c['id'][:2]+'  '+c['title'],font=font,fill='#f2e4c4')
            d.text((x,y-23),c['creator'],font=small,fill='#b7bec0')
        sheet.save(ROOT/('comparison.jpg' if mode=='context' else 'backgrounds.jpg'),quality=94,subsampling=0)

if __name__=='__main__':main()
