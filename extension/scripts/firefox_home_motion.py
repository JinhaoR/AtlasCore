"""Home presentation evidence; synthetic UI statuses never enter Core or storage."""
import math, time

def verify(c,h,shot,record,baseline=False):
    def js(script,*args):return c.script(script,*args)
    def pointer(actions):c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'home-mouse','parameters':{'pointerType':'mouse'},'actions':actions}])
    def move(x,y,duration=0):return {'type':'pointerMove','origin':'viewport','x':round(x),'y':round(y),'duration':duration}
    def click(selector):js('document.querySelector(arguments[0]).click();',selector)
    def wheel():return js('''const pin=document.querySelector('#pinned-primary .compass-pin'),r=document.getElementById('compass-handle').getBoundingClientRect();return {pin:pin.style.cssText,svg:document.querySelector('.compass').style.transform,x:r.x+r.width/2,y:r.y+r.height/2};''')
    def geometry():return js('''const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom};};return {heading:rect('.home-intro'),header:rect('.sidebar'),search:rect('#search-form'),launchers:rect('.home-launchers'),access:rect('.home-access-slot'),width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth};''')
    c.call('WebDriver:SetWindowRect',width=1752,height=1202)
    h.wait_for(lambda:js('return !document.getElementById("compass-handle").disabled;'),'compass ready')
    pins=js('return localStorage.getItem("atlas-home-pins-v1");');pages=record();layout=record('current')
    authority=c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    start=geometry();shot('home-empty')
    # A native ring gesture, followed by real animation frames. No synthetic pointer timestamps.
    w=wheel();x,y=w['x'],w['y'];actions=[move(x+118,y),{'type':'pointerDown','button':0}]
    for angle in [15,30,45,60,75]:actions.append(move(x+118*math.cos(math.radians(angle)),y+118*math.sin(math.radians(angle)),30))
    actions.append({'type':'pointerUp','button':0});pointer(actions)
    release=wheel();time.sleep(.35);coast=wheel()
    assert release['pin']!=coast['pin'],'ring should coast after release'
    if not baseline:
        assert release['svg']!=coast['svg'],'compass must turn along with pins'
        assert js('''const pin=document.querySelector('#pinned-primary .compass-pin'),x=parseFloat(pin.style.getPropertyValue('--pin-x')),y=parseFloat(pin.style.getPropertyValue('--pin-y'));const a=parseFloat(document.querySelector('.compass').style.transform.slice(7));const d=((Math.atan2(y,x)*180/Math.PI+90-a)%360+540)%360-180;return Math.abs(d)<.1&&getComputedStyle(pin.querySelector('.service-mark')).transform==='none';''')
    time.sleep(4);settled=wheel();time.sleep(.2);assert settled['pin']==wheel()['pin']
    js('window.__spinMutations=0;window.__spinObserver=new MutationObserver(ms=>window.__spinMutations+=ms.length);window.__spinObserver.observe(document.querySelector(".compass-composition"),{childList:true,subtree:true,attributes:true});window.__spinResources=performance.getEntriesByType("resource").length;')
    time.sleep(2.2)
    idle=js('window.__spinObserver.disconnect();return {mutations:window.__spinMutations,resources:performance.getEntriesByType("resource").length-window.__spinResources};')
    assert idle['mutations']==0,idle
    shot('home-compass-turned')
    # Hold before release: no stale fling. Escape and reduced motion also stop it.
    pointer([move(x+90,y),{'type':'pointerDown','button':0},move(x+60,y+60,150),{'type':'pause','duration':200},{'type':'pointerUp','button':0}])
    held=wheel();time.sleep(.2);assert held['pin']==wheel()['pin']
    pointer([move(x+90,y),{'type':'pointerDown','button':0},move(x+60,y+60,150)])
    c.call('WebDriver:PerformActions',actions=[{'type':'key','id':'escape','actions':[{'type':'keyDown','value':'\ue00c'},{'type':'keyUp','value':'\ue00c'}]}]);pointer([{'type':'pointerUp','button':0}])
    cancelled=wheel();time.sleep(.2);assert cancelled['pin']==wheel()['pin']
    c.call('Marionette:SetContext',value='chrome');c.script('Services.prefs.setIntPref("ui.prefersReducedMotion",1);');c.call('Marionette:SetContext',value='content')
    h.wait_for(lambda:js('return matchMedia("(prefers-reduced-motion: reduce)").matches;'),'reduced motion')
    pointer([move(x+90,y),{'type':'pointerDown','button':0},move(x+60,y+60,150),{'type':'pointerUp','button':0}]);reduced=wheel();time.sleep(.2);assert reduced['pin']==wheel()['pin']
    c.call('Marionette:SetContext',value='chrome');c.script('Services.prefs.clearUserPref("ui.prefersReducedMotion");');c.call('Marionette:SetContext',value='content')
    # Recorded UI-only replies exercise selected-tab coupling without opening external websites.
    js('''window.__homeSend=browser.runtime.sendMessage;window.__homeCount=2;window.__homeUnavailable=false;window.__homeJourneys=false;window.__homeLaunches=[];window.__deadline=Date.now()+600000;
      browser.runtime.sendMessage=async function(m,...rest){
        if(m.kind==='OPEN_DESTINATION'){window.__homeLaunches.push(m);return {opened:true,tabId:700001};}
        const r=await window.__homeSend.call(this,m,...rest);if(m.kind!=='GET_VIEW'||!r.view?.controller)return r;
        if(window.__homeUnavailable)r.view.controller.status='UNAVAILABLE';
        r.view.pendingAccess=Array.from({length:window.__homeCount},(_,i)=>({requestId:900+i,hostnames:['request'+i+'.example'],readyAt:window.__deadline,confirmBy:window.__deadline+60000}));
        r.view.temporaryAccess=[];
        r.view.contexts=[{tabId:700001,contextId:'synthetic-home-context',hostname:'request0.example',navigationId:1,effect:'NONE',retry:null,accessScope:null,latest:{type:'ASSESSMENT',decision:{outcome:'WAIT',reason:'COOLDOWN',requestId:900,target:{hostname:'request0.example'},readyAt:window.__deadline,confirmBy:window.__deadline+60000}},
          journey:window.__homeJourneys?{id:901,rootHostname:'root.example',phase:'IN_TRANSIT',expiresAt:window.__deadline,startedAt:window.__deadline-300000}:null}];return r;};''')
    h.wait_for(lambda:js('return document.querySelectorAll("#pending-access-list li").length===2;'),'two access rows')
    if not baseline:
        assert not js('return !!document.getElementById("show-access") || !!document.getElementById("home-journey");')
        assert js('return document.getElementById("temporary-title").textContent.startsWith("Greylist") && document.getElementById("temporary-count").textContent==="(2)";')
        assert js('''const region=document.querySelector('#temporary-section .home-access-rows').getBoundingClientRect(),rows=[...document.querySelectorAll('#pending-access-list li')].map(e=>e.getBoundingClientRect());return rows.every(r=>r.y>=region.y&&r.bottom<=region.bottom+1);''')
    two=geometry();shot('home-two-greylist')
    click('#pinned-primary .compass-pin')
    if js('return document.getElementById("pin-chooser").matches(":popover-open");'):click('#pin-chooser-pages button')
    h.wait_for(lambda:js('return window.__homeLaunches.length===1;'),'pin activation after rotation')
    if not baseline:
        assert js('return document.body.dataset.mode==="control" && document.getElementById("context").value==="";'),'ordinary launch must not select a Home context'
        after_launch=geometry();assert abs(after_launch['heading']['y']-two['heading']['y'])<1
    js('window.__homeCount=5;')
    h.wait_for(lambda:js('return document.querySelectorAll("#pending-access-list li").length===5;'),'overflow access list')
    five=geometry()
    if not baseline:
        assert two==five,'more requests must not resize Home'
        assert js('const e=document.querySelector("#temporary-section .home-access-rows");return e.scrollHeight>e.clientHeight;')
    shot('home-greylist-overflow')
    # Explicit per-request action still selects its exact owner. Home itself does not.
    click('#pending-access-list button');h.wait_for(lambda:js('return document.body.dataset.mode==="access";'),'request details')
    assert js('return document.getElementById("context").value==="700001";')
    click('#show-home');js('window.__homeJourneys=true;')
    if not baseline:
        h.wait_for(lambda:js('return !document.getElementById("home-journeys-section").hidden && document.querySelectorAll("#other-journeys li").length===1;'),'all journeys visible even if previously selected')
        assert js('return document.getElementById("temporary-count").textContent==="(5)";')
        shot('home-greylist-and-journey')
    js('window.__homeJourneys=false;window.__homeUnavailable=true;')
    h.wait_for(lambda:js('return !document.getElementById("temporary-unavailable").hidden;'),'truthful unavailable summary')
    assert js('return [...document.querySelectorAll("#temporary-section button")].every(b=>b.disabled);')
    js('window.__homeUnavailable=false;');h.wait_for(lambda:js('return document.getElementById("temporary-unavailable").hidden;'),'restored summary')
    sizes=[]
    for width,height,zoom in [(1752,1202,1),(1280,1000,1),(1280,800,1),(1488,1143,1.25),(1488,1143,1.5),(1488,1143,2),(500,900,1)]:
        c.call('WebDriver:SetWindowRect',width=width,height=height)
        c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.browsingContext.fullZoom=arguments[0];',zoom);c.call('Marionette:SetContext',value='content');time.sleep(.2)
        g=geometry();assert g['scroll']<=g['width']+1,g;sizes.append({'zoom':zoom,**g});shot('home-'+str(width)+'-'+str(zoom))
        if not baseline and g['width']>=1200 and g['height']>=900:
            assert js('const e=document.querySelector("main");return e.scrollHeight<=e.clientHeight+1;'),'desktop Home must fit its viewport'
    js('browser.runtime.sendMessage=window.__homeSend;')
    after=c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    for key in ['policy','policyRevision','configuration','configurationRevision']:assert after[key]==authority[key],key
    for key in ['pendingRequests','grants','nextRequestId','policyRevision']:assert after['accessState'][key]==authority['accessState'][key],key
    assert after['accessState']['lastObservedAt']>=authority['accessState']['lastObservedAt']
    assert js('return localStorage.getItem("atlas-home-pins-v1");')==pins and record()==pages and record('current')==layout
    return {'baseline':baseline,'resting':start,'twoRows':two,'fiveRows':five,'rotationTogether':not baseline,'pausedReleaseAndEscapeAndReducedMotion':True,'authorityAndPresentationStoresUnchanged':True,'idleWheel':idle,'viewports':sizes,'limitations':'Headless mouse input; temporary-status and launch replies injected in the UI only.'}
