"""Native rendering races and controls; every browser/profile/fixture is disposable."""
import json
import time
from importlib import import_module
from firefox_ui_stability import INSTRUMENT


def run_interactions(client, ui_handle, ui_url, port, wait_for, artifacts, baseline=False, indicator_only=False):
    checks, observations = [], []

    def passed(message):
        checks.append(message)
        print('PASS ' + message, flush=True)

    def ui():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)

    def ready():
        wait_for(lambda: client.script('return document.getElementById("destinations").dataset.phase==="READY" && !document.getElementById("add-site").disabled;'), 'ready interaction fixture')

    if indicator_only:
        observation = run_indicator(client, ui_handle, port, wait_for, artifacts)
        return {'suite':'ui-stability-indicator','observations':[observation]}

    ui()
    state = client.message({'kind': 'GET_VIEW'})['view']['controller']['snapshot']
    hosts = ['canvas.kth.se', 'canvas.instructure.com', 'learn.canvas.net', 'github.com']
    assert set(hosts) <= set(state['policy']['whitelist'])
    metadata = [
        {'id':'service:canvas.kth.se', 'label':'Paired library', 'primaryHostname':hosts[0], 'hostnames':hosts[:3], 'category':'Research'},
        {'id':'service:github.com', 'label':'Ranking library', 'primaryHostname':hosts[3], 'hostnames':[hosts[3],'www.github.com'], 'category':'Research'}]
    client.script('localStorage.setItem("atlas-destinations-v1",JSON.stringify({version:1,destinations:arguments[0],pending:null}));window.dispatchEvent(new StorageEvent("storage",{key:"atlas-destinations-v1"}));', metadata)
    ready()
    wait_for(lambda: client.script('''return document.querySelector('#destination-list .destination-card[data-destination-id="service:canvas.kth.se"] .destination-name')?.textContent==='Paired library';'''), 'prepared multiple-entry-point fixture')
    client.script('''window.__stableCard=document.querySelector('#destination-list [data-destination-id="service:canvas.kth.se"]');
      window.__stableHeading=window.__stableCard.closest('.service-group').querySelector('.category-heading');
      const d=window.__stableCard.querySelector('details'),s=d.querySelector('select');d.open=true;s.value='canvas.instructure.com';
      s.dispatchEvent(new Event('change'));s.focus({preventScroll:true});
      localStorage.setItem('atlas-destination-usage-v1',JSON.stringify({'service:github.com':{count:100,score:100,lastOpenedAt:Date.now()}}));
      window.dispatchEvent(new StorageEvent('storage',{key:'atlas-destination-usage-v1'}));''')
    time.sleep(3)
    identity = client.script('''const card=document.querySelector('#destination-list [data-destination-id="service:canvas.kth.se"]');return {
      cardSame:window.__stableCard===card,oldConnected:window.__stableCard.isConnected,open:card.querySelector('details').open,
      selected:card.querySelector('select').value,headingSame:window.__stableHeading===card.closest('.service-group').querySelector('.category-heading'),
      focusSame:document.activeElement===card.querySelector('select')};''')
    observations.append({'case':'usage-entry-point',**identity})
    print('Entry-point identity: ' + json.dumps(identity), flush=True)
    if baseline:
        client.script('''window.__actualSend=browser.runtime.sendMessage;
          browser.runtime.sendMessage=(m,...a)=>m.kind==='GET_VIEW'?Promise.reject(Error('Synthetic adapter failure')):window.__actualSend.call(browser.runtime,m,...a);''')
        wait_for(lambda: client.script('return document.getElementById("destinations").dataset.phase==="UNAVAILABLE";'), 'baseline failed authority')
        client.script(INSTRUMENT)
        for _ in range(6):
            client.script('document.getElementById("retry-destinations").click();')
            time.sleep(.1)
        time.sleep(5)
        stats = client.script('const s=window.__stability.sample();window.__stability.stop();return s.stats;')
        observations.append({'case':'retry-timer-ownership',**stats})
        print('Baseline retry timers: ' + json.dumps(stats), flush=True)
        return {'suite':'ui-stability-interactions','baseline':True,'checks':checks,'observations':observations}
    assert identity['cardSame'] and identity['oldConnected'] and identity['open'] and identity['headingSame'] and identity['focusSame'] and identity['selected']=='canvas.instructure.com', identity
    passed('usage reordering retains the exact card, focused entry-point selector, selected hostname and open disclosure')

    client.script('''window.__actualSend=browser.runtime.sendMessage;window.__opened=null;
      browser.runtime.sendMessage=function(m,...args){if(m.kind==='OPEN_DESTINATION'){window.__opened=m.url;return Promise.resolve({error:'SYNTHETIC_EFFECT_WITHHELD'});}return window.__actualSend.call(this,m,...args);};
      window.__stableCard.querySelector('.destination-open').click();''')
    wait_for(lambda: client.script('return window.__opened==="https://canvas.instructure.com/";'), 'exact chosen launcher message')
    ui()
    client.script('browser.runtime.sendMessage=window.__actualSend;')
    ready()
    passed('retained entry-point selection sends the exact adapter command; this fixture withholds the external browser effect')

    client.script(INSTRUMENT)
    client.script('''for(let i=0;i<40;i++)for(const key of ['atlas-destinations-v1','atlas-home-pins-v1','atlas-destination-usage-v1'])
      window.dispatchEvent(new StorageEvent('storage',{key}));''')
    time.sleep(3)
    stats = client.script('const s=window.__stability.sample();window.__stability.stop();return s.stats;')
    observations.append({'case':'unchanged-storage-notifications', **stats})
    assert stats['replacements'].get('destination-list', 0) == 0 and stats['replacements'].get('sites-list', 0) == 0, stats
    assert stats['regions'].get('destination-list', 0) == 0, stats
    passed('120 identical storage notifications leave destination structure and attributes unchanged')

    # A read held across a newer explicit editor verification must not restore old UI authority.
    client.script('''window.__actualSend=browser.runtime.sendMessage;window.__heldView=null;window.__holdNextView=true;
      browser.runtime.sendMessage=function(m,...args){if(m.kind==='GET_VIEW'&&window.__holdNextView){window.__holdNextView=false;
        return window.__actualSend.call(this,m,...args).then(response=>new Promise(resolve=>window.__heldView=()=>resolve({view:{...response.view,controller:{...response.view.controller,status:'UNAVAILABLE',reason:'SYNTHETIC_OLD_RESPONSE'}}})));}
        return window.__actualSend.call(this,m,...args);};''')
    wait_for(lambda: client.script('return typeof window.__heldView==="function";'), 'held old poll')
    client.script('document.getElementById("show-sites").click();document.getElementById("add-site").click();')
    wait_for(lambda: client.script('return !document.getElementById("site-draft").hidden;'), 'new verified editor action')
    client.script('''const e=document.getElementById('site-name');e.value='Keep my unfinished work';e.dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('show-home').click();document.querySelector('.open-address').open=true;
      document.getElementById('destination').value=arguments[0];document.getElementById('journey-form').requestSubmit();''', f'http://root.localhost:{port}/')
    wait_for(lambda: client.script('return document.getElementById("status").textContent==="Atlas is ready" && document.getElementById("hostname").textContent==="root.localhost";'), 'new acknowledged navigation operation')
    ui()
    client.script('''document.getElementById('show-sites').click();const e=document.getElementById('site-name');e.focus({preventScroll:true});
      e.setSelectionRange(2,5);window.__heldView();''')
    time.sleep(.25)
    observed = client.script('return {ready:document.getElementById("status").dataset.ready,focus:document.activeElement.id,value:document.getElementById("site-name").value,start:document.getElementById("site-name").selectionStart,end:document.getElementById("site-name").selectionEnd};')
    assert observed == {'ready':'true','focus':'site-name','value':'Keep my unfinished work','start':2,'end':5}, observed
    client.script('browser.runtime.sendMessage=window.__actualSend;')
    passed('an out-of-order failed poll cannot overwrite a newer verified operation or the active draft/caret')

    client.script('''window.__actualSend=browser.runtime.sendMessage;
      browser.runtime.sendMessage=(m,...a)=>m.kind==='GET_VIEW'?Promise.reject(Error('Synthetic adapter failure')):window.__actualSend.call(browser.runtime,m,...a);''')
    wait_for(lambda: client.script('return document.getElementById("destinations").dataset.phase==="UNAVAILABLE";'), 'truthful failed authority')
    assert client.script('''return !document.getElementById('site-draft').hidden && document.getElementById('site-name').value==='Keep my unfinished work'
      &&document.activeElement.id==='site-name'&&document.activeElement.selectionStart===2
      &&[...document.querySelectorAll('.destination-open')].every(e=>e.disabled);''')
    client.script(INSTRUMENT)
    for _ in range(6):
        client.script('document.getElementById("retry-destinations").click();')
        time.sleep(.1)
    time.sleep(5)
    stats = client.script('const s=window.__stability.sample();window.__stability.stop();return s.stats;')
    observations.append({'case':'retry-timer-ownership',**stats})
    assert stats['maxTimers'] <= 1 and stats['messages'].get('GET_VIEW',0) <= 12, stats
    client.script('browser.runtime.sendMessage=window.__actualSend;document.getElementById("retry-destinations").click();')
    ready()
    assert client.script('return document.getElementById("site-name").value==="Keep my unfinished work";')
    passed('failed authority retains work/focus, disables launchers and read-only retries retain one timer before recovery')

    # Diagnostics has its own latest-request fence and does not share Core authority.
    client.script('''document.getElementById('show-settings').click();window.__actualSend=browser.runtime.sendMessage;
      window.__releaseDiagnostic=null;window.__holdDiagnostic=true;
      const entry=(sequence,hostname)=>({sequence,at:null,event:'COMMAND',tabId:0,contextId:'synthetic',navigationId:0,
        hostname,outcome:null,reason:null,method:null,sourceHostname:null,continuationKind:null,journey:null});
      browser.runtime.sendMessage=function(m,...a){if(m.kind==='GET_DIAGNOSTICS'){
        if(window.__holdDiagnostic){window.__holdDiagnostic=false;return new Promise(resolve=>window.__releaseDiagnostic=()=>resolve({entries:[entry(111,'older.example')]}));}
        return Promise.resolve({entries:[entry(222,'newer.example')]});}
        return window.__actualSend.call(this,m,...a);};document.getElementById('diagnostics').open=true;''')
    wait_for(lambda: client.script('return typeof window.__releaseDiagnostic==="function";'), 'held diagnostic response')
    client.script('const e=document.getElementById("diagnostic-scope");e.value="all";e.dispatchEvent(new Event("change"));')
    wait_for(lambda: client.script('return document.getElementById("diagnostic-rows").textContent.includes("newer.example");'), 'new diagnostic scope')
    client.script('window.__releaseDiagnostic();')
    time.sleep(.25)
    assert client.script('return document.getElementById("diagnostic-rows").textContent.includes("newer.example")&&!document.getElementById("diagnostic-rows").textContent.includes("older.example");')
    client.script('browser.runtime.sendMessage=window.__actualSend;document.getElementById("diagnostics").open=false;')
    passed('late diagnostics from a previous scope cannot replace newer results')

    client.script('document.getElementById("show-home").click();document.getElementById("customize-home").click();')
    wait_for(lambda: client.script('return !document.querySelector("#home-layout-list input").disabled;'), 'customization controls')
    client.script('''window.__stabilityPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){
      if(this.name==='layout')throw new DOMException('Synthetic layout failure','AbortError');return window.__stabilityPut.apply(this,a);};
      document.querySelector('#home-layout-list input').click();''')
    wait_for(lambda: client.script('return !document.getElementById("retry-home-layout").hidden;'), 'retained unsaved layout')
    assert client.script('return document.getElementById("home-layout-status").textContent.includes("not verified as saved");')
    client.script('IDBObjectStore.prototype.put=window.__stabilityPut;document.getElementById("retry-home-layout").click();')
    wait_for(lambda: client.script('return document.getElementById("home-layout-status").textContent.startsWith("Home layout saved");'), 'explicit layout retry')
    client.script('document.getElementById("close-home-customization").click();document.getElementById("show-sites").click();window.__toolbarMarker={};')
    passed('failed layout saves retain unsaved work and recover only after acknowledged retry')

    # Native Firefox toolbar activation must reuse this document, including its draft.
    client.script('const done=arguments[arguments.length-1];browser.tabs.create({url:"about:blank",active:true}).then(t=>done(t.id));', asynchronous=True)
    client.call('Marionette:SetContext', value='chrome')
    toolbar = client.script('''const id="atlas-development_atlas_invalid-browser-action";
      CustomizableUI.addWidgetToArea(id, CustomizableUI.AREA_NAVBAR);
      const node=CustomizableUI.getWidget(id)?.forWindow(window).node;
      return node?.querySelector('.unified-extensions-item-action-button') ?? node;''')
    assert toolbar
    client.call('WebDriver:ElementClick', id=toolbar['element-6066-11e4-a52e-4f735466cecf'])
    wait_for(lambda: client.script('return gBrowser.selectedBrowser.currentURI.spec.startsWith(arguments[0]);', ui_url), 'native toolbar selects existing control page')
    client.call('Marionette:SetContext', value='content')
    ui()
    assert client.script('return !!window.__toolbarMarker && document.body.dataset.section==="sites" && document.getElementById("site-name").value==="Keep my unfinished work";')
    passed('actual Firefox toolbar activation reuses Sites without reloading or discarding the persistent editor')

    observations.append(run_indicator(client, ui_handle, port, wait_for, artifacts))
    passed('passive Journey indicator retains host/label for 60 seconds, mutates only countdown text and keeps its fixed Core deadline')
    (artifacts/'interactions.json').write_text(json.dumps({'checks':checks,'observations':observations},indent=2),encoding='utf-8')
    return {'suite':'ui-stability-interactions','checks':checks,'observations':observations}


