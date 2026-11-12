"""Category-grid presentation checks; only the caller's disposable profile."""
import time

def verify(current, wait, shot, record, stop, start):
    checks=[]
    def c(): return current()
    def click(selector): c().script('document.querySelector(arguments[0]).click();',selector)
    def keys(): return c().script('return [...document.querySelectorAll(".category-shortcut")].map(b=>b.dataset.categoryKey);')
    def settled(): wait(lambda:c().script('return !!document.querySelector(".category-shortcut[data-reorderable=true]");'),'acknowledged category grid')
    def read(key='current'): return record(key)
    def settings():
        click('#show-settings');click('[data-settings-panel="home-settings"]')
        wait(lambda:c().script('return !!document.querySelector("#home-layout-list .category-icon-choice:not(:disabled)");'),'category settings')
    def choose_icon(key,value):
        c().script('const s=[...document.querySelectorAll("[data-layout-category]")].find(r=>r.dataset.layoutCategory===arguments[0]).querySelector(".category-icon-choice");s.click();document.querySelector(`.category-icon-picker [data-icon="${arguments[1]}"]`).click();',key,value)
    def point(key): return c().script('const r=[...document.querySelectorAll(".category-shortcut")].find(b=>b.dataset.categoryKey===arguments[0]).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};',key)
    def pointer(actions): c().call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'category-mouse','parameters':{'pointerType':'mouse'},'actions':actions}])
    def move(p,duration=250): return {'type':'pointerMove','origin':'viewport','x':p['x'],'y':p['y'],'duration':duration}
    settled()
    baseline=c().message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    pins=c().script('return localStorage.getItem("atlas-home-pins-v1");')
    assert c().script('return !document.querySelector("#customize-home,.browse-categories,.open-address,#category-directory");')
    assert len(keys())>6
    shot('home-grid')
    initial=keys();source=initial[0];target=initial[3];a=point(source);b=point(target)
    revision=read()['revision']
    pointer([move(a,0),{'type':'pointerDown','button':0},move({'x':a['x']+20,'y':a['y']}),move(b,600),{'type':'pointerUp','button':0}])
    wait(lambda:read()['revision']>revision,'native drag acknowledged',10)
    assert keys()[:4]==[initial[1],initial[2],initial[3],initial[0]],keys()
    assert c().script('return document.getElementById("category-workspace").hidden;')
    checks.append('native pointer drag reorders once without opening a category')
    revision=read()['revision'];a=point(source);b=point(initial[1])
    pointer([move(a,0),{'type':'pointerDown','button':0},move(b,400)])
    c().call('WebDriver:PerformActions',actions=[{'type':'key','id':'cancel-key','actions':[{'type':'keyDown','value':'\ue00c'},{'type':'keyUp','value':'\ue00c'}]}])
    pointer([{'type':'pointerUp','button':0}]);assert read()['revision']==revision
    pointer([move(a,0),{'type':'pointerDown','button':0},move({'x':10,'y':10},500),{'type':'pointerUp','button':0}]);assert read()['revision']==revision
    assert c().script('return !document.querySelector(".category-shortcut[data-dragging],.category-shortcut[data-drop-target],.category-drag-ghost");'),c().script('return [...document.querySelectorAll("[data-dragging],[data-drop-target],.category-drag-ghost")].map(n=>n.outerHTML);')
    checks.append('Escape and release outside cancel dragging without persistence or activation')
    # Native keyboard alternative and focus survive retained-node movement.
    c().script('[...document.querySelectorAll(".category-shortcut")].find(b=>b.dataset.categoryKey===arguments[0]).focus();',source)
    revision=read()['revision']
    c().call('WebDriver:PerformActions',actions=[{'type':'key','id':'category-key','actions':[{'type':'keyDown','value':'\ue00a'},{'type':'keyDown','value':'\ue012'},{'type':'keyUp','value':'\ue012'},{'type':'keyUp','value':'\ue00a'}]}])
    wait(lambda:read()['revision']>revision,'keyboard reorder saved')
    assert keys()[2]==source
    assert c().script('return document.activeElement.dataset.categoryKey===arguments[0];',source)
    # Opening, back, history and live refresh never write category preferences.
    layout=read();click('.category-shortcut');wait(lambda:c().script('return !document.getElementById("category-workspace").hidden;'),'category opened')
    shot('category-open');click('#close-category-workspace')
    assert c().script('return document.activeElement.classList.contains("category-shortcut");')
    c().call('WebDriver:Back');wait(lambda:c().script('return !document.getElementById("category-workspace").hidden;'),'history category')
    c().call('WebDriver:Forward');wait(lambda:c().script('return document.getElementById("category-workspace").hidden;'),'history grid')
    assert read()==layout
    settings();c().script('[...document.querySelectorAll("[data-layout-category]")].find(r=>r.dataset.layoutCategory===arguments[0]).querySelector(".category-icon-choice").focus();',source);choose_icon(source,'feather')
    wait(lambda:read('category-icons-v1') and any(e['key']==source and e['icon']=='feather' for e in read('category-icons-v1')['value']['entries']),'icon saved')
    wait(lambda:c().script('return document.activeElement.classList.contains("category-icon-choice");'),'icon selection focus retained')
    shot('category-settings');click('#show-home');settled()
    assert c().script('return [...document.querySelectorAll(".category-shortcut")].find(b=>b.dataset.categoryKey===arguments[0]).querySelector("use").getAttribute("href")==="#icon-feather";',source)
    c().call('WebDriver:Refresh');settled();assert read()==layout
    assert read('category-icons-v1')['value']['entries'][0]['icon']=='feather'
    checks.append('keyboard, focus, Back/Forward and reload preserve order and local icon choice')
    # A real failed IndexedDB put retains requested icon and the acknowledged Home.
    settings();c().script('window.__originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==="layout"&&key==="category-icons-v1")throw new DOMException("fixture abort","AbortError");return window.__originalPut.call(this,value,key);};')
    choose_icon(source,'code');wait(lambda:c().script('return !document.getElementById("retry-category-icons").hidden;'),'failed icon save')
    assert read('category-icons-v1')['value']['entries'][0]['icon']=='feather'
    assert c().script('return [...document.querySelectorAll("[data-layout-category]")].find(r=>r.dataset.layoutCategory===arguments[0]).querySelector(".category-icon-choice").dataset.icon==="code";',source)
    c().script('IDBObjectStore.prototype.put=window.__originalPut;delete window.__originalPut;');click('#retry-category-icons')
    wait(lambda:read('category-icons-v1')['value']['entries'][0]['icon']=='code','icon retry saved')
    checks.append('failed icon save retains editor choice; retry commits without changing layout or policy')
    # Two control pages observe each other's acknowledged presentation writes.
    original=c().call('WebDriver:GetWindowHandle');other=c().call('WebDriver:NewWindow',type='tab')['handle']
    url=c().script('return browser.runtime.getURL("ui/index.html");')
    c().call('WebDriver:SwitchToWindow',handle=other);c().call('WebDriver:Navigate',url=url);settled();settings();choose_icon(source,'mail')
    wait(lambda:read('category-icons-v1')['value']['entries'][0]['icon']=='mail','other page saved')
    c().call('WebDriver:CloseWindow');c().call('WebDriver:SwitchToWindow',handle=original);click('#show-home');settled()
    wait(lambda:c().script('return [...document.querySelectorAll(".category-shortcut")].find(b=>b.dataset.categoryKey===arguments[0]).querySelector("use").getAttribute("href")==="#icon-mail";',source),'cross-page icon refresh')
    layout=read();icons=read('category-icons-v1');stop();start();settled()
    assert read()==layout and read('category-icons-v1')==icons
    assert c().script('return localStorage.getItem("atlas-home-pins-v1");')==pins
    checks.append('two control pages and a full Firefox restart preserve acknowledged icons, order and pins')
    # Many categories are presentation fixtures over the existing allowed hosts.
    hosts=baseline['policy']['whitelist'];metadata=[{'id':'host:'+host,'label':'Fixture '+str(i),'primaryHostname':host,'hostnames':[host],'category':'Custom category '+str(i%30).zfill(2)} for i,host in enumerate(hosts)]
    c().script('localStorage.setItem("atlas-destinations-v1",JSON.stringify({version:1,destinations:arguments[0],pending:null}));',metadata)
    c().call('WebDriver:Refresh');settled();wait(lambda:len(keys())==30,'all thirty categories')
    assert c().script('const n=document.getElementById("category-shortcuts");return n.scrollHeight>n.clientHeight && document.documentElement.scrollHeight<=innerHeight;')
    shot('thirty-categories');settings();choose_icon('custom category 00','network')
    wait(lambda:any(e['key']=='custom category 00' for e in read('category-icons-v1')['value']['entries']),'custom category icon');click('#show-home');settled()
    rectangles=[]
    for width,height,zoom in [(1488,1143,1),(2538,1261,1),(1200,900,1),(1488,1143,1.25),(1488,1143,1.5),(1488,1143,2),(500,900,1),(500,900,2)]:
        c().call('WebDriver:SetWindowRect',width=width,height=height)
        c().call('Marionette:SetContext',value='chrome');c().script('gBrowser.selectedBrowser.browsingContext.fullZoom=arguments[0];',zoom);c().call('Marionette:SetContext',value='content');time.sleep(.2)
        sizes=c().script('return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,categories:document.getElementById("category-shortcuts").clientHeight};')
        assert sizes['scroll']<=sizes['client'],sizes
        rectangles.append({'window':width,'zoom':zoom,**sizes});shot('grid-'+str(width)+'-'+str(zoom))
    c().call('WebDriver:SetWindowRect',width=1488,height=1143);c().call('Marionette:SetContext',value='chrome');c().script('gBrowser.selectedBrowser.browsingContext.fullZoom=1;');c().call('Marionette:SetContext',value='content');time.sleep(.3)
    c().script('window.__gridChanges=0;window.__gridNodes=[...document.querySelectorAll(".category-shortcut")];window.__gridResources=performance.getEntriesByType("resource").length;window.__gridObserver=new MutationObserver(m=>window.__gridChanges+=m.length);window.__gridObserver.observe(document.getElementById("category-shortcuts"),{attributes:true,childList:true,subtree:true});')
    time.sleep(5)
    idle=c().script('window.__gridObserver.disconnect();return {mutations:window.__gridChanges,resources:performance.getEntriesByType("resource").length-window.__gridResources,retained:window.__gridNodes.every((n,i)=>n===document.querySelectorAll(".category-shortcut")[i])};')
    assert idle=={'mutations':0,'resources':0,'retained':True},idle
    after=c().message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    for key in ['policy','policyRevision','configuration','configurationRevision']:assert baseline[key]==after[key],key
    checks.append('30 categories scroll internally; local custom icons, small windows and 125-200% zoom; idle nodes retained; authority unchanged')
    return {'checks':checks,'viewports':rectangles,'idle':idle,'normalProfileAccessed':False}
