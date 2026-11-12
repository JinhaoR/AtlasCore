"""Visual prototypes in disposable Firefox; no theme-specific application code."""
import math,time
from firefox_themes import capture

def verify(c,h,shot):
    def js(code,*args,**kwargs):return c.script(code,*args,**kwargs)
    def click(s):js('document.querySelector(arguments[0]).click();',s)
    def wait(code,label):h.wait_for(lambda:js(code),label,25)
    def choose(theme):js('const e=document.querySelector("#atlas-theme");e.value=arguments[0];e.dispatchEvent(new Event("change",{bubbles:true}));',theme)
    result={}
    for theme in ['celestial','parchment']:
        choose(theme);wait('return document.documentElement.dataset.theme===arguments[0];'.replace('arguments[0]',repr(theme)),'selected theme')
        c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'theme-pin','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','origin':'viewport','x':40,'y':80,'duration':0}]}])
        click('#show-sites');click('#sites-categories-back');click('#show-home')
        result[theme]=capture(c,h,shot,theme)
        home_art=js('return getComputedStyle(document.body).backgroundImage;')
        click('#show-sites')
        directory_art=js('return getComputedStyle(document.body).backgroundImage;')
        assert home_art!=directory_art and 'historical-home.webp' in home_art and 'historical-workspace.webp' in directory_art
        click('#show-home')
        result[theme]['pageSpecificArtwork']=True
        result[theme]['crops']=[]
        for width,height in [(1366,900),(2560,1440)]:
            c.call('WebDriver:SetWindowRect',width=width,height=height);time.sleep(.2)
            crop=js('return {viewport:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth>innerWidth+1};')
            assert not crop['overflow'],crop
            result[theme]['crops'].append(crop);shot(theme+'-home-'+str(width))
        c.call('WebDriver:SetWindowRect',width=1752,height=1202);time.sleep(.2)
        # Assets resolve within the bundle, including CSS background artwork on the SVG.
        assets=js('''return [getComputedStyle(document.body).backgroundImage,
          getComputedStyle(document.querySelector('#pin-compass')).backgroundImage,
          getComputedStyle(document.querySelector('.home-intro img')).content,
          getComputedStyle(document.querySelector('.compass-composition'),'::before').backgroundImage,
          getComputedStyle(document.querySelector('.home-launchers'),'::before').backgroundImage];''')
        result[theme]['assets']=assets
        assert all('https:' not in x for x in assets),assets
        if theme=='parchment':assert 'rose.svg' in assets[1] and 'mark.svg' in assets[2],assets
        # Load referenced local images explicitly to distinguish a painted background from a broken URL.
        for declaration in [*assets,directory_art]:
            import re
            for url in re.findall(r'url\("([^"]+)"\)',declaration):
                assert js('const [url,done]=arguments,i=new Image();i.onload=()=>done(i.naturalWidth>0);i.onerror=()=>done(false);i.src=url;',url,asynchronous=True),url
        assert js('return [...document.querySelectorAll(".compass-pin")].every(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});')
        positions=js('const p=document.querySelector(".compass-composition").getBoundingClientRect();return [...document.querySelectorAll(".compass-pin")].map(e=>{const r=e.getBoundingClientRect();return [r.x-p.x,r.y-p.y,r.width,r.height];});')
        result[theme]['pinGeometry']=positions
        # Decorative bearings share the actual compass center, and cannot catch
        # pointer input or cause overflow. No layout/rotation owner is involved.
        field=js('''const f=document.querySelector('.home-launchers'),c=document.querySelector('.compass-composition');
          const a=f.getBoundingClientRect(),b=c.getBoundingClientRect(),s=getComputedStyle(f,'::before');
          return {dx:Math.abs(a.x+a.width/2-b.x-b.width/2),dy:Math.abs(a.y+a.height/2-b.y-b.height/2),pointerEvents:s.pointerEvents,overflow:document.documentElement.scrollWidth>innerWidth+1};''')
        assert field['dx']<1 and field['dy']<1 and field['pointerEvents']=='none' and not field['overflow'],field
        result[theme]['centeredField']=field
        js('const e=document.querySelector("#destination-search");e.value="github";e.dispatchEvent(new Event("input",{bubbles:true}));')
        wait('return !!document.querySelector("#search-results button");','search results');shot(theme+'-search')
        js('const e=document.querySelector("#destination-search");e.value="";e.dispatchEvent(new Event("input",{bubbles:true}));')
        click('#show-sites');click('.site-row');wait('return document.querySelector("#sites-editor").open;','dialog');click('#edit-site');shot(theme+'-editor')
        click('#cancel-site-draft');wait('return !document.querySelector("#sites-editor").open;','closed editor')
        js('window.__confirm=window.confirm;window.confirm=()=>true;document.querySelector("#discard-destination-draft").click();window.confirm=window.__confirm;')
        click('#show-settings');click('#show-vault');shot(theme+'-vault');click('#show-home')
        # Paint-only state samples use actual app classes, no fake permission transitions.
        # Pause the existing visible-page refresh while synthetic DOM samples are
        # photographed; otherwise an unrelated authoritative read can erase them.
        js('Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));')
        js('''const s=document.querySelector('#temporary-section');s.hidden=false;
          document.querySelector('#temporary-empty').hidden=true;document.querySelector('#temporary-unavailable').hidden=true;
          document.querySelector('#pending-access-list').innerHTML=['waiting','active'].map((tone,i)=>`<li class="temporary-row"><div class="temporary-copy"><strong class="temporary-name">${i?'Reference library':'Research forum'}</strong><span class="temporary-scope">example.localhost</span></div><div class="temporary-actions"><button class="access-cancel">Cancel</button><button class="access-signal" data-tone="${tone}">${i?'Active':'Waiting'} &middot; 12:30</button></div></li>`).join('');''')
        assert js('return document.querySelector("#temporary-section").getBoundingClientRect().height>0;')
        shot(theme+'-greylist')
        c.call('WebDriver:SetWindowRect',width=540,height=900);time.sleep(.3)
        assert js('return getComputedStyle(document.querySelector(".compass-composition"),"::before").content==="none" && getComputedStyle(document.querySelector(".home-launchers"),"::before").content==="none" && getComputedStyle(document.querySelector(".compass-pin")).boxShadow==="none";')
        assert js('return document.documentElement.scrollWidth<=innerWidth+1;');shot(theme+'-narrow')
        c.call('WebDriver:SetWindowRect',width=1752,height=1202)
        c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=2;');c.call('Marionette:SetContext',value='content');time.sleep(.3)
        assert js('return document.documentElement.scrollWidth<=innerWidth+1;');shot(theme+'-zoom-200')
        c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=1;');c.call('Marionette:SetContext',value='content')
        c.call('WebDriver:Refresh');wait('return !!document.querySelector(".compass-pin:not(:disabled)");','reload pins')
        assert js('return document.documentElement.dataset.theme;')==theme
        assert js('return window.__firstThemeFrame;')==theme
        result[theme]['firstReloadFrame']=js('return {theme:window.__firstThemeFrame,base:window.__firstThemeBackground,artwork:window.__firstThemeBodyBackground};')
        # Actual pointer activation still reaches the ordinary gated launch command.
        original=c.call('WebDriver:GetWindowHandle');handles=c.call('WebDriver:GetWindowHandles')
        js('''window.__pinLaunch=0;window.__pinSend=browser.runtime.sendMessage;
          browser.runtime.sendMessage=async function(m,...a){const r=await window.__pinSend.call(this,m,...a);
          if(m.kind==='OPEN_DESTINATION'&&m.url==='https://github.com/')window.__pinLaunch++;return r;};''')
        x,y=js('const r=document.querySelector(\'[data-destination-id="service:github.com"]\').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];')
        c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'theme-pin','parameters':{'pointerType':'mouse'},'actions':[
          {'type':'pointerMove','origin':'viewport','x':round(x),'y':round(y),'duration':0},
          {'type':'pointerDown','button':0},{'type':'pointerUp','button':0}]}])
        wait('return window.__pinLaunch===1;','gated pin launch')
        for handle in c.call('WebDriver:GetWindowHandles'):
            if handle not in handles:c.call('WebDriver:SwitchToWindow',handle=handle);c.call('WebDriver:CloseWindow')
        c.call('WebDriver:SwitchToWindow',handle=original)
        js('browser.runtime.sendMessage=window.__pinSend;')
        result[theme]['gatedPointerLaunch']=True
    assert result['celestial']['pinGeometry']==result['parchment']['pinGeometry']
    # Warm switch: style only, retaining search, pins, SVG and focus. No new messages.
    js('''window.__themeCounts={messages:[],nodes:0,fetches:0,imageAssignments:0};
      window.__themeFetch=window.fetch;window.fetch=function(...a){window.__themeCounts.fetches++;return window.__themeFetch.apply(this,a);};
      window.__themeSrc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
      Object.defineProperty(HTMLImageElement.prototype,'src',{...window.__themeSrc,set(v){window.__themeCounts.imageAssignments++;window.__themeSrc.set.call(this,v);}});
      window.__savedPins=[...document.querySelectorAll('.compass-pin')];window.__savedSvg=document.querySelector('#pin-compass');
      window.__themeObserve=new MutationObserver(ms=>window.__themeCounts.nodes+=ms.filter(m=>m.type==='childList').length);
      window.__themeObserve.observe(document.querySelector('#destinations'),{subtree:true,childList:true});
      window.__themeSend=browser.runtime.sendMessage;browser.runtime.sendMessage=function(m,...args){window.__themeCounts.messages.push(m.kind);return window.__themeSend.call(this,m,...args);};''')
    # One browser task and its microtask checkpoint isolate the theme transaction
    # from the independent visible-page refresh timer. Waiting two animation frames
    # incorrectly attributed an ambient PRESENTATION_READ to a theme selection.
    c.script('''const done=arguments[0],e=document.querySelector('#atlas-theme');
      for(const id of ['celestial','parchment']){e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));}
      queueMicrotask(()=>{window.__themeCounts.nodes+=window.__themeObserve.takeRecords().filter(m=>m.type==='childList').length;
        window.__themeObserve.disconnect();browser.runtime.sendMessage=window.__themeSend;
        window.fetch=window.__themeFetch;Object.defineProperty(HTMLImageElement.prototype,'src',window.__themeSrc);done(true);});''',asynchronous=True)
    measured=js('''window.__themeObserve.disconnect();browser.runtime.sendMessage=window.__themeSend;
      window.fetch=window.__themeFetch;Object.defineProperty(HTMLImageElement.prototype,'src',window.__themeSrc);
      return {...window.__themeCounts,
        retained:window.__savedPins.every(n=>n.isConnected)&&window.__savedSvg===document.querySelector('#pin-compass')};''')
    assert measured['nodes']==0 and measured['messages']==[] and measured['fetches']==0 and measured['imageAssignments']==0 and measured['retained'],measured
    result['warmSwitch']=measured
    # The ornament and replacement rose must not intercept drag or pin clicks.
    x,y=js('const r=document.querySelector("#compass-handle").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];')
    start=js('return getComputedStyle(document.querySelector("#pin-compass")).transform;')
    move=lambda angle:{'type':'pointerMove','origin':'viewport','x':round(x+100*math.cos(angle)),'y':round(y+100*math.sin(angle)),'duration':40}
    c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'theme-drag','parameters':{'pointerType':'mouse'},'actions':[move(0),{'type':'pointerDown','button':0},move(.5),move(1),move(1.5),{'type':'pointerUp','button':0}]}])
    assert js('return getComputedStyle(document.querySelector("#pin-compass")).transform;')!=start
    result['nativeRotation']=True
    time.sleep(4.2)
    return result