def run_indicator(client, ui_handle, port, wait_for, artifacts):
    def ui():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
    ui()
    state = client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    before = set(client.call('WebDriver:GetWindowHandles'))
    launched = client.message({'kind':'OPEN_JOURNEY','url':f'http://root.localhost:{port}/begin-login'})
    assert launched['result']['type'] == 'COMMITTED', launched
    handle = wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in before), None), 'Journey document')
    client.call('WebDriver:SwitchToWindow', handle=handle)
    wait_for(lambda: client.script('return !!document.getElementById("atlas-journey-indicator")?.shadowRoot;'), 'passive indicator')
    client.script('''window.__indicator=document.getElementById('atlas-journey-indicator');window.__indicatorLabel=window.__indicator.shadowRoot.querySelector('span');
      window.__indicatorStats={attributes:0,childList:0,added:0,removed:0};window.__indicatorObserver=new MutationObserver(records=>{
        for(const m of records){if(m.type==='attributes')window.__indicatorStats.attributes++;if(m.type==='childList'){
          window.__indicatorStats.childList++;window.__indicatorStats.added+=m.addedNodes.length;window.__indicatorStats.removed+=m.removedNodes.length;}}});
      window.__indicatorObserver.observe(window.__indicator,{attributes:true});window.__indicatorObserver.observe(window.__indicator.shadowRoot,{subtree:true,childList:true,attributes:true});''')
    started = time.monotonic()
    indicator_samples = []
    for tick in range(12):
        time.sleep(max(0, started+(tick+1)*5-time.monotonic()))
        sample = client.script('return {stats:{...window.__indicatorStats},hidden:document.hidden,probeClear:document.documentElement.dataset.atlasProbeClear??null,actualExists:!!document.getElementById("atlas-journey-indicator"),hostStable:window.__indicator===document.getElementById("atlas-journey-indicator"),labelStable:window.__indicatorLabel===window.__indicator.shadowRoot.querySelector("span"),time:window.__indicator.shadowRoot.querySelectorAll("span")[1].textContent};')
        indicator_samples.append(sample)
        (artifacts/'indicator-samples.json').write_text(json.dumps(indicator_samples,indent=2),encoding='utf-8')
        if not sample['hostStable']:
            ui()
            latest = client.message({'kind':'GET_VIEW'})['view']
            owner = next(c for c in latest['contexts'] if c['tabId']==launched['tabId'])
            print('Indicator removal:', json.dumps({'sample':sample,'status':latest['controller']['status'],'effect':owner['effect'],'latest':owner['latest'],'journey':owner['journey']}), flush=True)
        assert sample['hostStable'] and sample['labelStable'], sample
    client.script('window.__indicatorObserver.disconnect();')
    assert indicator_samples[-1]['stats']['attributes'] == 0, indicator_samples
    assert 40 <= indicator_samples[-1]['stats']['childList'] <= 65, indicator_samples
    ui()
    active = client.message({'kind':'GET_VIEW'})['view']
    journey = next(c['journey'] for c in active['contexts'] if c['tabId']==launched['tabId'])
    assert journey['expiresAt']-journey['startedAt'] == state['configuration']['journeyLimits']['lifetimeMs']
    return {'case':'passive-indicator', 'seconds':round(time.monotonic()-started,2), 'samples':indicator_samples}
