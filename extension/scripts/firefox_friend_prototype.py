"""D27 native presentation and first-run checks. Synthetic sites, no credentials."""
import base64
import time


def run_friend_prototype(client, ui_handle, ui_url, port, wait_for, hits, run, startup):
    assert startup['status'] == 'READY', 'new friend profiles need no setup'
    seed = startup['snapshot']
    assert len(seed['policy']['whitelist']) == 51
    assert seed['policy']['blacklist'] == []
    assert seed['policyRevision'] == 0
    assert seed['accessState']['grants'] == [] and seed['accessState']['pendingRequests'] == []
    assert seed['journeyState']['journeys'] == [] and seed['vaultState']['pendingProposal'] is None

    def view():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']

    before = view()['controller']['snapshot']['policy']
    client.script("document.getElementById('show-home').click();")
    wait_for(lambda: client.script("return !document.getElementById('temporary-empty').hidden;"), 'empty overview')
    handles = client.call('WebDriver:GetWindowHandles')
    hit_start = len(hits)
    tab_id = client.script('''
        const done = arguments[arguments.length - 1];
        browser.tabs.create({url: arguments[0], active: false}).then(tab => done(tab.id));
    ''', f'http://unknown.localhost:{port}/', asynchronous=True)
    site_handle = wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in handles), None), 'blocked site tab')
    wait_for(lambda: any(c['tabId'] == tab_id and c['effect'] == 'REMOVED' for c in view()['contexts']), 'unknown navigation blocked')
    assert ('unknown.localhost', '/') not in hits[hit_start:]
    client.call('WebDriver:SwitchToWindow', handle=site_handle)
    wait_for(lambda: client.script("return !document.getElementById('start-access').hidden && !document.getElementById('start-access').disabled;"), 'request control')
    client.script("document.getElementById('start-access').click();")
    request = wait_for(lambda: next(iter(view()['controller']['snapshot']['accessState']['pendingRequests']), None), 'pending request')
    assert view()['temporaryAccess'] == []
    client.call('WebDriver:SwitchToWindow', handle=site_handle)
    wait_for(lambda: client.script("return !document.getElementById('confirm-access').hidden && !document.getElementById('confirm-access').disabled;"), 'confirmation window', 20)
    assert view()['temporaryAccess'] == [], 'time availability does not create a grant'
    client.call('WebDriver:SwitchToWindow', handle=site_handle)
    client.script("document.getElementById('confirm-access').click();")
    current = wait_for(lambda: (v := view()) and len(v['temporaryAccess'] or []) == 1 and v, 'committed grant overview')
    grant = current['controller']['snapshot']['accessState']['grants'][0]
    assert current['temporaryAccess'][0]['expiresAt'] == grant['expiresAt']
    assert grant['requestId'] == request['id']
    client.script("document.getElementById('show-home').click();")
    wait_for(lambda: client.script("return document.querySelectorAll('#temporary-list .temporary-row').length === 1 && document.querySelector('.temporary-time').textContent.includes('remaining');"), 'visible Home countdown')
    assert client.script("return document.querySelector('.temporary-scope').textContent;") == 'unknown.localhost'
    client.script('''
        window.__atlasTemporaryRow = document.querySelector('.temporary-row');
        window.__atlasTemporaryTime = document.querySelector('.temporary-time').textContent;
        document.getElementById('destination-search').focus();
    ''')
    wait_for(lambda: client.script("return document.querySelector('.temporary-time').textContent !== window.__atlasTemporaryTime;"), 'countdown advances')
    assert client.script("return document.querySelector('.temporary-row') === window.__atlasTemporaryRow && document.activeElement.id === 'destination-search';"), 'timer retains row and focus'
    (run / 'friends-home.png').write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=True)))
    client.call('WebDriver:SetWindowRect', width=500, height=950)
    assert client.script('return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;'), 'small-screen overflow'
    (run / 'friends-home-small.png').write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=True)))
    client.call('WebDriver:SetWindowRect', width=1280, height=1100)

    client.script('''
        window.__atlasTemporaryTransport = browser.runtime.sendMessage;
        browser.runtime.sendMessage = function(message, ...rest) {
            if (message?.kind === 'GET_VIEW') return Promise.reject(new Error('synthetic view failure'));
            return window.__atlasTemporaryTransport.call(browser.runtime, message, ...rest);
        };
    ''')
    wait_for(lambda: client.script("return !document.getElementById('temporary-unavailable').hidden && document.getElementById('temporary-list').hidden;"), 'unavailable authority hides active-access claims')
    client.script('browser.runtime.sendMessage = window.__atlasTemporaryTransport;')
    wait_for(lambda: client.script("return !document.getElementById('temporary-list').hidden;"), 'verified overview recovers')
    assert view()['controller']['snapshot']['policy'] == before
    assert client.message({'kind': 'CONFIRM_ACCESS', 'requestId': request['id']})['result']['reason'] == 'REQUEST_NOT_FOUND'

    # Reload the actual background without resetting policy or grant timestamps.
    client.script('setTimeout(() => browser.runtime.reload(), 0); return true;')
    wait_for(lambda: ui_handle not in client.call('WebDriver:GetWindowHandles'), 'old UI closes on reload')
    client.call('Marionette:SetContext', value='chrome')
    client.script('gBrowser.selectedTab = gBrowser.addTrustedTab(arguments[0]);', ui_url)
    client.call('Marionette:SetContext', value='content')
    ui_handle = client.call('WebDriver:GetWindowHandles')[-1]
    client.call('WebDriver:SwitchToWindow', handle=ui_handle)
    wait_for(lambda: client.script("return location.protocol === 'moz-extension:' && document.readyState === 'complete';"), 'reopened Atlas')
    recovered = wait_for(lambda: (v := view()) and (v.get('controller') or {}).get('status') == 'READY' and v, 'background authority recovered')
    assert recovered['controller']['snapshot']['policy'] == before
    assert recovered['controller']['snapshot']['accessState']['grants'] == [grant]
    assert recovered['temporaryAccess'][0]['expiresAt'] == grant['expiresAt']
    wait_for(lambda: client.script("return document.querySelectorAll('#temporary-list .temporary-row').length === 1;"), 'grant survives reload')
    wait_for(lambda: time.time() * 1000 >= grant['expiresAt'], 'original grant expires', 65)
    wait_for(lambda: client.script("return !document.getElementById('temporary-empty').hidden && document.querySelectorAll('#temporary-list .temporary-row').length === 0;"), 'expired grant leaves overview')
    final = wait_for(lambda: (v := view()) and any(c['hostname'] == 'unknown.localhost' and c['effect'] == 'REMOVED'
                       and c['latest'].get('decision', {}).get('outcome') == 'GREYLIST' for c in v['contexts']) and v, 'expired page withheld')
    assert final['temporaryAccess'] == []
    assert final['controller']['snapshot']['policy'] == before
    assert final['controller']['snapshot']['accessState']['grants'] == [grant]
    report = {
        'extensionVersion': client.script('return browser.runtime.getManifest().version;'),
        'freshInstallWhitelistCount': 51, 'freshInstallBlacklistEmpty': True,
        'setupRequired': False, 'freshRevision': 0, 'noCopiedRuntimeState': True,
        'pendingAndReadyRequestsHidden': True, 'savedGrantVisible': True,
        'countdownAdvances': True, 'rowAndFocusStable': True, 'smallScreenFits': True,
        'unavailableStateHidesGrants': True, 'restartPreservesGrantAndPolicy': True,
        'expiryRemovesRowAndPage': True, 'fixedExpiry': True, 'noRenewal': True,
    }
    print('PASS fresh friend policy, temporary overview/countdown, stable focus, failure, restart and real expiry', flush=True)
    return ui_handle, report
