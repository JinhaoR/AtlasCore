"""Home geometry and real pointer hit-testing in a disposable Firefox profile."""
import time


def verify(c,h,shot,baseline=False,pins=None):
    def js(code,*args):return c.script(code,*args)
    def pointer(actions):c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'hierarchy-mouse','parameters':{'pointerType':'mouse'},'actions':actions}])
    def move(x,y,duration=0):return {'type':'pointerMove','origin':'viewport','x':round(x),'y':round(y),'duration':duration}
    def click(selector):
        x,y=js('const r=document.querySelector(arguments[0]).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];',selector)
        pointer([move(x,y),{'type':'pointerDown','button':0},{'type':'pointerUp','button':0}])
    def key(value):c.call('WebDriver:PerformActions',actions=[{'type':'key','id':'hierarchy-keys','actions':[{'type':'keyDown','value':value},{'type':'keyUp','value':value}]}])
    def measure():return js('''const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
      const nav=document.querySelector('#category-shortcuts'),nr=nav.getBoundingClientRect();
      return {viewport:[innerWidth,innerHeight],width:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,
        panel:rect(document.querySelector('.home-launchers')),wheel:rect(document.querySelector('.compass-composition')),
        greylist:rect(document.querySelector('.home-access-box')),categoryRows:[...nav.children].map(e=>rect(e)),
        clippedRows:[...nav.children].filter(e=>{const r=e.getBoundingClientRect();return r.top<nr.bottom-1&&r.bottom>nr.top+1&&(r.top<nr.top-1||r.bottom>nr.bottom+1);}).length,
        pins:[...document.querySelectorAll('#pinned-primary .compass-pin')].map(e=>rect(e))};''')
    h.wait_for(lambda:js('return !!document.querySelector(".compass-pin:not(:disabled)");'),'enabled pins')
    hits=js('''return [...document.querySelectorAll('.compass-pin')].map(b=>{
      const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {id:b.dataset.destinationId,hit:hit?.id||hit?.className,works:b.contains(hit)};});''')
    shot('home-before' if baseline else 'home-after')
    if baseline:
        assert any(not p['works'] for p in hits),hits
        return {'pinHits':hits}
    assert all(p['works'] for p in hits),hits
    original=c.call('WebDriver:GetWindowHandle')
    # Observe the real command, without stubbing the gate or its response.
    js('window.__launches=[];window.__completed=0;window.__send=browser.runtime.sendMessage;browser.runtime.sendMessage=async function(m,...a){if(m.kind==="OPEN_DESTINATION")window.__launches.push(m.url);const result=await window.__send.call(this,m,...a);if(m.kind==="OPEN_DESTINATION")window.__completed++;return result;};')
    click('[data-destination-id="service:github.com"]')
    h.wait_for(lambda:js('return window.__completed===1;'),'real pointer launch completed')
    assert js('return window.__launches[0];')=='https://github.com/'
    c.call('WebDriver:SwitchToWindow',handle=original)
    # Grouped bookmark choice must also receive a pointer, then use the same gate.
    folder=c.script("""const done=arguments[0];(async()=>{
      const f=await browser.bookmarks.create({parentId:'toolbar_____',title:'Research pages'});
      await browser.bookmarks.create({parentId:f.id,title:'Unlisted note',url:'https://unlisted.localhost/note?q=1#section'});
      done(f.id);})().catch(e=>done({error:e.name}));""",asynchronous=True)
    group=f'[data-destination-id="folder:{folder}"]'
    h.wait_for(lambda:js('return !!document.querySelector(arguments[0]);',group),'folder')
    click(group);h.wait_for(lambda:js('return document.querySelector("#pin-chooser").matches(":popover-open");'),'pointer chooser')
    shot('folder-chooser');key('\ue00c')
    assert js('return document.activeElement===document.querySelector(arguments[0]);',group)
    key('\ue007');h.wait_for(lambda:js('return document.querySelector("#pin-chooser").matches(":popover-open");'),'keyboard chooser')
    click('#pin-chooser-pages button')
    h.wait_for(lambda:js('return window.__completed===2;'),'exact folder launch completed')
    c.call('WebDriver:SwitchToWindow',handle=original)
    assert js('return window.__launches[1];')=='https://unlisted.localhost/note?q=1#section'
    key('\ue00c')
    c.script('const [id,done]=arguments;browser.bookmarks.removeTree(id).then(()=>done(true));',folder,asynchronous=True)
    h.wait_for(lambda:js('return !document.querySelector(arguments[0]);',group),'folder removed')
    # Empty ring areas still reach the handle; spinning must not launch a pin.
    x,y=js('const r=document.querySelector("#compass-handle").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];')
    pointer([move(x+80,y),{'type':'pointerDown','button':0},move(x,y+80,180),{'type':'pointerUp','button':0}])
    assert js('return parseFloat(document.querySelector(".compass-composition").style.getPropertyValue("--wheel-angle"))!==0;')
    pointer([move(10,10)]);time.sleep(4.2)
    assert len(js('return window.__launches;'))==2
    assert js('return [...document.querySelectorAll(".compass-pin")].every(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});'),'hit targets after coast'
    dimensions=[]
    for width,height,zoom in [(1920,1080,1),(1440,900,1),(1100,800,1),(800,750,1),(500,750,1),(1440,900,1.25),(1440,900,2)]:
        c.call('WebDriver:SetWindowRect',width=width,height=height+85)
        c.call('Marionette:SetContext',value='chrome');c.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,arguments[0]);',zoom);c.call('Marionette:SetContext',value='content')
        time.sleep(.2);m=measure()
        assert m['width']<=m['client']+1,(width,zoom,m)
        assert m['clippedRows']==0,(width,zoom,m)
        dimensions.append(m);shot(f'home-{width}-{height}-zoom-{zoom}')
    c.call('Marionette:SetContext',value='chrome');c.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,1);');c.call('Marionette:SetContext',value='content')
    c.call('WebDriver:SetWindowRect',width=1440,height=985)
    capacities=[]
    for count in [0,1,6,8,10,12]:
        pins(count);h.wait_for(lambda:js('return document.querySelectorAll("#pinned-primary .compass-pin").length===arguments[0];',min(count,10)),'pin count')
        m=measure();boxes=m['pins']
        for i,a in enumerate(boxes):
            for b in boxes[i+1:]:assert not(a['x']<b['x']+b['w'] and a['x']+a['w']>b['x'] and a['y']<b['y']+b['h'] and a['y']+a['h']>b['y']),(count,a,b)
        capacities.append({'count':count,'geometry':m});shot(f'pins-{count}')
    pins(6)
    # Presentation-only stress fixtures: no saved category or authority changes.
    stress=[]
    js('window.__categoryChildren=[...document.querySelector("#category-shortcuts").children];')
    for count in [2,30]:
        js('''const n=document.querySelector('#category-shortcuts');n.replaceChildren(...Array.from({length:arguments[0]},(_,i)=>{
          const row=window.__categoryChildren[i%window.__categoryChildren.length].cloneNode(true);
          if(i===0)row.querySelector('span').textContent='A very long custom category name for research and reading';return row;}));''',count)
        m=measure();assert m['clippedRows']==0 and m['width']<=m['client']+1
        stress.append({'categories':count,'geometry':m});shot(f'categories-{count}')
    js('document.querySelector("#category-shortcuts").replaceChildren(...window.__categoryChildren);')
    # Browse a large category, return, and retain the stationary panel geometry.
    before=measure()['panel']
    click('.category-shortcut:nth-child(2)');shot('category-open')
    assert measure()['panel']==before
    assert js('return [...document.querySelectorAll("#category-workspace .service-group:not([hidden]) .destination-card")].every(e=>e.getBoundingClientRect().width>=250);'),'readable category results'
    js('document.querySelector("#close-category-workspace").click();')
    assert measure()['panel']==before
    # Keyboard reaches scrolled categories without altering their saved order.
    js('document.querySelector(".category-shortcut:last-child").focus();')
    assert js('return document.querySelector("#category-shortcuts").scrollTop>0&&document.activeElement.matches(".category-shortcut");')
    js('document.querySelector(".category-shortcut").focus();document.querySelector("#category-shortcuts").scrollTop=0;')
    # Reuse real waiting/confirmation/termination checks for Greylist and the flash.
    from firefox_greylist_controls import verify as greylist
    controls=greylist(c,h,shot)
    # Two genuine pending requests; the second is reachable in the bounded strip.
    for host in ['grey.localhost','second.localhost']:
        tab=c.message({'kind':'OPEN_DESTINATION','url':f'http://{host}/'})['tabId']
        c.call('WebDriver:SwitchToWindow',handle=original)
        c.message({'kind':'PREPARE_ACCESS','tabId':tab})
        def scope():
            contexts=c.message({'kind':'GET_VIEW'})['view']['contexts']
            return next((x.get('accessScope') for x in contexts if x['tabId']==tab and x.get('accessScope',{}).get('status')=='READY'),None)
        prepared=h.wait_for(scope,'prepared scope')
        c.message({'kind':'START_ACCESS','tabId':tab,'scopeId':prepared['id']})
    h.wait_for(lambda:js('return document.querySelectorAll("#pending-access-list li").length===2;'),'multiple request rows')
    shot('multiple-greylist')
    js('document.querySelector("#pending-access-list li:last-child .access-cancel").focus();')
    assert js('return document.querySelector(".home-access-rows").scrollTop>0;')
    shot('multiple-greylist-scrolled')
    return {'pinHits':hits,'pointerSingleLaunch':True,'pointerFolderLaunch':True,'keyboardChooser':True,'rotation':True,'dimensions':dimensions,'capacities':capacities,'categoryStress':stress,'categoryGeometryStable':True,'multipleGreylistScrollable':True,'controls':controls}
