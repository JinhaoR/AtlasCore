"""Milestone D: real rendered states, synthetic data, disposable Firefox only."""
import base64
import time
from importlib import import_module


def run_visual_polish(client, ui_handle, ui_url, port, wait_for, artifacts, baseline=False):
    configure_policy = import_module('firefox-e2e').configure_policy
    captures, layouts, checks, metrics = [], [], [], []

    def ui():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)

    def view():
        ui()
        return client.message({'kind': 'GET_VIEW'})['view']

    def state():
        return view()['controller']['snapshot']

    def ready(editable=True):
        wait_for(lambda: client.script('return document.getElementById("status").dataset.ready==="true" && (!arguments[0] || !document.getElementById("add-site").disabled);', editable), 'verified visual fixture', 20)

    def measure(surface):
        client.call('WebDriver:SetWindowRect', width=1440, height=1000)
        time.sleep(.2)
        sample = client.script(r'''const rgb=s=>s.match(/[\d.]+/g).map(Number),mix=(a,b)=>a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1))),
          root=rgb(getComputedStyle(document.documentElement).backgroundColor),bg=e=>{let b=root;for(const n of [e,...function*(n){while(n.parentElement){n=n.parentElement;yield n}}(e)].reverse())b=mix(rgb(getComputedStyle(n).backgroundColor),b);return b},
          lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0),
          contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05),visible=e=>!e.closest('[hidden]')&&e.getBoundingClientRect().height>0;
          const specs=['.note','.section-meta','.field-current','.unit','.temporary-scope','.search-hint','.result-copy small','.feedback','.pill','.scope-preview','.deadline'];
          const text=specs.flatMap(selector=>[...document.querySelectorAll(selector)].filter(visible).slice(0,4).map(e=>({selector,fontSize:parseFloat(getComputedStyle(e).fontSize),contrast:contrast(mix(rgb(getComputedStyle(e).color),bg(e)),bg(e))})));
          if(visible(document.getElementById('destination-search')))text.push({selector:'search placeholder',fontSize:parseFloat(getComputedStyle(document.getElementById('destination-search')).fontSize),contrast:contrast(rgb(getComputedStyle(document.getElementById('destination-search'),'::placeholder').color),bg(document.getElementById('destination-search'))) });
          const targets=['.pin-button','.entry-points summary','.text-button','.home-layout-list button'].flatMap(selector=>[...document.querySelectorAll(selector)].filter(e=>visible(e)&&!e.disabled).slice(0,6).map(e=>({selector,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
          const borders=[...document.querySelectorAll('input:not([type=checkbox]),select,textarea,button.secondary')].filter(e=>visible(e)&&!e.disabled&&getComputedStyle(e).borderTopStyle!=='none').slice(0,8).map(e=>({tag:e.tagName,color:getComputedStyle(e).borderTopColor,contrast:Math.min(contrast(rgb(getComputedStyle(e).borderTopColor),bg(e)),contrast(rgb(getComputedStyle(e).borderTopColor),bg(e.parentElement)))}));
          return {surface:arguments[0],text,targets,borders,controlBorder:getComputedStyle(document.documentElement).getPropertyValue('--control-border').trim()};''', surface)
        metrics.append(sample)
        if not baseline:
            assert all(t['contrast'] >= 4.5 and t['fontSize'] >= 13 for t in sample['text']), sample
            assert all(t['width'] >= 24 and t['height'] >= 24 for t in sample['targets']), sample
            assert all(b['contrast'] >= 3 for b in sample['borders']), sample

    def input_value(id, value):
        client.script('const e=document.getElementById(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event("input",{bubbles:true}));', id, value)

    def select_tab(tab, hostname):
        ui()
        # The direct GET_VIEW probe can see a new tab before the control page's
        # poll has added its option. Setting select.value before then selects "".
        wait_for(lambda: client.script('return [...document.getElementById("context").options].some(o=>o.value===String(arguments[0]));', tab), 'rendered owning context option')
        client.script('document.getElementById("context").value=String(arguments[0]);document.getElementById("context").dispatchEvent(new Event("change"));', tab)
        wait_for(lambda: client.script('return document.getElementById("context").value===String(arguments[0]) && document.getElementById("hostname").textContent===arguments[1];', tab, hostname), 'selected exact context')

    def capture(name, widths=(1440, 500), target=None, keep_focus=False):
        for width in widths:
            client.call('WebDriver:SetWindowRect', width=width, height=1000)
            client.script('if(!arguments[0])document.activeElement?.blur();window.scrollTo(0,0);', keep_focus)
            if target:
                client.script('document.getElementById(arguments[0]).scrollIntoView({block:"start"});', target)
            time.sleep(.25)
            wait_for(lambda: client.script('return !document.getAnimations().some(a=>a.playState==="running");'), 'settled visual state')
            filename = f'{name}-{width}.png'
            (artifacts / filename).write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)))
            captures.append(filename)
            sample = client.script('''return {surface:arguments[0],width:innerWidth,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
              columns:Number(document.getElementById('destinations').dataset.columns)};''', name)
            layouts.append(sample)
            if not baseline:
                assert not sample['overflow'], sample
        print('Captured ' + name, flush=True)

    def seed(count):
        labels = ['University', 'Research', 'Writing', 'Tools', 'Personal']
        items = [{'id': f'host:{h}', 'label': f'Research collection {i}' if i else 'University portal',
                  'primaryHostname': h, 'hostnames': [h], 'category': labels[i % 5] if count == 5 else f'Category {i % count:02d}'} for i, h in enumerate(hosts)]
        if count == 30 and not baseline:
            for item in items:
                if item['category'] == 'Category 29':
                    item['category'] = 'Category 29 — Research collections and reference reading'
        assert all(len(item['category']) <= 64 for item in items), 'Fixture must retain Milestone B category limits'
        client.script('localStorage.setItem("atlas-destinations-v1",JSON.stringify({version:1,destinations:arguments[0],pending:null}));window.dispatchEvent(new StorageEvent("storage",{key:"atlas-destinations-v1"}));', items)
        wait_for(lambda: client.script('return document.querySelectorAll("#destination-list .service-group").length===arguments[0] && document.getElementById("home-layout-status").textContent.startsWith("Home layout saved");', count), 'populated categories')
        return items

    initial = state()
    long_host = 'archive-' + 'a' * 49 + '.research.example'
    hosts = ['root.localhost'] + initial['policy']['whitelist'] + [f'library-{i:02d}.example' for i in range(40)] + [long_host]
    hosts = list(dict.fromkeys(hosts))
    configure_policy(client, {'whitelist': hosts, 'blacklist': initial['policy']['blacklist']})
    ready()
    metadata = seed(5)
    client.script('localStorage.setItem("atlas-home-pins-v1",JSON.stringify(arguments[0]));window.dispatchEvent(new StorageEvent("storage",{key:"atlas-home-pins-v1"}));', [metadata[i]['id'] for i in [0, 7, 3, 8]])
    capture('home')
    measure('home')
    if not baseline:
        point = client.script('const r=document.querySelector(".category-heading").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};')
        client.call('WebDriver:PerformActions', actions=[{'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [{'type': 'pointerMove', 'duration': 0, 'origin': 'viewport', **point}]}])
        capture('home-hover', widths=(1440,))
    input_value('destination-search', 'Research')
    wait_for(lambda: client.script('return !document.getElementById("search-results").hidden;'), 'real search results')
    capture('search')
    measure('search')
    input_value('destination-search', '')
    client.script('document.getElementById("customize-home").click();')
    if not baseline:
        assert client.script('return document.activeElement===document.getElementById("home-customization");')
    capture('customize', target='home-customization')
    measure('customize')
    if not baseline:
        # Use native keyboard focus rather than a synthesized click for the close action.
        client.script('document.getElementById("close-home-customization").focus();')
        client.call('WebDriver:PerformActions', actions=[{'type': 'key', 'id': 'keyboard', 'actions': [{'type': 'keyDown', 'value': '\ue004'}, {'type': 'keyUp', 'value': '\ue004'}]}])
        focus = client.script('const e=document.activeElement,s=getComputedStyle(e);return {tag:e.tagName,outline:s.outlineStyle,width:parseFloat(s.outlineWidth),inside:document.getElementById("home-customization").contains(e)};')
        assert focus['inside'] and focus['outline'] != 'none' and focus['width'] >= 2, focus
        capture('keyboard-focus', widths=(1440,), target='home-customization', keep_focus=True)
        checks.append('native keyboard focus within customization has a visible 2px outline')
        client.script('window.__visualPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==="layout")throw new DOMException("Synthetic visual save failure","AbortError");return window.__visualPut.apply(this,args);};document.querySelector("#home-layout-list input").click();')
        wait_for(lambda: client.script('return !document.getElementById("retry-home-layout").hidden && !document.getElementById("retry-home-layout").disabled;'), 'truthful presentation save failure')
        capture('presentation-error', target='home-customization')
        client.script('IDBObjectStore.prototype.put=window.__visualPut;document.getElementById("retry-home-layout").click();')
        wait_for(lambda: client.script('return document.getElementById("home-layout-status").textContent.startsWith("Home layout saved");'), 'explicit presentation retry')
        client.script('document.querySelector("#home-layout-list input").click();')
        wait_for(lambda: client.script('return document.getElementById("home-layout-status").textContent.startsWith("Home layout saved");'), 'restored baseline visibility')
    client.script('document.getElementById("close-home-customization").click();')
    for count in [15, 30]:
        seed(count)
        capture(f'crowded-{count}', widths=(1440,) if baseline else (1440, 500))
    metadata = seed(5)
    checks.append('real five/fifteen/thirty-category Home, pins, search and customization captured')

    client.script('document.getElementById("show-sites").click();')
    capture('sites')
    if not baseline:
        input_value('sites-search', long_host)
        wait_for(lambda: client.script('return document.querySelectorAll(".site-row").length===1;'), 'long exact hostname in list')
        client.script('document.querySelector(".site-row").click();')
        capture('long-hostname', target='site-detail')
    input_value('sites-search', 'University portal')
    wait_for(lambda: client.script('return document.querySelectorAll(".site-row").length===1;'), 'selected synthetic destination')
    client.script('document.querySelector(".site-row").click();document.getElementById("edit-site").click();')
    input_value('site-name', 'University portal and research')
    capture('editor', target='site-draft')
    if not baseline:
        input_value('site-hostname', 'https://bad.example/path')
        client.script('document.getElementById("site-form").requestSubmit();')
        wait_for(lambda: client.script('return document.getElementById("site-hostname").getAttribute("aria-invalid")==="true";'), 'associated form error')
        assert client.script('return document.activeElement.id==="site-hostname" && document.getElementById("site-hostname").getAttribute("aria-describedby").includes("site-field-error") && !document.getElementById("site-field-error").hidden;')
        capture('form-error', target='site-draft')
        input_value('site-hostname', 'root.localhost')
        input_value('site-extra', '*.bad.example')
        client.script('document.getElementById("site-extra").closest("details").open=false;document.getElementById("site-form").requestSubmit();')
        wait_for(lambda: client.script('return document.activeElement.id==="site-extra" && document.getElementById("site-extra").closest("details").open;'), 'invalid hidden host is revealed before focus')
        input_value('site-extra', '')
        checks.append('invalid hostname receives associated error and focus; correction retains and stages the existing draft')
    client.script('document.getElementById("site-form").requestSubmit();')
    wait_for(lambda: client.script('return document.getElementById("site-draft").hidden;'), 'saved editable destination draft')
    input_value('sites-search', '')
    for i in range(8):
        ready()
        client.script('document.getElementById("add-site").click();')
        input_value('site-name', ['Collected essays', 'Reference library', 'Focus boundary', 'Research archive'][i % 4] + f' {i + 1}')
        input_value('site-hostname', f'proposed-{i}.example')
        input_value('site-category', 'Research')
        input_value('site-access', 'BLACKLIST' if i in [2, 6] else 'WHITELIST')
        client.script('document.getElementById("site-form").requestSubmit();')
        wait_for(lambda: client.script('return document.getElementById("site-draft").hidden && document.getElementById("destination-draft-status").textContent.startsWith("Saved editable draft");'), 'mixed batch item persisted')
    input_value('sites-search', 'black.localhost')
    wait_for(lambda: client.script('return document.querySelectorAll(".site-row").length===1;'), 'explicit removal target')
    client.script('document.querySelector(".site-row").click();document.getElementById("remove-site").click();')
    wait_for(lambda: client.script('return document.querySelectorAll("#destination-draft-items > li").length===10;'), 'ten real staged operations')
    client.script('document.getElementById("review-destination-draft").click();')
    capture('batch-review', target='destination-draft-panel')
    if not baseline:
        metadata[0]['label'] = 'Updated university portal'
        client.script('localStorage.setItem("atlas-destinations-v1",JSON.stringify({version:1,destinations:arguments[0],pending:null}));window.dispatchEvent(new StorageEvent("storage",{key:"atlas-destinations-v1"}));', metadata)
        wait_for(lambda: client.script('return !document.getElementById("reconcile-destination-draft").disabled;'), 'stale draft review')
        client.script('document.getElementById("reconcile-destination-draft").click();')
        wait_for(lambda: client.script('return !document.getElementById("draft-reconciliation").hidden;'), 'explicit reconciliation preview')
        capture('reconciliation', target='draft-reconciliation')
        client.script('document.getElementById("accept-draft-reconciliation").click();')
        wait_for(lambda: client.script('return document.getElementById("destination-draft-stale").hidden && document.getElementById("draft-reconciliation").hidden;'), 'accepted local reconciliation')
        client.script('document.getElementById("review-destination-draft").click();')
        checks.append('rendered stale ten-item draft is explicitly reconciled without changing policy')
    assert state()['vaultState']['pendingProposal'] is None
    ready()
    wait_for(lambda: client.script('return !document.getElementById("submit-destination-draft").disabled;'), 'submit reviewed batch')
    client.script('document.getElementById("submit-destination-draft").click();')
    proposal = wait_for(lambda: state()['vaultState']['pendingProposal'], 'real frozen proposal')
    wait_for(lambda: client.script('return !document.getElementById("vault-destination-review").hidden;'), 'complete frozen destination terms')
    wait_for(lambda: client.script('return ["Waiting","Ready to confirm"].includes(document.getElementById("vault-phase").textContent);'), 'verified frozen review phase')
    capture('vault', target='vault-section')
    if not baseline:
        measure('vault')
    capture('vault-terms', target='vault-destination-review')
    assert state()['policy'] != proposal['candidatePolicy']
    checks.append('long Sites list, real editor and ten-item mixed batch/frozen review captured without premature policy changes')

    client.script('document.getElementById("show-settings").click();document.getElementById("timing-settings").open=true;')
    capture('settings')
    measure('settings')
    client.script('document.getElementById("diagnostics").open=true;document.getElementById("recovery-section").open=true;')
    capture('diagnostics', target='diagnostics')

    opened = client.message({'kind': 'OPEN_DESTINATION', 'url': f'http://unknown.localhost:{port}/'})
    tab = opened['tabId']
    wait_for(lambda: any(c['tabId'] == tab and c['effect'] == 'REMOVED' for c in view()['contexts']), 'blocked decision page')
    client.script('document.getElementById("show-home").click();')
    select_tab(tab, 'unknown.localhost')
    client.script('document.getElementById("show-access").click();')
    capture('decision', target='access-panel')
    prepared = client.message({'kind': 'PREPARE_ACCESS', 'tabId': tab})
    scope = next(c for c in prepared['view']['contexts'] if c['tabId'] == tab)['accessScope']
    assert client.message({'kind': 'START_ACCESS', 'tabId': tab, 'scopeId': scope['id']})['result']['type'] == 'COMMITTED'
    wait_for(lambda: client.script('return document.getElementById("deadline").textContent.includes("Wait");'), 'Greylist wait screen')
    capture('greylist', target='access-panel')
    measure('greylist')
    request = state()['accessState']['pendingRequests'][0]
    wait_for(lambda: time.time() * 1000 >= request['readyAt'], 'real Greylist wait', 45)
    wait_for(lambda: client.script('return !document.getElementById("confirm-access").hidden && !document.getElementById("confirm-access").disabled;'), 'explicit confirmation control')
    capture('confirmation', target='access-panel')
    client.script('document.getElementById("confirm-access").click();')
    wait_for(lambda: len(state()['accessState']['grants']) == 1, 'committed grant')
    capture('allowed', target='access-panel')
    client.script('document.getElementById("show-home").click();')
    wait_for(lambda: client.script('return document.querySelectorAll("#temporary-list li").length===1;'), 'active grant summary')
    capture('grant', target='temporary-section')
    before_journey = set(client.call('WebDriver:GetWindowHandles'))
    journey = client.message({'kind': 'OPEN_JOURNEY', 'url': f'http://root.localhost:{port}/begin-login'})
    wait_for(lambda: any(c['tabId'] == journey['tabId'] and c['displayedHostname'] == 'login.localhost' for c in view()['contexts']), 'active intermediate document')
    if not baseline:
        handle = next(h for h in client.call('WebDriver:GetWindowHandles') if h not in before_journey)
        client.call('WebDriver:SwitchToWindow', handle=handle)
        wait_for(lambda: client.script('return !!document.getElementById("atlas-journey-indicator")?.shadowRoot;'), 'rendered passive Journey indicator')
        client.call('WebDriver:SetWindowRect', width=1440, height=1000)
        filename = 'journey-indicator-1440.png'
        (artifacts / filename).write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)))
        captures.append(filename)
        ui()
    select_tab(journey['tabId'], 'login.localhost')
    wait_for(lambda: client.script('return !document.getElementById("home-journey").hidden && !document.getElementById("home-journey").disabled;'), 'owning Journey link')
    client.script('document.getElementById("home-journey").click();')
    capture('journey', target='access-panel')
    if not baseline:
        measure('journey')
    wait_for(lambda: client.script('return !document.getElementById("cancel-journey").hidden && !document.getElementById("cancel-journey").disabled;'), 'enabled Journey cancellation')
    client.script('document.getElementById("cancel-journey").click();')
    wait_for(lambda: client.script('return !document.getElementById("ended-journey").hidden;'), 'Journey recovery')
    capture('journey-recovery', target='access-panel')
    blocked = client.message({'kind': 'OPEN_DESTINATION', 'url': f'http://black.localhost:{port}/'})
    wait_for(lambda: any(c['tabId'] == blocked['tabId'] and c['effect'] == 'REMOVED' for c in view()['contexts']), 'explicit Blacklist decision')
    client.script('document.getElementById("show-home").click();')
    select_tab(blocked['tabId'], 'black.localhost')
    client.script('document.getElementById("show-access").click();')
    capture('blacklist', target='access-panel')
    checks.append('actual blocked/wait/confirmation/grant/Journey/recovery states use existing Core workflows')

    client.script('document.getElementById("show-home").click();window.__visualSend=browser.runtime.sendMessage;browser.runtime.sendMessage=()=>Promise.reject(Error("Synthetic unavailable authority"));')
    wait_for(lambda: client.script('return document.getElementById("destination-state").hidden===false;'), 'truthful unavailable presentation')
    capture('unavailable')
    client.script('browser.runtime.sendMessage=window.__visualSend;document.getElementById("retry-destinations").click();')
    ready(False)
    for width in [500, 768, 1080, 1440, 1800]:
        client.call('WebDriver:SetWindowRect', width=width, height=1000)
        time.sleep(.2)
        sample = client.script('''return {width:innerWidth,columns:Number(document.getElementById('destinations').dataset.columns),
          overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
          cardHeights:[...new Set([...document.querySelectorAll('.destination-card')].filter(e=>!e.closest('[hidden]')).map(e=>e.getBoundingClientRect().height))],
          overlappingCardControls:[...document.querySelectorAll('.destination-card')].filter(e=>!e.closest('[hidden]')).filter(e=>{
            const a=e.querySelector('.pin-button')?.getBoundingClientRect(),b=e.querySelector('.entry-points summary')?.getBoundingClientRect();
            return a&&b&&Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);
          }).length};''')
        layouts.append(sample)
        assert not sample['overflow'] and 1 <= sample['columns'] <= 5 and all(abs(h-56)<1 for h in sample['cardHeights']), sample
        if not baseline:
            assert sample['overlappingCardControls'] == 0, sample
    client.call('WebDriver:SetWindowRect', width=1440, height=1000)
    for zoom in [1.25, 1.5, 2]:
        client.call('Marionette:SetContext', value='chrome')
        client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,arguments[0]);', zoom)
        client.call('Marionette:SetContext', value='content')
        for route in ['home', 'sites', 'settings']:
            client.script('document.getElementById("show-"+arguments[0]).click();', route)
            time.sleep(.2)
            sample = client.script('return {zoom:arguments[0],route:arguments[1],width:innerWidth,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};', zoom, route)
            layouts.append(sample)
            assert not sample['overflow'], sample
        capture(f'zoom-{int(zoom*100)}', widths=(1440,))
    checks.append('all requested viewport widths, actual Firefox zoom and stable fixed-height five-column launchers')
    if not baseline:
        client.call('Marionette:SetContext', value='chrome')
        client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,1);Services.prefs.setIntPref("ui.prefersReducedMotion",1);')
        client.call('Marionette:SetContext', value='content')
        assert client.script('return matchMedia("(prefers-reduced-motion: reduce)").matches && [...document.querySelectorAll("button")].every(e=>parseFloat(getComputedStyle(e).transitionDuration)===0);')
        checks.append('actual reduced-motion preference disables control transitions')
    print(f'PASS visual baseline={baseline}: {len(captures)} screenshots and {len(layouts)} responsive observations', flush=True)
    return {'baseline': baseline, 'extensionVersion': client.script('return browser.runtime.getManifest().version;'), 'captures': captures, 'layouts': layouts, 'checks': checks, 'metrics': metrics, 'isolatedProfile': True}
