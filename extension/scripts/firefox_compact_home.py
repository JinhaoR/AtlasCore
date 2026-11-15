"""Compact Home native evidence. Disposable runtime/profile; no everyday profile.

Run directly with Python stdlib. Production artifacts receive no instrumentation.
"""
import sys
sys.dont_write_bytecode = True
import base64, importlib.util, json, os, shutil, socket, statistics, subprocess, tempfile, time, zipfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('atlas_native', Path(__file__).with_name('firefox-e2e.py'))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
ROOT = Path(__file__).resolve().parents[2]
PINS = ['service:webmail.kth.se','service:chatgpt.com','service:github.com','service:overleaf.com','service:scholar.google.com','service:mail.google.com','service:arxiv.org','service:claude.ai','service:student.ladok.se','service:doi.org','service:zotero.org','service:orcid.org']

def main():
    baseline = '--baseline' in sys.argv
    signed_version = sys.argv[sys.argv.index('--signed-baseline')+1] if '--signed-baseline' in sys.argv else '0.2.8'
    if signed_version not in ('0.2.1', '0.2.2', '0.2.3', '0.2.4', '0.2.5', '0.2.6', '0.2.7', '0.2.8', '0.3.0', '0.3.1', '0.3.2'): raise ValueError('Unsupported frozen signed baseline')
    run = Path(tempfile.mkdtemp(prefix='compact-home-native-', dir=ROOT/'.tools'))
    print('RUN', run, flush=True)
    runtime=run/'runtime'; profile=run/'profile'; profile.mkdir()
    shutil.copytree(Path(r'C:\Program Files\Mozilla Firefox'),runtime,ignore=shutil.ignore_patterns('distribution','updates','uninstall','maintenanceservice*'))
    addon=Path(sys.argv[sys.argv.index('--addon-dir')+1]).resolve() if '--addon-dir' in sys.argv else ROOT/'extension/dist'
    if '--hostname-validation-only' in sys.argv:
        # Extra modules are confined to this disposable test copy. Production
        # still ships one bundled Core; the probe also exercises ordinary loads.
        copied=run/'addon';shutil.copytree(addon,copied);addon=copied
        shutil.copytree(ROOT/'packages/core/dist',addon/'probe-core')
    if baseline:
        addon=run/'checkpoint/extension/dist'
        with zipfile.ZipFile(ROOT/'.tools/compact-home/checkpoint.zip') as z:
            for name in z.namelist():
                if name.startswith('extension/dist/'): z.extract(name,run/'checkpoint')
    if '--polish-only' in sys.argv:
        if '--polish-baseline' in sys.argv:
            with zipfile.ZipFile(ROOT/'.tools/ui-polish/checkpoint.zip') as z:
                for name in z.namelist():
                    if name.startswith('extension/dist/'): z.extract(name,run/'checkpoint')
            addon=run/'checkpoint/extension/dist'
        from firefox_ui_polish import instrument
        addon=instrument(addon,run/'addon')
    if '--theme-only' in sys.argv or '--theme-prototypes-only' in sys.argv:
        copied=run/'addon';shutil.copytree(addon,copied);addon=copied
        (addon/'ui/theme-probe.js').write_text('const first=()=>{if(document.body){window.__firstThemeFrame=document.documentElement.dataset.theme;window.__firstThemeBackground=getComputedStyle(document.documentElement).backgroundColor;window.__firstThemeBodyBackground=getComputedStyle(document.body).backgroundImage;}else requestAnimationFrame(first);};requestAnimationFrame(first);',encoding='utf8')
        html=addon/'ui/index.html';html.write_text(html.read_text(encoding='utf8').replace('<head>','<head><script src="theme-probe.js"></script>'),encoding='utf8')
    if '--home-refresh-only' in sys.argv:
        copied=run/'addon';shutil.copytree(addon,copied);addon=copied
        probe='window.__homeRefresh={};const check=()=>{if(document.querySelector(".category-shortcut")){window.__homeRefresh={readyAt:performance.now(),count:document.querySelectorAll(".category-shortcut").length,status:!!document.getElementById("status"),placeholder:getComputedStyle(document.getElementById("category-shortcuts"),"::before").content};}else requestAnimationFrame(check);};requestAnimationFrame(check);'
        (addon/'ui/home-refresh-probe.js').write_text(probe,encoding='utf8')
        html=addon/'ui/index.html';html.write_text(html.read_text(encoding='utf8').replace('<head>','<head><script src="home-refresh-probe.js"></script>'),encoding='utf8')
    with socket.socket() as s: s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
    prefs={'marionette.port':port,'browser.startup.page':0,'browser.startup.homepage':'about:blank','browser.aboutwelcome.enabled':False,'browser.shell.checkDefaultBrowser':False,'browser.sessionstore.resume_from_crash':False,'datareporting.policy.dataSubmissionEnabled':False,'toolkit.telemetry.reportingpolicy.firstRun':False,'extensions.webextensions.uuids':json.dumps({h.ADDON_ID:h.UUID})}
    (profile/'user.js').write_text('\n'.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});' for k,v in prefs.items()),encoding='utf8')
    client=None;process=None;log=None;result={'baseline':baseline,'signedBaseline':signed_version}
    def stop():
        nonlocal client,process,log
        if client:
            try:client.call('Marionette:Quit',flags=['eForceQuit'])
            except Exception:pass
            client.socket.close();client=None
        if process:
            try:process.wait(timeout=15)
            except subprocess.TimeoutExpired:process.terminate();process.wait(timeout=10)
            process=None
        if log:log.close();log=None
    def start(first=False, overlay=True):
        nonlocal client,process,log
        log=(run/'firefox.log').open('a',encoding='utf8')
        process=subprocess.Popen([str(runtime/'firefox.exe'),'-headless','-no-remote','-profile',str(profile),'-marionette','--remote-allow-system-access','about:blank'],stdout=log,stderr=log,env={**os.environ,'MOZ_HEADLESS':'1','MOZ_NO_REMOTE':'1','MOZ_REMOTE_ALLOW_SYSTEM_ACCESS':'1'},creationflags=subprocess.CREATE_NO_WINDOW)
        def connect():
            if process.poll() is not None:raise RuntimeError('Isolated Firefox exited')
            try:return h.Marionette(port)
            except (ConnectionRefusedError,TimeoutError):return None
        client=h.wait_for(connect,'Firefox startup',40)
        result['firefox']=client.call('WebDriver:NewSession')['capabilities']['browserVersion']
        time.sleep(1)
        client.call('WebDriver:SwitchToWindow',handle=client.call('WebDriver:GetWindowHandles')[-1])
        if first:client.call('Addon:Install',path=str(ROOT/f'extension/release/{signed_version}/signed/d7b2a7bba5e34ed685e3-{signed_version}.xpi'),temporary=False)
        if overlay:client.call('Addon:Install',path=str(addon),temporary=True)
        client.call('WebDriver:SwitchToWindow',handle=client.call('WebDriver:GetWindowHandles')[-1])
        client.call('Marionette:SetContext',value='chrome')
        client.script('gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});',h.UI_URL)
        client.call('Marionette:SetContext',value='content'); ready()
        client.call('WebDriver:SetWindowRect',width=1488,height=1143)
    def ready():
        h.wait_for(lambda:client.script('return location.href.startsWith(arguments[0]) && document.readyState==="complete";',h.UI_URL),'UI',40)
        h.wait_for(lambda:((client.message({'kind':'GET_VIEW'}).get('view',{}).get('controller') or {}).get('status')=='READY'),'authority',40)
        h.wait_for(lambda:client.script('return document.querySelector("#destinations")?.dataset.phase==="READY";'),'Home pins',40)
    def reload():client.call('WebDriver:Refresh');ready();time.sleep(.5)
    def shot(name):
        time.sleep(.15);(run/(name+'.png')).write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot',id=None,highlights=[],full=False)))
    def pins(count):
        # Existing presentation pin storage, never authority.
        client.script('localStorage.setItem("atlas-home-pins-v1",JSON.stringify(arguments[0]));',PINS[:count]);reload()
    def record(key='bookmarks-v1'):
        return client.script('const [key,done]=arguments,q=indexedDB.open("atlas-home-layout-v1",1);q.onsuccess=()=>{const db=q.result,t=db.transaction("layout","readonly"),r=t.objectStore("layout").get(key);r.onsuccess=()=>done(r.result??null);t.oncomplete=()=>db.close();};',key,asynchronous=True)
    def click(selector):client.script('document.querySelector(arguments[0]).click();',selector)
    try:
        if '--curated-scopes-only' in sys.argv:
            from firefox_curated_scopes import seed,verify,snapshot,presentation,stored,KEY
            start(True,overlay=False)
            before=seed(client,h)
            (run/'scope-before.json').write_text(json.dumps(before,indent=2),encoding='utf8')
            stop();start()
            (run/'scope-after.json').write_text(json.dumps({'snapshot':snapshot(client),'presentation':presentation(client)},indent=2),encoding='utf8')
            result['curatedScopes']=verify(client,h,before,shot)
            after=snapshot(client);saved=presentation(client);marker=stored(client,'atlas-authority-v1','authority',KEY)
            stop();start()
            again=snapshot(client)
            for key in ['policy','policyRevision','configuration','configurationRevision']:assert again[key]==after[key],key
            assert presentation(client)==saved
            assert stored(client,'atlas-authority-v1','authority',KEY)==marker
            result['curatedScopes']['fullRestartIdempotent']=True
            if '--scope-rollback' in sys.argv:
                stop();start(overlay=False)
                rolled=snapshot(client)
                for key in ['policy','policyRevision','configuration','configurationRevision']:assert rolled[key]==after[key],key
                assert presentation(client)==saved
                assert stored(client,'atlas-authority-v1','authority',KEY)==marker
                assert client.script('return browser.runtime.getManifest().version;')==signed_version
                result['curatedScopes']['signedRollbackPreservesMigratedPolicy']=True
            result['status']='PASS';print('PASS signed upgrade and scope restart',flush=True);return
        if '--friendly-sites-only' in sys.argv:
            from firefox_friendly_sites import verify
            is_baseline='--friendly-sites-baseline' in sys.argv
            start(True,overlay=not is_baseline)
            result['friendlySites']=verify(client,h,shot,pins,is_baseline)
            result['status']='PASS';print('PASS friendly sites'+(' baseline' if is_baseline else ''),flush=True);return
        start(True);pins(6)
        if '--hostname-validation-only' in sys.argv:
            from firefox_hostname_validation import verify
            result['hostnameValidation']=verify(client,h,shot)
            result['status']='PASS';print('PASS hostname validation',flush=True);return
        if '--site-checkbox-only' in sys.argv:
            from firefox_subdomain_scope import verify_add_site_checkbox
            result['addSiteCheckbox']=verify_add_site_checkbox(client,h,shot)
            result['status']='PASS';print('PASS Add Site checkbox',flush=True);return
        if '--greylist-layout-only' in sys.argv:
            from firefox_greylist_layout import verify
            result['greylistLayout']=verify(client,h,shot,'--layout-baseline' in sys.argv)
            result['status']='PASS';print('PASS Greylist layout',flush=True);return
        if '--theme-prototypes-only' in sys.argv:
            from firefox_theme_prototypes import verify
            result['prototypes']=verify(client,h,shot)
            stop();start()
            assert client.script('return document.documentElement.dataset.theme;')=='parchment'
            assert client.script('return window.__firstThemeFrame;')=='parchment'
            result['prototypes']['fullRestartPreserved']=True
            result['prototypes']['firstRestartFrameUsesSavedTheme']=True
            result['status']='PASS';print('PASS theme prototypes',flush=True);return
        if '--theme-only' in sys.argv:
            from firefox_themes import verify
            result['themes']=verify(client,h,shot)
            stop();start()
            assert client.script('return document.documentElement.dataset.theme;')=='light-test'
            assert client.script('return window.__firstThemeFrame;')=='light-test'
            assert client.script('return window.__firstThemeBackground;')=='rgb(244, 241, 233)'
            result['themes']['fullRestartPreserved']=True
            result['themes']['firstRestartFrameUsesSavedTheme']=True
            result['status']='PASS';print('PASS themes',flush=True);return
        if '--theme-baseline-only' in sys.argv:
            from firefox_themes import capture
            result['default']=capture(client,h,shot,'default')
            result['status']='PASS';print('PASS theme baseline',flush=True);return
        if '--home-balance-only' in sys.argv:
            from firefox_home_balance import verify
            result['balance']=verify(client,h,shot)
            from firefox_compass_frames import verify as frames
            client.script('location.hash="home";');time.sleep(.5)
            result['motion']=frames(client,h,shot)
            stop();start()
            client.script('location.hash="sites";')
            h.wait_for(lambda:client.script('return document.querySelectorAll("#sites-categories button").length>4 && !document.querySelector("#sites-category-order").disabled;'),'restart categories')
            assert client.script('return [...document.querySelectorAll("#sites-categories button")].map(e=>e.dataset.categoryKey);')==result['balance']['customOrder']
            result['balance']['restartPreserved']=True
            result['status']='PASS';print('PASS Home balance',flush=True);return
        if '--home-directory-only' in sys.argv:
            from firefox_home_directory import verify
            result['homeDirectory']=verify(client,h,shot)
            before=client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
            saved=client.script('return [localStorage.getItem("atlas-home-pins-v1"),localStorage.getItem("atlas-destinations-v1")];')
            stop();start()
            after=client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
            for key in ['policy','configuration']:assert before[key]==after[key],key
            assert client.script('return [localStorage.getItem("atlas-home-pins-v1"),localStorage.getItem("atlas-destinations-v1")];')==saved
            result['homeDirectory']['restartPreservesPolicySettingsAndPresentation']=True
            result['status']='PASS';print('PASS Home directory',flush=True);return
        if '--home-hierarchy-only' in sys.argv:
            from firefox_home_hierarchy import verify
            result['home']=verify(client,h,shot,'--home-hierarchy-baseline' in sys.argv,pins)
            result['status']='PASS';print('PASS Home hierarchy',flush=True);return
        if '--greylist-controls-only' in sys.argv:
            from firefox_greylist_controls import verify
            result['controls']=verify(client,h,shot,'--greylist-controls-baseline' in sys.argv)
            result['status']='PASS';print('PASS Greylist controls',flush=True);return
        if '--simplify-only' in sys.argv:
            from firefox_home_simplification import verify
            result['home']=verify(client,h,shot,reload)
            before=client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
            saved=client.message({'kind':'PRESENTATION_READ'})
            stop();start()
            after=client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
            for key in ['policy','policyRevision','configuration','configurationRevision']:assert before[key]==after[key],key
            again=client.message({'kind':'PRESENTATION_READ'})
            assert saved['pins']==again['pins'] and saved['bookmarks']==again['bookmarks']
            assert saved['sync']['folderIcons']==again['sync']['folderIcons']
            result['home']['restartPreserved']=True
            result['status']='PASS';print('PASS Home simplification',flush=True);return
        if '--simplify-motion-only' in sys.argv:
            from firefox_compass_frames import verify
            result['motion']=verify(client,h,shot)
            result['status']='PASS';print('PASS native frame measurement',flush=True);return
        if '--recaptcha-only' in sys.argv:
            from firefox_recaptcha_probe import verify
            result['recaptcha']=verify(client,h,shot)
            result['status']='PASS';print('PASS public-page observation',flush=True);return
        if '--end-access-only' in sys.argv:
            from firefox_declutter_access import verify
            result['endAccess']=verify(client,h,shot)
            before=client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
            stop();start()
            after=client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
            for key in ['policy','configuration','policyRevision','configurationRevision']:assert before[key]==after[key],key
            assert after['accessState']['grants']==before['accessState']['grants']==[]
            result['endAccess']['restartPreserved']=True
            result['status']='PASS';print('PASS end access and resource boundary',flush=True);return
        if '--declutter-only' in sys.argv:
            from firefox_declutter import verify
            result['declutter']=verify(client,h,shot,record,'--declutter-baseline' in sys.argv)
            result['status']='PASS';print('PASS declutter',flush=True);return
        if '--home-motion-only' in sys.argv:
            from firefox_home_motion import verify
            result['homeMotion']=verify(client,h,shot,record,'--home-motion-baseline' in sys.argv)
            result['status']='PASS';print(json.dumps(result),flush=True);return
        if '--navigation-failure-only' in sys.argv:
            from firefox_navigation_failure import verify
            result['navigationFailure']=verify(client,h,shot)
            result['status']='PASS';print(json.dumps(result),flush=True);return
        if '--interaction-polish-only' in sys.argv:
            from firefox_ux_refinement import verify
            result['interactions']=verify(client,h.wait_for,shot,record)
            result['status']='PASS';print(json.dumps(result),flush=True);return
        if '--category-grid-only' in sys.argv:
            from firefox_category_grid import verify
            result['categoryGrid']=verify(lambda:client,h.wait_for,shot,record,stop,start)
            result['status']='PASS';print(json.dumps(result),flush=True);return
        if '--polish-only' in sys.argv:
            from firefox_ui_polish import verify
            result['polish']=verify(client,h.wait_for,shot,reload,'--polish-baseline' in sys.argv)
            result['status']='PASS';print(json.dumps(result),flush=True);return
        if '--home-refresh-only' in sys.argv:
            result['reloads']=[]
            for _ in range(5):
                reload();result['reloads'].append(client.script('return window.__homeRefresh;'))
            shot('home-refresh');result['status']='PASS';print(json.dumps(result),flush=True);return
        if '--extras-only' in sys.argv:
            from firefox_compact_stress import run_stress
            result['stress']=run_stress(client,h.wait_for,shot);result['status']='PASS';print(json.dumps(result),flush=True);return
        # Matched, visible-page interaction/idle measurements. No external-load timing claims.
        time.sleep(3)
        result['navigationMs']=[client.script('const done=arguments[0],s=performance.now();document.getElementById("show-sites").click();document.getElementById("show-home").click();requestAnimationFrame(()=>done(performance.now()-s));',asynchronous=True) for _ in range(15)]
        client.script('window.__nodes=0;window.__attrs=0;window.__icons=performance.getEntriesByType("resource").length;window.__pin=document.getElementById("pinned-primary").firstElementChild;window.__observer=new MutationObserver(ms=>ms.forEach(m=>{if(m.type==="childList")window.__nodes+=m.addedNodes.length+m.removedNodes.length;else window.__attrs++;}));window.__observer.observe(document.getElementById("destinations"),{childList:true,subtree:true,attributes:true});window.__reads=0;window.__presentationReads=0;window.__pending=0;window.__peak=0;window.__sendIdle=browser.runtime.sendMessage;browser.runtime.sendMessage=async function(m,...rest){if(m.kind==="PRESENTATION_READ")window.__presentationReads++;const counted=m.kind==="GET_VIEW";if(counted){window.__reads++;window.__peak=Math.max(window.__peak,++window.__pending);}try{return await window.__sendIdle.call(this,m,...rest);}finally{if(counted)window.__pending--;}};')
        time.sleep(5)
        result['idle']=client.script('window.__observer.disconnect();browser.runtime.sendMessage=window.__sendIdle;return {replacedNodes:window.__nodes,attributes:window.__attrs,additionalResources:performance.getEntriesByType("resource").length-window.__icons,pinIdentity:window.__pin===document.getElementById("pinned-primary").firstElementChild,viewRequests:window.__reads,presentationRequests:window.__presentationReads,maxConcurrentViews:window.__peak};')
        shot('home')
        if '--measure-only' in sys.argv:
            result['status']='PASS';print(json.dumps(result),flush=True);return
        if '--everyday-only' in sys.argv:
            from firefox_everyday import run_everyday
            result['everyday']=run_everyday(lambda:client,h,shot,record,stop,start)
            result['status']='PASS';print(json.dumps(result),flush=True);return
        if not baseline:
            result['capacity']=[]
            for n in [0,1,6,8,10,12]:
                pins(n)
                geometry=client.script('return [...document.querySelectorAll("#pinned-primary .compass-pin")].map(b=>{const r=b.getBoundingClientRect();return {id:b.dataset.destinationId,x:r.x,y:r.y,w:r.width,h:r.height};});')
                assert len(geometry)==min(n,10),(n,geometry)
                for i,a in enumerate(geometry):
                    assert a['w']>=56 and a['h']>=56
                    for b in geometry[i+1:]:assert not(a['x']<b['x']+b['w'] and a['x']+a['w']>b['x'] and a['y']<b['y']+b['h'] and a['y']+a['h']>b['y']),(n,a,b)
                result['capacity'].append({'groups':n,'geometry':geometry});shot(f'capacity-{n}')
            pins(6)
            assert record() is None
            click('#edit-pins');h.wait_for(lambda:client.script('return document.getElementById("bookmark-editor").open;'),'editor')
            # Create exact named pages through real editor, preserving URL components.
            client.script('const set=(selector,value)=>{const e=document.querySelector(selector);e.value=value;e.dispatchEvent(new Event("input",{bubbles:true}));};set("#bookmark-pages input[data-field=label]","Inbox and calendar");set("#bookmark-pages input[data-field=url]","https://webmail.kth.se/inbox?view=all%2Bnew#today");')
            click('#add-bookmark-page')
            client.script('const row=document.querySelector("#bookmark-pages li:last-child");for(const [field,value] of [["label","Research notes"],["url","https://example.org/notes?topic=physics#reading"]]){const e=row.querySelector(`[data-field=${field}]`);e.value=value;e.dispatchEvent(new Event("input",{bubbles:true}));}')
            click('#save-bookmarks');h.wait_for(lambda:client.script('return !document.getElementById("bookmark-editor").open;'),'acknowledged save')
            result['bookmarks']=record();assert result['bookmarks']['revision']==1
            click('#pinned-primary .compass-pin');h.wait_for(lambda:client.script('return document.getElementById("pin-chooser").matches(":popover-open");'),'chooser')
            shot('bookmark-group')
            client.script('window.__chosen=document.querySelector("#pin-chooser-pages button");window.__chosen.focus();')
            time.sleep(3)
            assert client.script('return document.activeElement===window.__chosen && document.getElementById("pin-chooser").matches(":popover-open");')
            client.script('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));')
            assert client.script('return document.activeElement===document.querySelector("#pinned-primary .compass-pin");')
            saved=record('current')
            click('.category-shortcut');assert client.script('return !document.getElementById("category-workspace").hidden && !document.querySelector("#destination-list .service-group:not([hidden]) .destination-grid").hidden;')
            shot('category'); category=client.script('return history.state.atlasHomeView;')
            reload();assert client.script('return history.state.atlasHomeView===arguments[0] && !document.getElementById("category-workspace").hidden;',category)
            click('#back-to-categories');shot('category-directory');assert record('current')==saved
            click('#close-category-workspace')
            client.script('history.back();');h.wait_for(lambda:client.script('return history.state.atlasHomeView==="all";'),'history back')
            client.script('history.forward();');h.wait_for(lambda:client.script('return history.state.atlasHomeView===null;'),'history forward')
            from firefox_compact_interactions import run_interactions
            result['interactions']=run_interactions(client,h.wait_for,shot,record)
            pins(10)
            result['dimensions']=[]
            for width,zoom in [(1488,1),(1488,1.25),(1488,1.5),(1488,2),(800,1),(500,1),(500,2)]:
                client.call('WebDriver:SetWindowRect',width=width,height=1143)
                client.call('Marionette:SetContext',value='chrome');client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,arguments[0]);',zoom);client.call('Marionette:SetContext',value='content')
                time.sleep(.2)
                measure=client.script('return {width:innerWidth,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth};')
                assert measure['scroll']<=measure['client']+1,(width,zoom,measure)
                cboxes=client.script('return [...document.querySelectorAll("#pinned-primary .compass-pin")].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});')
                assert len(cboxes)==10
                for i,a in enumerate(cboxes):
                    assert a['h']>=56
                    for b in cboxes[i+1:]:assert not(a['x']<b['x']+b['w'] and a['x']+a['w']>b['x'] and a['y']<b['y']+b['h'] and a['y']+a['h']>b['y']),(width,zoom,a,b)
                result['dimensions'].append({'width':width,'zoom':zoom,**measure});shot(f'width-{width}-zoom-{zoom}')
            client.call('Marionette:SetContext',value='chrome');client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,1);');client.call('Marionette:SetContext',value='content')
            client.call('WebDriver:SetWindowRect',width=1488,height=1143)
            from firefox_compact_access import run_access
            result['access']=run_access(client,h,shot,record)
            before=client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
            saved_pins=client.script('return localStorage.getItem("atlas-home-pins-v1");'); saved_bookmarks=record();saved_layout=record('current')
            stop();start()
            after=client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
            for key in ['policy','configuration','policyRevision','configurationRevision']:assert before.get(key)==after.get(key),key
            assert record()==saved_bookmarks and record('current')==saved_layout
            assert client.script('return localStorage.getItem("atlas-home-pins-v1");')==saved_pins
            draft=client.script('const done=arguments[0],q=indexedDB.open("atlas-destination-drafts-v1");q.onsuccess=()=>{const db=q.result,t=db.transaction("workspace","readonly"),r=t.objectStore("workspace").get("current");r.onsuccess=()=>done(r.result);t.oncomplete=()=>db.close();};',asynchronous=True)
            assert draft==result['access']['draft'],'existing batch draft survives restart beside bookmarks'
            result['restartPreserved']=True
            if '--rollback-check' in sys.argv:
                for label, overlay in [('rollback', False), ('reupgrade', True)]:
                    stop();start(overlay=overlay)
                    expected=json.loads((addon/'manifest.json').read_text())['version'] if overlay else signed_version
                    assert client.script('return browser.runtime.getManifest().version;')==expected
                    state=client.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
                    for key in ['policy','configuration','policyRevision','configurationRevision']:assert state.get(key)==before.get(key),(label,key)
                    assert record()==saved_bookmarks and record('current')==saved_layout,label
                    assert client.script('return localStorage.getItem("atlas-home-pins-v1");')==saved_pins,label
                result['bookmarkRollbackAndReupgradePreserved']=True
        result['status']='PASS';print(json.dumps({'status':'PASS','baseline':baseline,'run':str(run),'navigationMedianMs':statistics.median(result['navigationMs']),'idle':result['idle'],'restartPreserved':result.get('restartPreserved')}),flush=True)
    finally:
        if client:
            try:shot('final-state')
            except Exception:pass
        stop();(run/'result.json').write_text(json.dumps(result,indent=2),encoding='utf8')

if __name__=='__main__':main()

