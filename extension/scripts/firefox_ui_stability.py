"""Matched idle rendering measurements, synthetic fixtures, disposable Firefox only.

Instrumentation records counts, stable IDs and geometry, never message payloads or URLs.
The fixture uses real Vault/access waits and acknowledgements, not injected authority.
"""
import base64
import json
import time
from importlib import import_module


INSTRUMENT = r'''
window.__stability?.stop();
const stats={mutations:0,attributes:0,redundantAttributes:0,childList:0,added:0,removed:0,
  replacements:{},writes:{},regions:{},messages:{},creates:0,layoutReads:0,timerCreated:0,timerFired:0,activeTimers:0,maxTimers:0};
const timers=new Set(),restores=[];let stopped=false;
const region=n=>{const e=n.nodeType===1?n:n.parentElement;return e?.closest('#home-customization,#vault-section,#temporary-section,#site-draft,#destination-draft-panel,#sites-list,#destination-list,#pinned-list,#search-results,#access-panel,#diagnostics,#timing-settings')?.id??'other';};
const count=(obj,key)=>obj[key]=(obj[key]??0)+1;
const wrap=(obj,key,fn)=>{const old=obj[key];obj[key]=fn(old);restores.push(()=>obj[key]=old);};
wrap(Element.prototype,'replaceChildren',old=>function(...args){count(stats.replacements,region(this));return old.apply(this,args);});
wrap(Element.prototype,'getBoundingClientRect',old=>function(...args){stats.layoutReads++;return old.apply(this,args);});
wrap(Document.prototype,'createElement',old=>function(...args){stats.creates++;return old.apply(this,args);});
wrap(Element.prototype,'setAttribute',old=>function(name,value){count(stats.writes,region(this)+':'+name);return old.call(this,name,value);});
wrap(browser.runtime,'sendMessage',old=>function(command,...args){count(stats.messages,command?.kind??'other');return old.call(this,command,...args);});
wrap(window,'setTimeout',old=>function(callback,delay,...args){stats.timerCreated++;let id;
  id=old.call(window,()=>{timers.delete(id);stats.activeTimers=timers.size;stats.timerFired++;callback(...args);},delay);
  timers.add(id);stats.activeTimers=timers.size;stats.maxTimers=Math.max(stats.maxTimers,timers.size);return id;});
wrap(window,'clearTimeout',old=>function(id){timers.delete(id);stats.activeTimers=timers.size;return old.call(window,id);});
const observer=new MutationObserver(records=>{for(const m of records){stats.mutations++;count(stats.regions,region(m.target));
  if(m.type==='attributes'){stats.attributes++;if(m.oldValue===m.target.getAttribute(m.attributeName))stats.redundantAttributes++;}
  if(m.type==='childList'){stats.childList++;stats.added+=m.addedNodes.length;stats.removed+=m.removedNodes.length;}
}});observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeOldValue:true});
const nodes=[...document.querySelectorAll('.service-group,.destination-card,#site-name,#site-category,#vault-allow-list>li,#temporary-list>li,#pending-access-list>li,#home-layout-list>li')];
const categories=()=>[...document.querySelectorAll('.service-group')].map(e=>[e.dataset.categoryKey,e.dataset.collapsed,e.querySelector('.destination-grid').hidden]);
const active=document.activeElement;
const initial={categories:categories(),scroll:scrollY,listScroll:document.getElementById('sites-list').scrollTop,
  focus:active?.id??'',value:active?.value??null,start:active?.selectionStart??null,end:active?.selectionEnd??null,
  details:[...document.querySelectorAll('details')].map(e=>[e.id||e.className,e.open]),
  pins:[...document.querySelectorAll('#pinned-list [data-destination-id]')].map(e=>e.dataset.destinationId)};
window.__stability={stats,initial,nodes,categories,stop:()=>{if(stopped)return;stopped=true;observer.disconnect();for(const restore of [...restores].reverse())restore();},
  sample:()=>{const e=document.activeElement;return {elapsed:performance.now(),stats:structuredClone(stats),
    retained:nodes.filter(n=>n.isConnected).length,total:nodes.length,categories:categories(),scroll:scrollY,
    listScroll:document.getElementById('sites-list').scrollTop,focus:e?.id??'',value:e?.value??null,
    start:e?.selectionStart??null,end:e?.selectionEnd??null,
    details:[...document.querySelectorAll('details')].map(e=>[e.id||e.className,e.open]),
    pins:[...document.querySelectorAll('#pinned-list [data-destination-id]')].map(e=>e.dataset.destinationId),
    deadlines:[...document.querySelectorAll('.temporary-time')].map(e=>e.textContent),
    disabledCategories:[...document.querySelectorAll('.category-heading')].filter(e=>e.disabled).length,
    vaultRows:document.querySelectorAll('#vault-allow-list>li,#vault-deny-list>li').length,
    bodyMode:document.body.dataset.mode,destinationPhase:document.getElementById('destinations').dataset.phase};}};
return initial;
'''


