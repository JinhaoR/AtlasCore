"""Credential-free navigation characterization; does not change Atlas rules.

Run after building the extension. The observer is inserted only into a disposable
copy. --mode passive removes Atlas's background from that copy to measure events
that the enforcing run blocks. Passive results are never enforcement evidence.
Fresh profiles are deleted; only closed, hostname-only projections survive.
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
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("atlas_public", Path(__file__).with_name("firefox-public-sites.py"))
public = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public)
smoke = public.smoke

PUBLIC = [
    ("Canvas", "canvas.kth.se", "https://canvas.kth.se/"),
    ("KTH webmail", "webmail.kth.se", "https://webmail.kth.se/"),
    ("Gmail", "mail.google.com", "https://mail.google.com/"),
    ("Microsoft account", "myaccount.microsoft.com", "https://myaccount.microsoft.com/"),
    ("Outlook", "outlook.office.com", "https://outlook.office.com/"),
    ("Overleaf", "overleaf.com", "https://overleaf.com/"),
    ("GitHub", "github.com", "https://github.com/"),
    ("Ladok", "student.ladok.se", "https://student.ladok.se/"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["enforcing", "passive"], default="enforcing")
    parser.add_argument("--public", action="store_true")
    parser.add_argument("--case", help="Run one case by name")
    parser.add_argument("--journey-retry", action="store_true", help="Public Canvas interruption and fresh Home retry; no credentials")
    parser.add_argument("--firefox", default=os.environ.get("FIREFOX_BINARY") or r"C:\Program Files\Mozilla Firefox\firefox.exe")
    args = parser.parse_args()
    artifacts = smoke.EXTENSION.parent / ".tools"
    artifacts.mkdir(exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix=f"auth-{args.mode}-", dir=artifacts))
    profile, addon = run / "profile", run / "addon"
    profile.mkdir()
    shutil.copytree(smoke.EXTENSION / "dist", addon)
    shutil.copyfile(Path(__file__).with_name("auth-evidence-observer.js"), addon / "auth-evidence-observer.js")
    manifest = json.loads((addon / "manifest.json").read_text(encoding="utf-8"))
    manifest["background"]["scripts"] = ["auth-evidence-observer.js"] + (
        manifest["background"]["scripts"] if args.mode == "enforcing" else [])
    (addon / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    hits = []

    class Pages(BaseHTTPRequestHandler):
        def do_POST(self):
            # Discard the synthetic POST body without storing it.
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.do_GET()

        def do_GET(self):
            host = self.headers.get("Host", "").split(":")[0]
            path = urlsplit(self.path).path
            hits.append({"hostname": host, "method": self.command, "fixture": path})
            port = self.server.server_port
            def url(target, endpoint):
                return f"http://{target}.localhost:{port}{endpoint}"
            redirects = {
                "/chain": (302, url("auth", "/return")),
                "/return": (302, url("app", "/home")),
                "/entry": (302, url("auth", "/waiting")),
                "/finish": (302, url("app", "/home")),
                "/selection": (302, url("selector", "/select")),
                "/canonical": (308, url("www.app", "/home")),
                "/http-evil": (302, url("evil", "/home")),
                "/http-black": (302, url("black", "/home")),
            }
            if path.startswith("/status-"):
                redirects[path] = (int(path[8:]), url("auth", "/return"))
            if path in redirects:
                status, destination = redirects[path]
                self.send_response(status)
                self.send_header("Location", destination)
                self.end_headers()
                return
            body = "<!doctype html><meta charset=utf-8><title>Atlas synthetic fixture</title>"
            auth, evil, callback = url("auth", "/return"), url("evil", "/home"), url("app", "/callback")
            if path in ["/href", "/assign", "/replace", "/evil-js"]:
                target = evil if path == "/evil-js" else auth
                action = {"/href": f"location.href='{target}'", "/assign": f"location.assign('{target}')",
                          "/replace": f"location.replace('{target}')", "/evil-js": f"location.href='{target}'"}[path]
                body += f'<button id="go" onclick="{action}">Continue</button>'
            elif path in ["/get", "/post", "/submit"]:
                method = "GET" if path == "/get" else "POST"
                body += f'<form id="form" method="{method}" action="{auth}"><button id="go">Continue</button></form>'
                if path == "/submit":
                    body += '<script>document.getElementById("go").onclick=e=>{e.preventDefault();document.getElementById("form").submit()}</script>'
            elif path == "/evil-link":
                body += f'<a id="go" href="{evil}">Unrelated</a>'
            elif path in ["/blank", "/popup"]:
                destination = url("auth", "/popup-return")
                body += (f'<a id="go" target="_blank" href="{destination}">Popup</a>' if path == "/blank"
                         else f'<button id="go" onclick="window.open(\'{destination}\')">Popup</button>')
            elif path == "/popup-return":
                self.send_response(302)
                self.send_header("Location", callback)
                self.end_headers()
                return
            elif path == "/callback":
                body += '<script>if(window.opener){window.opener.postMessage("synthetic-callback", "*");setTimeout(()=>window.close(),800)}</script>'
            elif path == "/select":
                body += f'<form method="POST" action="{url("auth", "/postback")}"><button id="go">Select synthetic identity</button></form>'
            elif path == "/postback":
                body += f'<form id="form" method="POST" action="{url("app", "/home")}"></form><script>document.getElementById("form").submit()</script>'
            elif path in ["/auto-js", "/auto-evil"]:
                target = auth if path == "/auto-js" else evil
                body += f'<script>setTimeout(()=>location.assign("{target}"),600)</script>'
            elif path == "/auto-post":
                body += f'<form id="form" method="POST" action="{auth}"></form><script>setTimeout(()=>document.getElementById("form").submit(),600)</script>'
            elif path == "/waiting":
                body += f'<a id="go" href="{url("auth", "/finish")}">Finish on current provider</a>'
            elif path == "/meta":
                body += f'<meta http-equiv="refresh" content="1;url={auth}">'
            elif path in ["/push", "/replace-state", "/spa"]:
                op = "replaceState" if path == "/replace-state" else "pushState"
                body += f'<button id="go" onclick="history.{op}({{}},\'\',\'/route\');document.title=\'Synthetic route\'">Route</button>'
            elif path in ["/iframe", "/promote"]:
                frame = "/frame-promote" if path == "/promote" else "/home"
                body += f'<iframe src="{url("auth", frame)}"></iframe>'
            elif path == "/frame-promote":
                body += f'<button id="go" onclick="top.location=\'{auth}\'">Promote</button>'
            elif path == "/history":
                body += f'<a id="go" href="{url("app", "/home")}">Second document</a>'
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body.encode("utf-8"))
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        automation_port = reservation.getsockname()[1]
    preferences = {"marionette.port": automation_port, "browser.startup.page": 0,
        "browser.aboutwelcome.enabled": False, "browser.shell.checkDefaultBrowser": False,
        "browser.sessionstore.resume_from_crash": False, "datareporting.policy.dataSubmissionEnabled": False,
        "extensions.webextensions.uuids": json.dumps({smoke.ADDON_ID: smoke.UUID}),
        "dom.disable_open_during_load": False}
    (profile / "user.js").write_text("\n".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});" for k, v in preferences.items()), encoding="utf-8")
    process = subprocess.Popen([args.firefox, "-headless", "-no-remote", "-profile", str(profile),
        "-marionette", "--remote-allow-system-access", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        env={**os.environ, "MOZ_HEADLESS": "1", "MOZ_NO_REMOTE": "1"},
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    client = None
    report = {"mode": args.mode, "public": args.public, "cases": [], "note": "Hostnames only; passive means NO Atlas enforcement."}
    try:
        def connect():
            if process.poll() is not None:
                raise RuntimeError("Firefox exited")
            try:
                return public.PublicClient(automation_port)
            except (ConnectionRefusedError, TimeoutError):
                return None
        client = smoke.wait_for(connect, "startup", 30)
        report["firefox"] = client.call("WebDriver:NewSession")["capabilities"]["browserVersion"]
        client.call("WebDriver:SetWindowRect", width=1280, height=1000)
        client.call("Addon:Install", path=str(addon), temporary=True)
        client.call("Marionette:SetContext", value="chrome")
        client.script("gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});", smoke.UI_URL)
        client.call("Marionette:SetContext", value="content")
        smoke.wait_for(lambda: client.script("return location.protocol==='moz-extension:' && document.readyState==='complete';"), "private UI")
        ui_handle = client.call("WebDriver:GetWindowHandle")
        def ui():
            client.call("WebDriver:SwitchToWindow", handle=ui_handle)
        def evidence(command="READ"):
            ui()
            return client.script("""const done=arguments[arguments.length-1];const p=browser.runtime.connect({name:'auth-evidence'});
                p.onMessage.addListener(v=>{p.disconnect();done(v)});p.postMessage({kind:arguments[0]});""", command, asynchronous=True)
        def view():
            ui()
            return client.message({"kind": "GET_VIEW"})["view"] if args.mode == "enforcing" else None
        policy = {"whitelist": [case[1] for case in PUBLIC] + ["www.overleaf.com"] if args.public
                  else ["app.localhost", "www.app.localhost", "other.localhost"], "blacklist": ["black.localhost"]}
        if args.mode == "enforcing":
            smoke.wait_for(lambda: (view().get("controller") or {}).get("status") == "UNINITIALIZED", "Core initialization")
            assert client.message({"kind": "SETUP", "policy": policy})["initialized"]
        def typed(handle, destination):
            client.call("WebDriver:SwitchToWindow", handle=handle)
            client.call("Marionette:SetContext", value="chrome")
            try:
                client.script("gURLBar.value=arguments[0];gURLBar.handleCommand();", destination)
            finally:
                client.call("Marionette:SetContext", value="content")
        def click(handle, selector="#go", frame=False):
            client.call("WebDriver:SwitchToWindow", handle=handle)
            if frame:
                client.call("WebDriver:SwitchToFrame", id=0)
            element = client.call("WebDriver:FindElement", using="css selector", value=selector)
            client.call("WebDriver:ElementClick", id=next(iter(element.values())))
            if frame:
                client.call("WebDriver:SwitchToFrame", id=None)
        def facts(handle):
            client.call("WebDriver:SwitchToWindow", handle=handle)
            return client.script(public.PAGE_FACTS)
        def close_tabs(ids):
            ui()
            client.script("const done=arguments[arguments.length-1];browser.tabs.remove(arguments[0]).then(()=>done(true));", ids, asynchronous=True)
        def capture(case, tab_id):
            current = view()
            if current:
                assert current["controller"]["snapshot"]["policy"] == policy
                assert current["controller"]["snapshot"]["accessState"]["grants"] == []
                context = next((c for c in current["contexts"] if c["tabId"] == tab_id), None)
                case["core"] = {"latest": context["latest"], "journey": context["journey"], "effect": context["effect"]} if context else None
                case["diagnostics"] = client.message({"kind": "GET_DIAGNOSTICS", "tabId": tab_id})["entries"]
                case["policyUnchanged"] = True
                case["noGrants"] = True
                if args.public:
                    case['toolbar'] = client.script('''const [tabId,done]=arguments;
                        Promise.all([browser.browserAction.getBadgeText({tabId}),browser.browserAction.getTitle({tabId})])
                        .then(([text,title])=>done({text,title}));''',tab_id,asynchronous=True)
            recorded = evidence()
            assert recorded["dropped"] == 0
            case["events"] = recorded["entries"]
            if not args.public:
                try:
                    assert_fixture(case, args.mode)
                except AssertionError:
                    (run / 'failed-fixture.json').write_text(json.dumps(case, indent=2), encoding='utf-8')
                    print('Failed synthetic characterization:', json.dumps({'name':case['name'],'core':case.get('core'),'serverHits':case['serverHits']}), flush=True)
                    raise
                case["characterizationPassed"] = True
            report["cases"].append(case)
            (run / "result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(json.dumps({"case": case["name"], "mode": args.mode, "events": len(case["events"]),
                              "decision": (case.get("core") or {}).get("latest"), "facts": case.get("facts")}), flush=True)
        fixtures = [(f"A_{status}", f"/status-{status}", "none") for status in [301, 302, 303, 307, 308]] + [
            ("B_href", "/href", "click"), ("B_assign", "/assign", "click"), ("B_replace", "/replace", "click"),
            ("B_auto_JS", "/auto-js", "none"), ("E_auto_JS", "/auto-evil", "none"), ("auto_POST", "/auto-post", "none"),
            ("C_POST", "/post", "click"), ("GET_form", "/get", "click"), ("JS_submit", "/submit", "click"),
            ("D_link", "/evil-link", "click"), ("E_JS", "/evil-js", "click"),
            ("F_during", "/entry", "typed"), ("F_after", "/home", "typed"),
            ("G_popup", "/popup", "click"), ("blank_link", "/blank", "click"),
            ("H_SAML_POST", "/selection", "click"), ("I_intermediate", "/entry", "click"),
            ("J_canonical", "/canonical", "none"), ("meta_refresh", "/meta", "none"),
            ("history_push", "/push", "click"), ("history_replace", "/replace-state", "click"),
            ("SPA", "/spa", "click"), ("iframe", "/iframe", "none"), ("iframe_promote", "/promote", "frame"),
            ("reload", "/home", "reload"), ("back_forward", "/history", "history"),
            ("bookmark", "/home", "bookmark"),
            ("malicious_HTTP", "/http-evil", "none"), ("blacklist_HTTP", "/http-black", "none")]
        cases = PUBLIC if args.public else fixtures
        for name, root_or_path, operation_or_url in cases:
            if args.case and args.case != name:
                continue
            ui()
            if args.mode == "enforcing":
                client.message({"kind": "CLEAR_DIAGNOSTICS"})
            tab_id = client.script("const done=arguments[arguments.length-1];browser.tabs.create({url:'about:blank',active:true}).then(t=>done(t.id));", asynchronous=True)
            handle = client.call("WebDriver:GetWindowHandles")[-1]
            time.sleep(0.25)
            evidence("RESET")
            start_hit = len(hits)
            url = operation_or_url if args.public else f"http://app.localhost:{server.server_port}{root_or_path}"
            typed(handle, url)
            case = {"name": name, "actions": ["address bar root"]}
            if args.public:
                observations = []
                until = time.monotonic() + 22
                clicked = False
                while time.monotonic() < until:
                    try:
                        page = facts(handle)
                        if not isinstance(page, dict):
                            time.sleep(0.1)
                            continue
                        if page not in observations:
                            observations.append(page)
                        if page["atlasPage"] or page["browserError"] or (page["credentialForm"] and
                            (name not in ["Overleaf", "GitHub"] or clicked)):
                            break
                        if page["documentReady"] and (not clicked or name == "Ladok" and len(case["actions"]) < 4) and name in ["Overleaf", "GitHub", "Ladok"]:
                            client.call("WebDriver:SwitchToWindow", handle=handle)
                            action = client.script(public.DEEP_QUERY + """
                                const links=queryAll('a,button').filter(e=>e.getClientRects().length>0);
                                const item=arguments[0] ? links.find(e=>/institution|university|ros.te/i.test(e.textContent))
                                    ?? links.find(e=>/logga in|log in|sign in/i.test(e.textContent))
                                  : links.find(e=>e.matches('a[href="/login"]'))
                                    ?? links.find(e=>/sign in|log in|logga in|login/i.test(e.textContent));
                                if(item){item.click();return true}return false;""", name == "Ladok")
                            if action:
                                case["actions"].append("script-click public sign-in control; no credential submission")
                                clicked = True
                    except RuntimeError:
                        pass
                    time.sleep(0.3)
                case["facts"] = observations
            else:
                time.sleep(0.8 if name != "meta_refresh" else 1.8)
                if operation_or_url in ["click", "frame", "history"]:
                    click(handle, frame=operation_or_url == "frame")
                    case["actions"].append("native click" if operation_or_url != "frame" else "native iframe click")
                elif operation_or_url == "typed":
                    typed(handle, f"http://evil.localhost:{server.server_port}/home")
                    case["actions"].append("address bar unrelated host")
                elif operation_or_url == "reload":
                    client.call("WebDriver:SwitchToWindow", handle=handle)
                    client.call("WebDriver:Refresh")
                    case["actions"].append("browser reload")
                elif operation_or_url == "bookmark":
                    client.call("WebDriver:SwitchToWindow", handle=handle)
                    client.call("Marionette:SetContext", value="chrome")
                    try:
                        result = client.script("""const done=arguments[arguments.length-1];let phase='import';
                            (async()=>{const {PlacesUtils}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');phase='insert';
                            const b=await PlacesUtils.bookmarks.insert({parentGuid:PlacesUtils.bookmarks.toolbarGuid,
                              url:arguments[0],title:'Atlas synthetic bookmark'});
                            const node={uri:arguments[0],title:b.title,bookmarkGuid:b.guid,itemId:1,
                              type:Ci.nsINavHistoryResultNode.RESULT_TYPE_URI};
                            phase='open';PlacesUIUtils.openNodeIn(node,'current',{ownerWindow:window});done({ok:true})})()
                            .catch(e=>done({ok:false,phase,errorName:e.name}));""", url, asynchronous=True)
                        if not result.get('ok'):
                            print(json.dumps({"bookmarkProbe": result}), flush=True)
                        assert result.get('ok'), "bookmark command unavailable"
                        case["actions"].append("native saved bookmark through PlacesUIUtils")
                    finally:
                        client.call("Marionette:SetContext", value="content")
                time.sleep(1.5)
                if operation_or_url == "history":
                    client.call("WebDriver:SwitchToWindow", handle=handle)
                    client.call("WebDriver:Back")
                    time.sleep(0.6)
                    client.call("WebDriver:Forward")
                    time.sleep(0.6)
                    case["actions"].append("browser back and forward")
                try:
                    case["facts"] = facts(handle)
                except RuntimeError:
                    case["facts"] = {"unavailable": True}
                case["serverHits"] = hits[start_hit:]
            if args.journey_retry and name == 'Canvas' and args.mode == 'enforcing':
                prior = next(c for c in view()['contexts'] if c['tabId'] == tab_id)
                assert prior['journey']['phase'] == 'IN_TRANSIT', 'public Canvas must reach an active intermediate'
                previous_id = prior['journey']['id']
                typed(handle, 'https://google.com/')
                stopped = smoke.wait_for(lambda: next((c for c in view()['contexts'] if c['tabId'] == tab_id and c['effect'] == 'REMOVED'),None), 'Google denied during Canvas Journey')
                assert stopped['journey']['endReason'] == 'UNRELATED_NAVIGATION' and stopped['latest']['decision']['outcome'] != 'ALLOW'
                client.call('WebDriver:SwitchToWindow',handle=handle); client.call('WebDriver:Back')
                stale = smoke.wait_for(lambda: next((c for c in view()['contexts'] if c['tabId'] == tab_id
                    and c['hostname'] != 'google.com' and c['effect'] == 'REMOVED'),None), 'public Back blocks stale authentication page')
                assert stale['journey']['id'] == previous_id and stale['journey']['phase'] == 'ENDED'
                ui(); before = set(client.call('WebDriver:GetWindowHandles'))
                smoke.wait_for(lambda: client.script('return !!document.querySelector("[data-destination-id=\\"service:canvas.kth.se\\"] .destination-open");'), 'Canvas Home launcher')
                client.script('document.getElementById("show-home").click(); document.querySelector("[data-destination-id=\\"service:canvas.kth.se\\"] .destination-open").click();')
                fresh_handle = smoke.wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in before),None), 'fresh Canvas tab')
                fresh = smoke.wait_for(lambda: next((c for c in view()['contexts'] if c['journey'] and c['journey']['id'] != previous_id
                    and c['journey']['rootHostname'] == 'canvas.kth.se' and c['journey']['phase'] == 'IN_TRANSIT' and c['displayedHostname']),None), 'fresh Canvas authentication chain')
                assert fresh['journey']['expiresAt'] - fresh['journey']['startedAt'] == 300000 and fresh['journey']['maxHops'] == 12
                client.call('WebDriver:SwitchToWindow',handle=fresh_handle)
                pill = smoke.wait_for(lambda: client.script('const host=document.getElementById("atlas-journey-indicator");return host?.shadowRoot.textContent;'), 'public Canvas Journey indicator')
                assert 'Canvas' in pill and 'saml-5.sys.kth.se' not in pill
                case['interruptionRetry'] = {'oldJourneyId':previous_id,'endReason':stopped['journey']['endReason'],
                    'googleOutcome':stopped['latest']['decision']['outcome'],'backHostname':stale['hostname'],
                    'freshJourney':fresh['journey'],'indicatorDestination':'Canvas','newTab':fresh['tabId'] != tab_id}
                case['actions'] += ['address bar Google denied','Back to stale auth denied','actual Home Canvas retry','visible Canvas indicator']
                tab_id = fresh['tabId']
            capture(case, tab_id)
            ui()
            remaining = client.script("""const done=arguments[arguments.length-1];
                browser.tabs.getCurrent().then(control=>browser.tabs.query({})
                  .then(ts=>done(ts.filter(t=>t.id!==control.id).map(t=>t.id))));""", asynchronous=True)
            # Blocked tabs use extension pages, so always include the original tab.
            close_tabs(list(set(remaining + [tab_id])))
        (run / "result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Sanitized evidence: {run / 'result.json'}", flush=True)
    finally:
        if client:
            try:
                client.call("Marionette:Quit", flags=["eForceQuit"])
            except Exception:
                pass
            client.socket.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=10)
        server.shutdown()
        for target in [profile, addon]:
            resolved = target.resolve()
            if resolved.parent != run.resolve() or run.resolve().parent != artifacts.resolve() or resolved.name not in ["profile", "addon"]:
                raise RuntimeError("Unexpected disposable directory")
            shutil.rmtree(resolved)


def assert_fixture(case, mode):
    """Characterize current behavior; these are not proposed permission rules."""
    name, events, hits = case["name"], case["events"], case["serverHits"]
    top = [e for e in events if e["event"] == "webRequest.onBeforeRequest" and e["frameId"] == 0]
    assert top and top[0]["hostname"] == "app.localhost"
    assert top[0]["request"] is not None
    if name.startswith("A_"):
        redirects = [e for e in events if e["event"] == "webRequest.onBeforeRedirect"]
        assert redirects[0]["statusCode"] == int(name[2:])
        assert [e["hostname"] for e in top] == ["app.localhost", "auth.localhost", "app.localhost"]
        assert len({e["request"] for e in top}) == 1
    if name in ["history_push", "history_replace", "SPA"]:
        assert len(top) == 1 and any(e["event"] == "webNavigation.onHistoryStateUpdated" for e in events)
    if name == "bookmark":
        assert any(e["transitionType"] == "auto_bookmark" for e in events)
    if name == "iframe":
        assert any(e["type"] == "sub_frame" and e["parentFrameId"] == 0 for e in events)
        assert len(top) == 1
    if mode == "passive":
        return
    decision = case["core"]["latest"]["decision"]
    grey = ["B_href", "B_assign", "B_replace", "B_auto_JS", "E_auto_JS", "auto_POST", "C_POST", "GET_form",
            "JS_submit", "D_link", "E_JS", "F_during", "F_after", "H_SAML_POST", "meta_refresh", "iframe_promote"]
    expected = "GREYLIST" if name in grey else "DENY" if name == "blacklist_HTTP" else "ALLOW"
    assert decision["outcome"] == expected
    if expected != "ALLOW":
        rejected_host = decision["target"]["hostname"]
        assert not any(h["hostname"] == rejected_host and h["fixture"] != "/frame-promote" for h in hits)
    if name in ["G_popup", "blank_link"]:
        assert any(e["event"] == "webNavigation.onCreatedNavigationTarget" for e in events)
        assert not any(h["hostname"] == "auth.localhost" for h in hits)
    if name.startswith("A_") or name == "I_intermediate":
        assert case["core"]["journey"]["endReason"] == "RETURNED"
    if name == "J_canonical":
        assert case["core"]["journey"]["endReason"] == "DESTINATION_CHANGED"
    deadlines = {}
    for entry in case["diagnostics"]:
        journey = entry["journey"]
        if journey:
            assert deadlines.setdefault(journey["id"], journey["expiresAt"]) == journey["expiresAt"]


if __name__ == "__main__":
    try:
        main()
    except Exception as failure:
        import traceback
        frames = traceback.extract_tb(failure.__traceback__)
        own = [frame for frame in frames if Path(frame.filename).name == Path(__file__).name]
        raise SystemExit(f"Investigation failed at line {own[-1].lineno if own else 0} ({type(failure).__name__}); raw errors suppressed.") from None
