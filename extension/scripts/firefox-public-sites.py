"""Optional public sign-in investigation, never an authenticated compatibility test.

Uses a fresh disposable Firefox profile, no credentials, and no raw browser logs.
Only hostname diagnostics and form-presence booleans are retained. The page-specific
selectors below are investigation aids; they never enter the adapter or Core.
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
import time

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("atlas_smoke", Path(__file__).with_name("firefox-e2e.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class PublicClient(smoke.Marionette):
    def call(self, method, **parameters):
        try:
            return super().call(method, **parameters)
        except Exception:
            # WebDriver errors can include live URLs. Never print or retain their text.
            raise RuntimeError(f"Automation command failed: {method}") from None


CASES = [
    ("Ladok / university SSO", "student.ladok.se", "https://student.ladok.se/"),
    ("Google / Gmail", "mail.google.com", "https://mail.google.com/"),
    ("Microsoft / work or school", "myaccount.microsoft.com", "https://myaccount.microsoft.com/"),
    ("ORCID / academic identity", "orcid.org", "https://orcid.org/signin"),
    ("KTH Canvas / university SSO", "canvas.kth.se", "https://canvas.kth.se/"),
]

# Include open shadow roots used by some public institution choosers.
DEEP_QUERY = """
const queryAll = (selector, root = document) => [...root.querySelectorAll(selector),
  ...[...root.querySelectorAll('*')].filter(item => item.shadowRoot).flatMap(item => queryAll(selector, item.shadowRoot))];
