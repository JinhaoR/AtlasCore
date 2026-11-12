"""Startup/viewport evidence. Uses a test-only head probe in disposable runtimes."""
import base64
from pathlib import Path
import shutil
import time


def instrument_runtime(source, target):
    """Change only a new disposable copy, never the supplied runtime or release."""
    source, target = Path(source).resolve(), Path(target).resolve()
    assert source != target and not target.exists(), 'new fixture output required'
    shutil.copytree(source, target)
    shutil.copyfile(Path(__file__).with_name('startup-layout-probe.js'), target/'ui/startup-probe.js')
    html = target/'ui/index.html'
    html.write_text(html.read_text(encoding='utf-8').replace('<title>', '<script src="startup-probe.js"></script><title>', 1), encoding='utf-8')
    bundle = target/'ui/main.js'; code = bundle.read_text(encoding='utf-8')
    for part, call in [('settings', 'renderSettings(controller, ready, now);'), ('sites', 'sites.render(ready && !busy);'), ('home', 'renderHome(controller?.snapshot?.policy, ready);')]:
        assert code.count(call) == 1, (part, 'unsupported fixture instrumentation target')
        code = code.replace(call, '{const started=performance.now();'+call+' (window.__startupProbe.profile??=[]).push({part:"'+part+'",at:started,ms:performance.now()-started});}')
    bundle.write_text(code, encoding='utf-8')
    return target


def run_startup_layout(client, ui_handle, ui_url, port, wait_for, run, restart_browser, baseline=False):
    def view(): return client.message({'kind': 'GET_VIEW'})['view']
    def ready(): return wait_for(lambda: (v := view()) and v.get('controller', {}).get('status') == 'READY' and v, 'verified startup fixture', 30)
    def script(text, *args): return client.script(text, *args)
    def shot(name): (run/(name+'.png')).write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)))
    def open_page(suffix=''):
        old = client.call('WebDriver:GetWindowHandles')
        client.call('Marionette:SetContext', value='chrome')
        script('gBrowser.selectedTab=gBrowser.addTrustedTab(arguments[0]);', ui_url+suffix)
        client.call('Marionette:SetContext', value='content')
        handle = wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in old), None), 'fresh control tab')
        client.call('WebDriver:SwitchToWindow', handle=handle)
        wait_for(lambda: script('return !!window.__startupProbe&&document.readyState!=="loading";'), 'startup probe')
        return handle
    def capture(name):
        start = time.monotonic(); shots = []
        for offset in [0, .15, .45, 1.2, 2.7]:
            remaining = start + offset - time.monotonic()
            if remaining > 0: time.sleep(remaining)
            shots.append({'at': script('return performance.now();'), 'file': name+'-'+str(offset)+'.png'})
            shot(name+'-'+str(offset))
        p = script('return window.__startupProbe;')
        p['shots'] = shots
        print('STARTUP', name, {k:p.get(k) for k in ['domAt','readyAt','cardsAt','fontsAt','assignments']}, 'icon requests',len(p['requests']),flush=True)
        return p
    def geometry():
        return script('''const measure=id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,client:e.clientHeight,scroll:e.scrollHeight,top:e.scrollTop,overflow:getComputedStyle(e).overflowY}};
          return {viewport:[innerWidth,innerHeight],document:document.documentElement.scrollHeight,main:measure('main-content'),left:{y:document.querySelector('.home-direction').getBoundingClientRect().y},categories:measure('destination-list'),toolbar:{y:document.querySelector('.category-toolbar').getBoundingClientRect().y},pins:measure('pinned-section')};''')
    initial = ready()['controller']['snapshot']; client.call('WebDriver:SetWindowRect', width=1586, height=1077)
    startup = {'initial': script('return window.__startupProbe;')}
    pins = ['service:mail.google.com','service:webmail.kth.se','service:chatgpt.com','service:github.com','service:arxiv.org','service:overleaf.com']
    script('localStorage.setItem("atlas-home-pins-v1",JSON.stringify(arguments[0]));',pins)
    ui_handle = open_page(); startup['fresh'] = capture('fresh')
    client.call('WebDriver:CloseWindow'); client.call('WebDriver:SwitchToWindow',handle=client.call('WebDriver:GetWindowHandles')[0])
    ui_handle = open_page(); startup['reopened'] = capture('reopened')
    client, ui_handle = restart_browser(); client.call('WebDriver:SetWindowRect', width=1586,height=1077)
    startup['restart'] = capture('restart')
    rendering = None
    if script('return !!window.__atlasPerf;'):
        from firefox_rendering_review import measure_rendering
        rendering = measure_rendering(client, run, baseline)
    before_requests = script('return window.__startupProbe.requests.length;')
    for name in ['show-sites','show-home','show-settings','show-home']:
        script('document.getElementById(arguments[0]).click();',name)
    script('document.querySelector(".category-shortcut").click();')
    time.sleep(1.1)
    first_visit_requests = script('return window.__startupProbe.requests.length;')
    first_visit_assignments = script('return window.__startupProbe.assignments;')
    script('window.__retainedIcons=[...document.querySelectorAll("#destination-list .site-icon")];document.getElementById("back-to-compass").click();document.querySelector(".category-shortcut").click();')
    time.sleep(.2)
    revisit = {'beforeNewViews':before_requests,'afterFirstVisit':first_visit_requests,'afterRepeat':script('return window.__startupProbe.requests.length;'), 'firstVisitAssignments':first_visit_assignments,'repeatAssignments':script('return window.__startupProbe.assignments;'), 'sameIconNodes':script('return window.__retainedIcons.every(n=>n.isConnected);')}
    if not baseline:
        assert revisit['afterFirstVisit']==revisit['afterRepeat'] and revisit['sameIconNodes'],revisit
        assert revisit['firstVisitAssignments']==revisit['repeatAssignments'],revisit
    script('document.getElementById("show-home").click();')
    # Synthetic display metadata only. No authority or policy write.
    hosts = ready()['controller']['snapshot']['policy']['whitelist']
    metadata = [{'id':'host:'+h,'primaryHostname':h,'hostnames':[h],'label':'Research destination '+str(i)+' with a long descriptive label','category':'Collection '+str(i%30).zfill(2)}for i,h in enumerate(hosts)]
    script('localStorage.setItem("atlas-destinations-v1",JSON.stringify({version:1,pending:null,destinations:arguments[0]}));localStorage.setItem("atlas-home-pins-v1",JSON.stringify(arguments[0].slice(0,14).map(x=>x.id)));',metadata)
    client.call('WebDriver:Refresh')
    wait_for(lambda:script('return document.querySelectorAll(".service-group").length>=30;'),'thirty categories')
    script('document.querySelector(".browse-categories").click();')
    time.sleep(.3); crowded = geometry();shot('crowded-categories')
    script('document.getElementById("customize-home").click();')
    modal = script('const e=document.getElementById("home-customization"),r=e.getBoundingClientRect();return {tag:e.tagName,open:e.open??false,modal:e.matches(":modal"),top:r.y,bottom:r.bottom,height:r.height,viewport:innerHeight,focus:document.activeElement.id};')
    shot('customization')
    if not baseline:
        assert crowded['document'] <= crowded['viewport'][1]+1, crowded
        assert crowded['categories']['scroll'] > crowded['categories']['client'] > 100,crowded
        assert modal['modal'] and modal['top']>=0 and modal['bottom']<=modal['viewport'],modal
    script('document.getElementById("close-home-customization").click();')
    checks = {} if baseline else verify_interactions(client, script, wait_for, geometry, shot, open_page)
    assert ready()['controller']['snapshot']['policy']==initial['policy']
    return {'suite':'startup-layout','baseline':baseline,'startup':startup,'rendering':rendering,'revisit':revisit,'crowded':crowded,'customization':modal,'interactions':checks,'policyUnchanged':True,'normalProfileAccessed':False,'controlledIcons':'450ms credential-free homepage and image responses, no-store; no real website credentials or live URLs logged'}


