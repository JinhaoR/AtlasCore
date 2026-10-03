"""Native loaded-root/re-entry regressions. Disposable synthetic sites, no accounts."""
import base64
import json


def run_journey_polish(client, ui_handle, ui_url, port, wait_for, hits, run, root_departure_probe=False):
    try:
        return _run_journey_polish(client, ui_handle, ui_url, port, wait_for, hits, run, root_departure_probe)
    except Exception as failure:
        # Save failure evidence while the isolated browser and fixture still live.
        # Do not let diagnostic collection replace the original failed assertion.
        evidence = {'failureType': type(failure).__name__, 'contexts': [], 'diagnostics': [],
                    'documents': [], 'serverRequests': [
                        {'hostname': host, 'fixturePath': path.split('?', 1)[0].split('#', 1)[0]}
                        for host, path in list(hits)]}
        try:
            client.call('Marionette:SetContext', value='content')
            client.call('WebDriver:SwitchToWindow', handle=ui_handle)
            current = client.message({'kind': 'GET_VIEW'}).get('view', {})
            controller = current.get('controller') or {}
            snapshot = controller.get('snapshot') or {}
            evidence['authority'] = {key: controller.get(key) for key in ['status', 'reason']}
            evidence['snapshot'] = {key: snapshot.get(key) for key in
                                    ['policyRevision', 'configurationRevision', 'journeyState', 'accessState']}
            for context in current.get('contexts', []):
                latest = context.get('latest') or {}
                evidence['contexts'].append({key: context.get(key) for key in
                    ['tabId', 'contextId', 'navigationId', 'hostname', 'displayedHostname', 'journey', 'effect', 'retry']}
                    | {'latest': {key: latest.get(key) for key in
                                 ['type', 'decision', 'reason', 'policyRevision', 'observedAt']}})
            evidence['diagnostics'] = client.message({'kind': 'GET_DIAGNOSTICS', 'tabId': None}).get('entries', [])
        except Exception:
            evidence['authorityCaptureUnavailable'] = True
        try:
            handles = client.call('WebDriver:GetWindowHandles')
            for handle in handles:
                try:
                    client.call('WebDriver:SwitchToWindow', handle=handle)
                    evidence['documents'].append(client.script('''return {
                        hostname:location.hostname, protocol:location.protocol,
                        atlasControl:!!document.getElementById('hostname'),
                        rootLogin:!!document.getElementById('polish-login'),
                        identityFinish:!!document.getElementById('polish-finish'),
                        journeyIndicator:!!document.getElementById('atlas-journey-indicator'),
                        displayedAtlasHostname:document.getElementById('hostname')?.textContent ?? null,
                        atlasDecision:document.getElementById('decision')?.textContent ?? null,
                        restartVisible:document.getElementById('restart-journey')?.hidden === false};'''))
                except Exception:
                    evidence['documents'].append({'captureUnavailable': True})
        except Exception:
            evidence['documentCaptureUnavailable'] = True
        (run / 'journey-polish-failure.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
        print('Journey polish failure evidence:', run / 'journey-polish-failure.json', flush=True)
        raise


def _run_journey_polish(client, ui_handle, ui_url, port, wait_for, hits, run, root_departure_probe=False):
    report = {'sequence': [], 'checks': [], 'chains': []}

    def view():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']

    def context(tab_id):
        return next((item for item in view()['contexts'] if item['tabId'] == tab_id), None)

    def diagnostics(tab_id):
        view()
        return client.message({'kind': 'GET_DIAGNOSTICS', 'tabId': tab_id})['entries']

    def marker(tab_id):
        return max((item['sequence'] for item in diagnostics(tab_id)), default=0)

    def project(current):
        journey = current['journey']
        decision = (current.get('latest') or {}).get('decision')
        return {'tabId': current['tabId'], 'contextId': current['contextId'],
                'hostname': current['hostname'], 'displayedHostname': current['displayedHostname'],
                'effect': current['effect'], 'decision': decision,
                'journey': None if journey is None else {key: journey[key] for key in
                    ['id', 'phase', 'rootHostname', 'currentHostname', 'startedAt', 'expiresAt',
                     'hopCount', 'maxHops', 'endedAt', 'endReason']}}

    def record(name, current):
        report['sequence'].append({'step': name, **project(current)})
        (run / 'journey-polish-trace.json').write_text(json.dumps(report, indent=2), encoding='utf-8')

    def document(handle, identity):
        client.call('WebDriver:SwitchToWindow', handle=handle)
        return client.script('return !!document.getElementById(arguments[0]);', identity)

    def click(handle, identity):
        wait_for(lambda: document(handle, identity), f'{identity} fixture control exists')
        client.script('document.getElementById(arguments[0]).click();', identity)

    def typed(handle, url):
        client.call('WebDriver:SwitchToWindow', handle=handle)
        client.call('Marionette:SetContext', value='chrome')
        client.script('gURLBar.value = arguments[0]; gURLBar.handleCommand();', url)
        client.call('Marionette:SetContext', value='content')

    def pill(handle):
        client.call('WebDriver:SwitchToWindow', handle=handle)
        return client.script('''const host = document.getElementById('atlas-journey-indicator');
            return host ? {id:Number(host.dataset.journeyId),text:host.shadowRoot.textContent,
                pointerEvents:getComputedStyle(host).pointerEvents} : null;''')

    def root_arrived(tab_id, expected_end='REACHED', previous_id=None):
        def arrived():
            current = context(tab_id)
            if not current or current['displayedHostname'] != 'root.localhost':
                return None
            journey = current['journey']
            if journey is None or journey['phase'] != 'ENDED' or journey['endReason'] != expected_end:
                return None
            if previous_id is not None and journey['id'] == previous_id:
                return None
            decision = (current.get('latest') or {}).get('decision', {})
            return current if decision.get('outcome') == 'ALLOW' else None
        return wait_for(arrived, f'root arrival ends {expected_end}')

    def identity_arrived(tab_id, previous_id):
        def arrived():
            current = context(tab_id)
            if not current or current['displayedHostname'] != 'identity.localhost':
                return None
            journey = current['journey']
            decision = (current.get('latest') or {}).get('decision', {})
            return current if journey and journey['id'] != previous_id and journey['phase'] == 'IN_TRANSIT' \
                and decision.get('outcome') == 'ALLOW' and decision.get('reason') == 'ACTIVE_JOURNEY' else None
        return wait_for(arrived, 'loaded-root Login and immediate same-host POST reach identity')

    initial_snapshot = view()['controller']['snapshot']
    policy = initial_snapshot['policy']
    limits = initial_snapshot['configuration']['journeyLimits']

    def terms(journey):
        assert journey['expiresAt'] - journey['startedAt'] == limits['lifetimeMs'], journey
        assert journey['maxHops'] == limits['maxHops'], journey

    def open_root():
        view()
        before = set(client.call('WebDriver:GetWindowHandles'))
        opened = client.message({'kind': 'OPEN_DESTINATION', 'url': f'http://root.localhost:{port}/polish-root'})
        assert opened.get('tabId') is not None and not opened.get('error'), opened
        handle = wait_for(lambda: next((item for item in client.call('WebDriver:GetWindowHandles')
                                       if item not in before), None), 'new root document tab')
        current = root_arrived(opened['tabId'])
        wait_for(lambda: document(handle, 'polish-login'), 'root Login is present')
        assert pill(handle) is None, 'initial root REACHED should have no active Journey pill'
        record('initial root document reached', current)
        return handle, current

    def begin_login(handle, reached, name):
        tab_id = reached['tabId']
        start_sequence = marker(tab_id)
        before_hits = len(hits)
        click(handle, 'polish-login')
        current = identity_arrived(tab_id, reached['journey']['id'])
        journey = current['journey']
        assert journey['rootHostname'] == 'root.localhost' and journey['currentHostname'] == 'identity.localhost'
        assert journey['hopCount'] == 2, journey
        assert journey['startedAt'] > reached['journey']['startedAt'], journey
        terms(journey)
        entries = [item for item in diagnostics(tab_id) if item['sequence'] > start_sequence]
        released = [item for item in entries if item['event'] == 'RELEASED']
        assert [item['hostname'] for item in released] == \
            ['root.localhost', 'login.localhost', 'login.localhost', 'identity.localhost'], released
        assert all(item['outcome'] == 'ALLOW' and item['journey']['id'] == journey['id'] for item in released), released
        assert all(item['journey']['expiresAt'] == journey['expiresAt'] and
                   item['journey']['maxHops'] == journey['maxHops'] for item in released), released
        assert [item['journey']['hopCount'] for item in released] == [0, 1, 1, 2], released
        assert ('login.localhost', '/polish-select') in hits[before_hits:], 'server must receive the actual auto-POST'
        shown = wait_for(lambda: pill(handle), 'identity Journey pill after immediate auto-POST')
        assert shown['id'] == journey['id'] and 'root.localhost' in shown['text'] and shown['pointerEvents'] == 'none', shown
        report['chains'].append({'step': name, 'releases': released,
                                 'autoPostReachedServer': True, 'sameHostPostConsumedNoHop': True})
        record(name, current)
        return current

    def begin_departure(handle, reached, identity, path, name):
        tab_id = reached['tabId']
        start_sequence = marker(tab_id)
        before_hits = len(hits)
        click(handle, identity)
        current = identity_arrived(tab_id, reached['journey']['id'])
        journey = current['journey']
        assert journey['rootHostname'] == 'root.localhost' and journey['currentHostname'] == 'identity.localhost', current
        assert journey['startedAt'] > reached['journey']['startedAt'] and journey['hopCount'] == 3, journey
        terms(journey)
        entries = [item for item in diagnostics(tab_id) if item['sequence'] > start_sequence]
        released = [item for item in entries if item['event'] == 'RELEASED']
        assert [item['hostname'] for item in released] == \
            ['app.localhost', 'login.localhost', 'login.localhost', 'identity.localhost'], released
        assert all(item['outcome'] == 'ALLOW' and item['journey']['id'] == journey['id'] for item in released), released
        assert [item['journey']['hopCount'] for item in released] == [1, 2, 2, 3], released
        assert all(item['journey']['expiresAt'] == journey['expiresAt'] and
                   item['journey']['maxHops'] == journey['maxHops'] for item in released), released
        assert len({item['navigationId'] for item in released}) == 4, released
        assert ('app.localhost', path) in hits[before_hits:], 'real initial cross-host request must reach server'
        assert ('login.localhost', '/polish-select') in hits[before_hits:], 'same-host auto-POST must reach server'
        shown = wait_for(lambda: pill(handle), 'root-departure path has the original root Journey pill')
        assert shown['id'] == journey['id'] and 'root.localhost' in shown['text'], shown
        report['chains'].append({'step': name, 'releases': released,
            'rootDepartureReachedServer': True, 'autoPostReachedServer': True,
            'sameHostPostConsumedNoHop': True})
        record(name, current)
        return current

    def finish(handle, transit, name):
        click(handle, 'polish-finish')
        current = root_arrived(transit['tabId'], 'RETURNED')
        assert current['journey']['id'] == transit['journey']['id'], current
        for key in ['startedAt', 'expiresAt', 'hopCount', 'maxHops']:
            assert current['journey'][key] == transit['journey'][key], current
        wait_for(lambda: document(handle, 'polish-login'), 'completed root Login exists')
        wait_for(lambda: pill(handle) is None, 'return clears Journey pill')
        record(name, current)
        return current

    handle, reached = open_root()
    tab_id = reached['tabId']
    if root_departure_probe:
        before_hits = len(hits)
        start_sequence = marker(tab_id)
        click(handle, 'polish-direct-login')
        blocked = wait_for(lambda: (current if (current := context(tab_id)) and
            current['hostname'] == 'app.localhost' and current['effect'] == 'REMOVED' else None),
            'prior strict model denies direct Login after root REACHED')
        assert blocked['latest']['decision']['outcome'] == 'GREYLIST', blocked
        assert blocked['journey']['id'] == reached['journey']['id'] and blocked['journey']['phase'] == 'ENDED', blocked
        assert ('app.localhost', '/polish-app') not in hits[before_hits:], 'prior strict denial must withhold destination request'
        assert view()['controller']['snapshot']['policy'] == policy
        assert view()['controller']['snapshot']['accessState']['grants'] == []
        record('prior strict model: actual direct root Login is Greylist', blocked)
        report['checks'] = ['prior strict direct loaded-root Login returns Greylist',
            'root remains REACHED and no new Journey exists', 'direct request withheld', 'policy unchanged/no grants']
        report['diagnostics'] = [item for item in diagnostics(tab_id) if item['sequence'] > start_sequence]
        print('PASS prior strict root-departure probe:', json.dumps(report['checks']), flush=True)
        return report
    transit = begin_login(handle, reached, 'Login after root REACHED creates fresh Journey')
    (run / 'journey-polish-intermediate.png').write_bytes(base64.b64decode(
        client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)))

    # A typed departure must not inherit the active chain. Re-enter the root in the
    # same tab through the real address bar, then activate its actual Login link.
    for cycle in range(1, 5):
        previous = transit['journey']
        typed(handle, 'https://google.com/')
        stopped = wait_for(lambda: (current if (current := context(tab_id)) and
            current['hostname'] == 'google.com' and current['effect'] == 'REMOVED' else None),
            f'cycle {cycle}: actual typed Google is blocked')
        assert stopped['latest']['decision']['outcome'] == 'GREYLIST', stopped
        assert stopped['journey']['id'] == previous['id'] and stopped['journey']['endReason'] == 'UNRELATED_NAVIGATION', stopped
        record(f'cycle {cycle}: Google denied and prior Journey ended', stopped)
        typed(handle, f'http://root.localhost:{port}/polish-root')
        reached = root_arrived(tab_id, previous_id=previous['id'])
        assert reached['contextId'] == stopped['contextId'], reached
        terms(reached['journey'])
        record(f'cycle {cycle}: native typed root re-entry reaches document', reached)
        transit = begin_login(handle, reached, f'cycle {cycle}: legitimate Login and fast POST succeed')
        reached = finish(handle, transit, f'cycle {cycle}: successful root return')
        if cycle < 4:
            transit = begin_login(handle, reached, f'cycle {cycle}: next deliberate Login starts independently')
    report['checks'] += ['loaded root ends REACHED; actual Login starts a new Journey',
        'immediate same-host auto-POST survives document/request ordering',
        'same-host POST does not consume a hop or extend the fixed deadline',
        'four same-tab Google denial/root re-entry/Login/return cycles']

    # Cancel a live path, then use the displayed root recovery action. Recovery
    # navigates root '/', never the old provider request or the cancelled chain.
    transit = begin_login(handle, reached, 'live Journey before explicit cancellation')
    view()
    cancelled = client.message({'kind': 'CANCEL_JOURNEY', 'tabId': tab_id})
    assert cancelled.get('result', {}).get('type') == 'COMMITTED', cancelled
    removed = wait_for(lambda: (current if (current := context(tab_id)) and current['effect'] == 'REMOVED'
        and current['journey']['endReason'] == 'CANCELLED' else None), 'cancelled intermediate removed')
    assert removed['latest']['decision']['outcome'] == 'GREYLIST', removed
    record('explicit cancellation removes identity permission', removed)
    client.call('WebDriver:SwitchToWindow', handle=handle)
    wait_for(lambda: client.script('return document.getElementById("restart-journey")?.hidden === false '
        '&& !document.getElementById("restart-journey").disabled;'), 'cancelled Journey root retry action')
    client.script('document.getElementById("restart-journey").click();')
    restarted = root_arrived(tab_id, previous_id=transit['journey']['id'])
    terms(restarted['journey'])
    assert restarted['journey']['hopCount'] == 0, restarted
    record('Restart action reaches fresh root without restoring cancelled Journey', restarted)
    transit = begin_login(handle, restarted, 'Login after cancelled-Journey root retry succeeds')
    report['checks'].append('explicit cancellation and Restart action reach fresh root and fresh Login')

    # A separate tab cannot borrow the first tab's live Journey, even for the
    # exact identity hostname that it currently authorizes.
    other_handle, other_root = open_root()
    assert other_root['contextId'] != transit['contextId'] and other_root['journey']['id'] != transit['journey']['id']
    before_hits = len(hits)
    typed(other_handle, f'http://identity.localhost:{port}/polish-unrelated')
    unrelated = wait_for(lambda: (current if (current := context(other_root['tabId'])) and
        current['hostname'] == 'identity.localhost' and current['effect'] == 'REMOVED' else None),
        'second tab independently denies identity hostname')
    assert unrelated['latest']['decision']['outcome'] == 'GREYLIST', unrelated
    assert ('identity.localhost', '/polish-unrelated') not in hits[before_hits:], hits[before_hits:]
    first = context(tab_id)
    assert first['journey']['id'] == transit['journey']['id'] and first['journey']['phase'] == 'IN_TRANSIT', first
    assert wait_for(lambda: pill(handle), 'first-tab Journey remains visible')['id'] == transit['journey']['id']
    assert pill(other_handle) is None
    record('unrelated second tab has no inherited Journey authorization', unrelated)
    record('first-tab Journey unaffected by second-tab denial', first)
    reached = finish(handle, transit, 'first-tab completion after isolated second-tab denial')
    report['checks'].append('two tabs keep independent authorization and indicators; denied synthetic request withheld')

    # Root document arrival is deliberately delayed across background timer
    # checkpoints. There is no candidate injection or test-only trust signal.
    previous_id = reached['journey']['id']
    start_sequence = marker(tab_id)
    typed(handle, f'http://root.localhost:{port}/polish-slow')
    pending = wait_for(lambda: (current if (current := context(tab_id)) and current['hostname'] == 'root.localhost'
        and current['journey']['id'] != previous_id and current['journey']['phase'] == 'STARTED' else None),
        'slow root request retains a fresh STARTED Journey before arrival')
    terms(pending['journey'])
    record('slow root has saved permission while document arrival is pending', pending)
    view()
    client.script('const done = arguments[0]; setTimeout(() => done(true), 1800);', asynchronous=True)
    during = context(tab_id)
    assert during['journey']['id'] == pending['journey']['id'] and during['journey']['phase'] == 'STARTED', during
    assert during['effect'] == 'NONE' and during['latest']['decision']['outcome'] == 'ALLOW', during
    assert during['journey']['expiresAt'] == pending['journey']['expiresAt'], during
    slow_entries = [item for item in diagnostics(tab_id) if item['sequence'] > start_sequence]
    assert any(item['event'] == 'RELEASED' and item['hostname'] == 'root.localhost' for item in slow_entries), slow_entries
    assert not any(item['event'] == 'CONTENT_REMOVED' for item in slow_entries), slow_entries
    record('pending slow root survives background cadence', during)
    arrived = root_arrived(tab_id, previous_id=previous_id)
    assert arrived['journey']['id'] == pending['journey']['id'], arrived
    assert arrived['journey']['expiresAt'] == pending['journey']['expiresAt'], arrived
    record('slow root arrival ends the same saved Journey REACHED', arrived)
    report['checks'].append('four-second root document delay survives timer checkpoints without losing permission')

    # The approved first departure is rooted at the loaded Whitelist document.
    # Actual link, form and script actions use new Firefox request IDs, while
    # their following unfamiliar transitions still require HTTP correlation.
    for identity, path, name in [
            ('polish-direct-login', '/polish-app', 'direct GET Login'),
            ('polish-direct-post', '/polish-app-post', 'direct cross-host POST Login'),
            ('polish-direct-script', '/polish-app-script', 'root script navigation')]:
        transit = begin_departure(handle, arrived, identity, path, f'loaded-root {name} starts fresh bounded Journey')
        arrived = finish(handle, transit, f'{name} HTTP chain returns to original root')
    report['checks'] += ['actual direct GET, cross-host POST and root script departures start fresh Journeys',
                        'first departure consumes hop one; subsequent redirects retain HTTP correlation',
        'all direct-departure returns end the same Journey without renewed deadline']

    # A provider is not a new trusted root. An unrelated page link from the
    # intermediate must be blocked before the synthetic destination is contacted.
    transit = begin_departure(handle, arrived, 'polish-direct-login', '/polish-app',
        'fresh direct departure before uncorrelated intermediate link')
    before_hits = len(hits)
    click(handle, 'polish-unrelated')
    unrelated = wait_for(lambda: (current if (current := context(tab_id)) and
        current['hostname'] == 'evil.localhost' and current['effect'] == 'REMOVED' else None),
        'uncorrelated cross-host link from an intermediate remains Greylist')
    assert unrelated['latest']['decision']['outcome'] == 'GREYLIST', unrelated
    assert unrelated['journey']['id'] == transit['journey']['id'] and unrelated['journey']['endReason'] == 'UNRELATED_NAVIGATION', unrelated
    assert ('evil.localhost', '/polish-uncorrelated') not in hits[before_hits:], hits[before_hits:]
    record('intermediate cross-host link cannot rebase the Journey or reach server', unrelated)
    typed(handle, f'http://root.localhost:{port}/polish-root')
    arrived = root_arrived(tab_id, previous_id=transit['journey']['id'])
    transit = begin_departure(handle, arrived, 'polish-direct-login', '/polish-app',
        'same-tab root re-entry restores legitimate direct Login after unrelated denial')
    record('same-tab direct Login succeeds after previously ended Journey', transit)
    typed(handle, 'https://google.com/')
    stopped = wait_for(lambda: (current if (current := context(tab_id)) and
        current['hostname'] == 'google.com' and current['effect'] == 'REMOVED' else None),
        'actual Google entry during direct-departure Journey stays blocked')
    assert stopped['latest']['decision']['outcome'] == 'GREYLIST', stopped
    assert stopped['journey']['id'] == transit['journey']['id'] and stopped['journey']['endReason'] == 'UNRELATED_NAVIGATION', stopped
    record('Google cannot borrow loaded-root departure evidence', stopped)
    typed(handle, f'http://root.localhost:{port}/polish-root')
    arrived = root_arrived(tab_id, previous_id=transit['journey']['id'])
    transit = begin_departure(handle, arrived, 'polish-direct-login', '/polish-app',
        'direct Login succeeds again after typed Google interruption')
    arrived = finish(handle, transit, 'final fresh direct Login returns to root')
    report['checks'] += ['uncorrelated intermediate link stays Greylist and its destination request is withheld',
        'typed Google stays Greylist during direct-departure Journey',
        'same-tab root re-entry and legitimate direct Login succeed after each ended attempt']

    # A real cross-domain form POST, followed by an immediate auto-submit POST,
    # models the transport after phone approval without credentials or request bodies.
    transit = begin_departure(handle, arrived, 'polish-direct-login', '/polish-app',
        'loaded root enters synthetic phone authentication')
    approval = transit['journey']
    wait_for(lambda: document(handle, 'polish-mfa-confirm'), 'synthetic phone confirmation button is loaded')
    button = client.call('WebDriver:FindElement', using='css selector', value='#polish-mfa-confirm')
    client.call('WebDriver:ElementClick', id=button['element-6066-11e4-a52e-4f735466cecf'])
    arrived = root_arrived(tab_id, expected_end='RETURNED')
    assert arrived['journey']['id'] == approval['id']
    assert arrived['journey']['expiresAt'] == approval['expiresAt']
    assert arrived['journey']['hopCount'] == approval['hopCount'] + 2
    assert ('login.localhost', '/polish-mfa-approved') in hits
    assert ('app.localhost', '/polish-mfa-callback') in hits
    post_entries = [entry for entry in diagnostics(tab_id) if entry['event'] == 'RELEASED'
        and entry.get('continuationKind') == 'FORM_POST' and entry['journey']['id'] == approval['id']]
    assert [(entry['method'], entry['sourceHostname'], entry['hostname']) for entry in post_entries] == \
        [('POST', 'identity.localhost', 'login.localhost'), ('POST', 'login.localhost', 'app.localhost')], post_entries
    record('synthetic phone confirmation returned through POSTs', arrived)
    report['checks'].append('cross-domain confirmation POST and immediate auto-POST return with unchanged Journey ID/deadline')

    current_snapshot = view()['controller']['snapshot']
    assert current_snapshot['policy'] == policy
    assert current_snapshot['accessState']['grants'] == initial_snapshot['accessState']['grants'] == []
    assert current_snapshot['accessState']['pendingRequests'] == initial_snapshot['accessState']['pendingRequests'] == []
    assert current_snapshot['configuration'] == initial_snapshot['configuration']
    report['checks'] += ['policy/configuration unchanged', 'no permanent trust, pending Access request or temporary grant created']
    report['diagnostics'] = client.message({'kind': 'GET_DIAGNOSTICS', 'tabId': None})['entries']
    (run / 'journey-polish-trace.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('PASS native Journey loaded-root/re-entry polishing:', json.dumps(report['checks']), flush=True)
    return report
