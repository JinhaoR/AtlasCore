"""Stage A: real Atlas UI in a disposable native Firefox profile.

Only the temporary addon copy receives candidate files. Inline token overrides
below are test instrumentation, not a new application/theme customization API.
"""
from pathlib import Path
import sys, shutil, time, json
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'extension/scripts'))
import firefox_compact_home as harness
import firefox_theme_prototypes as scenario

def verify(c,h,shot):
    def js(s,*args,**kw): return c.script(s,*args,**kw)
    def click(s): js('document.querySelector(arguments[0]).click();',s)
    c.call('WebDriver:SetWindowRect',width=1752,height=1202)
    result={}
    for theme in ['celestial','parchment']:
        js('const e=document.querySelector("#atlas-theme");e.value=arguments[0];e.dispatchEvent(new Event("change",{bubbles:true}));',theme)
        h.wait_for(lambda:js('return document.documentElement.dataset.theme===arguments[0];',theme),'theme',20)
        click('#show-home')
        for variant in ['a','b']:
            name=theme+'-'+variant
            js('''const url=browser.runtime.getURL('ui/themes/studies/'+arguments[0]+'.webp');
              document.documentElement.style.setProperty('--page-home-background',`url("${url}") center / cover no-repeat`);
              document.documentElement.style.setProperty('--compass-field','none');''',name)
            assert js('''const [name,done]=arguments,i=new Image();i.onload=()=>done(true);i.onerror=()=>done(false);
              i.src=browser.runtime.getURL('ui/themes/studies/'+name+'.webp');''',name,asynchronous=True)
            time.sleep(.25);shot(name+'-home')
            result[name]=js('''return {viewport:[innerWidth,innerHeight],background:getComputedStyle(document.body).backgroundImage,
              pins:[...document.querySelectorAll('.compass-pin')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),
              horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1};''')
            assert not result[name]['horizontalOverflow']
    js('document.documentElement.style.removeProperty("--page-home-background");document.documentElement.style.removeProperty("--compass-field");')
    return result

if __name__=='__main__':
    addon=ROOT/'.tools/historical-final/stage-a-addon'
    if addon.exists():raise RuntimeError('Refuse to overwrite existing candidate runtime')
    shutil.copytree(ROOT/'extension/dist',addon)
    shutil.copytree(HERE/'candidates',addon/'ui/themes/studies')
    before=set((ROOT/'.tools').glob('compact-home-native-*'))
    scenario.verify=verify
    sys.argv=[str(__file__),'--theme-prototypes-only','--signed-baseline','0.2.8','--addon-dir',str(addon)]
    try:harness.main()
    finally:
        created=set((ROOT/'.tools').glob('compact-home-native-*'))-before
        assert len(created)==1,created
        run=created.pop();out=HERE/'native-candidates';out.mkdir(exist_ok=True)
        for p in [*run.glob('*.png'),*run.glob('result.json')]:shutil.copy2(p,out/p.name)
        # Remove only the exact task-created, resolved children after evidence.
        assert run.resolve().parent==(ROOT/'.tools').resolve()
        assert addon.resolve().parent==(ROOT/'.tools/historical-final').resolve()
        shutil.rmtree(run);shutil.rmtree(addon)
