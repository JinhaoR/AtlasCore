"""Release evidence in synthetic, isolated profiles; never shipped as runtime."""
from copy import deepcopy
import statistics
import time


def run_history_navigation(client, port, wait_for):
    def view(): return client.message({'kind': 'GET_VIEW'})['view']
    def ready():
        return wait_for(lambda: (v := view()) and v.get('controller', {}).get('status') == 'READY' and v, 'verified history fixture', 30)
    client.call('WebDriver:SetWindowRect', width=1440, height=1000)
    client.script('document.getElementById("show-home").click();window.scrollTo(0,0);')
    ready()
    samples = []
    # Same population, timing boundaries, poll interval and fifteen requests as
    # the original quality-pass comparison, without unrelated editor scenarios.
    for count in [0, 2500]:
        if count:
            assert client.script('''const done=arguments[0];browser.runtime.getBackgroundPage().then(b=>{
              const o=b.indexedDB.open('atlas-authority-v1');o.onsuccess=()=>{const db=o.result,t=db.transaction('authority','readwrite'),s=t.objectStore('authority'),q=s.get('envelope');
                q.onsuccess=()=>{const e=q.result,j=e.snapshot.journeyState,past=j.lastObservedAt-20000;
                  for(let i=0;i<2500;i++)j.journeys.push({id:j.nextJourneyId++,contextId:'quality-history-'+i,rootHostname:'root.localhost',currentHostname:'root.localhost',startedAt:past,expiresAt:past+10000,hopCount:0,maxHops:12,policyRevision:0,phase:'ENDED',endedAt:past+1,endReason:'REACHED'});
                  e.storageVersion=b.crypto.randomUUID();s.put(e,'envelope');};t.oncomplete=()=>{db.close();done(true)};t.onabort=()=>{db.close();done(false)};};});''', asynchronous=True)
            wait_for(lambda: len(ready()['controller']['snapshot']['journeyState']['journeys']) >= 2500, 'history loaded')
        times = []
        for _ in range(15):
            started = time.monotonic()
            identity = client.script('const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));', f'http://root.localhost:{port}/', asynchronous=True)
            wait_for(lambda: any(c['tabId'] == identity and (c.get('latest') or {}).get('decision', {}).get('reason') == 'WHITELISTED' for c in view()['contexts']), 'native navigation')
            times.append((time.monotonic() - started) * 1000)
            client.script('const [id,done]=arguments;browser.tabs.remove(id).then(()=>done(true));', identity, asynchronous=True)
        samples.append({'history': count, 'medianMs': statistics.median(times), 'maxMs': max(times), 'samples': times})
        print('NAVIGATION', count, samples[-1]['medianMs'], flush=True)
    return {'suite': 'history-navigation', 'navigation': samples, 'controllerReason': ready()['controller']['reason'], 'normalProfileAccessed': False}


