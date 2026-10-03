"""Optional native check of one Greylist cycle across a public canonical redirect.

Fresh Firefox profile, public homepage only, no login, cookies from a user profile,
or page contents in evidence. The server may show a bot challenge; the check is of
Atlas's navigation authorization, not shopping or authenticated compatibility.
Amazon uses declared aliases; Goodreads exercises pre-request canonical discovery.
The optional HTTP entry check disables automatic HTTPS upgrades only in its
disposable test profile, proving that scope preparation still probes HTTPS.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('atlas_smoke', Path(__file__).with_name('firefox-e2e.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class PublicClient(smoke.Marionette):
    def call(self, method, **parameters):
        try:
            return super().call(method, **parameters)
        except Exception:
            # Browser errors can contain live URLs; do not retain their raw text.
            raise RuntimeError(f'Automation command failed: {method}') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--firefox', default=os.environ.get('FIREFOX_BINARY') or shutil.which('firefox')
                        or r'C:\Program Files\Mozilla Firefox\firefox.exe')
    parser.add_argument('--hostname', choices=['amazon.se', 'www.amazon.se', 'goodreads.com'], default='amazon.se')
    parser.add_argument('--scheme', choices=['http', 'https'], default='https',
                        help='Requested homepage scheme; HTTP mode uses an isolated transport test profile')
    args = parser.parse_args()
    apex_hostname = args.hostname.removeprefix('www.')
    canonical_hostname = f'www.{apex_hostname}'
    expected_scope = [apex_hostname, canonical_hostname]
    artifacts = smoke.EXTENSION.parent / '.tools'
    artifacts.mkdir(exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix='firefox-greylist-', dir=artifacts))
    profile = run / 'profile'
    profile.mkdir()
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    preferences = {
        'marionette.port': port, 'browser.startup.page': 0, 'browser.startup.homepage': 'about:blank',
        'browser.aboutwelcome.enabled': False, 'browser.shell.checkDefaultBrowser': False,
        'browser.sessionstore.resume_from_crash': False, 'datareporting.policy.dataSubmissionEnabled': False,
        'datareporting.healthreport.uploadEnabled': False, 'toolkit.telemetry.reportingpolicy.firstRun': False,
        'extensions.webextensions.uuids': json.dumps({smoke.ADDON_ID: smoke.UUID}),
    }
    if args.scheme == 'http':
        # Only this fresh test profile: ensure Firefox presents the adapter with
        # the HTTP entry rather than upgrading it before interception. Production
        # browser transport security and extension settings remain unchanged.
        preferences.update({
            'dom.security.https_first': False, 'dom.security.https_first_pbm': False,
            'dom.security.https_only_mode': False, 'dom.security.https_only_mode_pbm': False,
            'network.stricttransportsecurity.preloadlist': False,
        })
    (profile / 'user.js').write_text('\n'.join(
        f'user_pref({json.dumps(key)}, {json.dumps(value)});' for key, value in preferences.items()), encoding='utf-8')
    process = subprocess.Popen([args.firefox, '-headless', '-no-remote', '-profile', str(profile),
                                '-marionette', '--remote-allow-system-access', 'about:blank'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               env={**os.environ, 'MOZ_HEADLESS': '1', 'MOZ_NO_REMOTE': '1'},
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    client = None
    try:
        def connect():
            if process.poll() is not None:
                raise RuntimeError('Isolated Firefox exited')
            try:
                return PublicClient(port)
            except (ConnectionRefusedError, TimeoutError):
                return None
        client = smoke.wait_for(connect, 'Firefox startup', 30)
        version = client.call('WebDriver:NewSession')['capabilities']['browserVersion']
        client.call('Addon:Install', path=str(smoke.EXTENSION / 'dist'), temporary=True)
        client.call('Marionette:SetContext', value='chrome')
        client.script('gBrowser.selectedTab = gBrowser.addTrustedTab(arguments[0]);', smoke.UI_URL)
        client.call('Marionette:SetContext', value='content')
        ui_handle = client.call('WebDriver:GetWindowHandles')[-1]
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        smoke.wait_for(lambda: client.script("return location.protocol === 'moz-extension:' && document.readyState === 'complete';"), 'Atlas UI')
        policy = {'whitelist': [], 'blacklist': []}
        smoke.configure_policy(client, policy)
        smoke.wait_for(lambda: client.message({'kind': 'GET_VIEW'})['view'].get('managed', {}).get('updateStatus') != 'UPDATING', 'managed refresh', 40)
        client.script("""
            const scope = new Set(arguments[0]);
            const extensionHost = new URL(browser.runtime.getURL('')).host;
            window.atlasPublicRequestEvidence = [];
            browser.webRequest.onBeforeRequest.addListener(details => {
                const target = new URL(details.url);
                if (!scope.has(target.hostname)) return;
                const navigation = details.type === 'main_frame' && details.frameId === 0 && details.method === 'GET';
                const sources = [details.originUrl, details.documentUrl].filter(source => source !== undefined);
                const discovery = details.tabId === -1 && details.type === 'xmlhttprequest' && details.method === 'HEAD'
                    && sources.length > 0 && sources.every(source => {
                        try {
                            const origin = new URL(source);
                            return origin.protocol === 'moz-extension:' && origin.host === extensionHost;
                        } catch { return false; }
                    });
                if (navigation || discovery) window.atlasPublicRequestEvidence.push({
                    kind: navigation ? 'NAVIGATION' : 'DISCOVERY', hostname: target.hostname,
                    protocol: target.protocol,
                });
            }, {urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'xmlhttprequest']});
        """, expected_scope)
        handles = client.call('WebDriver:GetWindowHandles')
        tab_id = client.script("""
            const done = arguments[arguments.length - 1];
            browser.tabs.create({url: arguments[0], active: false}).then(tab => done(tab.id));
        """, f'{args.scheme}://{args.hostname}/', asynchronous=True)
        site_handle = smoke.wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in handles), None), 'site tab')

        def view():
            client.call('WebDriver:SwitchToWindow', handle=ui_handle)
            return client.message({'kind': 'GET_VIEW'})['view']

        def context():
            return next((c for c in view()['contexts'] if c['tabId'] == tab_id), None)

        def pending():
            return view()['controller']['snapshot']['accessState']['pendingRequests']

        smoke.wait_for(lambda: context() and context()['effect'] == 'REMOVED', 'initial Greylist block')
        prepared = smoke.wait_for(lambda: (c := context()) and (scope := c.get('accessScope'))
                                  and scope['status'] == 'READY' and scope, 'prepared scope before request', 20)
        assert prepared['hostnames'] == expected_scope
        assert prepared['source'] == ('CANONICAL_REDIRECT' if args.hostname == 'goodreads.com' else 'DECLARED')
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        preparation_evidence = client.script('return window.atlasPublicRequestEvidence;')
        entry = next(e for e in preparation_evidence if e['kind'] == 'NAVIGATION' and e['hostname'] == args.hostname)
        assert entry['protocol'] == f'{args.scheme}:'
        discovery = [e for e in preparation_evidence if e['kind'] == 'DISCOVERY']
        if args.hostname == 'goodreads.com':
            assert len(discovery) >= 1
            assert all(e['protocol'] == 'https:' and e['hostname'] == args.hostname for e in discovery)
        else:
            assert discovery == []
        assert pending() == []
        assert view()['controller']['snapshot']['accessState']['grants'] == []
        client.call('WebDriver:SwitchToWindow', handle=site_handle)
        scope_text = f'Temporary access covers exactly: {", ".join(expected_scope)}'
        smoke.wait_for(lambda: client.script("return document.getElementById('access-scope')?.textContent === arguments[0] && !document.getElementById('start-access').disabled;", scope_text), 'scope preview before request')
        client.script("document.getElementById('start-access').click();")
        request = smoke.wait_for(lambda: next(iter(pending()), None), 'one persisted request')
        assert request['scopeHostnames'] == expected_scope
        assert len(pending()) == 1
        assert client.message({'kind': 'CONFIRM_ACCESS', 'requestId': request['id']})['result']['reason'] == 'NOT_READY'
        assert view()['controller']['snapshot']['accessState']['grants'] == []
        client.call('WebDriver:SwitchToWindow', handle=site_handle)
        smoke.wait_for(lambda: client.script("return !document.getElementById('confirm-access').hidden && !document.getElementById('confirm-access').disabled;"), 'explicit confirmation readiness', 20)
        assert view()['controller']['snapshot']['accessState']['grants'] == []
        client.call('WebDriver:SwitchToWindow', handle=site_handle)
        client.script("document.getElementById('confirm-access').click();")
        released = smoke.wait_for(lambda: (c := context()) and c['displayedHostname'] == canonical_hostname
                                  and c['latest'].get('decision', {}).get('reason') == 'ACTIVE_GRANT' and c, 'canonical homepage allowed', 30)
        snapshot = view()['controller']['snapshot']
        assert snapshot['accessState']['pendingRequests'] == []
        assert len(snapshot['accessState']['grants']) == 1
        grant = snapshot['accessState']['grants'][0]
        assert grant['scopeHostnames'] == request['scopeHostnames']
        assert grant['expiresAt'] == grant['issuedAt'] + request['grantDurationMs']
        assert snapshot['policy'] == policy
        assert snapshot['journeyState']['journeys'] == []
        assert client.message({'kind': 'CONFIRM_ACCESS', 'requestId': request['id']})['result']['reason'] == 'REQUEST_NOT_FOUND'
        entries = client.message({'kind': 'GET_DIAGNOSTICS', 'tabId': tab_id})['entries']
        if args.hostname == apex_hostname:
            assert any(e['event'] == 'RELEASED' and e['hostname'] == apex_hostname for e in entries)
            assert any(e['event'] == 'REDIRECT' and e['hostname'] == canonical_hostname for e in entries)
        assert any(e['event'] == 'RELEASED' and e['hostname'] == canonical_hostname for e in entries)
        report = {
            'scope': 'Public homepage authorization only; no account or authenticated compatibility claim',
            'firefox': version, 'extensionVersion': client.script('return browser.runtime.getManifest().version;'),
            'requestedHostname': args.hostname, 'displayedHostname': released['displayedHostname'],
            'requestedScheme': args.scheme, 'initialNavigationProtocol': entry['protocol'],
            'discoveryProtocols': sorted(set(e['protocol'] for e in discovery)),
            'discoveryHostnames': sorted(set(e['hostname'] for e in discovery)),
            'isolatedTransportTestPreferences': args.scheme == 'http',
            'decisionReason': released['latest']['decision']['reason'], 'scopeHostnames': grant['scopeHostnames'],
            'preparedSource': prepared['source'], 'scopeDisclosedBeforeStart': True,
            'discoveryCreatesNoRequestOrGrant': True,
            'oneRequest': True, 'oneConfirmation': True, 'prematureConfirmationRejected': True,
            'duplicateConfirmationRejected': True, 'fixedGrantDeadline': True,
            'policyUnchanged': True, 'noJourney': True,
        }
        (run / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report), flush=True)
        print(f'Sanitized report: {run / "result.json"}', flush=True)
    finally:
        if client is not None:
            try:
                client.call('Marionette:Quit', flags=['eForceQuit'])
            except (OSError, RuntimeError, ValueError):
                pass
            client.socket.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=10)
        # Delete only this fresh, checked profile; retain sanitized evidence.
        resolved = profile.resolve()
        if resolved.parent != run.resolve() or run.resolve().parent != artifacts.resolve() or resolved.name != 'profile':
            raise RuntimeError('Unexpected disposable profile path')
        shutil.rmtree(resolved)


if __name__ == '__main__':
    try:
        main()
    except Exception as failure:
        import traceback
        frames = traceback.extract_tb(failure.__traceback__)
        local = [frame for frame in frames if Path(frame.filename).name == Path(__file__).name]
        line = local[-1].lineno if local else 0
        raise SystemExit(f'Greylist check failed at script line {line} ({type(failure).__name__}); raw errors suppressed.') from None