def verify_interactions(client, script, wait_for, geometry, shot, open_page):
    def key(value): client.call('WebDriver:PerformActions',actions=[{'type':'key','id':'layout-keys','actions':[{'type':'keyDown','value':value},{'type':'keyUp','value':value}]}])
    def wheel(delta):
        point=script('const r=document.getElementById("destination-list").getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];')
        client.call('WebDriver:PerformActions',actions=[{'type':'wheel','id':'layout-wheel','actions':[{'type':'scroll','origin':'viewport','x':point[0],'y':point[1],'deltaX':0,'deltaY':delta,'duration':100}]}])
        time.sleep(.2)
    before=geometry();wheel(480);large=geometry();wheel(32);small=geometry()
    assert large['categories']['top']>0 and small['categories']['top']>large['categories']['top'],(before,large,small)
    assert before['left']==small['left'] and before['toolbar']==small['toolbar'] and before['document']==small['document']
    script('document.getElementById("destination-list").focus();');key('\ue00f');time.sleep(.2)
    assert geometry()['categories']['top']>small['categories']['top'],'PageDown uses the category pane'
    saved_scroll=geometry()['categories']['top']
    script('document.getElementById("customize-home").click();')
    # Native modality prevents a tab cycle reaching the underlying page.
    for _ in range(110):
        key('\ue004')
        assert script('return document.getElementById("home-customization").contains(document.activeElement) || !document.hasFocus();'),'native Tab must not focus underlying page controls (browser chrome is allowed)'
    key('\ue00c')
    assert script('return !document.getElementById("home-customization").open && document.activeElement.id==="customize-home";')
    assert geometry()['categories']['top']==saved_scroll
    # Actual persistence failure is limited to this page's presentation store.
    script('document.getElementById("customize-home").click();window.__layoutPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==="layout")throw new DOMException("Synthetic layout failure","AbortError");return window.__layoutPut.apply(this,args);};document.querySelector("[data-layout-action=VISIBILITY]").click();')
    wait_for(lambda:script('return !document.getElementById("retry-home-layout").hidden && !document.getElementById("retry-home-layout").disabled;'),'layout failed-save feedback')
    failure=script('const e=document.getElementById("home-layout-status"),r=e.getBoundingClientRect();return {text:e.textContent,y:r.y,bottom:r.bottom,modal:document.getElementById("home-customization").open,viewport:innerHeight};')
    assert failure['modal'] and 0<=failure['y']<failure['bottom']<=failure['viewport'],failure
    shot('customization-failed-save');key('\ue00c');script('document.getElementById("customize-home").click();')
    assert script('return !document.getElementById("retry-home-layout").hidden;'),'unsaved change survives dialog close'
    script('IDBObjectStore.prototype.put=window.__layoutPut;document.getElementById("retry-home-layout").click();')
    wait_for(lambda:script('return document.getElementById("home-layout-status").textContent.startsWith("Home layout saved");'),'layout retry acknowledged')
    assert script('return document.getElementById("home-customization").open;'),'saving never dismisses the dialog'
    script('document.getElementById("close-home-customization").click();')
    # Complete category expansion stays within the same desktop scroll pane.
    script('const t=document.querySelector(".service-group:not([hidden]) .category-toggle");if(t&&!t.hidden)t.click();')
    assert geometry()['document']<=geometry()['viewport'][1]+1
    script('document.getElementById("back-to-compass").click();')
    pins=script('const e=document.getElementById("pinned-overflow-list");e.scrollTop=e.scrollHeight;return {primary:document.querySelectorAll("#pinned-primary .destination-card").length,extra:e.querySelectorAll(".destination-card").length,scroll:e.scrollTop,client:e.clientHeight,height:e.scrollHeight};')
    assert pins['primary']==6 and pins['extra']==8 and pins['scroll']>0,pins
    # Each scroll region is tested against populated content; long drafts and
    # complete Vault outcomes remain covered by the batch/management scenarios.
    panes=[]
    for nav,ident in [('show-sites','sites-list'),('show-settings','settings-workspace'),('show-vault','vault-contents')]:
        script('document.getElementById(arguments[0]).click();',nav);time.sleep(.2)
        panes.append(script('const e=document.getElementById(arguments[0]);return {id:e.id,overflow:getComputedStyle(e).overflowY,client:e.clientHeight,height:e.scrollHeight,document:document.documentElement.scrollHeight,viewport:innerHeight};',ident))
    assert panes[0]['height']>panes[0]['client']>100 and panes[0]['overflow']=='auto',panes
    sizes=[]
    for width,height,zoom in [(1586,1077,1),(1280,900,1),(1440,735,1),(500,900,1),(1586,1077,1.25),(1586,1077,1.5),(1586,1077,2)]:
        client.call('WebDriver:SetWindowRect',width=width,height=height)
        client.call('Marionette:SetContext',value='chrome');script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,arguments[0]);',zoom);client.call('Marionette:SetContext',value='content')
        for nav in ['show-home','show-sites','show-settings','show-vault']:
            script('document.getElementById(arguments[0]).click();',nav);time.sleep(.12)
            sample=script('return {page:arguments[0],viewport:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};',nav)
            assert not sample['overflow'],(width,height,zoom,sample)
            if nav == 'show-sites':
                assert script('''return [...document.querySelectorAll('.site-row')].every(e=>{
                  const r=e.getBoundingClientRect();return [...e.children].every(c=>{
                    const b=c.getBoundingClientRect();return b.top>=r.top-1&&b.bottom<=r.bottom+1&&b.left>=r.left-1&&b.right<=r.right+1;
                  });});'''),('row content stays inside its row',width,height,zoom)
            sizes.append({'zoom':zoom,**sample})
        script('document.getElementById("show-home").click();document.getElementById("customize-home").click();')
        assert script('const r=document.getElementById("home-customization").getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;'),(width,height,zoom)
        shot('layout-'+str(width)+'-'+str(height)+'-'+str(zoom));key('\ue00c')
    client.call('Marionette:SetContext',value='chrome');script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,1);');client.call('Marionette:SetContext',value='content')
    client.call('WebDriver:SetWindowRect',width=1586,height=1077)
    # Controlled late first view and failed favicons photograph the real loading
    # shell. This fixture delay is not a production timeout or performance sample.
    open_page('?atlasFixture=late-offline')
    shot('delayed-shell');time.sleep(1.2);shot('offline-ready')
    offline=script('return {ready:document.getElementById("destinations").dataset.phase,requests:window.__startupProbe.requests,fontsAt:window.__startupProbe.fontsAt,domAt:window.__startupProbe.domAt,frames:window.__startupProbe.frames};')
    assert offline['ready'] in ('READY', 'EMPTY'),offline
    assert not any(f.get('recoveryBanner') for f in offline['frames'] if f.get('phase')=='LOADING'),'pending read is not a recovery warning'
    assert script('return [...document.querySelectorAll("#pinned-section .site-icon")].every(i=>!!i.getAttribute("src"));'),'local fallback exists without icon service'
    return {'wheelAndFineScroll':True,'keyboardPageDown':True,'modalTabCycles':110,'escapeReturnFocusAndScroll':True,'failedSave':failure,'retryAcknowledged':True,'pins':pins,'panes':panes,'sizes':sizes,'offline':offline,'physicalTrackpadVerified':False}
