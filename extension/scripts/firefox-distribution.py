"""Cold-start distribution and startup-recovery checks in isolated Firefox profiles.

The default fixture clones the built package with Git core.autocrlf=true. It also
reproduces the old corrupt-feed checkout and repairs its bytes before explicit
Recovery. No accounts, user profiles, or website credentials are used.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile

EXTENSION = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('atlas_firefox_smoke', EXTENSION / 'scripts/firefox-e2e.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def git(directory, *args):
    result = subprocess.run(['git', *args], cwd=directory, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    if result.returncode:
        raise RuntimeError('Distribution fixture Git operation failed')


def checkout(run):
    source = run / 'package-source'
    source.mkdir()
    shutil.copytree(EXTENSION / 'dist', source / 'extension/dist')
    git(source, 'init', '-q')
    git(source, '-c', 'core.autocrlf=false', 'add', '.')
    git(source, '-c', 'user.name=Atlas test', '-c', 'user.email=atlas-test@atlas.invalid', 'commit', '-qm', 'Distribution fixture')
    older = run / 'older-windows-checkout'
    git(run, '-c', 'core.autocrlf=true', 'clone', '-q', '--no-hardlinks', str(source), str(older))
    relative_hosts = 'extension/dist/data/stevenblack/hosts'
    original = (EXTENSION / 'dist/data/stevenblack/hosts').read_bytes()
    assert (older / relative_hosts).read_bytes() != original, 'reproduce pre-attributes checkout conversion'
    shutil.copyfile(EXTENSION.parent / '.gitattributes', source / '.gitattributes')
    git(source, '-c', 'core.autocrlf=false', 'add', '.gitattributes')
    git(source, '-c', 'user.name=Atlas test', '-c', 'user.email=atlas-test@atlas.invalid', 'commit', '-qm', 'Preserve pinned bytes')
    git(older, 'pull', '-q', '--ff-only')
    git(older, 'restore', '--source=HEAD', '--worktree', '--', relative_hosts)
    assert (older / relative_hosts).read_bytes() == original, 'documented older-checkout repair restores pinned bytes'
    destination = run / 'windows-checkout'
    git(run, '-c', 'core.autocrlf=true', 'clone', '-q', '--no-hardlinks', str(source), str(destination))
    addon = destination / 'extension/dist'
    assert (addon / 'data/stevenblack/hosts').read_bytes() == (EXTENSION / 'dist/data/stevenblack/hosts').read_bytes()
    return addon


def open_ui(client):
    client.call('Marionette:SetContext', value='chrome')
    client.script("""
        gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
        });
    """, smoke.UI_URL)
    client.call('Marionette:SetContext', value='content')
    smoke.wait_for(lambda: client.script("return location.href === arguments[0] && document.readyState === 'complete';",
                                        smoke.UI_URL), 'extension UI')


def scenario(run, addon, firefox, broken=False):
    directory = run / ('recovery' if broken else 'first-run')
    directory.mkdir()
    profile = directory / 'profile'
    profile.mkdir()
    if broken:
        copied = directory / 'addon'
        shutil.copytree(addon, copied)
        addon = copied
    hosts = addon / 'data/stevenblack/hosts'
    original = hosts.read_bytes()
    if broken:
        hosts.write_bytes(original.replace(b'\n', b'\r\n'))
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
        f'user_pref({json.dumps(key)}, {json.dumps(value)});' for key, value in preferences.items()), encoding='utf8')
    client = None
    with (directory / 'firefox.log').open('w', encoding='utf8') as log:
        process = subprocess.Popen([firefox, '-headless', '-no-remote', '-profile', str(profile), '-marionette',
                                    '--remote-allow-system-access', 'about:blank'], stdout=log, stderr=log,
                                   env={**os.environ, 'MOZ_HEADLESS': '1', 'MOZ_NO_REMOTE': '1'},
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        try:
            def connect():
                if process.poll() is not None:
                    raise RuntimeError('Firefox exited during fixture startup')
                try:
                    return smoke.Marionette(port)
                except (ConnectionRefusedError, TimeoutError):
                    return None
            client = smoke.wait_for(connect, 'Firefox automation startup', 30)
            version = client.call('WebDriver:NewSession')['capabilities']['browserVersion']
            client.call('Addon:Install', path=str(addon.resolve()), temporary=True)
            open_ui(client)
            view = lambda: client.message({'kind': 'GET_VIEW'})['view']
            failure = None
            if broken:
                failed = smoke.wait_for(lambda: (v := view())['startup']['status'] == 'FAILED' and v, 'bundle verification failure')
                failure = failed['startup']
                assert failure == {'status': 'FAILED', 'stage': 'MANAGED_BLACKLIST', 'reason': 'BUNDLED_BLACKLIST_INVALID'}
                assert failed['controller'] is None and failed['temporaryAccess'] is None
                smoke.wait_for(lambda: client.script("return !document.getElementById('startup-warning').hidden;"), 'visible startup error')
                marker = client.script("""
                    const done = arguments[arguments.length - 1];
                    const open = indexedDB.open('atlas-authority-v1');
                    open.onsuccess = () => {
                        const db = open.result, tx = db.transaction('authority', 'readonly');
                        const initialized = tx.objectStore('authority').get('initialized');
                        const envelope = tx.objectStore('authority').get('envelope');
                        tx.oncomplete = () => { db.close(); done({initialized: initialized.result, hasEnvelope: envelope.result !== undefined}); };
                    };
                """, asynchronous=True)
                assert marker == {'initialized': False, 'hasEnvelope': False}, 'a failed bundle cannot seed policy'
                still_failed = client.message({'kind': 'RECOVER'})
                assert still_failed['error'] == 'BUNDLED_BLACKLIST_INVALID'
                hosts.write_bytes(original)
                client.script("document.getElementById('show-settings').click(); document.getElementById('recovery-section').open = true;")
                smoke.wait_for(lambda: client.script("return document.getElementById('recover').textContent === 'Retry startup' && !document.getElementById('recover').disabled;"), 'startup retry button')
                client.script("document.getElementById('recover').click();")
            current = smoke.wait_for(lambda: (v := view()).get('controller') and v['controller']['status'] == 'READY' and v,
                                     'verified first-run authority', 20)
            snapshot = current['controller']['snapshot']
            assert current['startup']['status'] == 'READY'
            assert current['managed']['active'] and current['managed']['count'] >= 100000
            assert len(snapshot['policy']['whitelist']) == 51
            assert 'student.ladok.se' in snapshot['policy']['whitelist'] and 'github.com' in snapshot['policy']['whitelist']
            assert snapshot['policy']['blacklist'] == [] and snapshot['policyRevision'] == 0
            assert snapshot['accessState']['grants'] == [] and snapshot['accessState']['pendingRequests'] == []
            assert snapshot['journeyState']['journeys'] == [] and snapshot['vaultState']['pendingProposal'] is None
            client.script("document.getElementById('show-home').click();")
            smoke.wait_for(lambda: client.script("return document.querySelectorAll('#destination-list .destination-card').length > 0 && document.getElementById('startup-warning').hidden;"), 'visible Whitelist cards')
            for _ in range(2):
                recovered = client.message({'kind': 'RECOVER'})['view']['controller']['snapshot']
                assert recovered['policy'] == snapshot['policy'] and recovered['policyRevision'] == 0
                assert recovered['accessState']['grants'] == []
            old_ui = client.call('WebDriver:GetWindowHandle')
            client.script("""
                const done = arguments[arguments.length - 1];
                browser.tabs.create({url: 'about:blank', active: false}).then(() => done(true));
            """, asynchronous=True)
            client.script("setTimeout(() => browser.runtime.reload(), 0); return true;")
            smoke.wait_for(lambda: old_ui not in client.call('WebDriver:GetWindowHandles'), 'old UI closes on reload')
            client.call('WebDriver:SwitchToWindow', handle=client.call('WebDriver:GetWindowHandles')[0])
            open_ui(client)
            restored = smoke.wait_for(lambda: (v := view()).get('controller') and v['controller']['status'] == 'READY' and v,
                                      'reload authority', 20)
            assert restored['controller']['snapshot']['policy'] == snapshot['policy']
            return {'firefox': version, 'mode': 'repaired-bundle' if broken else 'fresh-checkout',
                    'whitelistHosts': 51, 'policyRevision': 0, 'startupFailure': failure,
                    'checks': ['verified managed data', 'saved first-run policy', 'no copied runtime permissions',
                               'repeated recovery preserves policy', 'reload retains policy']
                              + (['corrupt bundle stops before initialization', 'safe diagnostic', 'explicit UI startup retry'] if broken else [])}
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--firefox', default=os.environ.get('FIREFOX_BINARY') or shutil.which('firefox')
                        or r'C:\Program Files\Mozilla Firefox\firefox.exe')
    parser.add_argument('--addon-dir', type=Path, help='Optional existing fresh checkout; otherwise create a Windows-style checkout')
    arguments = parser.parse_args()
    artifacts = EXTENSION.parent / '.tools'
    artifacts.mkdir(exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix='firefox-distribution-', dir=artifacts))
    addon = arguments.addon_dir.resolve() if arguments.addon_dir else checkout(run)
    results = [scenario(run, addon, arguments.firefox), scenario(run, addon, arguments.firefox, broken=True)]
    evidence = {'extension': json.loads((addon / 'manifest.json').read_text())['version'],
                'checkout': 'provided' if arguments.addon_dir else 'Git core.autocrlf=true',
                'olderCheckoutRepair': 'not run' if arguments.addon_dir else 'PASS git pull + exact asset restore',
                'results': results}
    (run / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf8')
    print(json.dumps(evidence, indent=2), flush=True)
    print('PASS Firefox distribution and startup recovery', flush=True)


if __name__ == '__main__':
    main()
