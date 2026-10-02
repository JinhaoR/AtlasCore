"""Native development smoke test. Python stdlib + installed Firefox; no real accounts.

Uses Mozilla's length-prefixed Marionette protocol in a fresh, headless profile.
The profile and logs remain under the ignored .tools directory for diagnosis.
"""
import argparse
import base64
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


EXTENSION = Path(__file__).resolve().parents[1]
ADDON_ID = "atlas-development@atlas.invalid"
UUID = "85b4a551-0305-4eb5-aac8-8d127445c879"
UI_URL = f"moz-extension://{UUID}/ui/index.html"


class Marionette:
    def __init__(self, port):
        self.socket = socket.create_connection(("127.0.0.1", port), timeout=20)
        self.sequence = 0
        self.receive()  # protocol handshake

    def receive(self):
        length = b""
        while not length.endswith(b":"):
            part = self.socket.recv(1)
            if not part:
                raise RuntimeError("Firefox closed the automation connection")
            length += part
        payload = b""
        size = int(length[:-1])
        while len(payload) < size:
            part = self.socket.recv(size - len(payload))
            if not part:
                raise RuntimeError("Incomplete Firefox response")
            payload += part
        return json.loads(payload)

    def call(self, method, **parameters):
        self.sequence += 1
        data = json.dumps([0, self.sequence, method, parameters]).encode()
        self.socket.sendall(str(len(data)).encode() + b":" + data)
        _, identity, error, result = self.receive()
        assert identity == self.sequence
        if error:
            raise RuntimeError(f"{method}: {error['error']}: {error['message']}")
        return result["value"] if isinstance(result, dict) and set(result) == {"value"} else result

    def script(self, script, *args, asynchronous=False):
        result = self.call("WebDriver:ExecuteAsyncScript" if asynchronous else "WebDriver:ExecuteScript",
                           script=script, args=list(args), sandbox=None, newSandbox=False,
                           scriptTimeout=15000, filename="atlas-smoke", line=1)
        return result

    def message(self, command):
        return self.script("""
            const [command, done] = arguments;
            browser.runtime.sendMessage(command).then(done, () => done({error: 'MESSAGE_FAILED'}));
        """, command, asynchronous=True)


