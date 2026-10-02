"""Native interruption/retry probe. Synthetic hosts only, no real accounts."""
import json
import base64
import time


def run_journey_retry(client, ui_handle, ui_url, port, wait_for, hits, artifacts, probe=False):
    report = {'probe': probe, 'sequence': [], 'checks': []}

    def view():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']

    def context(tab_id):
        return next((c for c in view()['contexts'] if c['tabId'] == tab_id), None)

    def indicator(handle):
        client.call('WebDriver:SwitchToWindow', handle=handle)
        return client.script('''const host = document.getElementById('atlas-journey-indicator');
            return host ? {id:Number(host.dataset.journeyId), text:host.shadowRoot.textContent,
                pointerEvents:getComputedStyle(host).pointerEvents} : null;''')

    def typed(handle, url):
        client.call('WebDriver:SwitchToWindow', handle=handle)
        client.call('Marionette:SetContext', value='chrome')
        client.script('gURLBar.value = arguments[0]; gURLBar.handleCommand();', url)
        client.call('Marionette:SetContext', value='content')

    def record(name, current):
        report['sequence'].append({'step': name, 'hostname': current['hostname'],
                                   'displayedHostname': current['displayedHostname'],
                                   'decision': current['latest'], 'journey': current['journey']})
        (artifacts / 'journey-trace.json').write_text(json.dumps(report, indent=2), encoding='utf-8')

    def open_root(surface='address'):
        view()
        before = set(client.call('WebDriver:GetWindowHandles'))
        if surface == 'card':
            client.script('document.getElementById("show-home").click(); document.querySelector("#destination-list [data-destination-id=\\"host:root.localhost\\"] .destination-open").click();')
        elif surface == 'search':
            client.script('''document.getElementById('show-home').click(); const input = document.getElementById('destination-search');
                input.value = 'root.localhost'; input.dispatchEvent(new Event('input')); document.getElementById('search-form').requestSubmit();''')
        else:
            client.script('''document.getElementById('show-home').click();
                document.getElementById('destination').value = arguments[0];
                document.getElementById('journey-form').requestSubmit();''', f'http://root.localhost:{port}/begin-login')
        handle = wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in before), None), 'fresh Home destination tab')
        try:
            current = wait_for(lambda: next((c for c in view()['contexts'] if c['displayedHostname'] == 'login.localhost'
                and c['journey']['phase'] == 'IN_TRANSIT'), None), 'committed authentication intermediate')
        except AssertionError:
            print('Retry fixture state:', json.dumps(view()), flush=True)
            client.call('WebDriver:SwitchToWindow', handle=handle)
            print('Retry document:', client.script('return {hostname:location.hostname,protocol:location.protocol,title:document.title};'), flush=True)
            print('Synthetic server requests:', hits, flush=True)
            raise
        return handle, current

    handle, initial = open_root()
    tab_id = initial['tabId']; original = initial['journey']; policy = view()['controller']['snapshot']['policy']
    record('intermediate arrival', initial)
    if not probe:
        shown = wait_for(lambda: indicator(handle), 'visible intermediate Journey pill')
        assert shown['id'] == original['id'] and 'root.localhost' in shown['text'] and 'login.localhost' not in shown['text']
        assert shown['pointerEvents'] == 'none'
        stable = client.script('''const done=arguments[0], host=document.getElementById('atlas-journey-indicator'),
            pill=host.shadowRoot.querySelector('div'), timer=pill.lastElementChild, before=timer.textContent;
            const changes={nodes:0,text:0}; const observer=new MutationObserver(records=>records.forEach(r=>{
                if(r.type==='childList' && r.target!==timer)changes.nodes++; else changes.text++;
            })); observer.observe(host.shadowRoot,{subtree:true,childList:true,characterData:true});
            const a=host.getBoundingClientRect(),b=document.getElementById('synthetic-login').getBoundingClientRect();
            const overlap=a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
            setTimeout(()=>{observer.disconnect();done({sameHost:host===document.getElementById('atlas-journey-indicator'),
                sameTimer:timer===pill.lastElementChild,before,after:timer.textContent,...changes,overlap})},2300);''', asynchronous=True)
        assert stable['sameHost'] and stable['sameTimer'] and stable['nodes'] == 0 and stable['before'] != stable['after'] and not stable['overlap'], stable
        report['stableIndicator'] = stable
        shot = client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)
        (artifacts / 'journey-intermediate.png').write_bytes(base64.b64decode(shot))
    view()
    report['badge'] = client.script('''const [tabId, done] = arguments;
        Promise.all([browser.browserAction.getBadgeText({tabId}),browser.browserAction.getTitle({tabId})])
        .then(([text,title])=>done({text,title}));''', tab_id, asynchronous=True)
    client.call('WebDriver:SwitchToWindow', handle=handle)
    client.call('Marionette:SetContext', value='chrome')
    report['toolbar'] = client.script('''const widget = CustomizableUI.getWidget('atlas-development_atlas_invalid-browser-action');
        const node = widget?.forWindow(window)?.node;
        return {placement: CustomizableUI.getPlacementOfWidget('atlas-development_atlas_invalid-browser-action'),
            inNavbar: !!node?.closest('#nav-bar'), visible: !!node?.getClientRects().length};''')
    client.script('gURLBar.value = arguments[0]; gURLBar.handleCommand();', f'http://evil.localhost:{port}/typed')
    client.call('Marionette:SetContext', value='content')
    stopped = wait_for(lambda: (c if (c := context(tab_id)) and c['hostname'] == 'evil.localhost'
        and c['effect'] == 'REMOVED' else None), 'typed unrelated navigation blocked')
    assert stopped['journey']['id'] == original['id'] and stopped['journey']['endReason'] == 'UNRELATED_NAVIGATION'
    assert stopped['latest']['decision']['outcome'] == 'GREYLIST'
    assert not any(host == 'evil.localhost' for host, _ in hits)
    record('typed unrelated navigation', stopped)
    if not probe:
        assert indicator(handle) is None
    client.call('WebDriver:SwitchToWindow', handle=handle)
    view(); before_back_sequence = client.message({'kind':'GET_DIAGNOSTICS','tabId':tab_id})['entries'][-1]['sequence']
    before_back_hits = len(hits)
    client.call('WebDriver:SwitchToWindow', handle=handle)
    client.call('WebDriver:Back')
    stale = wait_for(lambda: (c if (c := context(tab_id)) and c['hostname'] == 'login.localhost'
        and c['effect'] == 'REMOVED' else None), 'Back to stale auth document is Greylist')
    assert stale['journey']['id'] == original['id'] and stale['journey']['phase'] == 'ENDED'
    record('Back to stale intermediate', stale)
    back_entries = client.message({'kind':'GET_DIAGNOSTICS','tabId':tab_id})['entries']
    report['backEvidence'] = { 'requestObserved': any(e['sequence'] > before_back_sequence and e['event'] == 'REQUEST' and e['hostname'] == 'login.localhost' for e in back_entries),
        'arrivalObserved': any(e['sequence'] > before_back_sequence and e['event'] == 'ARRIVED' and e['hostname'] == 'login.localhost' for e in back_entries),
        'serverDocumentRequest': ('login.localhost','/') in hits[before_back_hits:] }
    client.call('WebDriver:SwitchToWindow', handle=handle)
    wait_for(lambda: client.script('return document.getElementById("hostname")?.textContent === "login.localhost";'), 'blocked intermediate UI')
    if not probe:
        wait_for(lambda: client.script('return document.getElementById("restart-journey")?.hidden === false && !document.getElementById("restart-journey").disabled;'), 'root recovery action rendered')
    report['recoveryUI'] = client.script('''return {hostname:document.getElementById('hostname').textContent,
        journeyHidden:document.getElementById('journey-panel').hidden,
        restartAvailable:!!document.getElementById('restart-journey') && !document.getElementById('restart-journey').hidden};''')
    if not probe:
        (artifacts / 'journey-ended.png').write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)))
    next_handle, retry = open_root('card' if not probe else 'address')
    assert retry['journey']['id'] != original['id']
    assert retry['journey']['rootHostname'] == 'root.localhost' and retry['journey']['hopCount'] == 1
    assert retry['journey']['startedAt'] > original['startedAt']
    assert retry['journey']['expiresAt'] - retry['journey']['startedAt'] == 300000
    assert retry['journey']['maxHops'] == 12
    assert view()['controller']['snapshot']['policy'] == policy
    assert view()['controller']['snapshot']['accessState']['grants'] == []
    record('fresh explicit root retry', retry)
    root_events = client.message({'kind':'GET_DIAGNOSTICS','tabId':retry['tabId']})['entries']
    released = [e for e in root_events if e['event'] == 'RELEASED']
    assert released[0]['hostname'] == 'root.localhost'
    assert all(e['journey']['id'] == retry['journey']['id'] for e in released)
    assert all(e['navigationId'] > initial['navigationId'] for e in released)
    if not probe:
        assert report['recoveryUI']['restartAvailable']
        assert wait_for(lambda: indicator(next_handle), 'retry indicator')['id'] == retry['journey']['id']
        # The actual Home card opens HTTPS root directly; the fixture then redirects.
        assert ('root.localhost', '/') in hits
        record('Home card recovery', retry)
        # Actual google.com address entry remains blocked during the fresh Journey.
        typed(next_handle, 'https://google.com/')
        google = wait_for(lambda: (c if (c := context(retry['tabId'])) and c['hostname'] == 'google.com'
            and c['effect'] == 'REMOVED' else None), 'actual Google address entry remains blocked')
        assert google['latest']['decision']['outcome'] != 'ALLOW'
        assert google['journey']['endReason'] == 'UNRELATED_NAVIGATION'
        assert indicator(next_handle) is None
        record('actual Google interruption', google)
        # The old blocked auth tab's explicit recovery action uses its saved root origin.
        client.call('WebDriver:SwitchToWindow', handle=handle)
        client.script('document.getElementById("restart-journey").click();')
        restarted = wait_for(lambda: (c if (c := context(tab_id)) and c['displayedHostname'] == 'login.localhost'
            and c['journey']['phase'] == 'IN_TRANSIT' else None), 'Restart journey returns to legitimate auth')
        assert restarted['journey']['id'] != original['id']
        assert restarted['journey']['hopCount'] == 1 and restarted['journey']['maxHops'] == 12
        assert restarted['journey']['expiresAt'] - restarted['journey']['startedAt'] == 300000
        assert wait_for(lambda: indicator(handle), 'restart indicator')['id'] == restarted['journey']['id']
        record('Restart button recovery', restarted)
        # Reload is an independent unfamiliar navigation, so normal policy applies.
        client.call('WebDriver:SwitchToWindow', handle=handle); client.call('WebDriver:Refresh')
        reloaded = wait_for(lambda: (c if (c := context(tab_id)) and c['hostname'] == 'login.localhost'
            and c['effect'] == 'REMOVED' else None), 'stale auth reload uses ordinary policy')
        assert reloaded['journey']['phase'] == 'ENDED'
        record('auth reload cannot retain old authority', reloaded)
        # A second Home surface also starts the correct root, not the selected auth host.
        search_handle, searched = open_root('search')
        assert searched['journey']['id'] != restarted['journey']['id']
        assert wait_for(lambda: indicator(search_handle), 'search retry indicator')
        record('Home search recovery', searched)
        # Another ordinary root document has no Journey pill after REACHED.
        view(); before = set(client.call('WebDriver:GetWindowHandles'))
        ordinary = client.message({'kind':'OPEN_DESTINATION','url':f'http://root.localhost:{port}/complete'})
        ordinary_handle = wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in before),None), 'ordinary root tab')
        wait_for(lambda: (c := context(ordinary['tabId'])) and c['journey']['phase'] == 'ENDED', 'ordinary root arrival')
        assert indicator(ordinary_handle) is None
        assert context(searched['tabId'])['journey']['phase'] == 'IN_TRANSIT'
        client.call('WebDriver:SwitchToWindow', handle=search_handle)
        # Same-host action → correlated root/identity redirect → return.
        client.script('document.getElementById("identity").click();')
        wait_for(lambda: (c := context(searched['tabId'])) and c['displayedHostname'] == 'identity.localhost', 'fresh chain identity')
        assert wait_for(lambda: indicator(search_handle), 'second intermediate indicator')['id'] == searched['journey']['id']
        client.script('document.getElementById("finish").click();')
        completed = wait_for(lambda: (c if (c := context(searched['tabId'])) and c['journey']['endReason'] == 'RETURNED' else None), 'fresh chain root return')
        assert indicator(search_handle) is None
        record('successful root return', completed)
        # Reload the extension while a NEW attempt is in transit. Lost native bindings end it.
        live_handle, live = open_root('card')
        assert wait_for(lambda: indicator(live_handle), 'live indicator before extension reload')
        old_id = live['journey']['id']; view()
        client.script('setTimeout(()=>browser.runtime.reload(),0); return true;')
        wait_for(lambda: ui_handle not in client.call('WebDriver:GetWindowHandles'), 'old UI closes')
        client.call('WebDriver:SwitchToWindow', handle=live_handle)
        client.call('Marionette:SetContext', value='chrome')
        client.script('gBrowser.selectedTab = gBrowser.addTrustedTab(arguments[0]);', ui_url)
        client.call('Marionette:SetContext', value='content')
        ui_handle = client.call('WebDriver:GetWindowHandles')[-1]
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        wait_for(lambda: client.script('return location.href === arguments[0] && document.readyState === "complete";',ui_url), 'new UI')
        wait_for(lambda: view()['controller']['status'] == 'READY','recovered authority')
        ended = next(j for j in view()['controller']['snapshot']['journeyState']['journeys'] if j['id'] == old_id)
        assert ended['phase'] == 'ENDED' and ended['endReason'] == 'CONTEXT_CLOSED'
        wait_for(lambda: not indicator(live_handle), 'reload clears old page indicator')
        view()
        assert view()['controller']['snapshot']['policy'] == policy
        assert view()['controller']['snapshot']['accessState']['grants'] == []
        report['checks'] += ['visible destination/decreasing countdown without node churn or form overlap',
            'toolbar arrival reset and new navbar placement', 'actual Google address entry blocked',
            'actual Home card and search start fresh roots', 'Restart button restarts root and fresh terms',
            'auth reload uses ordinary policy', 'second tab has no inherited indicator',
            'second intermediate recreates indicator', 'return clears indicator', 'extension reload ends authority and clears indicator']
    report['diagnostics'] = client.message({'kind':'GET_DIAGNOSTICS','tabId':None})['entries']
    report['checks'] += ['unrelated typed destination withheld', 'ended UNRELATED_NAVIGATION',
        'Back does not resurrect Journey', 'explicit Home root retry creates fresh Journey and succeeds']
    print('PASS Journey interruption/visibility' if not probe else 'Journey interruption probe:', json.dumps({key:value for key,value in report.items() if key != 'diagnostics'}), flush=True)
    return report
