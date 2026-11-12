"""Synthetic Firefox tabs.update rejection and real Core-gated UI retry.

Run using firefox_compact_home.py --navigation-failure-only. Injection is confined
to that harness's disposable background; it does not prove the user's browser cause.
"""
import threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def verify(c, h, shot):
    hits = []
    class Page(BaseHTTPRequestHandler):
        def do_GET(self):
            hits.append(self.headers.get('Host', '').split(':')[0])
            body = b'<!doctype html><title>Navigation retry fixture</title><h1>Allowed page</h1>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers(); self.wfile.write(body)
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Page)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port
    ui = c.call('WebDriver:GetWindowHandle')
    def view(): return c.message({'kind': 'GET_VIEW'})['view']
    def context(tab): return next((x for x in view()['contexts'] if x['tabId'] == tab), None)
    def background(script, *args):
        return c.script('''const [values,done]=arguments;browser.runtime.getBackgroundPage().then(window=>{
          try{done((function(args){''' + script + '''})(values));}catch{done({fixtureError:true});}
          },()=>done({fixtureError:true}));''', list(args), asynchronous=True)
    checks = []
    grey_tab = None
    try:
        policy = view()['controller']['snapshot']['policy']
        policy['whitelist'].append('www.video.localhost')
        policy['blacklist'].append('denied.localhost')
        h.configure_policy(c, policy)
        saved = view()['controller']['snapshot']
        assert background('''window.__navigationProbe={update:window.browser.tabs.update,host:null};
          window.browser.tabs.update=function(id,change){const p=window.__navigationProbe;
            if(change?.url && new URL(change.url).hostname===p.host){p.host=null;
              return window.Promise.reject(new Error('synthetic private browser rejection'));}
            return p.update.call(this,id,change);};return true;''') is True
        for host, outcome in [('video.localhost', 'GREYLIST'), ('denied.localhost', 'DENY'), ('www.video.localhost', 'ALLOW')]:
            assert background('window.__navigationProbe.host=args[0];return true;', host) is True
            tab = c.message({'kind': 'OPEN_DESTINATION', 'url': f'http://{host}:{port}/private?not-logged=1'})['tabId']
            c.call('WebDriver:SwitchToWindow', handle=ui)
            h.wait_for(lambda: (x := context(tab)) and (x.get('latest') or {}).get('reason') == 'NAVIGATION_FAILED', 'rejected browser effect')
            assert context(tab)['navigationId'] == 0
            c.call('WebDriver:Navigate', url=h.UI_URL + f'?view=access&tab={tab}')
            h.wait_for(lambda: c.script('return document.getElementById("access-title").textContent === "The site did not open" && !document.getElementById("open-home").hidden && !document.getElementById("open-home").disabled;'), 'truthful error and retry')
            assert c.script('return document.getElementById("outcome").textContent;') == 'Navigation failed'
            if host == 'video.localhost':
                grey_tab = tab
                shot('navigation-failed')
                # Failed authority reads cannot make the retry actionable.
                c.script('window.__send=browser.runtime.sendMessage;browser.runtime.sendMessage=async function(m,...rest){const r=await window.__send.call(this,m,...rest);if(m.kind==="GET_VIEW"&&r.view?.controller)r.view.controller.status="UNAVAILABLE";return r;};')
                h.wait_for(lambda: c.script('return document.getElementById("open-home").disabled && document.getElementById("access-title").textContent === "Waiting for verified state";'), 'unavailable disables retry')
                c.script('browser.runtime.sendMessage=window.__send;')
                h.wait_for(lambda: c.script('return !document.getElementById("open-home").disabled;'), 'verified query restored')
            c.script('document.getElementById("open-home").click();')
            h.wait_for(lambda: (x := context(tab)) and (x.get('latest') or {}).get('decision', {}).get('outcome') == outcome, 'retry goes through Core')
            if outcome == 'ALLOW': h.wait_for(lambda: host in hits, 'authorized server receives request')
            else:
                h.wait_for(lambda: context(tab)['effect'] == 'REMOVED', 'nonallowed page removed')
                assert host not in hits
                if outcome == 'GREYLIST':
                    h.wait_for(lambda: c.script('return !document.getElementById("start-access").hidden;'), 'existing Greylist workflow shown')
                    shot('retry-greylist')
            checks.append({'host': host, 'retryOutcome': outcome})
            current = view()['controller']['snapshot']
            for key in ['policy', 'policyRevision', 'configuration', 'configurationRevision']:
                assert current[key] == saved[key], key
            for key in ['pendingRequests', 'grants', 'nextRequestId', 'policyRevision']:
                assert current['accessState'][key] == saved['accessState'][key], key
            # Real time advances normally; that observation is not a permission change.
            assert current['accessState']['lastObservedAt'] >= saved['accessState']['lastObservedAt']

        # Match the user's clarification: temporary permission already exists
        # when a later browser launch fails. Retry must use its original terms.
        prepared = c.message({'kind': 'PREPARE_ACCESS', 'tabId': grey_tab})
        scope = next(x['accessScope'] for x in prepared['view']['contexts'] if x['tabId'] == grey_tab)
        assert c.message({'kind': 'START_ACCESS', 'tabId': grey_tab, 'scopeId': scope['id']})['result']['type'] == 'COMMITTED'
        request = view()['controller']['snapshot']['accessState']['pendingRequests'][-1]
        h.wait_for(lambda: time.time()*1000 >= request['readyAt'], 'real Greylist wait', 20)
        assert c.message({'kind': 'CONFIRM_ACCESS', 'requestId': request['id']})['result']['type'] == 'COMMITTED'
        grant = view()['controller']['snapshot']['accessState']['grants'][-1]
        assert background('window.__navigationProbe.host="video.localhost";return true;') is True
        tab = c.message({'kind': 'OPEN_DESTINATION', 'url': f'http://video.localhost:{port}/'})['tabId']
        c.call('WebDriver:SwitchToWindow', handle=ui)
        h.wait_for(lambda: (x := context(tab)) and (x.get('latest') or {}).get('reason') == 'NAVIGATION_FAILED', 'failed launch with active grant')
        c.call('WebDriver:Navigate', url=h.UI_URL + f'?view=access&tab={tab}')
        h.wait_for(lambda: c.script('return !document.getElementById("open-home").hidden && !document.getElementById("open-home").disabled;'), 'granted-site retry')
        c.script('document.getElementById("open-home").click();')
        h.wait_for(lambda: (x := context(tab)) and (x.get('latest') or {}).get('decision', {}).get('reason') == 'ACTIVE_GRANT', 'saved grant authorizes retry')
        h.wait_for(lambda: 'video.localhost' in hits, 'granted site receives request')
        assert view()['controller']['snapshot']['accessState']['grants'][-1] == grant
        assert not view()['controller']['snapshot']['accessState']['pendingRequests']
        checks.append({'host': 'video.localhost', 'retryOutcome': 'ALLOW', 'reason': 'ACTIVE_GRANT', 'grantUnchanged': True})
        diagnostics = c.message({'kind': 'GET_DIAGNOSTICS', 'tabId': None})
        failures = [x for x in diagnostics['entries'] if x['event'] == 'FAILED']
        assert len(failures) == 4
        assert 'synthetic private browser rejection' not in str(diagnostics)
        assert 'not-logged' not in str(diagnostics)
        return {'checks': checks, 'failedEvents': len(failures), 'unavailableRetryDisabled': True,
                'retriesPreservePolicyConfigurationAndAccessTerms': True, 'cause': 'synthetic tabs.update rejection; original Firefox cause unverified'}
    finally:
        c.call('WebDriver:SwitchToWindow', handle=ui)
        background('const p=window.__navigationProbe;if(p)window.browser.tabs.update=p.update;return true;')
        server.shutdown(); server.server_close()
