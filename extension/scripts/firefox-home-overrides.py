"""Home/new-tab experiment. Isolated runtime/policy copies and generated profiles only.

Release Firefox uses a temporary overlay; Nightly may use persistent unsigned
packages with signing disabled ONLY in its disposable profiles. No shipped code
or live enterprise policy is instrumented. Python stdlib + existing Marionette.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('atlas_smoke', Path(__file__).with_name('firefox-e2e.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
ID = smoke.ADDON_ID


class Browser:
    def __init__(self, binary, profile, unsigned=False):
        self.binary, self.profile = binary, profile
        profile.mkdir(parents=True)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        prefs = {'marionette.port': self.port, 'browser.aboutwelcome.enabled': False,
                 'browser.shell.checkDefaultBrowser': False, 'browser.startup.page': 1,
                 'browser.sessionstore.resume_from_crash': False,
                 'datareporting.policy.dataSubmissionEnabled': False,
                 'datareporting.healthreport.uploadEnabled': False,
                 'toolkit.telemetry.reportingpolicy.firstRun': False}
        if unsigned:
            prefs['xpinstall.signatures.required'] = False
        (profile / 'user.js').write_text('\n'.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});' for k, v in prefs.items()))

    def start(self):
        self.log = (self.profile.parent / (self.profile.name + '.log')).open('a', encoding='utf8')
        self.process = subprocess.Popen([str(self.binary), '-no-remote', '-profile', str(self.profile),
            '-marionette', '--remote-allow-system-access'], stdout=self.log, stderr=self.log,
            env={**os.environ, 'MOZ_HEADLESS': '1', 'MOZ_NO_REMOTE': '1', 'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS': '1'},
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        def connect():
            if self.process.poll() is not None:
                raise RuntimeError('Isolated Firefox exited')
            try:
                return smoke.Marionette(self.port)
            except (ConnectionRefusedError, TimeoutError):
                return None
        self.client = smoke.wait_for(connect, 'Marionette', 40)
        self.version = self.client.call('WebDriver:NewSession', acceptInsecureCerts=True)['capabilities']['browserVersion']
        self.client.call('WebDriver:SetWindowRect', width=1440, height=1000)
        return self

    def chrome(self, code, *args):
        self.client.call('Marionette:SetContext', value='chrome')
        return self.client.script(code, *args)

    def content(self, code, *args):
        self.client.call('Marionette:SetContext', value='content')
        return self.client.script(code, *args)

    def select(self):
        handle = self.handles()[-1]
        self.client.call('WebDriver:SwitchToWindow', handle=handle)

    def handles(self):
        # Marionette enumerates windows in chrome context, tabs in content.
        self.client.call('Marionette:SetContext', value='content')
        return self.client.call('WebDriver:GetWindowHandles')

    def open(self, url):
        self.chrome('gBrowser.selectedTab=gBrowser.addTrustedTab(arguments[0]);', url)
        self.select()

    def authority(self):
        self.client.call('Marionette:SetContext', value='content')
        return self.client.message({'kind': 'GET_VIEW'})['view']

    def ready(self):
        smoke.wait_for(lambda: self.content('return location.protocol === "moz-extension:" && !!document.getElementById("status");'), 'Atlas document', 30)
        view = smoke.wait_for(lambda: ((v := self.authority()).get('controller') or {}).get('status') == 'READY' and v, 'Atlas ready', 30)
        smoke.wait_for(lambda: self.content('return document.getElementById("status").dataset.ready === "true";'), 'rendered authority', 30)
        return view

    def keys(self, text, modifier=None):
        self.client.call('Marionette:SetContext', value='chrome')
        actions = []
        if modifier:
            actions.append({'type': 'keyDown', 'value': modifier})
        for char in text:
            actions.extend([{'type': 'keyDown', 'value': char}, {'type': 'keyUp', 'value': char}])
        if modifier:
            actions.append({'type': 'keyUp', 'value': modifier})
        self.client.call('WebDriver:PerformActions', actions=[{'type': 'key', 'id': 'keyboard', 'actions': actions}])
        self.client.call('WebDriver:ReleaseActions')

    def prompts(self):
        return self.chrome('return [...document.querySelectorAll("panel")].filter(p=>p.state==="open").map(p=>({id:p.id,text:p.textContent.trim().slice(0,700)}));')

    def settings(self):
        return self.chrome('''return {homepage:Services.prefs.getStringPref("browser.startup.homepage"),
            startPage:Services.prefs.getIntPref("browser.startup.page"),
            newtab:ChromeUtils.importESModule("resource:///modules/AboutNewTab.sys.mjs").AboutNewTab.newTabURL,
            policies:Services.policies.getActivePolicies(),
            origin:WebExtensionPolicy.getByID(arguments[0])?.getURL("ui/index.html")};''', ID)

    def screenshot(self, path):
        self.client.call('Marionette:SetContext', value='content')
        path.write_bytes(base64.b64decode(self.client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)))

    def stop(self):
        try:
            self.client.call('Marionette:Quit', flags=['eAttemptQuit'])
        except (OSError, RuntimeError):
            pass
        self.client.socket.close()
        try:
            self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=10)
        self.log.close()


def exercise(browser, evidence, directory):
    b = browser
    settings = smoke.wait_for(lambda: (s := b.settings()).get('origin') and s['newtab'] == s['origin'] and s, 'relative overrides installed', 30)
    assert settings['homepage'] == settings['origin']
    assert settings['policies']['ExtensionSettings'][ID]['installation_mode'] == 'force_installed'
    # Native browser shortcuts, not extension tabs.create or simulated page keys.
    b.keys('t', '\ue009')
    time.sleep(1)
    evidence['focusBeforeAutomationSelect'] = b.chrome('return {focused:gURLBar.focused,value:gURLBar.value};')
    evidence['firstNewtabPrompts'] = b.prompts()
    evidence['firstNewtabFocus'] = b.chrome('return {focused:gURLBar.focused,value:gURLBar.value};')
    evidence['noticeButtons'] = b.chrome('return [...document.querySelectorAll("#extension-notification-panel button, #extension-notification-panel toolbarbutton, #extension-notification-panel popupnotification")].map(e=>({tag:e.tagName,id:e.id,label:e.getAttribute("label"),buttonlabel:e.getAttribute("buttonlabel"),secondarybuttonlabel:e.getAttribute("secondarybuttonlabel")}));')
    # Firefox owns this one-time acknowledgement; do not suppress it by pref.
    if evidence['firstNewtabPrompts']:
        b.chrome('document.getElementById("extension-new-tab-notification").button.click();')
        b.keys('t', '\ue009')
        time.sleep(1)
        evidence['acknowledgedFocusBeforeSelect'] = b.chrome('return {focused:gURLBar.focused,value:gURLBar.value};')
    b.keys('atlas focus probe')
    evidence['typedValue'] = b.chrome('return {value:gURLBar.value,focused:gURLBar.focused,active:document.activeElement?.id};')
    assert b.chrome('return gURLBar.value;') == 'atlas focus probe', 'typing lands in address bar'
    b.keys('\ue00c')
    evidence['ctrlTImmediateTyping'] = True
    b.select()
    b.ready()
    b.chrome('document.getElementById("tabs-newtab-button").click();')
    time.sleep(1)
    assert b.chrome('return gURLBar.focused;')
    b.keys('plus focus probe')
    assert b.chrome('return gURLBar.value;') == 'plus focus probe'
    b.keys('\ue00c')
    evidence['plusImmediateTyping'] = True
    b.select()
    b.ready()
    b.screenshot(directory / 'home.png')
    # Place the standard browser Home widget in this disposable profile only.
    b.chrome('CustomizableUI.addWidgetToArea("home-button","nav-bar");')
    b.chrome('document.getElementById("home-button").click();')
    time.sleep(1)
    evidence['homepagePrompts'] = b.prompts()
    if evidence['homepagePrompts']:
        b.chrome('document.getElementById("extension-homepage-notification").button.click();')
    b.select()
    b.ready()
    evidence['homeButton'] = True
    handles = b.handles()
    b.chrome('OpenBrowserWindow();')
    smoke.wait_for(lambda: len(b.handles()) > len(handles), 'new window')
    new = [h for h in b.handles() if h not in handles][0]
    b.client.call('WebDriver:SwitchToWindow', handle=new)
    b.ready()
    assert b.content('return document.body.dataset.page;') == 'home'
    evidence['newWindowHome'] = True
    evidence['origin'] = settings['origin']  # Synthetic random test profile, not a user identifier.
    evidence['firefox'] = b.version


def gate_checks(b, run):
    """Synthetic HTTPS on loopback; the real launcher and controller make decisions."""
    hits = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_GET(self):
            hits.append(self.headers.get('Host'))
            body = b'<!doctype html><title>Atlas local fixture</title><h1 id="fixture">Authorized local destination</h1>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    openssl = shutil.which('openssl') or r'C:\Program Files\Git\usr\bin\openssl.exe'
    subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-keyout', str(run / 'fixture.key'), '-out', str(run / 'fixture.crt'), '-subj', '/CN=root.localhost',
        '-addext', 'subjectAltName=DNS:root.localhost,DNS:black.localhost,DNS:unknown.localhost'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    server = ThreadingHTTPServer(('127.0.0.1', 443), Handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(run / 'fixture.crt', run / 'fixture.key')
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        b.ready()
        policy = b.authority()['controller']['snapshot']['policy']
        b.client.call('Marionette:SetContext', value='content')
        smoke.configure_policy(b.client, {'whitelist': policy['whitelist'] + ['root.localhost'],
                                         'blacklist': policy['blacklist'] + ['black.localhost']})
        b.content('localStorage.setItem("atlas-home-pins-v1",JSON.stringify(["host:root.localhost"]));')
        b.keys('t', '\ue009')
        b.select()
        b.ready()
        smoke.wait_for(lambda: b.content('return !!document.querySelector("#home-pinned .destination-open, #frequent-list .destination-open, #pinned-list .destination-open");'), 'pinned Home launcher')
        b.content('document.querySelector(".destination-open[data-destination-id=\\"host:root.localhost\\"]").click();')
        smoke.wait_for(lambda: 'root.localhost' in hits, 'pinned exact destination arrives at local server')
        # Open a new Home for every attempt: no trusted-page departure/Journey inheritance.
        result = {'pinnedAllowedPageReached': True}
        for host, expected in [('black.localhost', 'DENY'), ('unknown.localhost', 'GREYLIST')]:
            b.keys('t', '\ue009')
            b.select()
            b.ready()
            b.content('const input=document.getElementById("destination");input.value=arguments[0];input.closest("details").open=true;input.form.requestSubmit();', f'https://{host}/')
            def denied():
                contexts = b.authority()['contexts']
                return next((c for c in contexts if c['hostname'] == host and c['effect'] == 'REMOVED'
                    and (c.get('latest') or {}).get('decision', {}).get('outcome') == expected), None)
            try:
                context = smoke.wait_for(denied, f'{host} {expected} removal')
            except AssertionError:
                (run / 'gate-failure.json').write_text(json.dumps({'host': host, 'contexts': b.authority()['contexts'],
                    'ui': b.content('return {page:document.body.dataset.page,feedback:document.getElementById("feedback").textContent,value:document.getElementById("destination").value};')}, indent=2))
                raise
            result[host] = {'decision': context['latest']['decision'], 'effect': context['effect']}
            assert host not in hits, 'blocked destination must not reach local server'
        state = b.authority()['controller']['snapshot']
        assert state['accessState']['grants'] == [] and state['accessState']['pendingRequests'] == []
        result['noGrantsOrAccessRequestsCreated'] = True
        return result
    finally:
        server.shutdown()
        server.server_close()


def restart_checks(b, evidence):
    # user.js is first-run fixture setup; do not overwrite the user-selected
    # startup option on each restart (the browser persists it in prefs.js).
    user = b.profile / 'user.js'
    user.write_text('\n'.join(line for line in user.read_text().splitlines() if 'browser.startup.page' not in line))
    b.chrome('Services.prefs.setIntPref("browser.startup.page",1);')
    b.stop()
    b.start()
    smoke.wait_for(lambda: b.chrome('return gBrowser.selectedBrowser.currentURI.spec;').startswith('moz-extension://'), 'homepage on full restart', 30)
    b.select()
    b.ready()
    evidence['restartRestoreDisabledHome'] = True
    evidence['restartPrompts'] = b.prompts()
    # Observe the real Preferences UI's checkbox/selection, not just a guessed pref.
    b.open('about:preferences#general')
    smoke.wait_for(lambda: b.content('return !!document.getElementById("browserRestoreSession");'), 'startup setting')
    evidence['restoreSessionLabel'] = b.content('return document.getElementById("browserRestoreSession").getAttribute("label");')
    b.content('document.getElementById("browserRestoreSession").click();')
    assert b.chrome('return Services.prefs.getIntPref("browser.startup.page");') == 3
    # A Firefox-owned page proves restore retains previous pages rather than forcing Home.
    b.open('about:robots')
    time.sleep(1)
    b.stop()
    b.start()
    smoke.wait_for(lambda: b.chrome('return [...gBrowser.tabs].some(t=>t.linkedBrowser.currentURI.spec==="about:robots");'), 'restored previous tab', 30)
    evidence['restartRestoreEnabledRetainsPreviousTab'] = True
    b.keys('t', '\ue009')
    time.sleep(1)
    assert b.chrome('return gURLBar.focused && gURLBar.value === "";')
    b.keys('restart focus probe')
    assert b.chrome('return gURLBar.value;') == 'restart focus probe'
    b.keys('\ue00c')
    b.select()
    b.ready()
    evidence['ctrlTAfterRestart'] = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--firefox', type=Path, required=True)
    parser.add_argument('--policies', type=Path, required=True)
    parser.add_argument('--addon-dir', type=Path, default=ROOT / 'extension/dev-home', help='Runtime under test, including a staged unsigned release')
    parser.add_argument('--unsigned-persistent', action='store_true', help='Only use with Nightly/Developer Edition')
    parser.add_argument('--upgrade', action='store_true')
    args = parser.parse_args()
    args.addon_dir = args.addon_dir.resolve()
    policy_hash = hashlib.sha256(args.policies.read_bytes()).hexdigest()
    run = Path(tempfile.mkdtemp(prefix='home-overrides-', dir=ROOT / '.tools'))
    print(run, flush=True)
    # Copy the runtime so distribution changes cannot affect installed Firefox.
    runtime = run / 'firefox'
    shutil.copytree(args.firefox.parent, runtime, ignore=shutil.ignore_patterns('distribution', 'updates'))
    distribution = runtime / 'distribution'
    distribution.mkdir()
    policies = json.loads(args.policies.read_text(encoding='utf-8-sig'))
    assert policies['policies']['ExtensionSettings'][ID]['installation_mode'] == 'force_installed'
    target = distribution / 'atlas.xpi'
    policies['policies']['ExtensionSettings'][ID]['install_url'] = target.as_uri()
    (distribution / 'policies.json').write_text(json.dumps(policies, indent=2))
    baseline = ROOT / 'extension/release/0.2.0/signed/d7b2a7bba5e34ed685e3-0.2.0.xpi'
    candidate = run / 'experiment.xpi'
    with zipfile.ZipFile(candidate, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in args.addon_dir.rglob('*'):
            if p.is_file():
                z.write(p, p.relative_to(args.addon_dir).as_posix())
    shutil.copyfile(baseline if args.upgrade or not args.unsigned_persistent else candidate, target)
    b = Browser(runtime / args.firefox.name, run / 'profile', args.unsigned_persistent)
    evidence = {'mode': 'persistent-unsigned' if args.unsigned_persistent else 'temporary-overlay',
                'upgrade': args.upgrade, 'baselineVersion': '0.2.0' if args.upgrade or not args.unsigned_persistent else None,
                'policyCopy': 'Only Atlas install_url changed to disposable local package', 'checks': {}}
    try:
        b.start()
        smoke.wait_for(lambda: b.settings().get('origin'), 'enterprise install', 40)
        evidence['initialStartupPage'] = b.chrome('return gBrowser.selectedBrowser.currentURI.spec;')
        evidence['initialPrompts'] = b.prompts()
        if args.upgrade:
            origin = b.settings()['origin']
            b.open(origin)
            snapshot = b.ready()['controller']['snapshot']
            b.content('localStorage.setItem("atlas-home-pins-v1",JSON.stringify(["host:github.com"]));')
            evidence['baselineWhitelistCount'] = len(snapshot['policy']['whitelist'])
            if args.unsigned_persistent:
                b.stop()
                shutil.copyfile(candidate, target)
                b.start()
                evidence['firstUpgradeStartupPage'] = b.chrome('return gBrowser.selectedBrowser.currentURI.spec;')
                evidence['firstUpgradePrompts'] = b.prompts()
        if not args.unsigned_persistent:
            b.client.call('Addon:Install', path=str(args.addon_dir), temporary=True)
        exercise(b, evidence['checks'], run)
        if args.upgrade:
            assert b.authority()['controller']['snapshot']['policy'] == snapshot['policy']
            assert b.content('return JSON.parse(localStorage.getItem("atlas-home-pins-v1"));') == ['host:github.com']
            assert b.settings()['origin'] == origin
            evidence['upgradePreservesPolicyPinsAndOrigin'] = True
        evidence['gates'] = gate_checks(b, run)
        if args.unsigned_persistent:
            restart_checks(b, evidence)
        assert hashlib.sha256(args.policies.read_bytes()).hexdigest() == policy_hash
        evidence['sourcePolicyUnchanged'] = True
        evidence['passed'] = True
        (run / 'result.json').write_text(json.dumps(evidence, indent=2))
        print(json.dumps(evidence, indent=2), flush=True)
    finally:
        (run / 'result.json').write_text(json.dumps(evidence, indent=2))
        b.stop()


if __name__ == '__main__':
    main()
