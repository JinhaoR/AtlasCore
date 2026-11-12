"""Matched navigation and consecutive editing evidence in disposable profiles."""
import base64
import statistics
import time


def run_quality_pass(client, ui_handle, ui_url, port, wait_for, run, baseline=False):
    def view(): return client.message({'kind':'GET_VIEW'})['view']
    def ready(): return wait_for(lambda: (v:=view()) and v.get('controller',{}).get('status')=='READY' and v,'ready quality fixture',30)
    def fields(values):
        client.script('for(const [id,v] of Object.entries(arguments[0])){const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));}',values)
    def shot(name):
        (run/name).write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot',id=None,highlights=[],full=True)))
    ready();client.call('WebDriver:SetWindowRect',width=1440,height=1000)
    client.script('document.getElementById("show-sites").click();')
    fields({'sites-search':'root.localhost'})
    wait_for(lambda:client.script('const r=document.querySelector("#sites-list .site-row");if(r){r.click();return true;}return false;'),'selected root')
    client.script('document.getElementById("edit-site").click();')
    fields({'site-name':'Research portal'})
    time.sleep(.4)
    client.script('window.scrollTo(0,0);')
    shot('sites-edit-wide.png')
    # The same native input node/caret must survive background reads and rerenders.
    client.script('const n=document.getElementById("site-name");n.focus();n.setSelectionRange(3,5);window.__qualityInput=n;')
    time.sleep(2)
    stable=client.script('const n=document.getElementById("site-name");return n===window.__qualityInput&&document.activeElement===n&&n.selectionStart===3&&n.selectionEnd===5;')
    assert stable
    client.script('document.getElementById("site-form").requestSubmit();')
    wait_for(lambda:client.script('return document.getElementById("site-draft").hidden;'),'stage first edit')
    client.script('document.getElementById("add-site").click();')
    fields({'site-name':'Synthetic reference','site-hostname':'reference.example','site-category':'Research'})
    time.sleep(.3)
    client.script('window.scrollTo(0,0);')
    editor_position=client.script('const r=document.getElementById("site-draft").getBoundingClientRect();return {top:r.top+scrollY,pageHeight:document.documentElement.scrollHeight};')
    shot('sites-batch-wide.png')
    client.call('WebDriver:SetWindowRect',width=820,height=900)
    shot('sites-batch-small.png')
    overflow=client.script('return document.documentElement.scrollWidth>window.innerWidth;')
    assert not overflow
    if not baseline:
        assert client.script('return document.getElementById("site-detail").hidden;'),'editor replaces committed detail'
        client.script('document.getElementById("site-name").focus();')
        client.call('WebDriver:PerformActions',actions=[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue004'},{'type':'keyUp','value':'\ue004'}]}])
        assert client.script('return document.activeElement.id==="site-category";'),'native Tab reaches the next Display field'
        position=client.script('window.scrollTo(0,250);return scrollY;')
        time.sleep(2)
        assert abs(client.script('return scrollY;')-position)<=1,'background refresh preserves scroll'
        client.script('window.__qualityPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){if(this.name==="workspace")throw new DOMException("Synthetic isolated draft failure","AbortError");return window.__qualityPut.apply(this,a);};')
        fields({'site-name':'Synthetic reference retained'})
        wait_for(lambda:client.script('return !document.getElementById("retry-destination-draft").hidden&&document.getElementById("destination-draft-status").textContent.includes("Unsaved");'),'truthful local draft failure')
        shot('draft-save-failure.png')
        client.script('IDBObjectStore.prototype.put=window.__qualityPut;document.getElementById("retry-destination-draft").click();')
        wait_for(lambda:client.script('return document.getElementById("retry-destination-draft").hidden;'),'explicit draft retry')
        assert client.script('return document.getElementById("site-name").value==="Synthetic reference retained";')
    client.script('document.getElementById("site-form").requestSubmit();')
    wait_for(lambda:client.script('return document.getElementById("site-draft").hidden;'),'stage second edit')
    client.script('document.getElementById("review-destination-draft").click();')
    time.sleep(.3);shot('sites-review-small.png')
    if not baseline:
        client.script('document.getElementById("review-destination-draft").focus();')
        client.call('WebDriver:PerformActions',actions=[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue007'},{'type':'keyUp','value':'\ue007'}]}])
        wait_for(lambda:client.script('return document.getElementById("destination-draft-items").hidden;'),'keyboard closes disclosure')
        assert client.script('return document.activeElement.id==="site-detail" || document.activeElement.classList.contains("site-row");'),'closing review returns to the selected destination'
        client.script('document.getElementById("review-destination-draft").click();')
    for page in ['show-home','show-sites','show-settings','show-sites']:
        client.script('document.getElementById(arguments[0]).click();',page)
    assert client.script('return document.querySelectorAll("#destination-draft-items > li").length===2;')
    client.call('WebDriver:SetWindowRect',width=1440,height=1000)
    client.script('document.getElementById("show-home").click();window.scrollTo(0,0);')
    shot('home-wide.png')
    zoom_checks=[]
    if not baseline:
        for zoom in [1.25,2]:
            client.call('Marionette:SetContext',value='chrome')
            client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,arguments[0]);',zoom)
            client.call('Marionette:SetContext',value='content')
            for page in ['show-home','show-sites','show-settings']:
                client.script('document.getElementById(arguments[0]).click();',page)
                time.sleep(.15)
                assert client.script('return document.documentElement.scrollWidth<=document.documentElement.clientWidth+1;'),(zoom,page)
                zoom_checks.append({'zoom':zoom,'page':page,'overflow':False})
        client.call('Marionette:SetContext',value='chrome')
        client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,1);')
        client.call('Marionette:SetContext',value='content')
        client.script('document.getElementById("show-home").click();')
    samples=[]
    for count in [0,2500]:
        if count:
            assert client.script('''const done=arguments[0];browser.runtime.getBackgroundPage().then(b=>{
              const o=b.indexedDB.open('atlas-authority-v1');o.onsuccess=()=>{const db=o.result,t=db.transaction('authority','readwrite'),s=t.objectStore('authority'),q=s.get('envelope');
                q.onsuccess=()=>{const e=q.result,j=e.snapshot.journeyState,past=j.lastObservedAt-20000;
                  for(let i=0;i<2500;i++)j.journeys.push({id:j.nextJourneyId++,contextId:'quality-history-'+i,rootHostname:'root.localhost',currentHostname:'root.localhost',startedAt:past,expiresAt:past+10000,hopCount:0,maxHops:12,policyRevision:0,phase:'ENDED',endedAt:past+1,endReason:'REACHED'});
                  e.storageVersion=b.crypto.randomUUID();s.put(e,'envelope');};t.oncomplete=()=>{db.close();done(true)};t.onabort=()=>{db.close();done(false)};};});''',asynchronous=True) is True
            wait_for(lambda:len(ready()['controller']['snapshot']['journeyState']['journeys'])>=2500,'history loaded')
        times=[]
        for _ in range(15):
            started=time.monotonic()
            identity=client.script('const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));',f'http://root.localhost:{port}/',asynchronous=True)
            wait_for(lambda:any(c['tabId']==identity and (c.get('latest')or{}).get('decision',{}).get('reason')=='WHITELISTED' for c in view()['contexts']),'native navigation')
            times.append((time.monotonic()-started)*1000)
            client.script('const [id,done]=arguments;browser.tabs.remove(id).then(()=>done(true));',identity,asynchronous=True)
        samples.append({'history':count,'medianMs':statistics.median(times),'maxMs':max(times),'samples':times})
        print('NAVIGATION',samples[-1]['history'],samples[-1]['medianMs'],flush=True)
    return {'suite':'quality-pass','baseline':baseline,'navigation':samples,'focusCaretPreserved':stable,'smallViewportOverflow':overflow,
      'editorPosition':editor_position,'nativeZoomChecks':zoom_checks,
      'keyboardAndFailedDraftRetry':not baseline,
      'checks':['consecutive display and policy draft edits','review/sidebar return retains both staged changes','native caret identity retained','wide/small screenshots','ordinary Core-gated navigation with history'],
      'controllerReason':ready()['controller']['reason'],'normalProfileAccessed':False}
