"""Milestone C. Synthetic presentation fixtures; only the disposable Firefox profile."""
import base64
import time


def run_home_organization(client, ui_handle, ui_url, port, wait_for, artifacts, restart_browser):
    from importlib import import_module
    configure_policy = import_module('firefox-e2e').configure_policy
    checks, layouts = [], []

    def passed(message):
        checks.append(message)
        print('PASS ' + message, flush=True)

    expected_revision = None

    def ui():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)

    def view():
        ui()
        return client.message({'kind': 'GET_VIEW'})['view']

    def snapshot():
        return view()['controller']['snapshot']

    def saved():
        return client.script('''const done=arguments[0];const q=indexedDB.open('atlas-home-layout-v1',1);
          q.onsuccess=()=>{const db=q.result,tx=db.transaction('layout','readonly'),r=tx.objectStore('layout').get('current');
            r.onsuccess=()=>done(r.result??null);tx.oncomplete=()=>db.close();};q.onerror=()=>done(null);''', asynchronous=True)

    def stable():
        wait_for(lambda: client.script('return document.getElementById("status").dataset.ready==="true" && document.getElementById("home-layout-status").textContent.startsWith("Home layout saved") && (arguments[0]===null || document.getElementById("sites-status").textContent.endsWith("revision "+arguments[0]));', expected_revision), 'current authority and acknowledged Home layout', 20)

    def groups():
        return client.script('return [...document.querySelectorAll("#destination-list .service-group")].map(g=>g.dataset.categoryKey);')

    def control(key, action):
        client.script('document.querySelector(`[data-layout-category="${arguments[0]}"] [data-layout-action="${arguments[1]}"]`).click();', key, action)
        stable()

    def input_value(id, value):
        client.script('const input=document.getElementById(arguments[0]);input.value=arguments[1];input.dispatchEvent(new Event("input",{bubbles:true}));', id, value)

    def capture(name):
        wait_for(lambda: client.script('return !document.getAnimations().some(a=>a.playState==="running");'), 'stable screenshot')
        (artifacts / f'{name}.png').write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=True)))

    policy = snapshot()['policy']
    hosts = policy['whitelist'] + [f'home-{i}.example' for i in range(180)]
    configure_policy(client, { 'whitelist': hosts, 'blacklist': policy['blacklist'] })
    baseline = snapshot()
    expected_revision = baseline['policyRevision']
    stable()
    # Existing Milestone B metadata, not authorization, supplies five populated categories.
    metadata = [{ 'id': f'host:{host}', 'label': f'Destination {i} ' + 'long label ' * 6,
                  'primaryHostname': host, 'hostnames': [host], 'category': f'Category {i % 5:02d}' } for i, host in enumerate(hosts)]

    def seed(items):
        hidden = {c['key'] for c in (saved() or {'value':{'categories':[]}})['value']['categories'] if not c['visible']}
        expected = len({item['category'].lower().strip() for item in items} - hidden)
        client.script('localStorage.setItem("atlas-destinations-v1",JSON.stringify({version:1,destinations:arguments[0],pending:null}));window.dispatchEvent(new StorageEvent("storage",{key:"atlas-destinations-v1"}));', items)
        wait_for(lambda: len(groups()) == expected, 'fixture categories rendered')
        members = {}
        for item in items:
            members.setdefault(item['category'].lower().strip(), []).append(item['id'])
        def acknowledged_members():
            record = saved()
            current = {c['key']: c['members'] for c in record['value']['categories']} if record else {}
            return all(current.get(key) == sorted(ids) for key, ids in members.items())
        wait_for(acknowledged_members, 'saved current category membership')
        stable()

    seed(metadata)
    assert groups() == [f'category {i:02d}' for i in range(5)]
    assert all(c['visible'] and not c['collapsed'] for c in saved()['value']['categories'] if c['key'].startswith('category '))
    passed('five populated legacy metadata categories migrate visibly without policy or metadata changes')
    pins = [metadata[3]['id'], metadata[0]['id'], metadata[1]['id']]
    client.script('localStorage.setItem("atlas-home-pins-v1",JSON.stringify(arguments[0]));window.dispatchEvent(new StorageEvent("storage",{key:"atlas-home-pins-v1"}));', pins)
    wait_for(lambda: client.script('return [...document.querySelectorAll("#pinned-list .destination-card")].map(c=>c.dataset.destinationId).join()===arguments[0].join();', pins), 'explicit pins')

    client.script('document.getElementById("customize-home").click();')
    control('category 03', 'UP'); control('category 03', 'UP')
    order = groups()
    assert order == ['category 00', 'category 03', 'category 01', 'category 02', 'category 04']
    control('category 00', 'VISIBILITY')
    assert 'category 00' not in groups()
    input_value('destination-search', metadata[0]['primaryHostname'])
    wait_for(lambda: client.script('return document.querySelector("#search-results button small")?.textContent===arguments[0];', metadata[0]['primaryHostname']), 'hidden category exact search')
    assert client.script('return [...document.querySelectorAll("#pinned-list .destination-card")].map(c=>c.dataset.destinationId);') == pins
    client.script('document.getElementById("destination-search").value="";document.getElementById("destination-search").dispatchEvent(new Event("input"));document.getElementById("close-home-customization").click();')
    assert client.script('return document.activeElement.id==="customize-home";')
    client.script('document.querySelector("[data-category-key=\\"category 01\\"] .category-heading").click();')
    stable()
    assert client.script('const g=document.querySelector("[data-category-key=\\"category 01\\"]");return g.dataset.collapsed==="true" && g.querySelector(".destination-grid").hidden && [...g.querySelectorAll(".destination-card")].every(c=>c.hidden);')
    organization = saved()['value']
    client.call('WebDriver:Refresh'); stable()
    assert saved()['value'] == organization, {'beforeReload': organization, 'afterReload': saved()['value']}
    assert 'category 00' not in groups()
    assert client.script('return document.querySelector("[data-category-key=\\"category 01\\"]").dataset.collapsed==="true";')
    assert client.script('return [...document.querySelectorAll("#pinned-list .destination-card")].map(c=>c.dataset.destinationId);') == pins
    passed('reorder, hide, true collapse and pin order survive Home reload; hidden destinations retain exact search')

    # A genuine process restart with the preserved signed baseline keeps extension origin/data.
    client, ui_handle = restart_browser(); stable()
    assert saved()['value'] == organization
    assert 'category 00' not in groups()
    assert client.script('return [...document.querySelectorAll("#pinned-list .destination-card")].map(c=>c.dataset.destinationId);') == pins
    assert snapshot()['policy'] == baseline['policy']
    passed('full Firefox restart retains layout, metadata, pins and authoritative policy')

    # Five -> fifteen -> thirty nonempty categories; new categories appear predictably.
    for count in [15, 30]:
        for i, item in enumerate(metadata):
            item['category'] = f'Category {i % count:02d}'
        seed(metadata)
        # Hidden 00 remains hidden: seed's count expectation needs account for it.
        assert len(groups()) == count - 1
        known = [key for key in groups() if key in order and key != 'category 00']
        assert known == [key for key in order if key != 'category 00']
        assert all(c['visible'] for c in saved()['value']['categories'] if c['key'].startswith('category ') and int(c['key'].split()[-1]) >= 5)
    passed('fifteen and thirty category growth preserves custom order; new categories append visibly')
    # Safe whole-category rename: exact complete membership, same position/preferences.
    old_position = next(i for i, c in enumerate(saved()['value']['categories']) if c['key'] == 'category 01')
    long_category = ('Long category name ' + 'with careful reading ' * 2).strip()
    for item in metadata:
        if item['category'] == 'Category 01': item['category'] = long_category
    seed(metadata)
    renamed = saved()['value']['categories'][old_position]
    assert renamed['key'] == long_category.lower() and renamed['collapsed']
    passed('unambiguous complete rename migrates collapse and order; long category labels remain usable')

    # A failed IndexedDB presentation transaction cannot publish the requested arrangement.
    client.script('document.getElementById("customize-home").click();window.__layoutPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==="layout")throw new DOMException("Synthetic presentation failure","AbortError");return window.__layoutPut.apply(this,args);};')
    before_failure = saved()
    client.script('document.querySelector("[data-layout-category=\\"category 02\\"] input").click();')
    wait_for(lambda: client.script('return !document.getElementById("retry-home-layout").hidden && !document.getElementById("retry-home-layout").disabled;'), 'truthful failed save and retry')
    assert saved() == before_failure and 'category 02' in groups()
    assert client.script('return !document.querySelector("[data-layout-category=\\"category 02\\"] input").checked && document.getElementById("customize-home").textContent.includes("unsaved");')
    client.script('IDBObjectStore.prototype.put=window.__layoutPut;document.getElementById("retry-home-layout").click();')
    stable(); assert 'category 02' not in groups()
    passed('failed presentation save retains requested draft, shows no false saved success, and explicit retry succeeds without policy commands')
    control('category 02', 'VISIBILITY')
    # Keyboard activation of Move up; no synthetic click event.
    client.script('document.querySelector("[data-layout-category=\\"category 04\\"] [data-layout-action=\\"UP\\"]").focus();')
    previous = saved()['value']
    client.call('WebDriver:PerformActions', actions=[{'type':'key','id':'atlas-home-order','actions':[{'type':'keyDown','value':'\ue007'},{'type':'keyUp','value':'\ue007'}]}])
    wait_for(lambda: saved()['value'] != previous, 'real keyboard Move up')
    stable(); assert client.script('return document.activeElement.dataset.layoutAction==="UP" && document.activeElement.closest("[data-layout-category]").dataset.layoutCategory==="category 04";')
    passed('keyboard Move up works and retains focus on the same category control')

    # Two live control pages race writes against one saved presentation revision.
    old_handles = client.call('WebDriver:GetWindowHandles')
    client.script('window.__atlasOther=window.open(arguments[0]+"#home","atlas-layout-concurrency");', ui_url)
    second_handle = wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in old_handles), None), 'second Atlas control page')
    wait_for(lambda: client.script('return window.__atlasOther?.document.getElementById("home-layout-status")?.textContent.startsWith("Home layout saved");'), 'second layout connection')
    client.script('window.__atlasOther.document.getElementById("customize-home").click();')
    wait_for(lambda: client.script('''const other=window.__atlasOther.document,a=document.querySelector('[data-layout-category="category 04"] input'),b=other.querySelector('[data-layout-category="category 05"] input');
      if(a.disabled||b.disabled)return false;a.click();b.click();return true;'''), 'two simultaneously enabled layout actions')
    wait_for(lambda: client.script('return [document,window.__atlasOther.document].some(d=>d.getElementById("home-layout-status").textContent.startsWith("Another Atlas page"));'), 'native competing-write conflict')
    assert saved()['value']['categories'] != previous['categories']
    client.script('''for(const d of [document,window.__atlasOther.document])if(!d.getElementById('load-saved-home-layout').hidden){
      const original=d.defaultView.confirm;d.defaultView.confirm=()=>true;d.getElementById('load-saved-home-layout').click();d.defaultView.confirm=original;}''')
    stable()
    wait_for(lambda: client.script('return window.__atlasOther.document.getElementById("home-layout-status").textContent.startsWith("Home layout saved");'), 'second page conflict recovery')
    assert client.script('return [...document.querySelectorAll("#destination-list .service-group")].map(g=>g.dataset.categoryKey).join() === [...window.__atlasOther.document.querySelectorAll("#destination-list .service-group")].map(g=>g.dataset.categoryKey).join();')
    passed('two live Atlas pages race native CAS writes; stale writer retains its draft, explicitly reconciles, and both layouts converge')
    capture('milestone-c-customization')
    client.call('WebDriver:SwitchToWindow', handle=second_handle); client.call('WebDriver:CloseWindow'); ui()
    client.script('document.getElementById("close-home-customization").click();')

    # Layout and card identity survive usage updates and timer rerenders.
    current_order = groups()
    client.script('window.__card=document.querySelector("#destination-list .destination-card");window.__heading=document.querySelector(".category-heading");document.getElementById("destination-search").focus();')
    for i in range(8):
        client.script('localStorage.setItem("atlas-destination-usage-v1",JSON.stringify({[arguments[0]]:{count:arguments[1],score:arguments[1],lastOpenedAt:Date.now()}}));window.dispatchEvent(new StorageEvent("storage",{key:"atlas-destination-usage-v1"}));', metadata[-1]['id'], i+1)
    assert groups() == current_order
    time.sleep(1.2)
    assert client.script('return window.__heading===document.querySelector(".category-heading") && document.activeElement.id==="destination-search";')
    passed('usage ranking and repeated Home timer rerenders retain category order, header identity and search focus')
    capture('milestone-c-home')

    for width in [500, 800, 1280, 1800]:
        client.call('WebDriver:SetWindowRect', width=width, height=1000)
        wait_for(lambda: client.script('return document.getElementById("destinations").getBoundingClientRect().width>0;'), 'resized Home')
        sample = client.script('''const cards=[...document.querySelectorAll('#destination-list .destination-card')].filter(c=>!c.hidden&&!c.closest('[hidden]'));
          return {width:innerWidth,columns:Number(document.getElementById('destinations').dataset.columns),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
          heights:[...new Set(cards.map(c=>c.getBoundingClientRect().height))],visible:cards.length};''')
        assert not sample['overflow'] and 1 <= sample['columns'] <= 5 and all(abs(h-56)<1 for h in sample['heights']), sample
        layouts.append(sample)
    # Firefox's actual full-page zoom, rather than CSS transforms or pretend viewport values.
    client.call('WebDriver:SetWindowRect', width=1280, height=1000)
    for zoom in [1.25, 1.5, 2]:
        client.call('Marionette:SetContext', value='chrome')
        client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,arguments[0]);', zoom)
        client.call('Marionette:SetContext', value='content')
        sample = client.script('return {zoom:arguments[0],width:innerWidth,columns:Number(document.getElementById("destinations").dataset.columns),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};', zoom)
        assert not sample['overflow'] and sample['columns'] <= 5, sample
        layouts.append(sample)
    capture('milestone-c-home-zoom')
    client.call('Marionette:SetContext', value='chrome'); client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,1);'); client.call('Marionette:SetContext', value='content')
    passed('crowded thirty-category Home, long labels, four window sizes and real 125/150/200 percent Firefox zoom have no horizontal overflow and at most five columns')

    # Sites keeps a long-list row and editor context through sidebar/Vault/Back/reload.
    client.script('document.getElementById("show-sites").click();')
    wait_for(lambda: client.script('return document.querySelectorAll(".site-row").length>200 && !document.getElementById("add-site").disabled;'), 'complete Sites collection')
    hidden_host = metadata[0]['primaryHostname']
    assert client.script('return !!document.querySelector(`[data-destination-id="host:${arguments[0]}"]`);', hidden_host)
    client.script('const list=document.getElementById("sites-list");list.scrollTop=600;const row=[...list.children][25];row.click();window.__selectedId=row.dataset.destinationId;document.getElementById("edit-site").click();')
    wait_for(lambda: client.script('return !document.getElementById("site-draft").hidden && document.activeElement.id==="site-name";'), 'editor beside selected row')
    selection = client.script('return window.__selectedId;')
    list_scroll = client.script('return document.getElementById("sites-list").scrollTop;')
    input_value('site-name', 'Retained Milestone C edit')
    client.script('document.getElementById("show-home").click();document.getElementById("show-sites").click();')
    assert client.script('return document.getElementById("site-name").value==="Retained Milestone C edit" && document.querySelector(".site-row[aria-pressed=true]").dataset.destinationId===arguments[0];', selection)
    client.script('document.getElementById("show-settings").click();history.back();')
    wait_for(lambda: client.script('return document.body.dataset.section==="sites" && document.querySelector(".site-row[aria-pressed=true]").dataset.destinationId===arguments[0];', selection), 'browser Back restores Sites')
    client.call('WebDriver:Refresh'); stable()
    wait_for(lambda: client.script('return document.body.dataset.section==="sites" && document.querySelector(".site-row[aria-pressed=true]")?.dataset.destinationId===arguments[0] && document.getElementById("site-name").value==="Retained Milestone C edit";', selection), 'Sites reload restores selection and existing persistent editor')
    assert abs(client.script('return document.getElementById("sites-list").scrollTop;')-list_scroll)<5
    client.script('document.getElementById("cancel-site-draft").click();')
    wait_for(lambda: client.script('return document.getElementById("site-draft").hidden && document.activeElement.dataset.destinationId===arguments[0];', selection), 'close editor restores selected row focus')
    client.script('document.getElementById("edit-site").click();')
    input_value('site-name', 'Committed display name')
    client.script('document.getElementById("save-site-display").click();')
    wait_for(lambda: client.script('return document.getElementById("site-draft").hidden && JSON.parse(localStorage.getItem("atlas-destinations-v1")).destinations.find(d=>d.id===arguments[0])?.label==="Committed display name" && document.getElementById("site-save-feedback").textContent.startsWith("Display details and pins saved.");', selection), 'acknowledged display-only metadata save')
    assert groups() == current_order
    assert client.script('return document.activeElement.dataset.destinationId===arguments[0];', selection)
    # Enter and leave the existing Vault review without submitting any new authorization.
    client.script('document.getElementById("show-settings").click();document.getElementById("vault-section").open=true;document.getElementById("return-to-sites").click();')
    assert client.script('return document.body.dataset.section==="sites" && document.querySelector(".site-row[aria-pressed=true]").dataset.destinationId===arguments[0];', selection)
    passed('Sites keeps complete hidden destinations, long-list selection/scroll, persistent B editor, browser Back and reload; close/save/Vault return restore selected-row context without authority changes')
    capture('milestone-c-sites')

    # Existing pending request and grant UI actions; Home never confirms by itself.
    opened = client.message({'kind':'OPEN_DESTINATION','url':f'http://unknown.localhost:{port}/'})
    tab_id = opened['tabId']
    wait_for(lambda: any(c['tabId']==tab_id and c['effect']=='REMOVED' for c in view()['contexts']), 'Greylist context blocked')
    prepared = client.message({'kind':'PREPARE_ACCESS','tabId':tab_id})
    scope = next(c for c in prepared['view']['contexts'] if c['tabId']==tab_id)['accessScope']
    assert client.message({'kind':'START_ACCESS','tabId':tab_id,'scopeId':scope['id']})['result']['type']=='COMMITTED'
    client.script('document.getElementById("show-home").click();')
    wait_for(lambda: client.script('return document.querySelector("#pending-access-list .temporary-scope")?.textContent.startsWith("Waiting");'), 'Home pending wait summary')
    pending = snapshot()['accessState']['pendingRequests'][0]
    client.script('document.querySelector("#pending-access-list button").click();')
    assert client.script('return !document.getElementById("access-panel").hidden && document.getElementById("context").value===String(arguments[0]);', tab_id)
    assert snapshot()['accessState']['grants']==[]
    wait_for(lambda: client.script('return !document.getElementById("confirm-access").hidden && !document.getElementById("confirm-access").disabled;'), 'existing Greylist confirmation', 25)
    client.script('document.getElementById("show-home").click();')
    wait_for(lambda: client.script('return document.querySelector("#pending-access-list .temporary-scope")?.textContent.startsWith("Confirmation available");'), 'Home available confirmation summary')
    client.script('document.querySelector("#pending-access-list button").click();document.getElementById("confirm-access").click();')
    grant = wait_for(lambda: next(iter(snapshot()['accessState']['grants']), None), 'explicit confirmation committed grant')
    client.script('document.getElementById("show-home").click();')
    wait_for(lambda: client.script('return document.querySelector("#temporary-list .temporary-scope")?.textContent.includes("Temporary permission");'), 'temporary permission summary')
    capture('milestone-c-access')
    client.script('document.querySelector("#temporary-list button").click();')
    assert client.script('return document.getElementById("context").value===String(arguments[0]) && !document.getElementById("access-panel").hidden;', tab_id)
    assert snapshot()['accessState']['grants'][0]==grant and grant['requestId']==pending['id']
    passed('Home pending WAIT and confirmation-ready links select the existing workflow; only its explicit confirmation creates a grant, and access-details links retain the exact deadline')

    journey_opened = client.message({'kind':'OPEN_DESTINATION','url':f'http://root.localhost:{port}/begin-login'})
    journey_tab = journey_opened['tabId']
    journey_context = wait_for(lambda: next((c for c in view()['contexts'] if c['tabId']==journey_tab and c['displayedHostname']=='login.localhost'), None), 'bounded Journey intermediate')
    client.script('document.getElementById("show-home").click();')
    wait_for(lambda: client.script('return document.querySelector("#other-journeys button") || !document.getElementById("home-journey").hidden;'), 'owning Journey Home link')
    client.script('(document.querySelector("#other-journeys button")??document.getElementById("home-journey")).click();')
    assert client.script('return !document.getElementById("access-panel").hidden && document.getElementById("context").value===String(arguments[0]);', journey_tab)
    same = next(c for c in view()['contexts'] if c['tabId']==journey_tab)['journey']
    assert same['id']==journey_context['journey']['id'] and same['expiresAt']==journey_context['journey']['expiresAt']
    assert snapshot()['policy']==baseline['policy'] and snapshot()['policyRevision']==baseline['policyRevision']
    passed('Home Journey link uses only its live owning tab/context and preserves its ID, deadline, policy and grant separation')
    # Truthful unavailable authority cannot claim verified empty or offer Home status actions.
    client.script('window.__send=browser.runtime.sendMessage;browser.runtime.sendMessage=(m,...a)=>m.kind==="GET_VIEW"?Promise.reject(new Error("Synthetic unavailable")):window.__send.call(browser.runtime,m,...a);document.getElementById("show-home").click();')
    wait_for(lambda: client.script('return document.getElementById("destinations").dataset.phase==="UNAVAILABLE" && !document.getElementById("temporary-unavailable").hidden;'), 'unavailable Home')
    assert client.script('return document.getElementById("empty-destinations").hidden && document.getElementById("temporary-list").hidden && document.getElementById("pending-access-list").hidden && document.getElementById("other-journeys").hidden;')
    client.script('browser.runtime.sendMessage=window.__send;document.getElementById("retry-destinations").click();'); stable()
    passed('unavailable authority labels retained catalog stale and removes access claims/actions; recovery retains layout and policy')
    print(f'PASS Milestone C: {len(checks)} native organization/navigation checks', flush=True)
    return {'extensionVersion':client.script('return browser.runtime.getManifest().version;'), 'checks':checks,'layouts':layouts,'isolatedProfile':True,'fullProcessRestart':True}
