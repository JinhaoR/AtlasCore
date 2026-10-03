"""Optional native check of one Greylist cycle across Amazon's public redirect.

Fresh Firefox profile, public homepage only, no login, cookies from a user profile,
or page contents in evidence. The server may show a bot challenge; the check is of
Atlas's navigation authorization, not shopping or authenticated compatibility.
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
    parser.add_argument('--hostname', choices=['amazon.se', 'www.amazon.se'], default='amazon.se')
    args = parser.parse_args()
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
        handles = client.call('WebDriver:GetWindowHandles')
        tab_id = client.script("""
            const done = arguments[arguments.length - 1];
            browser.tabs.create({url: arguments[0], active: false}).then(tab => done(tab.id));
        """, f'https://{args.hostname}/', asynchronous=True)
        site_handle = smoke.wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in handles), None), 'site tab')

        def view():
            client.call('WebDriver:SwitchToWindow', handle=ui_handle)
            return client.message({'kind': 'GET_VIEW'})['view']

        def context():
            return next((c for c in view()['contexts'] if c['tabId'] == tab_id), None)

        def pending():
            return view()['controller']['snapshot']['accessState']['pendingRequests']

        smoke.wait_for(lambda: context() and context()['effect'] == 'REMOVED', 'initial Greylist block')
        client.call('WebDriver:SwitchToWindow', handle=site_handle)
        scope_text = 'Temporary access covers exactly: amazon.se, www.amazon.se'
        smoke.wait_for(lambda: client.script("return document.getElementById('access-scope')?.textContent === arguments[0] && !document.getElementById('start-access').disabled;", scope_text), 'scope preview before request')
        client.script("document.getElementById('start-access').click();")
        request = smoke.wait_for(lambda: next(iter(pending()), None), 'one persisted request')
        assert request['scopeHostnames'] == ['amazon.se', 'www.amazon.se']
        assert len(pending()) == 1
        assert client.message({'kind': 'CONFIRM_ACCESS', 'requestId': request['id']})['result']['reason'] == 'NOT_READY'
        assert view()['controller']['snapshot']['accessState']['grants'] == []
        client.call('WebDriver:SwitchToWindow', handle=site_handle)
        smoke.wait_for(lambda: client.script("return !document.getElementById('confirm-access').hidden && !document.getElementById('confirm-access').disabled;"), 'explicit confirmation readiness', 20)
        assert view()['controller']['snapshot']['accessState']['grants'] == []
        client.call('WebDriver:SwitchToWindow', handle=site_handle)
        client.script("document.getElementById('confirm-access').click();")
        released = smoke.wait_for(lambda: (c := context()) and c['displayedHostname'] == 'www.amazon.se'
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
        if args.hostname == 'amazon.se':
            assert any(e['event'] == 'RELEASED' and e['hostname'] == 'amazon.se' for e in entries)
            assert any(e['event'] == 'REDIRECT' and e['hostname'] == 'www.amazon.se' for e in entries)
        assert any(e['event'] == 'RELEASED' and e['hostname'] == 'www.amazon.se' for e in entries)
        report = {
            'scope': 'Public homepage authorization only; no account or authenticated compatibility claim',
            'firefox': version, 'extensionVersion': client.script('return browser.runtime.getManifest().version;'),
            'requestedHostname': args.hostname, 'displayedHostname': released['displayedHostname'],
            'decisionReason': released['latest']['decision']['reason'], 'scopeHostnames': grant['scopeHostnames'],
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
