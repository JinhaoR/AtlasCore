"""Native adapter/UI regressions in the existing isolated Firefox smoke profile."""
import base64


def run_coherence(client, ui_handle, ui_url, port, wait_for, artifacts):
    checks = []

    def view():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']

    def snapshot():
        return view()['controller']['snapshot']

    def capture(name):
        wait_for(lambda: client.script('return !document.getAnimations().some(animation => animation.playState === "running");'), 'presentation animations settle before screenshot')
        shot = client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)
        (artifacts / f'{name}.png').write_bytes(base64.b64decode(shot))

    baseline = snapshot()
    client.script('document.getElementById("show-settings").click();')
    capture('coherence-settings-overview')
    assert client.script('return !document.getElementById("timing-settings").open;')
    client.script('document.querySelector("#timing-settings > summary").click();')
    assert client.script('return document.getElementById("timing-settings").open && document.getElementById("show-settings").getAttribute("aria-current") === "page";')
    drafts = client.script('''
      const white = document.getElementById('policy-whitelist');
      const black = document.getElementById('policy-blacklist');
      white.value += '\\ndraft.localhost'; black.value += '\\ndraft-deny.localhost';
      document.getElementById('access-wait').value = '1.001';
      return {white:white.value, black:black.value, wait:document.getElementById('access-wait').value};
    ''')
    # Fail this UI page's transport only. Background authority and IndexedDB stay intact.
    client.script('''
      window.__atlasUiTransport = browser.runtime.sendMessage;
      window.__atlasUiFailedPolls = 0;
      browser.runtime.sendMessage = function(message, ...rest) {
        if (message?.kind === 'GET_VIEW') {
          ++window.__atlasUiFailedPolls;
          return Promise.reject(new Error('synthetic UI transport failure'));
        }
        return window.__atlasUiTransport.call(browser.runtime, message, ...rest);
      };
    ''')
    try:
        wait_for(lambda: client.script('return window.__atlasUiFailedPolls > 0 && document.getElementById("status").textContent === "Atlas is unavailable";'), 'UI observes unavailable authority')
        unavailable = client.script('''
          return {white:document.getElementById('policy-whitelist').value,
            black:document.getElementById('policy-blacklist').value,
            wait:document.getElementById('access-wait').value,
            disabled:['propose-policy','propose-settings','confirm-policy'].every(id => document.getElementById(id).disabled)};
        ''')
        assert {key: unavailable[key] for key in drafts} == drafts, unavailable
        assert unavailable['disabled'], unavailable
    finally:
        client.script('browser.runtime.sendMessage = window.__atlasUiTransport; delete window.__atlasUiTransport; delete window.__atlasUiFailedPolls;')
    wait_for(lambda: client.script('return document.getElementById("status").dataset.ready === "true";'), 'UI authority reconnects')
    assert client.script('return {white:document.getElementById("policy-whitelist").value, black:document.getElementById("policy-blacklist").value, wait:document.getElementById("access-wait").value};') == drafts
    assert snapshot()['policy'] == baseline['policy']
    assert snapshot()['configuration'] == baseline['configuration']
    checks.append('unsaved policy/timing drafts survive unavailable authority and reconnect; commands stay disabled')
    print('PASS native UI drafts: unavailable state, disabled commands, reconnect without lost edits', flush=True)

    client.script('''
      document.getElementById('access-wait').value = '1.0005';
      document.getElementById('settings-form').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
    ''')
    assert 'whole milliseconds' in client.script('return document.getElementById("feedback").textContent;')
    assert snapshot()['vaultState']['pendingProposal'] is None
    assert snapshot()['configuration'] == baseline['configuration']
    checks.append('fractional millisecond draft cannot create a Vault proposal or change active settings')
    client.script('document.getElementById("show-home").click();')
    assert client.script('return document.activeElement.id === "main-content";')
    assert client.script('return document.getElementById("feedback").hidden;'), 'Settings validation message leaked into Home'
    client.script('''
      const input = document.getElementById('destination-search'); input.focus(); input.value = 'root.localhost';
      input.dispatchEvent(new Event('input')); input.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true}));
    ''')
    assert client.script('return document.getElementById("destination-search").getAttribute("aria-activedescendant") === "search-result-0";')
    assert client.script('return [...document.querySelectorAll("#search-results button")].every(button => button.tabIndex === -1);')
    client.script('document.getElementById("destination-search").dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}));')
    assert client.script('return document.activeElement.id === "destination-search" && document.getElementById("search-results").hidden && !document.getElementById("destination-search").hasAttribute("aria-activedescendant");')
    capture('coherence-home')
    client.call('WebDriver:SetWindowRect', width=500, height=900)
    assert client.script('return document.documentElement.scrollWidth <= document.documentElement.clientWidth;'), 'small-screen horizontal overflow'
    capture('coherence-home-small')
    client.call('WebDriver:SetWindowRect', width=1280, height=1100)
    checks.append('explicit navigation clears stale feedback; search/Escape retain focus; responsive Home has no horizontal overflow')

    opened = client.message({'kind': 'OPEN_DESTINATION', 'url': f'http://root.localhost:{port}/'})
    tab_id = opened['tabId']
    assert opened['opened']

    def context():
        return next((entry for entry in view()['contexts'] if entry['tabId'] == tab_id), None)

    wait_for(lambda: (entry := context()) and entry['displayedHostname'] == 'root.localhost' and entry['journey']['phase'] == 'ENDED', 'root document and completion')
    client.script('''
      document.getElementById('show-home').click();
      const select = document.getElementById('context'); select.value = String(arguments[0]); select.dispatchEvent(new Event('change'));
    ''', tab_id)
    wait_for(lambda: client.script('return !document.getElementById("show-access").hidden;'), 'current destination control')
    client.script('document.getElementById("show-access").focus(); document.getElementById("show-access").click();')
    assert client.script('return document.activeElement.id === "access-title" && !document.getElementById("access-panel").hidden;')
    client.script('document.getElementById("show-home").click();')
    assert client.script('return document.activeElement.id === "main-content" && document.getElementById("access-panel").hidden;')
    checks.append('current destination and Home move focus to their visible content')

    # An internal replacement retires the loaded document as a Journey source.
    client.script('const [tabId, done] = arguments; browser.tabs.update(tabId,{url:"about:blank"}).then(() => done(true));', tab_id, asynchronous=True)
    wait_for(lambda: (entry := context()) and entry['displayedHostname'] is None, 'internal page retires root source')
    old_count = len(snapshot()['journeyState']['journeys'])
    client.script('const [tabId, url, done] = arguments; browser.tabs.update(tabId,{url}).then(() => done(true));', tab_id, f'http://unknown.localhost:{port}/', asynchronous=True)
    entry = wait_for(lambda: (item := context()) and item['latest'].get('decision', {}).get('outcome') == 'GREYLIST' and item['effect'] == 'REMOVED' and item, 'unknown site stays Greylist after internal replacement')
    assert entry['displayedHostname'] is None
    assert len(snapshot()['journeyState']['journeys']) == old_count
    assert snapshot()['accessState']['grants'] == []
    checks.append('native internal replacement clears root evidence; next unknown site gets no Journey or grant')

    client.script('document.getElementById("show-access").click();')
    wait_for(lambda: client.script('return !document.getElementById("start-access").hidden && !document.getElementById("start-access").disabled;'), 'Greylist request action')
    client.script('document.getElementById("start-access").focus(); document.getElementById("start-access").click();')
    wait_for(lambda: client.script('return document.getElementById("start-access").hidden && document.activeElement.id === "access-title";'), 'hidden action transfers focus')
    assert context()['latest']['decision']['outcome'] == 'WAIT'
    assert snapshot()['accessState']['grants'] == []
    capture('coherence-access')
    client.script('document.getElementById("cancel-access").click();')
    wait_for(lambda: len(snapshot()['accessState']['pendingRequests']) == 0, 'native pending request cancelled')
    checks.append('Greylist request preserves wait; hidden action transfers focus to access heading')
    assert snapshot()['policy'] == baseline['policy']
    assert snapshot()['configuration'] == baseline['configuration']
    assert snapshot()['accessState']['grants'] == []
    print('PASS native coherence: source retirement, keyboard focus, Greylist wait and unchanged policy/settings', flush=True)
    view()
    client.script('const [tabId, done] = arguments; browser.tabs.remove(tabId).then(() => done(true));', tab_id, asynchronous=True)
    client.script('document.getElementById("show-settings").click();')
    capture('coherence-settings')
    return {'extensionVersion': client.script('return browser.runtime.getManifest().version;'), 'checks': checks}
