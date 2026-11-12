"""Rasterize standalone SVGs in a disposable Firefox, not the Atlas extension.

No addon is installed. Runtime copy excludes installed enterprise distribution.
All external resources are embedded; a loopback server serves only this folder.
"""
from pathlib import Path
import base64, functools, importlib.util, json, os, shutil, socket, subprocess, sys, tempfile, threading, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[1]
spec=importlib.util.spec_from_file_location('marionette',REPO/'extension/scripts/firefox-e2e.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*a):pass

def main():
    run=Path(tempfile.mkdtemp(prefix='background-art-',dir=REPO/'.tools')).resolve()
    print('DISPOSABLE',run,flush=True)
    runtime=run/'runtime';profile=run/'profile';profile.mkdir()
    shutil.copytree(Path(r'C:\Program Files\Mozilla Firefox'),runtime,ignore=shutil.ignore_patterns('distribution','updates','uninstall','maintenanceservice*'))
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    prefs={'marionette.port':port,'browser.startup.page':0,'browser.startup.homepage':'about:blank','browser.aboutwelcome.enabled':False,'browser.shell.checkDefaultBrowser':False,'browser.sessionstore.resume_from_crash':False,'datareporting.policy.dataSubmissionEnabled':False,'toolkit.telemetry.reportingpolicy.firstRun':False}
    (profile/'user.js').write_text('\n'.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});' for k,v in prefs.items()))
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    log=(run/'firefox.log').open('w');client=None
    process=subprocess.Popen([str(runtime/'firefox.exe'),'-headless','-no-remote','-profile',str(profile),'-marionette','--remote-allow-system-access','about:blank'],stdout=log,stderr=log,env={**os.environ,'MOZ_HEADLESS':'1','MOZ_NO_REMOTE':'1'},creationflags=subprocess.CREATE_NO_WINDOW)
    evidence=[]
    try:
        def connect():
            if process.poll() is not None:raise RuntimeError('Isolated Firefox exited')
            try:return h.Marionette(port)
            except (ConnectionRefusedError,TimeoutError):return None
        client=h.wait_for(connect,'art renderer',40)
        caps=client.call('WebDriver:NewSession',capabilities={})
        time.sleep(1)
        handles=client.call('WebDriver:GetWindowHandles')
        client.call('WebDriver:SwitchToWindow',handle=handles[-1])
        client.call('WebDriver:Navigate',url=f'http://127.0.0.1:{server.server_port}/')
        files=sorted((ROOT/'compositions').glob('*.svg'))+sorted((ROOT/'previews').glob('*-context.svg'))
        for p in files:
            rel=p.relative_to(ROOT).as_posix()
            result=client.script('''const [url,done]=arguments;
              const image=new Image();image.onload=()=>{try{const c=document.createElement('canvas');c.width=1920;c.height=1200;
                c.getContext('2d').drawImage(image,0,0,1920,1200);done({png:c.toDataURL('image/png').split(',')[1],w:image.naturalWidth,h:image.naturalHeight});}
                catch(e){done({error:String(e)})}};image.onerror=()=>done({error:'SVG_LOAD_FAILED'});image.src=url;''',rel,asynchronous=True)
            if 'error' in result:raise RuntimeError(result['error'])
            p.with_suffix('.png').write_bytes(base64.b64decode(result['png']))
            evidence.append({'file':rel,'naturalSize':[result['w'],result['h']],'output':[1920,1200]})
            print('RENDERED',rel,flush=True)
        client.call('WebDriver:Navigate',url=f'http://127.0.0.1:{server.server_port}/index.html')
        client.script('document.querySelectorAll("img").forEach(i=>i.loading="eager");')
        h.wait_for(lambda:client.script('return [...document.querySelectorAll("img")].every(i=>i.complete && i.naturalWidth===1920);'),'gallery images',15)
        client.script('document.querySelector("#toggle").click();')
        h.wait_for(lambda:client.script('return document.querySelector("#toggle").getAttribute("aria-pressed")==="false" && [...document.querySelectorAll("img")].every(i=>i.complete && i.naturalWidth===1920 && i.src.includes("/compositions/"));'),'background-only gallery',15)
        (ROOT/'process/render.json').write_text(json.dumps({'renderer':caps,'outputs':evidence,'runtime':str(run),'extensionInstalled':False,'galleryImagesAndToggleVerified':True},indent=2))
    finally:
        if client:
            try:client.call('Marionette:Quit',flags=['eForceQuit'])
            except Exception:pass
            client.socket.close()
        try:process.wait(timeout=15)
        except subprocess.TimeoutExpired:process.terminate();process.wait(timeout=10)
        log.close();server.shutdown();server.server_close()
        # Exact task-created directory, checked within this workspace before removal.
        assert run.parent== (REPO/'.tools').resolve() and run.name.startswith('background-art-')
        shutil.rmtree(run)
        print('DISPOSABLE REMOVED',run,flush=True)

if __name__=='__main__':main()
