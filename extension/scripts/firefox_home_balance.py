"""Focused presentation checks; isolated synthetic profile only."""
import time

def verify(c,h,shot):
    def js(code,*args): return c.script(code,*args)
    def wait(code,label): h.wait_for(lambda:js(code),label,25)
    def click(s): js('document.querySelector(arguments[0]).click();',s)
    def mode(value):
        js('const e=document.querySelector("#sites-category-order");e.value=arguments[0];e.dispatchEvent(new Event("change",{bubbles:true}));',value)
        wait('return !document.querySelector("#sites-category-order").disabled;','saved category order')
        assert js('return document.querySelector("#sites-category-order").value;')==value
    def keys():return js('return [...document.querySelectorAll("#sites-categories button")].map(e=>e.dataset.categoryKey);')
    wait('return !!document.querySelector(".compass-pin:not(:disabled)");','pins')
    c.call('WebDriver:SetWindowRect',width=1752,height=1202)
    time.sleep(.5)
    assert js('return document.querySelector(".home-intro h1").textContent;')=='Atlas'
    assert js('return getComputedStyle(document.querySelector(".sidebar-heading")).visibility;')=='hidden'
    geometry=js('const m=document.querySelector("main").getBoundingClientRect(),w=document.querySelector("#workspace").getBoundingClientRect();return {topGap:w.top-m.top,bottomGap:m.bottom-w.bottom};')
    assert abs(geometry['topGap']-geometry['bottomGap'])<8,geometry
    shot('home-empty')
    # Measure row capacity using temporary presentation fixtures, not Core grants.
    sizes=[]
    for count in [1,2,3]:
        js('''const s=document.querySelector('#temporary-section');s.hidden=false;
          document.querySelector('#temporary-empty').hidden=true;document.querySelector('#temporary-unavailable').hidden=true;
          document.querySelector('#pending-access-list').innerHTML=Array.from({length:arguments[0]},(_,i)=>`<li class="temporary-row"><div class="temporary-copy"><strong class="temporary-name">Sample ${i+1}</strong><span class="temporary-scope">sample.localhost</span></div><div class="temporary-actions"><button class="access-cancel">Cancel</button><button class="access-signal" data-tone="active">Active · 12:30</button></div></li>`).join('');''',count)
        sizes.append(js('const r=document.querySelector("#temporary-section .home-access-rows");return {height:r.clientHeight,scroll:r.scrollHeight};'))
        if count==2:shot('home-two-rows')
    assert sizes[1]['height']>sizes[0]['height'] and sizes[1]['scroll']==sizes[1]['height'] and sizes[2]['height']==sizes[1]['height'] and sizes[2]['scroll']>sizes[2]['height'],sizes
    c.call('WebDriver:Refresh');wait('return !!document.querySelector(".compass-pin:not(:disabled)");','reloaded')
    click('#show-sites');wait('return document.querySelectorAll("#sites-categories button").length>4 && !document.querySelector("#sites-category-order").disabled;','categories')
    original=keys();mode('alphabetic')
    labels=js('return [...document.querySelectorAll("#sites-categories button span")].map(e=>e.textContent);')
    assert labels==sorted(labels,key=str.casefold),labels
    mode('custom');assert keys()==original
    # Existing usage identity, isolated profile. Force one category above the rest.
    js('localStorage.setItem("atlas-destination-usage-v1",JSON.stringify({"service:github.com":{score:999,count:999,lastOpenedAt:Date.now()}}));')
    mode('usage');assert keys()[0]=='development',keys()
    shot('directory-most-used')
    before=keys()
    rects=js('return [...document.querySelectorAll("#sites-categories button")].slice(0,2).map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];});')
    (x,y),(tx,ty)=rects
    c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'category-drag','parameters':{'pointerType':'mouse'},'actions':[
      {'type':'pointerMove','origin':'viewport','x':x,'y':y,'duration':0},{'type':'pointerDown','button':0},
      {'type':'pointerMove','origin':'viewport','x':tx,'y':ty,'duration':400},{'type':'pause','duration':250}]}])
    js('''window.__drop=[];window.__dropAt=performance.now();const nodes=[...document.querySelectorAll('#sites-categories button')].slice(0,2);
      const tick=()=>{window.__drop.push(nodes.map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y];}));if(performance.now()-window.__dropAt<500)requestAnimationFrame(tick);};tick();''')
    c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'category-drag','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerUp','button':0}]}])
    wait('return document.querySelector("#sites-category-order").value==="custom" && !document.querySelector("#sites-category-order").disabled;','drop switches to custom')
    time.sleep(.6)
    after=keys();assert after[:2]==[before[1],before[0]],(before,after)
    trace=js('return window.__drop;')
    excursions=[max(frame[i][axis] for frame in trace)-min(frame[i][axis] for frame in trace) for i in range(2) for axis in range(2)]
    assert max(excursions)<3,excursions
    shot('directory-custom')
    c.call('WebDriver:Refresh');wait('return document.querySelectorAll("#sites-categories button").length>4 && !document.querySelector("#sites-category-order").disabled;','saved order reload')
    assert keys()==after
    return {'homeCenter':geometry,'rowCapacity':sizes,'customOrder':after,'dropExcursionPx':excursions,'modeAndOrderSurviveReload':True}
