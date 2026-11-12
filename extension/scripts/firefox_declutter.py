"""Native category/compass checks, using only disposable synthetic presentation data."""
import math, time

def verify(c,h,shot,record,baseline=False):
    def js(s,*args):return c.script(s,*args)
    def pointer(actions):c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'declutter-mouse','parameters':{'pointerType':'mouse'},'actions':actions}])
    def move(x,y,d=0):return {'type':'pointerMove','origin':'viewport','x':round(x),'y':round(y),'duration':d}
    c.call('WebDriver:SetWindowRect',width=1752,height=1202)
    h.wait_for(lambda:js('return !document.getElementById("compass-handle").disabled;'),'wheel')
    # Each shortcut has two real bookmark pages, so hover chooser behavior is exercised.
    ids=js('return [...document.querySelectorAll("#pinned-primary .compass-pin")].map(e=>e.dataset.destinationId);')
    old=record();value={'revision':(old or {}).get('revision',0)+1,'value':{'version':1,'groups':[{'parentId':i,'pages':[{'id':'one','label':'Home','url':'https://'+i.split(':',1)[1]+'/'},{'id':'two','label':'Second page','url':'https://'+i.split(':',1)[1]+'/second'}]} for i in ids]}}
    c.script('const [value,done]=arguments,q=indexedDB.open("atlas-home-layout-v1",1);q.onsuccess=()=>{const db=q.result,t=db.transaction("layout","readwrite");t.objectStore("layout").put(value,"bookmarks-v1");t.oncomplete=()=>{db.close();done(true);};};',value,asynchronous=True)
    c.call('WebDriver:Refresh');h.wait_for(lambda:js('return document.querySelectorAll("#pinned-primary [aria-haspopup]").length===6;'),'grouped pins')
    r=js('const r=document.getElementById("compass-handle").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};');x,y=r['x'],r['y']
    # Hover the ring while it coasts: sample native hit-testing, label visibility and popovers.
    js('''window.__wheelSamples=[];window.__wheelStart=performance.now();const sample=t=>{const e=document.querySelector('.compass-composition');window.__wheelSamples.push({t,angle:document.querySelector('#pin-compass').style.transform,moving:e.dataset.moving??null,popover:document.getElementById('pin-chooser').matches(':popover-open'),labels:[...document.querySelectorAll('#pinned-primary .pin-label')].filter(l=>getComputedStyle(l).visibility==='visible').length});if(t-window.__wheelStart<5500)requestAnimationFrame(sample);};requestAnimationFrame(sample);''')
    a=[move(x+106,y-40),{'type':'pointerDown','button':0}]
    for angle in [0,15,30,45,60]:a.append(move(x+110*math.cos(math.radians(angle)),y+110*math.sin(math.radians(angle)),40))
    a.append({'type':'pointerUp','button':0})
    for offset in [1,4,7,10,13,16,19,22,25,28,31,34,37,40,43]:a.append(move(x+134,y+offset,90))
    pointer(a);time.sleep(3.5);shot('wheel-hover');time.sleep(2)
    samples=js('return window.__wheelSamples;');moving=[p for i,p in enumerate(samples[1:],1) if p['angle']!=samples[i-1]['angle'] and p['moving']!='false']
    issue={'labelsDuringMovement':sum(p['labels']>0 for p in moving),'popoverDuringMovement':sum(p['popover'] for p in moving),'movingFrames':len(moving)}
    if not baseline:assert issue['labelsDuringMovement']==0 and issue['popoverDuringMovement']==0,issue
    js('if(document.getElementById("pin-chooser").matches(":popover-open"))document.getElementById("pin-chooser").hidePopover();')
    pointer([move(5,5)])
    # Find the large category without depending on its display spelling.
    js('const a=[...document.querySelectorAll(".category-shortcut")].find(e=>/Research/.test(e.textContent));if(a)a.click();')
    time.sleep(.6)
    category=js('const g=[...document.querySelectorAll(".service-group")].find(e=>!e.hidden);return g?{count:g.querySelectorAll(".destination-card").length,hidden:[...g.querySelector(".destination-grid").children].filter(e=>e.hidden).length,toggles:g.querySelectorAll(".category-toggle").length}:null;')
    if not baseline:assert category and category['hidden']==0 and category['toggles']==0,category
    shot('category-all-sites')
    if baseline:return {'baseline':True,'wheel':issue,'category':category,'samples':samples}
    saved_layout=record('current')
    js('''document.getElementById("show-settings").click();document.querySelector('[data-settings-panel="home-settings"]').click();''')
    h.wait_for(lambda:js('return !!document.querySelector(".category-icon-choice:not(:disabled)");'),'icon settings')
    js('document.querySelector(".category-icon-choice").click();')
    assert js('return document.querySelectorAll(".category-icon-picker .icon-option").length;')==29
    shot('icon-picker')
    js('''document.querySelector('.category-icon-picker [data-icon="brain"]').click();''')
    h.wait_for(lambda:(r:=record('category-icons-v1')) and any(e['icon']=='brain' for e in r['value']['entries']),'saved brain icon')
    c.call('WebDriver:Refresh');h.wait_for(lambda:js('''return !!document.querySelector('.category-icon-choice use[href="#icon-brain"]');'''),'brain icon reload')
    viewports=[]
    for width,height,zoom in [(1280,900,1.25),(1280,900,2),(500,900,1)]:
        c.call('WebDriver:SetWindowRect',width=width,height=height)
        c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.browsingContext.fullZoom=arguments[0];',zoom);c.call('Marionette:SetContext',value='content')
        js('document.querySelector(".category-icon-choice").click();')
        box=js('const r=document.querySelector(".category-icon-picker").getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right,width:innerWidth,height:innerHeight};')
        assert box['bottom']<=box['height'] and box['right']<=box['width'],box
        c.call('WebDriver:PerformActions',actions=[{'type':'key','id':'picker-key','actions':[{'type':'keyDown','value':'\ue010'},{'type':'keyUp','value':'\ue010'}]}])
        assert js('return document.activeElement.dataset.icon;')=='film'
        c.call('WebDriver:PerformActions',actions=[{'type':'key','id':'picker-key','actions':[{'type':'keyDown','value':'\ue00c'},{'type':'keyUp','value':'\ue00c'}]}])
        assert js('return document.activeElement.classList.contains("category-icon-choice");')
        js('document.getElementById("show-home").click();')
        js('const a=[...document.querySelectorAll(".category-shortcut")].find(e=>/Research/.test(e.textContent));if(a)a.click();')
        assert js('return document.documentElement.scrollWidth<=innerWidth+1;')
        shot('home-zoom-'+str(zoom)+'-'+str(width));viewports.append(box)
        js('''document.getElementById("show-settings").click();document.querySelector('[data-settings-panel="home-settings"]').click();''')
    assert record('current')==saved_layout
    return {'baseline':baseline,'wheel':issue,'category':category,'samples':samples,'iconPicker':28,'iconReload':True,'viewports':viewports,'layoutUnchanged':True}
