"""Isolated local download mechanism probe. No accounts, external sites or profiles."""
import importlib.util
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('atlas_smoke', Path(__file__).with_name('firefox-e2e.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe', action='store_true', help='Observer only, no Atlas enforcement')
    runtime = parser.add_mutually_exclusive_group()
    runtime.add_argument('--baseline', action='store_true', help='Reproduce using a disposable copy of preserved 0.1.14 staging')
    runtime.add_argument('--addon-dir', type=Path, help='Test a disposable copy of this staged add-on instead of development dist')
    args = parser.parse_args()
    run = Path(tempfile.mkdtemp(prefix='firefox-downloads-', dir=smoke.EXTENSION.parent / '.tools'))
    profile, addon, downloads = run / 'profile', run / 'addon', run / 'downloads'
    for folder in [profile, addon, downloads]:
        folder.mkdir()
    hits = []
    class Pages(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_GET(self):
            host = self.headers.get('Host', '').split(':')[0]
            hits.append({'host': host, 'fixture': self.path.split('?')[0]})
            port = self.server.server_port
            if self.path in ['/redirect', '/loop']:
                self.send_response(302)
                self.send_header('Location', f'http://cdn.localhost:{port}/' + ('file' if self.path == '/redirect' else 'loop'))
                self.end_headers()
                return
            if self.path == '/delayed': time.sleep(2)
            if self.path == '/slow': time.sleep(5)
            if self.path == '/expired': time.sleep(33)
            file = self.path in ['/file', '/delayed', '/slow', '/expired', '/attachment-html', '/mime-only']
            body = b'Atlas synthetic file\n' if file else b'<!doctype html><title>External HTML</title>'
            if self.path in ['/html', '/interstitial', '/attachment-html']:
                body = f'<title>External HTML</title><script>fetch("/executed");setTimeout(()=>location.href="http://cdn.localhost:{port}/file",100)</script>'.encode()
            if host == 'root.localhost':
                body = (f'''<!doctype html><title>Download fixture</title>
                  <script>window.fixtureError=null;addEventListener('error',e=>window.fixtureError=e.message)</script>
                  <a id="direct" href="http://cdn.localhost:{port}/file">Direct</a>
                  <a id="new" target="_blank" href="http://redirect.localhost:{port}/redirect">New tab</a>
                  <a id="delay" target="_blank" href="http://cdn.localhost:{port}/delayed">Delayed</a>
                  <a id="html" target="_blank" href="http://cdn.localhost:{port}/html">HTML</a>
                  <button id="js" onclick="window.open('http://cdn.localhost:{port}/file')">JS</button>
                  <a id="claimed" target="_blank" download="claim.txt" href="http://cdn.localhost:{port}/html">Claimed download</a>
                  <a id="interstitial" target="_blank" href="http://cdn.localhost:{port}/interstitial">Interstitial</a>
                  <a id="blacklist" target="_blank" href="http://black.localhost:{port}/file">Blacklisted file</a>
                  <a id="loop" target="_blank" href="http://cdn.localhost:{port}/loop">Redirect loop</a>
                  <a id="attachment-html" target="_blank" href="http://cdn.localhost:{port}/attachment-html">HTML file</a>
                  <a id="mime-only" target="_blank" href="http://cdn.localhost:{port}/mime-only">Unproven file MIME</a>
                  <a id="slow" target="_blank" href="http://cdn.localhost:{port}/slow">Slow</a>
                  <a id="expired" target="_blank" href="http://cdn.localhost:{port}/expired">Expires</a>
                  <button id="unactivated" onclick="setTimeout(()=>window.open('http://cdn.localhost:{port}/file'),6000)">Late script</button>
                  <button id="blob" onclick="const a=document.createElement('a');a.href=window.URL.createObjectURL(new window.Blob(['synthetic blob'],{{type:'application/octet-stream'}}));a.download='blob.bin';document.body.append(a);a.click()">Blob</button>
                ''').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream' if file and self.path != '/attachment-html' else 'text/html')
            if file and self.path != '/mime-only': self.send_header('Content-Disposition', 'attachment; filename="atlas-test.txt"')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            try: self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    manifest = {'manifest_version': 2, 'name': 'Atlas isolated download observer', 'version': '1.0',
                'browser_specific_settings': {'gecko': {'id': smoke.ADDON_ID}},
                'permissions': ['tabs', 'webRequest', 'webRequestBlocking', 'webNavigation', 'downloads', '<all_urls>'],
                'background': {'scripts': ['observer.js']}}
    if not args.probe:
        source_addon = args.addon_dir or smoke.EXTENSION / ('release/0.1.14/addon' if args.baseline else 'dist')
        shutil.copytree(source_addon, addon, dirs_exist_ok=True)
        manifest = json.loads((addon / 'manifest.json').read_text(encoding='utf8'))
        manifest['permissions'].append('downloads') # Test observer only; never shipped.
        manifest['background']['scripts'].append('observer.js')
    (addon / 'manifest.json').write_text(json.dumps(manifest), encoding='utf8')
    shutil.copyfile(Path(__file__).with_name('download-evidence-observer.js'), addon / 'observer.js')
    if args.probe:
        (addon / 'ui').mkdir()
        (addon / 'ui/index.html').write_text('<title>Fixture observer</title>', encoding='utf8')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        marionette_port = sock.getsockname()[1]
    prefs = {'marionette.port': marionette_port, 'browser.startup.page': 0,
             'browser.aboutwelcome.enabled': False, 'browser.shell.checkDefaultBrowser': False,
             'datareporting.policy.dataSubmissionEnabled': False,
             'extensions.webextensions.uuids': json.dumps({smoke.ADDON_ID: smoke.UUID}),
             'browser.download.folderList': 2, 'browser.download.dir': str(downloads),
             'browser.download.useDownloadDir': True, 'browser.download.alwaysOpenPanel': False,
             'browser.helperApps.neverAsk.saveToDisk': 'application/octet-stream,text/plain',
             'browser.download.start_downloads_in_tmp_dir': False}
    (profile / 'user.js').write_text('\n'.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});' for k,v in prefs.items()), encoding='utf8')
    log = (run / 'firefox.log').open('w', encoding='utf8')
    process = subprocess.Popen([r'C:\Program Files\Mozilla Firefox\firefox.exe', '-headless', '-no-remote', '-profile', str(profile),
                               '-marionette', '--remote-allow-system-access', 'about:blank'],
                               stdout=log, stderr=log, env={**os.environ, 'MOZ_HEADLESS': '1', 'MOZ_NO_REMOTE': '1'},
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    client = None
    try:
        def connect():
            try: return smoke.Marionette(marionette_port)
            except (ConnectionRefusedError, TimeoutError): return None
        client = smoke.wait_for(connect, 'Firefox starts', 30)
        version = client.call('WebDriver:NewSession')['capabilities']['browserVersion']
        client.call('Addon:Install', path=str(addon), temporary=True)
        client.call('Marionette:SetContext', value='chrome')
        client.script('gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});', smoke.UI_URL)
        client.call('Marionette:SetContext', value='content')
        smoke.wait_for(lambda: client.script('return location.href.split(/#/,1)[0]===arguments[0]', smoke.UI_URL), 'observer UI')
        smoke.wait_for(lambda: client.script('const done=arguments[0];browser.runtime.getBackgroundPage().then(b=>done(b.downloadObserverReady===true))', asynchronous=True), 'complete native observer registration')
        ui = client.call('WebDriver:GetWindowHandle')
        if not args.probe:
            smoke.configure_policy(client, {'whitelist':['root.localhost'], 'blacklist':['black.localhost']})
            initial = client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
        root = client.call('WebDriver:NewWindow', type='tab')['handle']
        results = []
        for mechanism in ['direct', 'new', 'delay', 'html', 'js', 'claimed', 'blob', 'interstitial', 'blacklist', 'loop', 'attachment-html', 'mime-only', 'unactivated']:
            client.call('WebDriver:SwitchToWindow', handle=root)
            client.call('WebDriver:Navigate', url=f'http://root.localhost:{server.server_port}/')
            client.call('WebDriver:SwitchToWindow', handle=ui)
            if not args.probe:
                smoke.wait_for(lambda: any(c['displayedHostname']=='root.localhost' and c['latest'].get('decision',{}).get('outcome')=='ALLOW'
                    for c in client.message({'kind':'GET_VIEW'})['view']['contexts']), 'loaded authorized root')
            before_paths = set(downloads.iterdir())
            before_files = len(before_paths)
            before_hits = len(hits)
            client.script('const done=arguments[0];browser.runtime.getBackgroundPage().then(b=>{b.downloadEvidence=[];done(true)})', asynchronous=True)
            client.call('WebDriver:SwitchToWindow', handle=root)
            element = client.call('WebDriver:FindElement', using='css selector', value='#'+mechanism)
            client.call('WebDriver:ElementClick', id=element['element-6066-11e4-a52e-4f735466cecf'])
            time.sleep(8 if mechanism=='unactivated' else 3)
            if mechanism == 'blob':
                print('Blob fixture: '+json.dumps(client.script('return {error:window.fixtureError, anchors:document.querySelectorAll("a[download]").length, activation:navigator.userActivation.isActive}')),flush=True)
            client.call('WebDriver:SwitchToWindow', handle=ui)
            events = client.script('const done=arguments[0];browser.runtime.getBackgroundPage().then(b=>done(b.downloadEvidence))', asynchronous=True)
            result = {'mechanism': mechanism, 'events': events, 'files':len(list(downloads.glob('*')))-before_files,
                      'hits':hits[before_hits:]}
            if not args.probe:
                result['diagnostics'] = client.message({'kind':'GET_DIAGNOSTICS','tabId':None})['entries'][-20:]
            results.append(result)
            (run / 'result.json').write_text(json.dumps({'firefox':version,'results':results},indent=2),encoding='utf8')
            print(f'{mechanism}: files={result["files"]}, requests={len(result["hits"])}', flush=True)
            if not args.probe and not args.baseline:
                if mechanism in ['direct','new','delay','js','blob','attachment-html']:
                    assert result['files'] == 1, f'{mechanism} did not produce exactly one file: {run}'
                    # A .part file is not evidence of successful delivery. Check
                    # native completion and exact synthetic bytes independently.
                    completed = client.script('const done=arguments[0];browser.downloads.search({}).then(items=>done(items.filter(i=>i.state==="complete").length))', asynchronous=True)
                    result['completedDownloads'] = completed
                    assert completed == before_files + 1, 'Firefox has not completed the transfer'
                    assert any(e['event']=='downloads.onCreated' for e in events), 'native download event missing'
                    if mechanism != 'blob':
                        assert any(e['event']=='onBeforeSendHeaders' and e['gesture'] for e in events), 'initial native user activation missing'
                        assert any(e['event']=='onHeadersReceived' and e['attachment'] for e in events), 'attachment response evidence missing'
                    if mechanism in ['new','delay','js','attachment-html']:
                        assert any(e['event']=='navigation.onCreatedNavigationTarget' and e['sourceFrame']==0 for e in events), 'native top-level lineage missing'
                    bodies = [p.read_bytes() for p in downloads.iterdir() if p not in before_paths and p.is_file() and p.suffix != '.part']
                    expected = b'synthetic blob' if mechanism == 'blob' else b'Atlas synthetic file\n'
                    if mechanism == 'attachment-html':
                        assert any(b.startswith(b'<title>External HTML</title>') for b in bodies), 'HTML attachment bytes missing'
                    else:
                        assert expected in bodies, 'Synthetic file bytes changed'
                elif mechanism in ['html','claimed','interstitial','blacklist','loop','mime-only','unactivated']:
                    assert result['files']==0, f'{mechanism} unexpectedly produced a file'
                    assert not any(h['fixture']=='/executed' for h in result['hits']), 'unauthorized HTML executed'
                    assert not any(e['event']=='navigation.onCommitted' and e['host']=='cdn.localhost' for e in events), 'unauthorized page displayed'
                if mechanism=='blacklist': assert not any(h['host']=='black.localhost' for h in result['hits'])
                if mechanism=='loop': assert len(result['hits'])<=6, 'redirect budget exceeded'
                if mechanism=='attachment-html': assert not any(h['fixture']=='/executed' for h in result['hits'])
                current = client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
                assert current['policy']==initial['policy'] and current['accessState']['grants']==[]
                (run / 'result.json').write_text(json.dumps({'firefox':version,'results':results},indent=2),encoding='utf8')
            # Close all fixture child tabs to keep later evidence independent.
            for handle in client.call('WebDriver:GetWindowHandles'):
                if handle not in [ui,root]:
                    client.call('WebDriver:SwitchToWindow', handle=handle)
                    client.call('WebDriver:CloseWindow')
        if not args.probe and not args.baseline:
            client.call('WebDriver:SwitchToWindow', handle=ui)
            candidate = {'whitelist':['root.localhost','added.localhost'], 'blacklist':['black.localhost']}
            proposal=client.message({'kind':'PROPOSE_POLICY','candidatePolicy':candidate})['result']['referenceId']
            for failure in ['expired','policy','closed','restart']:
                client.call('WebDriver:SwitchToWindow', handle=root)
                client.call('WebDriver:Navigate', url=f'http://root.localhost:{server.server_port}/')
                client.call('WebDriver:SwitchToWindow', handle=ui)
                smoke.wait_for(lambda:any(c['displayedHostname']=='root.localhost' for c in client.message({'kind':'GET_VIEW'})['view']['contexts']), 'source ready')
                before_files=len(list(downloads.glob('*')))
                before_hits=len(hits)
                client.call('WebDriver:SwitchToWindow', handle=root)
                element=client.call('WebDriver:FindElement',using='css selector',value='#expired' if failure=='expired' else '#slow')
                client.call('WebDriver:ElementClick',id=element['element-6066-11e4-a52e-4f735466cecf'])
                smoke.wait_for(lambda:len(hits)>before_hits, 'held delayed request reaches fixture')
                if failure=='closed':
                    client.call('WebDriver:CloseWindow')
                    root=None
                client.call('WebDriver:SwitchToWindow',handle=ui)
                if failure=='policy':
                    assert client.message({'kind':'CONFIRM_POLICY','proposalId':proposal})['result']['type']=='COMMITTED'
                if failure=='restart':
                    client.script('setTimeout(()=>browser.runtime.reload(),0);return true')
                    smoke.wait_for(lambda:ui not in client.call('WebDriver:GetWindowHandles'),'background reload')
                    client.call('WebDriver:SwitchToWindow',handle=root)
                    client.call('Marionette:SetContext',value='chrome')
                    client.script('gBrowser.selectedTab=gBrowser.addTrustedTab(arguments[0])',smoke.UI_URL)
                    client.call('Marionette:SetContext',value='content')
                    ui=client.call('WebDriver:GetWindowHandles')[-1]
                    client.call('WebDriver:SwitchToWindow',handle=ui)
                    smoke.wait_for(lambda:client.script('return location.href.split(/#/,1)[0]===arguments[0]&&document.readyState==="complete"',smoke.UI_URL),'restarted UI')
                    smoke.wait_for(lambda:(client.message({'kind':'GET_VIEW'}).get('view',{}).get('controller') or {}).get('status')=='READY','restarted authority')
                time.sleep(34 if failure=='expired' else 6)
                assert len(list(downloads.glob('*')))==before_files, f'{failure} operation delivered a file'
                current=client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
                assert current['accessState']['grants']==[]
                results.append({'mechanism':failure,'files':0,'passed':True})
                (run / 'result.json').write_text(json.dumps({'firefox':version,'results':results},indent=2),encoding='utf8')
                print(f'PASS {failure}: pending file withheld',flush=True)
                if root is None: root=client.call('WebDriver:NewWindow',type='tab')['handle']
                for handle in client.call('WebDriver:GetWindowHandles'):
                    if handle not in [ui,root]:
                        client.call('WebDriver:SwitchToWindow',handle=handle)
                        client.call('WebDriver:CloseWindow')
        (run / 'result.json').write_text(json.dumps({'firefox':version,'results':results,'hits':hits},indent=2),encoding='utf8')
        print(f'Artifacts: {run}', flush=True)
    finally:
        if client:
            try: client.call('Marionette:Quit', flags=['eForceQuit'])
            except Exception: pass
        try: process.wait(timeout=10)
        except subprocess.TimeoutExpired: process.terminate()
        server.shutdown()
        log.close()


if __name__ == '__main__': main()
