"""Trusted input, CAS failure and concurrent-page checks for the compact Home."""
import time

def run_interactions(c, wait, shot, record):
    checks=[]
    def click(s):c.script('document.querySelector(arguments[0]).click();',s)
    def focus(s):c.script('document.querySelector(arguments[0]).focus();',s)
    def point(s):return c.script('const r=document.querySelector(arguments[0]).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};',s)
    def pointer(actions):c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':actions}])
    def move(p,d=150):return {'type':'pointerMove','origin':'viewport','x':p['x'],'y':p['y'],'duration':d}
    def key(value):c.call('WebDriver:PerformActions',actions=[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':value},{'type':'keyUp','value':value}]}])
    def opened():return c.script('return document.getElementById("pin-chooser").matches(":popover-open");')
    def edit_name(name):c.script('const e=document.querySelector("#bookmark-pages input[data-field=label]");e.value=arguments[0];e.dispatchEvent(new Event("input",{bubbles:true}));',name)
    trigger='#pinned-primary .compass-pin'
    c.script('window.scrollTo(0,0);');focus('#destination-search')
    pointer([move(point(trigger))]);wait(opened,'fine-pointer hover opens chooser')
    assert c.script('return document.activeElement.id==="destination-search";'),'hover must not steal focus'
    pointer([move(point('#pin-chooser-pages button'))]);time.sleep(.5);assert opened(),'pointer transfer'
    key('\ue00c');assert not opened()
    for activation in ['\ue007',' ']:
        focus(trigger);key(activation);wait(opened,'keyboard chooser')
        assert c.script('return document.activeElement===document.querySelector("#pin-chooser-pages button");')
        key('\ue004');assert c.script('return document.activeElement===document.querySelectorAll("#pin-chooser-pages button")[1];')
        key('\ue00c');assert not opened();assert c.script('return document.activeElement===document.querySelector(arguments[0]);',trigger)
    focus(trigger);key('\ue007');outside=point('.home-intro h1');pointer([move(outside),{'type':'pointerDown','button':0},{'type':'pointerUp','button':0}]);assert not opened()
    checks.append('native hover transfer without focus theft; Enter/Space, Tab, Escape focus return, outside dismissal')

    # Rotation uses actual pointer capture. No persistence or order changes.
    before=record();pins=c.script('return localStorage.getItem("atlas-home-pins-v1");')
    p=point('#compass-handle');original=c.script('return document.querySelector(arguments[0]).style.cssText;',trigger)
    pointer([move({'x':p['x']+20,'y':p['y']}),{'type':'pointerDown','button':0},move({'x':p['x'],'y':p['y']+50}),move({'x':p['x']-80,'y':p['y']+60}),{'type':'pointerUp','button':0}])
    assert c.script('return document.querySelector(arguments[0]).style.cssText!==arguments[1] && document.getElementById("compass-handle").dataset.dragging==="false";',trigger,original)
    focus(trigger);key('\ue007');assert opened();key('\ue00c')
    for cancel in ['cancel','lost']:
        pointer([move({'x':p['x']+20,'y':p['y']}),{'type':'pointerDown','button':0},move({'x':p['x'],'y':p['y']+50})])
        if cancel=='cancel':key('\ue00c');c.call('WebDriver:ReleaseActions')
        else:c.script('const h=document.getElementById("compass-handle");for(let id=0;id<10;id++)if(h.hasPointerCapture(id))h.releasePointerCapture(id);');c.call('WebDriver:ReleaseActions')
        assert c.script('return document.getElementById("compass-handle").dataset.dragging==="false";')
    assert record()==before and c.script('return localStorage.getItem("atlas-home-pins-v1");')==pins
    assert c.script('return [...document.querySelectorAll("#pinned-primary img")].every(i=>getComputedStyle(i).transform==="none");')
    checks.append('native rotation/release outside handle, Escape cancellation and lost capture; upright icons; no writes')

    # A deliberately injected IDB put failure cannot publish pages or discard work.
    click('#edit-pins');wait(lambda:c.script('return document.getElementById("bookmark-editor").open;'),'editor')
    edit_name('Retained after failed save')
    c.script('window.__put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(this.name==="layout"&&k==="bookmarks-v1")throw new DOMException("fixture abort","AbortError");return window.__put.call(this,v,k);};')
    click('#save-bookmarks');wait(lambda:c.script('return document.getElementById("bookmark-status").textContent.includes("not verified");'),'failure feedback')
    assert record()==before
    assert c.script('return document.querySelector("#bookmark-pages input[data-field=label]").value==="Retained after failed save";')
    shot('bookmark-failed-save')
    c.script('IDBObjectStore.prototype.put=window.__put;');click('#save-bookmarks')
    wait(lambda:c.script('return !document.getElementById("bookmark-editor").open;'),'retry committed')
    checks.append('injected failed write retains editor and old Home; explicit retry acknowledges saved pages')

    # Two actual Atlas control pages independently edit the same record.
    first=c.call('WebDriver:GetWindowHandle');click('#edit-pins');edit_name('Local draft from page A')
    c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedTab=gBrowser.addTrustedTab(arguments[0]);',c_script_url := 'moz-extension://85b4a551-0305-4eb5-aac8-8d127445c879/ui/index.html');c.call('Marionette:SetContext',value='content')
    c.call('WebDriver:SwitchToWindow',handle=c.call('WebDriver:GetWindowHandles')[-1])
    wait(lambda:c.script('return document.getElementById("status")?.dataset.ready==="true" && !!document.querySelector("#pinned-primary .compass-pin") && !document.getElementById("edit-pins").disabled;'),'second control page',30)
    click('#edit-pins');wait(lambda:c.script('return document.getElementById("bookmark-editor").open;'),'second editor')
    edit_name('Saved by page B');click('#save-bookmarks');wait(lambda:c.script('return !document.getElementById("bookmark-editor").open;'),'second save')
    c.call('WebDriver:CloseWindow');c.call('WebDriver:SwitchToWindow',handle=first)
    wait(lambda:c.script('return document.getElementById("bookmark-status").textContent.includes("newer bookmarks");'),'conflict refresh',15)
    assert c.script('return document.querySelector("#bookmark-pages input[data-field=label]").value==="Local draft from page A" && document.getElementById("save-bookmarks").disabled;')
    click('#review-bookmark-conflict');wait(lambda:c.script('return document.getElementById("bookmark-latest").textContent.includes("Saved by page B");'),'explicit newer version review')
    click('#save-reviewed-bookmarks');wait(lambda:c.script('return !document.getElementById("bookmark-editor").open;'),'explicit reconciliation')
    checks.append('conflicting control pages retain local draft; reviewed revision CAS reconciliation')

    # Refresh while chooser is focused must reuse rows even if a saved label changes.
    focus(trigger);key('\ue007');c.script('window.__focusedPage=document.activeElement;')
    c.script('const done=arguments[0],q=indexedDB.open("atlas-home-layout-v1");q.onsuccess=()=>{const db=q.result,t=db.transaction("layout","readwrite"),s=t.objectStore("layout"),r=s.get("bookmarks-v1");r.onsuccess=()=>{const v=r.result;v.revision++;v.value.groups[0].pages[0].label="Updated by another page";s.put(v,"bookmarks-v1");};t.oncomplete=()=>{db.close();done(true);};};',asynchronous=True)
    wait(lambda:c.script('return document.querySelector("#pin-chooser-pages button strong").textContent==="Updated by another page";'),'chooser live reconciliation')
    assert c.script('return document.activeElement===window.__focusedPage && document.getElementById("pin-chooser").matches(":popover-open");')
    key('\ue00c');checks.append('background bookmark changes preserve open chooser and focused stable page')
    # Category visibility/collapse is persisted presentation, not local navigation.
    c.script('const done=arguments[0],q=indexedDB.open("atlas-home-layout-v1");q.onsuccess=()=>{const db=q.result,t=db.transaction("layout","readwrite"),s=t.objectStore("layout"),r=s.get("current");r.onsuccess=()=>{const v=r.result;v.revision++;v.value.categories.find(c=>c.key==="university").visible=false;v.value.categories.find(c=>c.key==="university").collapsed=true;s.put(v,"current");};t.oncomplete=()=>{db.close();done(true);};};',asynchronous=True)
    wait(lambda:c.script('return ![...document.querySelectorAll(".category-shortcut")].some(b=>b.textContent.includes("University"));'),'hidden category refresh')
    saved_layout=record('current');click('.browse-categories')
    c.script('[...document.querySelectorAll(".category-directory-item")].find(b=>b.textContent.includes("University")).click();')
    wait(lambda:c.script('return !document.querySelector("[data-category-key=university] .destination-grid").hidden;'),'explicit collapsed category inspection')
    assert record('current')==saved_layout
    click('#close-category-workspace');focus('#destination-search')
    c.script('const e=document.getElementById("destination-search");e.value="student.ladok.se";e.dispatchEvent(new Event("input",{bubbles:true}));')
    wait(lambda:c.script('return document.getElementById("search-results").textContent.includes("Ladok");'),'hidden category search')
    key('\ue00c');c.script('document.getElementById("destination-search").value="";document.getElementById("destination-search").dispatchEvent(new Event("input",{bubbles:true}));')
    checks.append('hidden categories searchable and in full directory; explicit browsing bypasses saved collapse without changing preferences')
    # Unpinning and re-pinning never edits the saved group.
    saved_pages=record();click('#edit-pins');wait(lambda:c.script('return document.getElementById("bookmark-editor").open;'),'pin editor')
    click('#pin-bookmark-parent');assert record()==saved_pages
    assert c.script('return ![...document.querySelectorAll("#pinned-primary .compass-pin")].some(b=>b.dataset.destinationId==="service:webmail.kth.se");')
    click('#pin-bookmark-parent');assert record()==saved_pages;click('#cancel-bookmarks')
    checks.append('unpin/re-pin retains saved pages and uses existing independent pin persistence')
    # Missing parents are retained and can be explicitly cleaned up, not inherited.
    c.script('const done=arguments[0],q=indexedDB.open("atlas-home-layout-v1");q.onsuccess=()=>{const db=q.result,t=db.transaction("layout","readwrite"),s=t.objectStore("layout"),r=s.get("bookmarks-v1");r.onsuccess=()=>{const v=r.result;v.revision++;v.value.groups.push({parentId:"host:removed.example",pages:[{id:"orphan",label:"Retained page",url:"https://removed.example/path#section"}]});s.put(v,"bookmarks-v1");};t.oncomplete=()=>{db.close();done(true);};};',asynchronous=True)
    click('#edit-pins');wait(lambda:c.script('return [...document.getElementById("bookmark-parent").options].some(o=>o.value==="host:removed.example");'),'unavailable parent refreshed')
    c.script('const p=document.getElementById("bookmark-parent");p.value="host:removed.example";p.dispatchEvent(new Event("change"));')
    wait(lambda:c.script('return document.getElementById("bookmark-parent-note").textContent.includes("unavailable") && document.querySelectorAll("#bookmark-pages li").length===1;'),'orphan editor')
    assert c.script('return document.getElementById("add-bookmark-page").disabled && document.getElementById("pin-bookmark-parent").disabled;')
    click('#bookmark-pages [data-action=remove]');click('#save-bookmarks');wait(lambda:c.script('return !document.getElementById("bookmark-editor").open;'),'orphan cleanup acknowledged')
    assert not any(g['parentId']=='host:removed.example' for g in record()['value']['groups'])
    checks.append('unavailable parent pages remain editable for explicit cleanup, without launch or pin authority')
    return checks
