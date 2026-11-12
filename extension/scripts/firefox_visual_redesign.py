"""Matched presentation checks using only synthetic data and isolated profiles."""
import base64
import statistics
import time

def run_visual_redesign(client, ui_handle, ui_url, port, wait_for, run, baseline=False):
    def view(): return client.message({'kind':'GET_VIEW'})['view']
    def ready(): return wait_for(lambda:(v:=view()) and v.get('controller',{}).get('status')=='READY' and v,'verified visual fixture',30)
    def page(name):
        client.script('const [id,done]=arguments;document.getElementById(id).click();requestAnimationFrame(()=>requestAnimationFrame(()=>{window.scrollTo(0,0);done(true);}));','show-'+name,asynchronous=True)
        if name=='home' and refined:
            client.script('if(!document.getElementById("category-workspace").hidden)document.getElementById("back-to-compass").click();window.scrollTo(0,0);')
    def shot(name):
        time.sleep(.2)
        (run/(name+'.png')).write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot',id=None,highlights=[],full=False)))
    def pin(identity):
        wait_for(lambda:client.script('const b=[...document.querySelectorAll("#destination-list .pin-button")].find(b=>b.dataset.pinId===arguments[0]);return b&&!b.disabled;',identity),'enabled pin')
        client.script('const b=[...document.querySelectorAll("#destination-list .pin-button")].find(b=>b.dataset.pinId===arguments[0]);if(b.getAttribute("aria-pressed")!=="true")b.click();',identity)
        wait_for(lambda:identity in pin_order(),'saved pin')
    def pin_order(): return client.script('return [...document.querySelectorAll("#pinned-list .destination-card")].map(c=>c.dataset.destinationId);')
    def layout():
        return client.script('''const done=arguments[0],q=indexedDB.open('atlas-home-layout-v1',1);
          q.onsuccess=()=>{const db=q.result,tx=db.transaction('layout','readonly'),r=tx.objectStore('layout').get('current');
            r.onsuccess=()=>done(r.result??null);tx.oncomplete=()=>db.close();};q.onerror=()=>done(null);''',asynchronous=True)
    refined=client.script('return !!document.getElementById("category-workspace");')
    ready();client.call('WebDriver:SetWindowRect',width=1586,height=1077);page('home')
    client.script('const done=arguments[0];document.fonts.ready.then(()=>done(true));',asynchronous=True)
    reference_viewport=client.script('return {width:innerWidth,height:innerHeight};')
    assert reference_viewport=={'width':1586,'height':992},reference_viewport
    wait_for(lambda:client.script('return document.querySelectorAll(".destination-card").length>20;'),'catalog')
    pins=['service:mail.google.com','service:webmail.kth.se','service:chatgpt.com','service:github.com','service:arxiv.org','service:overleaf.com']
    for identity in pins: pin(identity)
    assert pin_order()==pins
    print('VISUAL six pins saved in order',flush=True)
    page('home');time.sleep(2);shot('home')
    timings=[]
    for _ in range(12):
        timings.append(client.script('const done=arguments[0],s=performance.now();document.getElementById("show-sites").click();document.getElementById("show-home").click();requestAnimationFrame(()=>done(performance.now()-s));',asynchronous=True))
    client.script('''window.__visualWrites=0;window.__visualMutations=0;window.__visualPin=document.querySelector('#pinned-list .destination-card');
      window.__visualSet=Storage.prototype.setItem;Storage.prototype.setItem=function(...a){window.__visualWrites++;return window.__visualSet.apply(this,a)};
      window.__visualObserver=new MutationObserver(m=>window.__visualMutations+=m.length);window.__visualObserver.observe(document.getElementById('pinned-list'),{subtree:true,childList:true,attributes:true});''')
    time.sleep(5)
    idle=client.script('window.__visualObserver.disconnect();Storage.prototype.setItem=window.__visualSet;return {writes:window.__visualWrites,pinMutations:window.__visualMutations,pinIdentity:window.__visualPin===document.querySelector("#pinned-list .destination-card")};')
    assert idle['writes']==0 and idle['pinIdentity'] and idle['pinMutations']==0,idle
    print('VISUAL timing and idle',statistics.median(timings),idle,flush=True)
    page('sites');time.sleep(2);shot('directory');page('home')
    if refined:
        saved_layout=layout()
        client.script('[...document.querySelectorAll(".category-shortcut")].find(b=>b.textContent.includes("Research")).click();window.scrollTo(0,0);')
        assert client.script('return document.getElementById("pinned-section").hidden && !document.getElementById("category-workspace").hidden;')
        category=client.script('return history.state.atlasHomeView;')
        client.script('document.getElementById("back-to-compass").click();history.back();')
        wait_for(lambda:client.script('return history.state.atlasHomeView===arguments[0] && !document.getElementById("category-workspace").hidden;',category),'Back restores category')
        client.script('history.forward();')
        wait_for(lambda:client.script('return !document.getElementById("pinned-section").hidden;'),'Forward restores compass')
        client.script('[...document.querySelectorAll(".category-shortcut")].find(b=>b.textContent.includes("Research")).click();window.scrollTo(0,0);')
        assert layout()==saved_layout,'merely viewing categories must not save Home preferences'
        assert client.script('return !performance.getEntriesByType("resource").some(r=>/fonts\\.(googleapis|gstatic)\\.com/.test(r.name));'),'fonts must stay local'
    else:
        client.script('const g=[...document.querySelectorAll(".service-group")].find(g=>g.dataset.category.includes("Research"));g.querySelector(".category-toggle").click();g.scrollIntoView({block:"start"});')
    time.sleep(2);shot('category');page('settings');shot('settings')
    policy=ready()['controller']['snapshot']['policy']
    candidate={**policy,'whitelist':policy['whitelist']+['visual-proposal.localhost']}
    response=client.message({'kind':'PROPOSE_POLICY','candidatePolicy':candidate});assert response['result']['type']=='COMMITTED'
    proposal=response['view']['controller']['snapshot']['vaultState']['pendingProposal']
    if baseline: client.script('document.getElementById("vault-section").open=true;document.getElementById("vault-section").scrollIntoView();')
    else: client.script('document.getElementById("show-vault").click();')
    wait_for(lambda:client.script('return !document.getElementById("vault-panel").hidden;'),'frozen review');shot('vault')
    assert ready()['controller']['snapshot']['policy']==policy
    assert client.message({'kind':'CANCEL_POLICY','proposalId':proposal['id']})['result']['type']=='COMMITTED'
    tab=client.script('const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));',f'http://visual-access.localhost:{port}/',asynchronous=True)
    wait_for(lambda:any(c['tabId']==tab and c['effect']=='REMOVED' for c in view()['contexts']),'blocked Greylist')
    client.script('document.getElementById("show-access").click();const s=document.getElementById("context");s.value=String(arguments[0]);s.dispatchEvent(new Event("change"));',tab)
    wait_for(lambda:client.script('const b=document.getElementById("start-access");return !b.hidden&&!b.disabled;'),'scope prepared')
    client.script('document.getElementById("start-access").click();')
    wait_for(lambda:len(ready()['controller']['snapshot']['accessState']['pendingRequests'])>0,'pending request saved');shot('access-wait')
    page('home');shot('home-access')
    more=client.script('return [...new Set([...document.querySelectorAll("#destination-list .pin-button")].map(b=>b.dataset.pinId))].filter(id=>!arguments[0].includes(id)).slice(0,8);',pins)
    for identity in more: pin(identity)
    expected=pins+more;assert pin_order()==expected
    dimensions=[]
    for width,zoom in [(1440,1),(1100,1),(820,1),(500,1),(360,1),(1440,1.25),(1440,2),(500,2)]:
        client.call('WebDriver:SetWindowRect',width=width,height=1000)
        client.call('Marionette:SetContext',value='chrome');client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,arguments[0]);',zoom);client.call('Marionette:SetContext',value='content')
        for name in ['home','sites','settings']:
            page(name);time.sleep(.1)
            overflow=client.script('return document.documentElement.scrollWidth>document.documentElement.clientWidth+1;')
            if overflow:
                print('OVERFLOW',client.script('return [...document.querySelectorAll("body *")].filter(e=>{const r=e.getBoundingClientRect();return r.width && r.right>innerWidth+1}).map(e=>({tag:e.tagName,id:e.id,cls:typeof e.className==="string"?e.className:"svg",right:e.getBoundingClientRect().right})).slice(0,20);'),flush=True)
            assert not overflow,(width,zoom,name)
            dimensions.append({'requestedWidth':width,'viewportWidth':client.script('return innerWidth;'),'zoom':zoom,'page':name,'overflow':overflow})
        if width==500 and zoom==1: page('home');shot('home-small')
    client.call('Marionette:SetContext',value='chrome');client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,1);');client.call('Marionette:SetContext',value='content')
    client.call('WebDriver:SetWindowRect',width=1440,height=1000);page('home');shot('home-many-pins')
    if client.script('return !!document.getElementById("pinned-overflow");'):
        client.script('document.getElementById("pinned-overflow").scrollIntoView({block:"center"});')
        shot('home-more-pins');client.script('window.scrollTo(0,0);')
    if not baseline:
        positions=client.script('return [...document.querySelectorAll("#pinned-list .destination-card")].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}});')
        for i,a in enumerate(positions):
            for b in positions[i+1:]: assert a['x']+a['w']<=b['x'] or b['x']+b['w']<=a['x'] or a['y']+a['h']<=b['y'] or b['y']+b['h']<=a['y'],('overlapping pins',a,b)
    # A refined checkpoint has category history too; select one before checking
    # its reload restoration, just as in the current UI.
    if refined or not baseline:
        client.script('document.querySelector(".category-shortcut").click();')
        assert client.script('return document.activeElement.classList.contains("category-heading");')
        if refined:
            assert client.script('return document.querySelectorAll(".category-shortcut").length===Math.min(6,document.querySelectorAll("#destination-list .service-group").length) && document.getElementById("home-category-select").options.length===document.querySelectorAll("#destination-list .service-group").length+1;')
        else:
            client.script('document.getElementById("more-categories").open=true;')
            assert client.script('return document.querySelectorAll(".category-shortcut").length===document.querySelectorAll("#destination-list .service-group").length;')
    client.call('WebDriver:Refresh')
    wait_for(lambda:pin_order()==expected,'pins retained after reload')
    if refined:
        wait_for(lambda:client.script('return !document.getElementById("category-workspace").hidden;'),'category view restored from browser history')
        assert client.script('return document.fonts.check(\'500 24px "Cormorant Garamond"\') && document.fonts.check(\'400 16px "Source Sans 3"\');')
    stress={}
    if not baseline:
        # Only isolated presentation metadata changes: split the already allowed
        # exact hostnames into many custom rows/categories. No policy is added.
        client.script('''const hosts=arguments[0];localStorage.setItem('atlas-destinations-v1',JSON.stringify({version:1,pending:null,
          destinations:hosts.map((h,i)=>({id:'host:'+h,primaryHostname:h,hostnames:[h],
            label:i%4===0?'A long research destination name for condensed matter and mathematical physics '+i:h,
            category:'Research collection '+String(i%30).padStart(2,'0')}))}));''',policy['whitelist'])
        client.call('WebDriver:Refresh')
        wait_for(lambda:client.script('return document.querySelectorAll("#destination-list .service-group").length>=30;'),'crowded custom Home')
        stress['categories']=client.script('return document.querySelectorAll("#destination-list .service-group").length;')
        page('sites');stress['destinations']=client.script('return document.querySelectorAll("#sites-list .site-row").length;')
        assert stress['destinations']>=250
        shot('directory-crowded');page('home');shot('home-crowded')
        if refined: client.script('document.querySelector(".browse-categories").click();')
        client.script('window.__visualMissingIcon=document.querySelector(".service-group:not([hidden]) .destination-card:not([hidden]) .site-icon");window.__visualMissingIcon.scrollIntoView();window.__visualMissingIcon.loading="eager";window.__visualMissingIcon.src="missing-visual-fixture.svg";')
        wait_for(lambda:client.script('return window.__visualMissingIcon.src.endsWith("/site.svg");'),'missing favicon fallback')
        # Keyboard shortcuts and exact search targets remain under the existing gate.
        client.script('document.getElementById("destination-search").value="root.localhost";document.getElementById("destination-search").dispatchEvent(new Event("input"));')
        wait_for(lambda:client.script('return !document.getElementById("search-results").hidden;'),'search finds custom destinations')
        assert client.script('return document.getElementById("search-results").textContent.includes("root.localhost");')
        client.script('document.getElementById("destination-search").value="";document.getElementById("destination-search").dispatchEvent(new Event("input"));')
        # Simulate failed UI transport only. Diagnostics has its independent request.
        client.script('window.__visualDiagnosticReads=0;window.__visualSend=browser.runtime.sendMessage.bind(browser.runtime);browser.runtime.sendMessage=m=>{if(m.kind==="GET_DIAGNOSTICS")window.__visualDiagnosticReads++;return m.kind==="GET_VIEW"?Promise.reject(new Error("isolated UI transport failure")):window.__visualSend(m);};document.dispatchEvent(new Event("visibilitychange"));')
        wait_for(lambda:client.script('return !document.getElementById("retry-destinations").hidden;'),'truthful unavailable UI')
        shot('unavailable');page('settings');client.script('document.getElementById("diagnostics").open=true;document.getElementById("diagnostics").scrollIntoView();')
        wait_for(lambda:client.script('return window.__visualDiagnosticReads>0 && document.getElementById("runtime-diagnostic").textContent.length>0;'),'independent diagnostics during unavailable UI transport')
        shot('diagnostics');client.script('browser.runtime.sendMessage=window.__visualSend;document.getElementById("retry-destinations").click();')
        page('home');wait_for(lambda:client.script('return document.getElementById("retry-destinations").hidden;'),'UI transport restored')
        stress['fallbackAndUnavailableDiagnostics']=True
        assert ready()['controller']['snapshot']['policy']==policy
    return {'suite':'visual-redesign','baseline':baseline,'refinement':refined,'referenceViewport':reference_viewport,'navigationMedianMs':statistics.median(timings),'navigationSamplesMs':timings,
      'idle':idle,'dimensions':dimensions,'pinsPreserved':len(expected),'policyUnchanged':ready()['controller']['snapshot']['policy']==policy,
      'stress':stress,
      'normalProfileAccessed':False,'checks':['complete categories retained','pin order/reload/overflow','real pending access and frozen Vault review','small windows and actual browser zoom','idle DOM identity and storage writes']}