def run_ui_stability(client, ui_handle, ui_url, port, wait_for, artifacts, baseline=False):
    configure_policy = import_module('firefox-e2e').configure_policy
    checks, measurements, layouts = [], [], []

    def ui():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)

    def view():
        return client.message({'kind': 'GET_VIEW'})['view']

    def state():
        return view()['controller']['snapshot']

    def ready():
        wait_for(lambda: client.script('return document.getElementById("status").dataset.ready==="true" && !document.getElementById("add-site").disabled;'), 'settled authoritative fixture', 20)

    def value(id, text):
        client.script('const e=document.getElementById(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event("input",{bubbles:true}));', id, text)

    def select(tab, hostname):
        ui()
        wait_for(lambda: client.script('return [...document.getElementById("context").options].some(o=>o.value===String(arguments[0]));', tab), 'owning context option')
        client.script('const e=document.getElementById("context");e.value=String(arguments[0]);e.dispatchEvent(new Event("change"));', tab)
        wait_for(lambda: client.script('return document.getElementById("hostname").textContent===arguments[0];', hostname), 'current context')

    def capture(name):
        (artifacts / f'{name}.png').write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)))

    def idle(name, focus=None):
        ready()
        time.sleep(1.3)  # fixtures/icons settle before the identical baseline/post-fix window
        if focus:
            client.script('const e=document.getElementById(arguments[0]);e.focus({preventScroll:true});if(["text","search","url"].includes(e.type))e.setSelectionRange(2,5);', focus)
        initial = client.script(INSTRUMENT)
        capture(name + '-start')
        start = time.monotonic()
        samples = []
        for tick in range(12):
            time.sleep(max(0, start + (tick + 1) * 5 - time.monotonic()))
            samples.append(client.script('return window.__stability.sample();'))
        capture(name + '-end')
        client.script('window.__stability.stop();')
        final = samples[-1]
        result = {'surface': name, 'seconds': round(time.monotonic()-start, 2), 'initial': initial, 'samples': samples}
        measurements.append(result)
        (artifacts / 'measurements.json').write_text(json.dumps(measurements, indent=2), encoding='utf-8')
        print(f'Idle {name}: {json.dumps(final["stats"])}; retained {final["retained"]}/{final["total"]}', flush=True)
        if not baseline:
            assert final['categories'] == initial['categories'], result
            assert final['pins'] == initial['pins'], result
            assert abs(final['scroll'] - initial['scroll']) <= 1, result
            if focus:
                assert all(s['focus'] == initial['focus'] and s['value'] == initial['value'] and s['start'] == initial['start'] and s['end'] == initial['end'] for s in samples), result
            assert final['stats']['replacements'].get('destination-list', 0) == 0, result
            assert final['stats']['replacements'].get('sites-list', 0) == 0, result
            assert final['stats']['replacements'].get('pinned-list', 0) == 0, result
            assert final['stats']['maxTimers'] <= 4, result
        return result

    ui()
    client.call('WebDriver:SetWindowRect', width=1440, height=1000)
    initial = state()
    hosts = list(dict.fromkeys(initial['policy']['whitelist'] + [f'library-{i:02d}.example' for i in range(45)]))
    configure_policy(client, {'whitelist': hosts, 'blacklist': initial['policy']['blacklist']})
    configuration = initial['configuration']
    configuration['accessTiming'] = {'waitMs': 10000, 'confirmationWindowMs': 900000, 'grantDurationMs': 150000}
    configuration['vaultTiming'] = {'waitMs': 80000, 'confirmationWindowMs': 180000}
    configuration['journeyLimits'] = {'lifetimeMs': 180000, 'maxHops': 12}
    proposed = client.message({'kind': 'PROPOSE_SETTINGS', 'candidateConfiguration': configuration})
    assert proposed['result']['type'] == 'COMMITTED', proposed
    proposal = proposed['view']['controller']['snapshot']['vaultState']['pendingProposal']
    wait_for(lambda: time.time()*1000 >= proposal['readyAt'], 'protected fixture timings', 40)
    assert client.message({'kind': 'CONFIRM_POLICY', 'proposalId': proposal['id']})['result']['type'] == 'COMMITTED'

    def seed(count):
        items = [{'id': f'host:{host}', 'label': f'Library {i:02d}', 'primaryHostname': host,
            'hostnames': [host], 'category': f'Collection {i % count:02d}'} for i, host in enumerate(hosts)]
        client.script('localStorage.setItem("atlas-destinations-v1",JSON.stringify({version:1,destinations:arguments[0],pending:null}));window.dispatchEvent(new StorageEvent("storage",{key:"atlas-destinations-v1"}));', items)
        wait_for(lambda: client.script('return document.querySelectorAll("#destination-list .service-group").length===arguments[0] && document.getElementById("home-layout-status").textContent.startsWith("Home layout saved");', count), 'persisted synthetic Home categories')
        return items

    metadata = seed(5)
    client.script('localStorage.setItem("atlas-home-pins-v1",JSON.stringify(arguments[0]));window.dispatchEvent(new StorageEvent("storage",{key:"atlas-home-pins-v1"}));', [metadata[i]['id'] for i in [0, 7, 3, 8]])
    granted = client.message({'kind': 'OPEN_DESTINATION', 'url': f'http://unknown.localhost:{port}/'})['tabId']
    wait_for(lambda: any(c['tabId'] == granted and c['effect'] == 'REMOVED' for c in view()['contexts']), 'Greylist fixture')
    prepared = client.message({'kind': 'PREPARE_ACCESS', 'tabId': granted})
    scope = next(c for c in prepared['view']['contexts'] if c['tabId'] == granted)['accessScope']
    assert client.message({'kind': 'START_ACCESS', 'tabId': granted, 'scopeId': scope['id']})['result']['type'] == 'COMMITTED'
    request = state()['accessState']['pendingRequests'][0]
    wait_for(lambda: time.time()*1000 >= request['readyAt'], 'real grant wait', 20)
    assert client.message({'kind': 'CONFIRM_ACCESS', 'requestId': request['id']})['result']['type'] == 'COMMITTED'
    grant = state()['accessState']['grants'][0]
    pending_tab = client.message({'kind': 'OPEN_DESTINATION', 'url': f'http://pending.localhost:{port}/'})['tabId']
    wait_for(lambda: any(c['tabId'] == pending_tab and c['effect'] == 'REMOVED' for c in view()['contexts']), 'pending fixture')
    prepared = client.message({'kind': 'PREPARE_ACCESS', 'tabId': pending_tab})
    scope = next(c for c in prepared['view']['contexts'] if c['tabId'] == pending_tab)['accessScope']
    assert client.message({'kind': 'START_ACCESS', 'tabId': pending_tab, 'scopeId': scope['id']})['result']['type'] == 'COMMITTED'
    before_handles = set(client.call('WebDriver:GetWindowHandles'))
    journey_tab = client.message({'kind': 'OPEN_JOURNEY', 'url': f'http://root.localhost:{port}/begin-login'})['tabId']
    wait_for(lambda: any(c['tabId'] == journey_tab and c['displayedHostname'] == 'login.localhost' for c in view()['contexts']), 'live intermediate')
    journey_handle = next(h for h in client.call('WebDriver:GetWindowHandles') if h not in before_handles)
    client.call('WebDriver:SwitchToWindow', handle=journey_handle)
    wait_for(lambda: client.script('return !!document.getElementById("atlas-journey-indicator")?.shadowRoot;'), 'passive Journey status')
    ui()
    select(pending_tab, 'pending.localhost')
    client.script('document.getElementById("show-home").click();document.querySelectorAll(".category-heading")[1].click();')
    wait_for(lambda: client.script('return [...document.querySelectorAll(".service-group")].some(e=>e.dataset.collapsed==="true");'), 'acknowledged collapsed category')
    client.script('document.getElementById("customize-home").click();')
    idle('home-five-customize', 'destination-search')
    client.script('document.getElementById("close-home-customization").click();')
    metadata = seed(15)
    idle('home-fifteen', 'destination-search')

    client.script('document.getElementById("show-sites").click();')
    ready()
    value('sites-search', 'root.localhost')
    wait_for(lambda: client.script('return document.querySelectorAll(".site-row").length===1;'), 'selected exact editor fixture')
    client.script('document.querySelector(".site-row").click();document.getElementById("edit-site").click();')
    value('site-name', 'Unfinished stable label')
    value('site-category', 'Collection 00')
    client.script('document.getElementById("site-draft").scrollIntoView({block:"start"});')
    idle('sites-editor-draft', 'site-name')
    wait_for(lambda: not view()['temporaryAccess'], 'real grant expiry', 10)
    assert state()['accessState']['grants'][0]['expiresAt'] == grant['expiresAt'], 'Grant keeps its original deadline'
    wait_for(lambda: state()['journeyState']['journeys'][0]['phase'] == 'ENDED', 'real Journey expiry', 10)
    checks.append('real temporary grant and Journey expire without UI extending their deadlines')

    client.script('document.getElementById("site-form").requestSubmit();')
    wait_for(lambda: client.script('return document.getElementById("site-draft").hidden;'), 'editable batch item staged')
    proposal = client.message({'kind': 'PROPOSE_POLICY', 'candidatePolicy': {'whitelist': hosts + ['proposed.example'], 'blacklist': initial['policy']['blacklist']}})
    assert proposal['result']['type'] == 'COMMITTED', proposal
    vault = proposal['view']['controller']['snapshot']['vaultState']['pendingProposal']
    client.script('document.getElementById("show-settings").click();document.getElementById("vault-section").open=true;document.getElementById("timing-settings").open=true;document.getElementById("diagnostics").open=true;document.getElementById("vault-section").scrollIntoView({block:"start"});')
    wait_for(lambda: client.script('return document.getElementById("vault-phase").textContent==="Waiting";'), 'Vault wait review')
    idle('settings-vault-diagnostics', 'access-wait')
    assert time.time()*1000 < vault['readyAt'], 'Native wait fixture remains waiting for the idle review sample'
    select(pending_tab, 'pending.localhost')
    client.script('document.getElementById("show-home").click();document.getElementById("show-access").click();document.getElementById("access-panel").scrollIntoView({block:"start"});')
    idle('greylist-confirmation')
    wait_for(lambda: client.script('return !document.getElementById("confirm-policy").hidden;'), 'real Vault readiness transition', 20)
    assert state()['policy']['whitelist'] == sorted(hosts), 'Time availability cannot commit Vault'
    assert state()['accessState']['pendingRequests'], 'Time availability cannot confirm access'
    checks.append('pending requests and Vault become ready without creating permission; review deadline remains original')
    for width in [768, 1080, 1440]:
        client.call('WebDriver:SetWindowRect', width=width, height=1000)
        client.script('document.getElementById("show-home").click();')
        time.sleep(.3)
        sample = client.script('return {width:innerWidth,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,columns:Number(document.getElementById("destinations").dataset.columns)};')
        layouts.append(sample)
        assert not sample['overflow'] and 1 <= sample['columns'] <= 5, sample
    client.call('Marionette:SetContext', value='chrome')
    client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,1.5);')
    client.call('Marionette:SetContext', value='content')
    time.sleep(.3)
    assert client.script('return document.documentElement.scrollWidth<=document.documentElement.clientWidth+1;')
    checks.append('768/1080/1440 widths and native 150% zoom retain compact five-column maximum without overflow')
    return {'suite':'ui-stability', 'baseline':baseline, 'measurements':measurements, 'layouts':layouts, 'checks':checks}