def wait_for(predicate, description, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(f"Timed out: {description}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--firefox", default=os.environ.get("FIREFOX_BINARY") or shutil.which("firefox")
                        or r"C:\Program Files\Mozilla Firefox\firefox.exe")
    parser.add_argument("--existing-policy", action="store_true", help="Exercise reload and explicit Vault upgrade from an older saved policy")
    parser.add_argument("--productization", action="store_true", help="Add native badge/search/protected settings and schema migration checks")
    parser.add_argument("--productization-only", action="store_true", help="Run the isolated D19 checks after fresh setup")
    parser.add_argument("--journey-retry-only", action="store_true", help="Run Journey interruption/retry and visibility checks")
    parser.add_argument("--journey-probe", action="store_true", help="Record pre-fix Journey interruption behavior")
    arguments = parser.parse_args()
    if not Path(arguments.firefox).is_file():
        raise SystemExit("Firefox not found. Set FIREFOX_BINARY or pass --firefox.")
    if not (EXTENSION / "dist/manifest.json").is_file():
        raise SystemExit("Build the extension first: npm --prefix extension run build")
    artifacts = EXTENSION.parent / ".tools"
    artifacts.mkdir(exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="firefox-e2e-", dir=artifacts))
    profile = run / "profile"
    profile.mkdir()
    hits = []

    class Pages(BaseHTTPRequestHandler):
        def do_GET(self):
            host = self.headers.get("Host", "").split(":")[0]
            hits.append((host, self.path))
            port = server.server_port
            if self.path == '/atlas-site-icon.svg':
                self.send_response(200)
                self.send_header('Content-Type', 'image/svg+xml')
                self.end_headers()
                self.wfile.write(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#405b68"/><circle cx="16" cy="16" r="7" fill="#faf7f0"/></svg>')
                return
            redirects = {
                ("root.localhost", "/begin-login"): f"http://login.localhost:{port}/",
                ("login.localhost", "/choose"): f"http://root.localhost:{port}/bounce",
                ("root.localhost", "/bounce"): f"http://identity.localhost:{port}/",
                ("identity.localhost", "/finish"): f"http://root.localhost:{port}/complete",
            }
            if arguments.journey_retry_only:
                redirects[("root.localhost", "/")] = f"http://login.localhost:{port}/"
            if (host, self.path) in redirects:
                self.send_response(302)
                self.send_header("Location", redirects[(host, self.path)])
                self.end_headers()
                return
            links = {
                "root.localhost": ("login", f"http://root.localhost:{port}/begin-login", "Choose login"),
                "login.localhost": ("identity", f"http://login.localhost:{port}/choose", "Choose identity"),
                "identity.localhost": ("finish", f"http://identity.localhost:{port}/finish", "Finish"),
            }
            link = links.get(host)
            body = f'<!doctype html><title>{host}</title><link rel="icon" type="image/svg+xml" href="/atlas-site-icon.svg"><h1>{host}</h1>'
            if arguments.journey_retry_only and host == 'login.localhost':
                body += '<form id="synthetic-login" style="position:absolute;left:25%;top:25%;width:40%;height:120px"><label>Synthetic identity<input name="identity"></label><button type="button">Continue</button></form>'
            if link:
                body += f'<a id="{link[0]}" href="{link[1]}">{link[2]}</a>'
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "max-age=120" if arguments.journey_retry_only else "no-store")
            self.end_headers()
            self.wfile.write(body.encode())

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port
    secure_server = None
    if arguments.journey_retry_only:
        # Exercise the actual Home cards/search (HTTPS root, port 443), without changing
        # their URL or intercepting Core. Certificate exceptions are profile-local test setup.
        openssl = shutil.which('openssl') or r'C:\Program Files\Git\usr\bin\openssl.exe'
        subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=root.localhost', '-addext', 'subjectAltName=DNS:root.localhost',
                        '-keyout', str(run / 'fixture.key'), '-out', str(run / 'fixture.crt')],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        secure_server = ThreadingHTTPServer(('127.0.0.1', 443), Pages)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(run / 'fixture.crt', run / 'fixture.key')
        secure_server.socket = tls.wrap_socket(secure_server.socket, server_side=True)
        threading.Thread(target=secure_server.serve_forever, daemon=True).start()
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        marionette_port = reservation.getsockname()[1]
    preferences = {
        "marionette.port": marionette_port,
        "browser.startup.page": 0,
        "browser.startup.homepage": "about:blank",
        "browser.aboutwelcome.enabled": False,
        "browser.shell.checkDefaultBrowser": False,
        "browser.sessionstore.resume_from_crash": False,
        "datareporting.policy.dataSubmissionEnabled": False,
        "datareporting.healthreport.uploadEnabled": False,
        "toolkit.telemetry.reportingpolicy.firstRun": False,
        "extensions.webextensions.uuids": json.dumps({ADDON_ID: UUID}),
    }
    (profile / "user.js").write_text("\n".join(
        f"user_pref({json.dumps(key)}, {json.dumps(value)});" for key, value in preferences.items()), encoding="utf-8")
    log = (run / "firefox.log").open("w", encoding="utf-8")
    environment = {**os.environ, "MOZ_HEADLESS": "1", "MOZ_NO_REMOTE": "1"}
    process = subprocess.Popen([arguments.firefox, "-headless", "-no-remote", "-profile", str(profile),
                                "-marionette", "--remote-allow-system-access", "about:blank"], stdout=log, stderr=log, env=environment,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    client = None
    try:
        def connect():
            if process.poll() is not None:
                raise RuntimeError(f"Firefox exited with {process.returncode}; see {run}")
            try:
                return Marionette(marionette_port)
            except (ConnectionRefusedError, TimeoutError):
                return None
        client = wait_for(connect, "Firefox automation startup", 30)
        session = client.call("WebDriver:NewSession", acceptInsecureCerts=True) if arguments.journey_retry_only else client.call("WebDriver:NewSession")
        if arguments.journey_retry_only:
            assert session['capabilities']['acceptInsecureCerts'], 'synthetic HTTPS fixture capability'
        version = session["capabilities"]["browserVersion"]
        client.call("WebDriver:SetWindowRect", width=1280, height=1100)
        client.call("Addon:Install", path=str(EXTENSION / "dist"), temporary=True)
        handles = client.call("WebDriver:GetWindowHandles")
        client.call("WebDriver:SwitchToWindow", handle=handles[-1])
        # WebDriver forbids content-context navigation to privileged extension URLs.
        # Open it through Firefox chrome, as the toolbar would, then return to content.
        client.call("Marionette:SetContext", value="chrome")
        client.script("""
            gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {
                triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
            });
        """, UI_URL)
        client.call("Marionette:SetContext", value="content")
        wait_for(lambda: client.script("return location.href === arguments[0] && document.readyState === 'complete';", UI_URL), "extension UI")
        ui_handle = client.call("WebDriver:GetWindowHandle")
        wait_for(lambda: client.message({"kind": "GET_VIEW"}).get("view", {}).get("controller"), "Core startup")
        assert client.script("return document.getElementById('use-defaults').checked;"), "preset offered by default"
        assert client.script("return document.querySelectorAll('#preset-preview details').length;") == 7
        if arguments.existing_policy:
            client.script("document.getElementById('use-defaults').checked = false;")
        client.script("""
            document.getElementById('whitelist').value = arguments[0];
            document.getElementById('blacklist').value = arguments[1];
            document.getElementById('setup-form').requestSubmit();
        """, "root.localhost", "black.localhost")
        wait_for(lambda: client.message({"kind": "GET_VIEW"})["view"]["controller"]["status"] == "READY", "setup form save")
        initial = client.message({"kind": "GET_VIEW"})["view"]["controller"]
        assert initial["status"] == "READY", initial
        policy = initial["snapshot"]["policy"]
        # Settle the one startup refresh before testing ordered navigation effects.
        wait_for(lambda: client.message({"kind": "GET_VIEW"})["view"].get("managed", {}).get("updateStatus") != "UPDATING",
                 "startup managed refresh", 40)
        managed = client.message({"kind": "GET_VIEW"})["view"]["managed"]
        assert managed["active"] and managed["count"] >= 100000, managed
        assert managed["categories"] == ["base", "fakenews", "gambling", "porn", "social"]
        if arguments.existing_policy:
            assert policy == {"whitelist": ["root.localhost"], "blacklist": ["black.localhost"]}
            spare_id = client.script("""
                const done = arguments[arguments.length - 1];
                browser.tabs.create({url: 'about:blank', active: false}).then(tab => done(tab.id));
            """, asynchronous=True)
            client.script("setTimeout(() => browser.runtime.reload(), 0); return true;")
            wait_for(lambda: ui_handle not in client.call("WebDriver:GetWindowHandles"), "old UI closes for preset upgrade reload")
            client.call("WebDriver:SwitchToWindow", handle=client.call("WebDriver:GetWindowHandles")[0])
            client.call("Marionette:SetContext", value="chrome")
            client.script("gBrowser.selectedTab = gBrowser.addTrustedTab(arguments[0]);", UI_URL)
            client.call("Marionette:SetContext", value="content")
            ui_handle = client.call("WebDriver:GetWindowHandles")[-1]
            client.call("WebDriver:SwitchToWindow", handle=ui_handle)
            wait_for(lambda: client.script("return location.href === arguments[0] && document.readyState === 'complete';", UI_URL), "upgrade UI after reload")
            wait_for(lambda: client.message({"kind": "GET_VIEW"}).get("view", {}).get("controller", {}).get("status") == "READY", "existing policy recovered")
            client.script("""
                const done = arguments[arguments.length - 1]; browser.tabs.remove(arguments[0]).then(() => done(true));
            """, spare_id, asynchronous=True)
            assert client.message({"kind": "GET_VIEW"})["view"]["controller"]["snapshot"]["policy"] == policy
            wait_for(lambda: client.script("return document.getElementById('propose-defaults')?.hidden === false && !document.getElementById('propose-defaults').disabled;"), "preset upgrade button")
            client.script("document.getElementById('show-settings').click(); document.getElementById('propose-defaults').closest('details').open = true; document.getElementById('propose-defaults').click();")
            def proposal():
                return client.message({"kind": "GET_VIEW"})["view"]["controller"]["snapshot"]["vaultState"]["pendingProposal"]
            frozen = wait_for(proposal, "frozen preset proposal")
            assert frozen["candidatePolicy"]["blacklist"] == policy["blacklist"]
            assert client.message({"kind": "CONFIRM_POLICY", "proposalId": frozen["id"]})["result"]["reason"] == "NOT_READY"
            wait_for(lambda: client.script("return document.getElementById('vault-review').textContent.includes('chatgpt.com') && document.getElementById('vault-deadline').textContent.startsWith('Vault wait ');"), "visible frozen review and Vault wait")
            print("PASS reload retained old policy; preset proposal/review did not change permission", flush=True)
            wait_for(lambda: client.script("return document.getElementById('confirm-policy').hidden === false && !document.getElementById('confirm-policy').disabled;"), "Vault readiness", 40)
            assert client.message({"kind": "GET_VIEW"})["view"]["controller"]["snapshot"]["policy"] == policy
            client.script("document.getElementById('confirm-policy').click();")
            wait_for(lambda: proposal() is None, "preset confirmation persisted")
            updated = client.message({"kind": "GET_VIEW"})["view"]["controller"]["snapshot"]
            assert updated["policyRevision"] == 1
            policy = updated["policy"]
            assert client.message({"kind": "CONFIRM_POLICY", "proposalId": frozen["id"]})["result"]["type"] == "REJECTED"
            print("PASS explicit native Vault confirmation saved curated defaults and retained manual Blacklist", flush=True)
        assert len(policy["whitelist"]) == 52
        assert {"root.localhost", "chatgpt.com", "www.youtube.com", "canvas.kth.se"} <= set(policy["whitelist"])
        assert "google.com" not in policy["whitelist"] and "www.google.com" not in policy["whitelist"]
        assert policy["blacklist"] == ["black.localhost"]
        print(f"Firefox {version}: curated setup, real IndexedDB, managed list active ({managed['count']} domains)", flush=True)
        if arguments.journey_retry_only or arguments.journey_probe:
            from firefox_journey_retry import run_journey_retry
            result = run_journey_retry(client, ui_handle, UI_URL, port, wait_for, hits, run, probe=arguments.journey_probe)
            (run / 'result.json').write_text(json.dumps({'firefox': version, **result}, indent=2), encoding='utf-8')
            print(f'Artifacts: {run}', flush=True)
            return
        if arguments.productization_only:
            from firefox_productization import run_productization
            ui_handle, product = run_productization(client, ui_handle, UI_URL, port, wait_for, run)
            (run / 'result.json').write_text(json.dumps({'firefox': version, 'productization': product}, indent=2), encoding='utf-8')
            for surface in ['home', 'settings']:
                client.script(f"document.getElementById('show-{surface}').click();")
                shot = client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=True)
                (run / f'{surface}.png').write_bytes(base64.b64decode(shot))
            print(f'Artifacts: {run}', flush=True)
            return

        denied_id = client.script("""
            const done = arguments[arguments.length - 1];
            browser.tabs.create({url: 'http://doubleclick.net/atlas-synthetic-denial', active: false}).then(tab => done(tab.id));
        """, asynchronous=True)
        def managed_denied():
            current = client.message({"kind": "GET_VIEW"})["view"]
            return next((context for context in current["contexts"] if context["tabId"] == denied_id
                         and context["effect"] == "REMOVED"), None)
        denied = wait_for(managed_denied, "native managed denial")
        assert denied["latest"]["decision"]["reason"] == "MANAGED_BLACKLISTED", denied
        assert client.message({"kind": "START_ACCESS", "tabId": denied_id})["result"]["reason"] == "MANAGED_BLACKLISTED"
        client.script("""
            const done = arguments[arguments.length - 1]; browser.tabs.remove(arguments[0]).then(() => done(true));
        """, denied_id, asynchronous=True)
        print("PASS native managed denial and blocked Greylist request", flush=True)

        def client_view():
            client.call("WebDriver:SwitchToWindow", handle=ui_handle)
            return client.message({"kind": "GET_VIEW"})["view"]

        # Real chrome-driven ordinary/new-tab and address-bar navigation use the same gate.
        for origin in ["ordinary", "typed"]:
            client.call("Marionette:SetContext", value="chrome")
            client.script("gBrowser.selectedTab = gBrowser.addTrustedTab('about:blank');")
            client.call("Marionette:SetContext", value="content")
            ordinary_handle = client.call("WebDriver:GetWindowHandles")[-1]
            if origin == "typed":
                client.call("Marionette:SetContext", value="chrome")
                client.script("gURLBar.value = arguments[0]; gURLBar.handleCommand();", f"http://root.localhost:{port}/begin-login")
                client.call("Marionette:SetContext", value="content")
            else:
                client.call("WebDriver:SwitchToWindow", handle=ordinary_handle)
                client.call("WebDriver:Navigate", url=f"http://root.localhost:{port}/begin-login")
            context = wait_for(lambda: next((c for c in client_view()["contexts"] if c["displayedHostname"] == "login.localhost"), None),
                               f"{origin} Whitelist authentication redirect")
            assert context["journey"]["rootHostname"] == "root.localhost"
            assert context["journey"]["phase"] == "IN_TRANSIT"
            assert context["latest"]["decision"]["reason"] == "ACTIVE_JOURNEY"
            assert client_view()["controller"]["snapshot"]["accessState"]["grants"] == []
            # Actual address-bar unrelated navigation must not contact the destination.
            before_hits = len(hits)
            client.call("WebDriver:SwitchToWindow", handle=ordinary_handle)
            client.call("Marionette:SetContext", value="chrome")
            client.script("gURLBar.value = arguments[0]; gURLBar.handleCommand();", f"http://unrelated.localhost:{port}/typed")
            client.call("Marionette:SetContext", value="content")
            stopped = wait_for(lambda: next((c for c in client_view()["contexts"] if c["tabId"] == context["tabId"]
                                            and c["hostname"] == "unrelated.localhost" and c["effect"] == "REMOVED"), None),
                               "typed unrelated destination denied")
            assert stopped["latest"]["decision"]["outcome"] == "GREYLIST"
            assert stopped["journey"]["endReason"] == "UNRELATED_NAVIGATION"
            assert ("unrelated.localhost", "/typed") not in hits[before_hits:]
            client.script("const done = arguments[arguments.length - 1]; browser.tabs.remove(arguments[0]).then(() => done(true));",
                          context["tabId"], asynchronous=True)
        print("PASS ordinary/new-tab and actual address-bar Whitelist redirects; typed unrelated target denied without server contact", flush=True)

        opened = client.message({"kind": "OPEN_JOURNEY", "url": f"http://root.localhost:{port}/"})
        assert opened["result"]["type"] == "COMMITTED", opened
        tab_id = opened["tabId"]
        journey_context = next(c["contextId"] for c in opened["view"]["contexts"] if c["tabId"] == tab_id)
        journey_handle = wait_for(lambda: next((handle for handle in client.call("WebDriver:GetWindowHandles")
                                                if handle != ui_handle), None), "Journey tab")

        def view():
            client.call("WebDriver:SwitchToWindow", handle=ui_handle)
            return client.message({"kind": "GET_VIEW"})["view"]

        def journey():
            return next(item for item in view()["controller"]["snapshot"]["journeyState"]["journeys"]
                        if item["contextId"] == journey_context)

        def displayed(host):
            return any(context["tabId"] == tab_id and context["displayedHostname"] == host
                       for context in view()["contexts"])

        def click(identity):
            client.call("WebDriver:SwitchToWindow", handle=journey_handle)
            wait_for(lambda: client.script("return !!document.getElementById(arguments[0]);", identity), "fixture control ready")
            client.script("document.getElementById(arguments[0]).click();", identity)

        wait_for(lambda: displayed("root.localhost"), "root page arrival")
        client.script("""
            const select = document.getElementById('context'); select.value = String(arguments[0]);
            select.dispatchEvent(new Event('change'));
        """, tab_id)
        assert journey()["endReason"] == "REACHED", journey()
        click("login")
        wait_for(lambda: displayed("login.localhost"), "provider page arrival")
        first = journey()
        assert first["phase"] == "IN_TRANSIT", first
        assert first["hopCount"] == 1
        click("identity")
        wait_for(lambda: displayed("identity.localhost"), "identity page after HTTP redirect")
        intermediate = journey()
        assert intermediate["phase"] == "IN_TRANSIT"
        assert intermediate["hopCount"] == 2
        assert intermediate["expiresAt"] == first["expiresAt"]
        click("finish")
        wait_for(lambda: journey()["endReason"] == "RETURNED" and displayed("root.localhost"), "return completes Journey and root document arrives")
        snapshot = view()["controller"]["snapshot"]
        assert snapshot["policy"] == policy
        assert snapshot["accessState"]["grants"] == []
        assert journey()["expiresAt"] == first["expiresAt"]
        print("PASS root -> provider -> root redirect -> identity -> root; fixed deadline, no policy/grant changes", flush=True)

        counts = len(hits)
        client.call("WebDriver:SwitchToWindow", handle=journey_handle)
        client.script("location.href = arguments[0];", f"http://identity.localhost:{port}/after")
        wait_for(lambda: any(context["tabId"] == tab_id and context["hostname"] == "identity.localhost"
                            and context["effect"] == "REMOVED" and context["latest"]["type"] == "ASSESSMENT"
                            and context["latest"]["decision"]["outcome"] == "GREYLIST"
                            for context in view()["contexts"]), "post-Journey Greylist UI")
        assert ("identity.localhost", "/after") not in hits[counts:]
        selected = next(context for context in view()["contexts"] if context["tabId"] == tab_id)
        assert selected["latest"]["decision"]["outcome"] == "GREYLIST", selected
        print("PASS intermediate access ends; independent server saw no denied /after request", flush=True)

        # Exercise real UI actions. Time availability alone must leave the page blocked.
        client.call("WebDriver:SwitchToWindow", handle=journey_handle)
        wait_for(lambda: client.script("return document.getElementById('start-access')?.hidden === false;"), "request button")
        client.script("document.getElementById('start-access').click();")
        request = wait_for(lambda: next((item for item in view()["controller"]["snapshot"]["accessState"]["pendingRequests"]
                                        if item["hostname"] == "identity.localhost"), None), "request saved from UI")
        request_id = request["id"]
        early = client.message({"kind": "CONFIRM_ACCESS", "requestId": request_id})
        assert early["result"]["reason"] == "NOT_READY"
        client.call("WebDriver:SwitchToWindow", handle=journey_handle)
        wait_for(lambda: client.script("return document.getElementById('deadline').textContent.startsWith('Wait ');"), "visible countdown")
        client.script("document.getElementById('context').focus();")
        wait_for(lambda: client.script("return document.getElementById('status').textContent.includes('Atlas is ready');"), "verified waiting view")
        mutations = client.script("""
            const done = arguments[arguments.length - 1];
            const count = {major: 0, controls: 0, countdown: 0};
            const observers = [];
            for (const id of ['status', 'access-title', 'access-description', 'destination-list']) {
                const observer = new MutationObserver(records => { count.major += records.length; });
                observer.observe(document.getElementById(id), {childList: true, characterData: true, subtree: id !== 'destination-list'});
                observers.push(observer);
            }
            const buttons = new MutationObserver(records => { count.controls += records.length; });
            buttons.observe(document.getElementById('access-panel'), {subtree: true, attributes: true, attributeFilter: ['disabled']});
            observers.push(buttons);
            const clock = new MutationObserver(records => { count.countdown += records.length; });
            clock.observe(document.getElementById('deadline'), {childList: true, subtree: true, characterData: true});
            observers.push(clock);
            setTimeout(() => { observers.forEach(observer => observer.disconnect()); done(count); }, 2500);
        """, asynchronous=True)
        assert mutations["major"] == 0 and mutations["controls"] == 0, mutations
        assert mutations["countdown"] > 0, mutations
        assert client.script("return document.activeElement.id === 'context';"), "polling must preserve focus"
        print("PASS countdown updates without replacing destination rows or blinking headings/buttons", flush=True)
        shot = client.call("WebDriver:TakeScreenshot", id=None, highlights=[], full=True)
        (run / "waiting.png").write_bytes(base64.b64decode(shot))
        wait_for(lambda: next(context for context in view()["contexts"] if context["tabId"] == tab_id)
                 ["latest"].get("decision", {}).get("outcome") == "REQUIRE_CONFIRMATION", "Access cooldown", 15)
        assert view()["controller"]["snapshot"]["accessState"]["grants"] == []
        client.call("WebDriver:SwitchToWindow", handle=journey_handle)
        wait_for(lambda: client.script("return document.getElementById('confirm-access')?.hidden === false && !document.getElementById('confirm-access').disabled;"), "confirmation button")
        client.script("document.getElementById('confirm-access').click();")
        wait_for(lambda: displayed("identity.localhost"), "saved confirmation opens homepage")
        assert client.message({"kind": "CONFIRM_ACCESS", "requestId": request_id})["result"]["type"] == "REJECTED"
        assert ("identity.localhost", "/after") not in hits[counts:]
        client.script("document.getElementById('show-diagnostics').click();")
        wait_for(lambda: client.script("return document.querySelectorAll('#diagnostic-rows tr').length > 0;"), "visible diagnostics")
        entries = client.message({"kind": "GET_DIAGNOSTICS", "tabId": tab_id})["entries"]
        assert any(item["event"] == "REDIRECT" and item["hostname"] == "identity.localhost" for item in entries)
        assert all('url' not in item for item in entries)
        print("PASS native UI: countdown, focus, explicit Confirm and open, duplicate rejection, diagnostics", flush=True)

        # Keep the selected identity after closure; never target another live tab silently.
        extra = client.message({"kind": "OPEN_JOURNEY", "url": f"http://root.localhost:{port}/"})
        extra_id = extra["tabId"]
        wait_for(lambda: client.script("return [...document.getElementById('context').options].some(item => item.value === String(arguments[0]));", extra_id), "new context option")
        client.script("""
            const select = document.getElementById('context'); select.value = String(arguments[0]);
            select.dispatchEvent(new Event('change'));
            const done = arguments[arguments.length - 1]; browser.tabs.remove(arguments[0]).then(() => done(true));
        """, extra_id, asynchronous=True)
        wait_for(lambda: client.script("return document.getElementById('hostname').textContent === 'Tab unavailable';"), "closed selected context")
        assert client.script("return document.getElementById('context').value === String(arguments[0]);", extra_id)
        assert client.script("return document.getElementById('confirm-access').hidden && document.getElementById('open-home').hidden;")
        print("PASS closed tab remains selected without transferring actions to another context", flush=True)

        # Keep both a grant and a pending request across a real background reload.
        client.call("WebDriver:SwitchToWindow", handle=journey_handle)
        client.script("location.href = arguments[0];", f"http://unknown.localhost:{port}/")
        wait_for(lambda: any(context["tabId"] == tab_id and context["hostname"] == "unknown.localhost"
                            and context["effect"] == "REMOVED" for context in view()["contexts"]), "second Greylist page")
        assert client.message({"kind": "START_ACCESS", "tabId": tab_id})["result"]["type"] == "COMMITTED"
        active = client.message({"kind": "OPEN_JOURNEY", "url": f"http://root.localhost:{port}/begin-login"})
        assert active["result"]["type"] == "COMMITTED"
        wait_for(lambda: any(c["tabId"] == active["tabId"] and c["displayedHostname"] == "login.localhost"
                             for c in view()["contexts"]), "active Journey before reload")
        saved = view()["controller"]["snapshot"]
        client.script("setTimeout(() => browser.runtime.reload(), 0); return true;")
        # Firefox closes extension UI tabs on reload. Reopen the private UI through chrome;
        # its old WebDriver handle is deliberately not treated as a surviving context.
        wait_for(lambda: ui_handle not in client.call("WebDriver:GetWindowHandles"), "old UI closes on reload")
        client.call("Marionette:SetContext", value="chrome")
        client.script("gBrowser.selectedTab = gBrowser.addTrustedTab(arguments[0]);", UI_URL)
        client.call("Marionette:SetContext", value="content")
        ui_handle = client.call("WebDriver:GetWindowHandles")[-1]
        client.call("WebDriver:SwitchToWindow", handle=ui_handle)
        wait_for(lambda: client.script("return location.href === arguments[0] && document.readyState === 'complete';", UI_URL), "reopened UI")

        def recovered():
            try:
                current = view()["controller"]
                if current is None or current["status"] != "READY":
                    return None
                records = current["snapshot"]["journeyState"]["journeys"]
                return current if any(item["id"] == active["result"]["referenceId"]
                                      and item["endReason"] == "CONTEXT_CLOSED" for item in records) else None
            except RuntimeError:
                return None
        restored = wait_for(recovered, "background restart reconciliation", 20)["snapshot"]
        assert restored["accessState"]["grants"] == saved["accessState"]["grants"]
        assert restored["accessState"]["pendingRequests"] == saved["accessState"]["pendingRequests"]
        assert restored["policy"] == policy
        assert view()["managed"]["active"] and view()["managed"]["origin"] == "CACHE"
        assert view()["managed"]["lastAttemptAt"] == managed["lastAttemptAt"]
        print("PASS real background reload: pending/grant deadlines preserved; old Journey binding ended", flush=True)
        client.call("WebDriver:SwitchToWindow", handle=ui_handle)
        wait_for(lambda: client.script("return document.querySelectorAll('#destination-list .service-group').length === 7 && document.getElementById('managed-status').textContent.startsWith('Status: active');"),
                 "restored curated groups and managed status in UI")
        shot = client.call("WebDriver:TakeScreenshot", id=None, highlights=[], full=True)
        (run / "ui.png").write_bytes(base64.b64decode(shot))
        report = {"firefox": version, "journey": journey(), "requests": hits, "managed": view()["managed"],
                  "checks": ["curated initialization UI", "managed denial", "managed cache restart", "journey", "redirect", "greylist", "confirmation UI", "focus retention", "diagnostics UI", "closed-tab selection", "request withholding", "background restart"]}
        if arguments.existing_policy:
            report["checks"].remove("curated initialization UI")
            report["checks"].extend(["existing policy reload", "preset Vault review", "preset Vault confirmation"])
        if arguments.productization:
            from firefox_productization import run_productization
            ui_handle, report["productization"] = run_productization(client, ui_handle, UI_URL, port, wait_for, run)
            client.call("WebDriver:SwitchToWindow", handle=ui_handle)
            shot = client.call("WebDriver:TakeScreenshot", id=None, highlights=[], full=True)
            (run / "home.png").write_bytes(base64.b64decode(shot))
            client.script("document.getElementById('show-settings').click();")
            shot = client.call("WebDriver:TakeScreenshot", id=None, highlights=[], full=True)
            (run / "settings.png").write_bytes(base64.b64decode(shot))
        (run / "result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Artifacts: {run}", flush=True)
    except Exception:
        if client is not None:
            try:
                client.call("WebDriver:SwitchToWindow", handle=journey_handle)
                print("Fixture UI state:", json.dumps(client.script("""
                    return { status: document.getElementById('status')?.textContent,
                        selected: document.getElementById('context')?.value,
                        confirmHidden: document.getElementById('confirm-access')?.hidden,
                        confirmDisabled: document.getElementById('confirm-access')?.disabled,
                        feedback: document.getElementById('feedback')?.textContent };
                """)), flush=True)
                client.call("WebDriver:SwitchToWindow", handle=ui_handle)
                diagnostic = client.message({"kind": "GET_VIEW"})
                print("Last adapter view:", json.dumps(diagnostic), flush=True)
                print("Fixture server requests:", json.dumps(hits), flush=True)
            except Exception:
                pass
        raise
    finally:
        if client is not None:
            try:
                client.call("Marionette:Quit", flags=["eForceQuit"])
            except (OSError, RuntimeError, ValueError):
                pass
            client.socket.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=10)
        server.shutdown()
        if secure_server is not None:
            secure_server.shutdown()
        log.close()


if __name__ == "__main__":
    main()