"""

# Nothing is typed in an account form. Returned values contain no page text or field values.
PAGE_FACTS = DEEP_QUERY + """
const visible = (item) => item.getClientRects().length > 0;
return {
  hostname: /^https?:$/.test(location.protocol) ? location.hostname : null,
  documentReady: document.readyState === 'complete',
  credentialForm: queryAll('input[type=password], input[type=email], input[autocomplete=username], input#identifierId, input[name=loginfmt]').some(visible),
  institutionSearch: queryAll('input').some(item => visible(item) && /institution|organisation|organization|lärosäte|sök/i.test(item.placeholder)),
  atlasPage: location.protocol === 'moz-extension:',
  browserError: /^about:(neterror|certerror|blocked)/.test(document.documentURI),
  institutionChoiceVisible: queryAll('a, button').some(item => visible(item) && /lärosäte|institution|university|KTH/i.test(item.textContent)),
  loginChoiceVisible: queryAll('a, button').some(item => visible(item) && /logga in|log in|sign in/i.test(item.textContent)),
  visibleInputCount: queryAll('input').filter(visible).length,
  frameCount: queryAll('iframe').length,
  shadowRootCount: [...document.querySelectorAll('*')].filter(item => item.shadowRoot).length
};
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--firefox", default=os.environ.get("FIREFOX_BINARY") or shutil.which("firefox")
                        or r"C:\Program Files\Mozilla Firefox\firefox.exe")
    parser.add_argument("--case", type=int, choices=range(len(CASES)), help="Run one numbered case (0–4)")
    arguments = parser.parse_args()
    artifacts = smoke.EXTENSION.parent / ".tools"
    artifacts.mkdir(exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="firefox-public-", dir=artifacts))
    profile = run / "profile"
    profile.mkdir()
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    preferences = {
        "marionette.port": port, "browser.startup.page": 0, "browser.startup.homepage": "about:blank",
        "browser.aboutwelcome.enabled": False, "browser.shell.checkDefaultBrowser": False,
        "browser.sessionstore.resume_from_crash": False, "datareporting.policy.dataSubmissionEnabled": False,
        "datareporting.healthreport.uploadEnabled": False, "toolkit.telemetry.reportingpolicy.firstRun": False,
        "extensions.webextensions.uuids": json.dumps({smoke.ADDON_ID: smoke.UUID}),
    }
    (profile / "user.js").write_text("\n".join(
        f"user_pref({json.dumps(key)}, {json.dumps(value)});" for key, value in preferences.items()), encoding="utf-8")
    process = subprocess.Popen([arguments.firefox, "-headless", "-no-remote", "-profile", str(profile),
                                "-marionette", "--remote-allow-system-access", "about:blank"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               env={**os.environ, "MOZ_HEADLESS": "1", "MOZ_NO_REMOTE": "1"},
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    client = None
    report = {"scope": "Public pages only; no identifiers, credentials, consent, or authenticated return", "cases": []}
    try:
        def connect():
            if process.poll() is not None:
                raise RuntimeError("Isolated Firefox exited")
            try:
                return PublicClient(port)
            except (ConnectionRefusedError, TimeoutError):
                return None
        client = smoke.wait_for(connect, "Firefox startup", 30)
        report["firefox"] = client.call("WebDriver:NewSession")["capabilities"]["browserVersion"]
        client.call("Addon:Install", path=str(smoke.EXTENSION / "dist"), temporary=True)
        client.call("Marionette:SetContext", value="chrome")
        client.script("""gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });""", smoke.UI_URL)
        client.call("Marionette:SetContext", value="content")
        smoke.wait_for(lambda: client.script("return location.protocol === 'moz-extension:' && document.readyState === 'complete';"), "private UI")
        ui_handle = client.call("WebDriver:GetWindowHandle")
        smoke.wait_for(lambda: client.message({"kind": "GET_VIEW"}).get("view", {}).get("controller", {}).get("status") == "UNINITIALIZED", "initialization")
        policy = {"whitelist": [case[1] for case in CASES], "blacklist": []}
        assert client.message({"kind": "SETUP", "policy": policy})["initialized"]

        def view():
            client.call("WebDriver:SwitchToWindow", handle=ui_handle)
            return client.message({"kind": "GET_VIEW"})["view"]

        for index, (name, root, url) in enumerate(CASES):
            if arguments.case is not None and arguments.case != index:
                continue
            client.call("WebDriver:SwitchToWindow", handle=ui_handle)
            client.message({"kind": "CLEAR_DIAGNOSTICS"})
            handles = client.call("WebDriver:GetWindowHandles")
            opened = client.message({"kind": "OPEN_JOURNEY", "url": url})
            assert opened["result"]["type"] == "COMMITTED"
            tab_id = opened["tabId"]
            handle = smoke.wait_for(lambda: next((item for item in client.call("WebDriver:GetWindowHandles") if item not in handles), None), "site tab")
            observations = []
            actions = []
            facts = {}
            deadline = time.monotonic() + 35
            while time.monotonic() < deadline:
                client.call("WebDriver:SwitchToWindow", handle=handle)
                try:
                    facts = client.script(PAGE_FACTS)
                    if facts not in observations:
                        observations.append(facts)
                    if facts["credentialForm"] or facts["atlasPage"] or facts["browserError"]:
                        break
                    # Public Ladok institution selection only; never click a submit on a credential form.
                    if index == 0 and facts["documentReady"]:
                        action = client.script(DEEP_QUERY + """
                            const visible = (item) => item.getClientRects().length > 0;
                            const links = queryAll('a, button').filter(visible);
                            const kth = links.find(item => /KTH|Kungliga Tekniska högskolan/i.test(item.textContent));
                            if (kth) { kth.click(); return 'selected public KTH entry'; }
                            const search = queryAll('input').find(item => visible(item) && (item.type === 'search'
                                || /institution|organisation|organization|lärosäte|sök|search/i.test([item.placeholder, item.getAttribute('aria-label'), item.id].join(' '))));
                            if (search && search.value !== 'KTH') {
                                search.value = 'KTH'; search.dispatchEvent(new Event('input', { bubbles: true }));
                                search.dispatchEvent(new Event('change', { bubbles: true }));
                                return 'searched public KTH institution';
                            }
                            const login = links.find(item => /lärosäte|institution|university/i.test(item.textContent))
                                ?? links.find(item => /logga in|log in|sign in/i.test(item.textContent));
                            if (login && !arguments[0]) { login.click(); return 'opened public institution login'; }
                            return null;
                        """, len(actions) > 0)
                        if action:
                            actions.append(action)
                except RuntimeError:
                    pass  # Navigation can destroy the old document; no raw exception output.
                time.sleep(0.5)
            current = view()
            context = next((item for item in current["contexts"] if item["tabId"] == tab_id), None)
            snapshot = current["controller"]["snapshot"]
            assert snapshot["policy"] == policy
            assert snapshot["accessState"]["grants"] == []
            entries = client.message({"kind": "GET_DIAGNOSTICS", "tabId": tab_id})["entries"]
            latest = context["latest"] if context else None
            journey = context["journey"] if context else None
            assert journey is not None
            assert all(entry["journey"] is None or entry["journey"]["expiresAt"] == journey["expiresAt"] for entry in entries)
            cancelled_outcome = None
            if latest and latest.get("decision", {}).get("reason") == "ACTIVE_JOURNEY":
                cancelled = client.message({"kind": "CANCEL_JOURNEY", "tabId": tab_id})
                assert cancelled["result"]["type"] == "COMMITTED"
                def removed():
                    state = next((item for item in view()["contexts"] if item["tabId"] == tab_id), None)
                    return state if state and state["effect"] == "REMOVED" else None
                after = smoke.wait_for(removed, "intermediate removal after cancellation")
                cancelled_outcome = after["latest"].get("decision", {}).get("outcome")
                assert cancelled_outcome == "GREYLIST"
            item = {"name": name, "root": root, "observations": observations, "actions": actions,
                    "decision": latest.get("decision") if latest else None, "journey": journey,
                    "policyUnchanged": True, "noGrants": True, "fixedDeadline": True,
                    "afterCancellation": cancelled_outcome, "diagnostics": entries}
            report["cases"].append(item)
            print(json.dumps({"case": name, "lastPage": facts, "core": item["decision"],
                              "journeyPhase": journey["phase"] if journey else None}), flush=True)
            client.script("const done = arguments[arguments.length - 1]; browser.tabs.remove(arguments[0]).then(() => done(true));", tab_id, asynchronous=True)
        (run / "result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Sanitized report: {run / 'result.json'}", flush=True)
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
        # Resolve both targets before removal; never remove an arbitrary/computed ancestor.
        resolved = profile.resolve()
        if resolved.parent != run.resolve() or run.resolve().parent != artifacts.resolve() or resolved.name != "profile":
            raise RuntimeError("Unexpected disposable profile path")
        shutil.rmtree(resolved)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Public-site investigation failed; raw errors suppressed to avoid logging live URLs.") from None