def run_release_upgrade(client, ui_handle, ui_url, port, wait_for, restart_browser, baseline_version='0.1.19', candidate_version='0.2.0'):
    def view(): return client.message({'kind': 'GET_VIEW'})['view']
    def state(): return wait_for(lambda: (v := view()) and v.get('controller', {}).get('status') == 'READY' and v['controller']['snapshot'], 'verified upgrade state', 30)
    def fields(values):
        client.script('for(const [id,v] of Object.entries(arguments[0])){const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event("input",{bubbles:true}));}', values)
    def workspace():
        return client.script('''const done=arguments[0],o=indexedDB.open('atlas-destination-drafts-v1');o.onsuccess=()=>{const db=o.result,t=db.transaction('workspace','readonly'),r=t.objectStore('workspace').get('current');t.oncomplete=()=>{done(r.result);db.close()};};''', asynchronous=True)
    def layout():
        return client.script('''const done=arguments[0],o=indexedDB.open('atlas-home-layout-v1');o.onsuccess=()=>{const db=o.result,t=db.transaction('layout','readonly'),r=t.objectStore('layout').get('current');t.oncomplete=()=>{done(r.result);db.close()};};''', asynchronous=True)
    def directory_order():
        return client.script('''const done=arguments[0],o=indexedDB.open('atlas-home-layout-v1');o.onsuccess=()=>{const db=o.result,t=db.transaction('layout','readonly'),r=t.objectStore('layout').get('category-order-v1');t.oncomplete=()=>{done(r.result ?? null);db.close()};};''', asynchronous=True)
    def presentation():
        return client.script('return Object.fromEntries(["atlas-home-pins-v1","atlas-destinations-v1"].map(k=>[k,localStorage.getItem(k)]));')
    def bookmarks():
        return client.script('''const done=arguments[0],o=indexedDB.open('atlas-home-layout-v1');o.onsuccess=()=>{const db=o.result,t=db.transaction('layout','readonly'),r=t.objectStore('layout').get('bookmarks-v1');t.oncomplete=()=>{done(r.result ?? null);db.close()};};''', asynchronous=True)
    def category_icons():
        return client.script('''const done=arguments[0],o=indexedDB.open('atlas-home-layout-v1');o.onsuccess=()=>{const db=o.result,t=db.transaction('layout','readonly'),r=t.objectStore('layout').get('category-icons-v1');t.oncomplete=()=>{done(r.result ?? null);db.close()};};''', asynchronous=True)
    def bookmark_sync():
        return client.script('''const done=arguments[0],o=indexedDB.open('atlas-home-layout-v1');o.onsuccess=()=>{const db=o.result,t=db.transaction('layout','readonly'),r=t.objectStore('layout').get('firefox-sync-v1');t.oncomplete=()=>{done(r.result ?? null);db.close()};};''', asynchronous=True)
    def saved(): wait_for(lambda: client.script('return /^Saved (?:editable draft|locally)/.test(document.getElementById("destination-draft-status").textContent);'), 'acknowledged local draft')
    initial = state()
    assert client.script('return browser.runtime.getManifest().version;') == baseline_version
    # All durable permissions/configuration use the signed baseline's real Core
    # operations, waits and explicit confirmation, rather than seeded authority.
    config = deepcopy(initial['configuration'])
    config['accessTiming'] = {'waitMs': 1000, 'confirmationWindowMs': 600000, 'grantDurationMs': 600000}
    config['vaultTiming']['confirmationWindowMs'] = 600000
    proposed = client.message({'kind': 'PROPOSE_SETTINGS', 'candidateConfiguration': config})
    assert proposed['result']['type'] == 'COMMITTED'
    proposal = proposed['view']['controller']['snapshot']['vaultState']['pendingProposal']
    wait_for(lambda: time.time()*1000 >= proposal['readyAt'], 'signed baseline settings wait', 45)
    assert client.message({'kind': 'CONFIRM_POLICY', 'proposalId': proposal['id']})['result']['type'] == 'COMMITTED'
    client.script('document.getElementById("show-sites").click();')
    fields({'sites-search': 'root.localhost'})
    wait_for(lambda: client.script('const r=document.querySelector("#sites-list .site-row");if(r){r.click();return !document.getElementById("edit-site").disabled;}return false;'), 'selected custom host')
    client.script('document.getElementById("edit-site").click();')
    fields({'site-name': 'Release research desk', 'site-category': 'Release fixtures'})
    client.script('document.getElementById("site-pin").checked=true;document.getElementById("site-pin").dispatchEvent(new Event("input",{bubbles:true}));')
    saved();client.script('document.getElementById("save-site-display").click();')
    wait_for(lambda: workspace() and (workspace()['value'].get('receipt') or {}).get('phase') == 'DONE', 'signed display save')
    if baseline_version in ('0.2.5', '0.2.6', '0.2.7', '0.2.8', '0.3.1', '0.3.2'):
        client.script('document.getElementById("show-settings").click();document.querySelector("[data-settings-panel=home-settings]").click();')
    else:
        client.script('document.getElementById("show-home").click();document.getElementById("customize-home").click();')
    wait_for(lambda: client.script('return [...document.querySelectorAll("[data-layout-category]")].some(r=>r.dataset.layoutCategory==="release fixtures");'), 'custom category control')
    seed_layout = layout(); seed_order = directory_order() if baseline_version in ('0.3.1', '0.3.2') else None
    if baseline_version in ('0.3.1', '0.3.2'):
        client.script('document.getElementById("show-sites").click();document.getElementById("sites-categories-back").click();')
        wait_for(lambda: client.script('const b=[...document.querySelectorAll("#sites-categories .category-shortcut")].find(b=>b.dataset.categoryKey==="release fixtures");if(!b)return false;b.focus();b.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",altKey:true,bubbles:true}));return true;'), 'All Sites keyboard category reorder')
        wait_for(lambda: (v:=directory_order()) and v!=seed_order, 'acknowledged directory order save')
        client.script('document.getElementById("show-settings").click();document.querySelector("[data-settings-panel=home-settings]").click();')
    elif baseline_version in ('0.2.6', '0.2.7', '0.2.8'):
        client.script('document.getElementById("show-home").click();')
        wait_for(lambda: client.script('const b=[...document.querySelectorAll(".category-shortcut")].find(b=>b.dataset.categoryKey==="release fixtures");if(!b)return false;b.focus();b.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",altKey:true,bubbles:true}));return true;'), 'Home keyboard category reorder')
        client.script('document.getElementById("show-settings").click();document.querySelector("[data-settings-panel=home-settings]").click();')
    else:
        wait_for(lambda: client.script('const r=[...document.querySelectorAll("[data-layout-category]")].find(r=>r.dataset.layoutCategory==="release fixtures");const b=r?.querySelector("[data-layout-action]:not(:disabled)");if(!b)return false;b.click();return true;'), 'enabled category reorder')
    if baseline_version not in ('0.3.1', '0.3.2'):
        wait_for(lambda: (v:=layout()) and v['revision']>seed_layout['revision'] and v['value']!=seed_layout['value'], 'acknowledged layout save')
    if baseline_version in ('0.2.5', '0.2.6', '0.2.7', '0.2.8', '0.3.1', '0.3.2'):
        if baseline_version in ('0.2.6', '0.2.7', '0.2.8', '0.3.1', '0.3.2'):
            client.script('document.querySelector("[data-layout-category=\\"release fixtures\\"] .category-icon-choice").click();document.querySelector(".category-icon-picker:popover-open [data-icon=feather]").click();document.getElementById("advanced-pin-settings").open=true;')
        else:
            client.script('const s=document.querySelector("[data-layout-category=\\"release fixtures\\"] select");s.value="feather";s.dispatchEvent(new Event("change",{bubbles:true}));document.getElementById("advanced-pin-settings").open=true;')
        wait_for(lambda: (v:=category_icons()) and any(e['key']=='release fixtures' and e['icon']=='feather' for e in v['value']['entries']), 'signed category icon save')
    else:
        client.script('document.getElementById("close-home-customization").click();')
    if baseline_version in ('0.2.3', '0.2.4', '0.2.5', '0.2.6', '0.2.7', '0.2.8', '0.3.1', '0.3.2'):
        wait_for(lambda: client.script('return !document.getElementById("edit-pins").disabled;'), 'signed bookmark editor')
        client.script('document.getElementById("edit-pins").click();')
        wait_for(lambda: client.script('return !!document.querySelector("#bookmark-pages [data-field=url]");'), 'signed bookmark fields')
        client.script('''for(const [field,value] of [['label','Release saved page'],['url','https://root.localhost/release?fixture=page#chapter']]){const e=document.querySelector('#bookmark-pages [data-field='+field+']');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}document.getElementById('save-bookmarks').click();''')
        wait_for(lambda: client.script('return !document.getElementById("bookmark-editor").open;') and bookmarks(), 'signed bookmark save')
    if baseline_version in ('0.2.8','0.3.1', '0.3.2'):
        wait_for(lambda: (v:=bookmark_sync()) and v['value']['enabled'] and v['value']['issue']=='NONE' and not v['value']['pending'], 'signed automatic toolbar connection')
        assert bookmark_sync()['value']['scope'] == 'toolbar'
    elif baseline_version in ('0.2.4', '0.2.5', '0.2.6', '0.2.7'):
        # Connect on the actual signed baseline, accepting the native optional
        # permission only in this disposable profile. Both versions support it.
        client.script('document.getElementById("show-settings").click();document.querySelector("[data-settings-panel=home-settings]").click();')
        if baseline_version not in ('0.2.6', '0.2.7', '0.2.8', '0.3.1', '0.3.2'):
            client.script('document.getElementById("settings-connect-bookmarks").click();')
            wait_for(lambda: client.script('const b=document.getElementById("grant-bookmark-permission");return !b.hidden&&!b.disabled;'), 'signed bookmark permission action')
        button=client.call('WebDriver:FindElement',using='css selector',value='#settings-connect-bookmarks' if baseline_version in ('0.2.6', '0.2.7', '0.2.8', '0.3.1', '0.3.2') else '#grant-bookmark-permission')
        client.call('WebDriver:ElementClick',id=button['element-6066-11e4-a52e-4f735466cecf'])
        client.call('Marionette:SetContext',value='chrome')
        try:
            wait_for(lambda: client.script('return !!document.getElementById("addon-webext-permissions-notification")?.button;'), 'signed native optional permission prompt')
            client.script('document.getElementById("addon-webext-permissions-notification").button.click();')
        finally: client.call('Marionette:SetContext',value='content')
        if baseline_version not in ('0.2.6', '0.2.7', '0.2.8', '0.3.1', '0.3.2'):
            wait_for(lambda: client.script('return !document.getElementById("sync-setup").hidden;'), 'signed bookmark setup')
            client.script('document.getElementById("preview-bookmark-sync").click();')
            wait_for(lambda: client.script('return !document.getElementById("apply-bookmark-sync").disabled;'), 'signed merge preview')
            client.script('document.getElementById("apply-bookmark-sync").click();')
        wait_for(lambda: (v:=bookmark_sync()) and v['value']['enabled'] and v['value']['issue']=='NONE' and not v['value']['pending'], 'signed bookmark connection')
        if baseline_version in ('0.2.6', '0.2.7', '0.2.8', '0.3.1', '0.3.2'):
            assert bookmark_sync()['value']['scope'] == 'toolbar'
        else:
            wait_for(lambda: client.script('return !document.getElementById("close-bookmark-sync").disabled;'), 'signed connection acknowledged')
            client.script('document.getElementById("close-bookmark-sync").click();')
    # A staged addition plus a raw unfinished editor exercise both persisted parts.
    client.script('document.getElementById("show-sites").click();document.getElementById("add-site").click();')
    fields({'site-name': 'Unsubmitted release draft', 'site-hostname': 'draft.localhost', 'site-category': 'Release fixtures'})
    saved();client.script('document.getElementById("site-form").requestSubmit();')
    wait_for(lambda: workspace()['value']['draft']['editor'] is None, 'staged release draft')
    client.script('document.getElementById("add-site").click();')
    fields({'site-name': 'Unfinished fields retained', 'site-hostname': 'unfinished.localhost'});saved()
    # Separate pending access and a frozen policy proposal; no confirmation replay.
    for host in ['grant.localhost', 'pending.localhost']:
        tab = client.script('const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));', f'http://{host}:{port}/', asynchronous=True)
        wait_for(lambda: any(c['tabId'] == tab and c['effect'] == 'REMOVED' for c in view()['contexts']), 'Greylist fixture')
        prepared = client.message({'kind': 'PREPARE_ACCESS', 'tabId': tab})
        scope = next(c['accessScope'] for c in prepared['view']['contexts'] if c['tabId'] == tab)
        assert client.message({'kind': 'START_ACCESS', 'tabId': tab, 'scopeId': scope['id']})['result']['type'] == 'COMMITTED'
        if host == 'grant.localhost':
            pending = state()['accessState']['pendingRequests'][-1]
            wait_for(lambda: time.time()*1000 >= pending['readyAt'], 'signed Greylist wait')
            assert client.message({'kind': 'CONFIRM_ACCESS', 'requestId': pending['id']})['result']['type'] == 'COMMITTED'
    candidate = deepcopy(state()['policy']);candidate['whitelist'].append('frozen.localhost')
    assert client.message({'kind': 'PROPOSE_POLICY', 'candidatePolicy': candidate})['result']['type'] == 'COMMITTED'
    before = deepcopy(state()); before_workspace = workspace(); before_layout = layout(); before_presentation = presentation(); before_bookmarks = bookmarks(); before_sync = bookmark_sync()
    assert before['policy']['blacklist'] and before_workspace['value']['draft']['changes']
    assert before_workspace['value']['draft']['editor']['name'] == 'Unfinished fields retained'
    assert before['accessState']['grants'] and before['accessState']['pendingRequests']
    before_order = directory_order() if baseline_version in ('0.3.1', '0.3.2') else None
    observations = []; expected_icons = category_icons(); expected_theme = None
    themed_candidate = tuple(map(int, candidate_version.split('.'))) >= (0, 3, 1)
    # A full restart removes the temporary overlay and restores the actual signed
    # baseline. Never uninstall: its stable extension origin keeps the real data.
    for label, overlay in [('upgrade', True), ('candidate-restart', True), ('rollback', False)]:
        client, ui_handle = restart_browser(overlay=overlay)
        after = state()
        expected_version = candidate_version if overlay else baseline_version
        assert client.script('return browser.runtime.getManifest().version;') == expected_version
        for key in ['policy', 'policyRevision', 'configuration', 'configurationRevision']:
            assert after[key] == before[key], (label, key)
        assert after['vaultState']['pendingProposal'] == before['vaultState']['pendingProposal'], label
        assert after['accessState']['grants'] == before['accessState']['grants'], label
        assert after['accessState']['pendingRequests'] == before['accessState']['pendingRequests'], label
        wait_for(lambda: workspace() == before_workspace, 'draft raw fields and receipt unchanged')
        assert layout() == before_layout and presentation() == before_presentation, label
        assert bookmarks() == before_bookmarks, label
        assert bookmark_sync() == before_sync, label
        assert category_icons() == expected_icons, label
        if baseline_version in ('0.3.1', '0.3.2'): assert directory_order() == before_order, label
        if themed_candidate:
            if label == 'upgrade':
                client.script('document.getElementById("show-settings").click();document.querySelector("[data-settings-panel=appearance-settings]").click();const e=document.getElementById("atlas-theme");e.value="parchment";e.dispatchEvent(new Event("change",{bubbles:true}));')
                wait_for(lambda: client.script('return document.documentElement.dataset.theme==="parchment";'), 'acknowledged candidate appearance')
                expected_theme = client.script('return localStorage.getItem("atlas-theme-v1");')
                assert expected_theme is not None
            assert client.script('return localStorage.getItem("atlas-theme-v1");') == expected_theme, label
            if overlay:
                assert client.script('return document.documentElement.dataset.theme;') == 'parchment', label
                client.script('document.getElementById("show-access").click();')
                wait_for(lambda: client.script('return document.body.dataset.page==="access" && !document.querySelector("#access-section").hidden && document.querySelectorAll("#pending-access-list li").length>=2;'), 'pending request and active grant on access page')
        if label == 'upgrade' and baseline_version == '0.2.4':
            # Save the new independent presentation record through the actual UI.
            # Restart and rollback must retain it without touching the older layout.
            assert expected_icons is None
            client.script('document.getElementById("show-settings").click();document.querySelector("[data-settings-panel=home-settings]").click();')
            wait_for(lambda: client.script('return !!document.querySelector("[data-layout-category=\\"release fixtures\\"] select");'), 'category icon choice')
            client.script('const s=document.querySelector("[data-layout-category=\\"release fixtures\\"] select");s.value="feather";s.dispatchEvent(new Event("change",{bubbles:true}));')
            expected_icons = wait_for(lambda: (v:=category_icons()) and any(e['key']=='release fixtures' and e['icon']=='feather' for e in v['value']['entries']) and v, 'acknowledged category icon')
            assert layout() == before_layout and bookmarks() == before_bookmarks
        client.script('document.getElementById("show-sites").click();')
        wait_for(lambda: client.script('return document.getElementById("site-name").value==="Unfinished fields retained";'), 'restored unfinished editor')
        observations.append({'step': label, 'version': expected_version, 'policySettingsPinsCategoriesDraftsPreserved': True, 'namedPagesPreserved': True, 'pendingProposalRequestGrantDeadlinesPreserved': True, 'categoryIconsPreserved': category_icons() == expected_icons, 'bookmarkConnectionPreserved': bookmark_sync() == before_sync, 'themePreferencePreserved': themed_candidate and client.script('return localStorage.getItem("atlas-theme-v1");') == expected_theme})
    return {'suite': 'release-upgrade-rollback', 'baseline': 'signed '+baseline_version, 'steps': observations, 'fullFirefoxRestarts': 3, 'normalProfileAccessed': False, 'signedArtifactsModified': False, 'mechanism': 'signed baseline plus temporary candidate overlay; restart without overlay restores the original signed baseline, without uninstalling'}
