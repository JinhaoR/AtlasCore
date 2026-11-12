"""Actual Core end-access commits and native embedded-resource boundary checks."""
import threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def verify(c,h,shot):
    hits=[];held=threading.Event()
    class Page(BaseHTTPRequestHandler):
        def do_GET(self):
            host=self.headers.get('Host','').split(':')[0];hits.append((host,self.path.split('?')[0]))
            if self.path=='/slow':held.wait(10)
            self.send_response(200)
            if self.path=='/script.js':kind='text/javascript';body=b'document.body.dataset.script="loaded";'
            elif self.path=='/frame':kind='text/html';body=b'<!doctype html><title>Embedded challenge fixture</title><p>Frame loaded</p>'
            else:
                kind='text/html';body=f'''<!doctype html><title>Embedded resources fixture</title><body><script src="http://denied.localhost:{port}/script.js"></script><iframe src="http://denied.localhost:{port}/frame"></iframe><script>fetch('http://allowed.localhost:{port}/data').then(()=>document.body.dataset.fetch='loaded');</script></body>'''.encode()
            self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.end_headers()
            try:self.wfile.write(body)
            except (ConnectionAbortedError,ConnectionResetError,BrokenPipeError):pass
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Page);port=server.server_port
    threading.Thread(target=server.serve_forever,daemon=True).start()
    ui=c.call('WebDriver:GetWindowHandle')
    def home():c.call('WebDriver:SwitchToWindow',handle=ui);c.script('document.getElementById("show-home").click();')
    def view():return c.message({'kind':'GET_VIEW'})['view']
    def context(tab):return next((x for x in view()['contexts'] if x['tabId']==tab),None)
    def open_site(host):
        tab=c.message({'kind':'OPEN_DESTINATION','url':f'http://{host}:{port}/'})['tabId'];home();return tab
    try:
        policy=view()['controller']['snapshot']['policy'];policy['whitelist'].append('allowed.localhost');policy['blacklist'].append('denied.localhost')
        h.configure_policy(c,policy)
        allowed=open_site('allowed.localhost')
        h.wait_for(lambda:('denied.localhost','/frame') in hits and ('denied.localhost','/script.js') in hits and ('allowed.localhost','/data') in hits,'embedded resources',20)
        before=len(hits);denied=open_site('denied.localhost')
        h.wait_for(lambda:(x:=context(denied)) and x['effect']=='REMOVED','blocked top-level')
        assert ('denied.localhost','/') not in hits
        grey=open_site('grey.localhost');h.wait_for(lambda:(x:=context(grey)) and x['effect']=='REMOVED','grey page')
        prepared=c.message({'kind':'PREPARE_ACCESS','tabId':grey});scope=next(x['accessScope'] for x in prepared['view']['contexts'] if x['tabId']==grey)
        started=c.message({'kind':'START_ACCESS','tabId':grey,'scopeId':scope['id']});assert started['result']['type']=='COMMITTED'
        request=view()['controller']['snapshot']['accessState']['pendingRequests'][-1]
        h.wait_for(lambda:time.time()*1000>=request['readyAt'],'real wait',40)
        assert c.message({'kind':'CONFIRM_ACCESS','requestId':request['id']})['result']['type']=='COMMITTED'
        first=open_site('grey.localhost');second=open_site('grey.localhost')
        h.wait_for(lambda:all((context(t) or {}).get('latest',{}).get('decision',{}).get('reason')=='ACTIVE_GRANT' for t in [first,second]),'grant tabs')
        home();h.wait_for(lambda:c.script('return !!document.querySelector("#temporary-list .end-access:not(:disabled)");'),'Home end action')
        delayed=c.message({'kind':'OPEN_DESTINATION','url':f'http://grey.localhost:{port}/slow'})['tabId'];home()
        h.wait_for(lambda:('grey.localhost','/slow') in hits,'released slow request')
        shot('home-active-grant');saved=view()['controller']['snapshot'];deadline=saved['accessState']['grants'][-1]['expiresAt']
        c.script('document.querySelector("#temporary-list .end-access").click();')
        h.wait_for(lambda:not view()['controller']['snapshot']['accessState']['grants'],'end committed');held.set()
        h.wait_for(lambda:all(context(t)['effect']=='REMOVED' for t in [first,second,delayed]),'grant documents and delayed request removed')
        h.wait_for(lambda:c.script('return !document.querySelector("#temporary-list .end-access");'),'Home grant removed')
        assert context(allowed)['latest']['decision']['outcome']=='ALLOW'
        state=view()['controller']['snapshot']
        for key in ['policy','configuration','policyRevision','configurationRevision']:assert state[key]==saved[key],key
        assert c.message({'kind':'CONFIRM_ACCESS','requestId':request['id']})['result']['reason']=='REQUEST_NOT_FOUND'
        assert c.message({'kind':'END_ACCESS','requestId':request['id']})['result']['reason']=='GRANT_NOT_FOUND'
        shot('home-grant-ended')
        prepared=c.message({'kind':'PREPARE_ACCESS','tabId':first});scope=next(x['accessScope'] for x in prepared['view']['contexts'] if x['tabId']==first)
        started=c.message({'kind':'START_ACCESS','tabId':first,'scopeId':scope['id']});assert started['result']['type']=='COMMITTED'
        new_request=view()['controller']['snapshot']['accessState']['pendingRequests'][-1]
        assert new_request['id']!=request['id'] and new_request['readyAt']>time.time()*1000
        assert c.message({'kind':'CONFIRM_ACCESS','requestId':new_request['id']})['result']['reason']=='NOT_READY'
        h.wait_for(lambda:time.time()*1000>=new_request['readyAt'],'new full wait',40)
        assert c.message({'kind':'CONFIRM_ACCESS','requestId':new_request['id']})['result']['type']=='COMMITTED'
        c.message({'kind':'OPEN_HOME','tabId':first});home()
        h.wait_for(lambda:context(first)['latest'].get('decision',{}).get('reason')=='ACTIVE_GRANT','second grant page')
        c.call('WebDriver:Navigate',url=h.UI_URL+f'?view=access&tab={first}')
        h.wait_for(lambda:c.script('return !document.getElementById("end-access").hidden && !document.getElementById("end-access").disabled;'),'details end action')
        c.script('document.getElementById("end-access").click();')
        h.wait_for(lambda:not view()['controller']['snapshot']['accessState']['grants'],'details end committed')
        h.wait_for(lambda:context(first)['effect']=='REMOVED','second grant document removed')
        return {'embeddedScriptAndFrameAndFetchLoaded':True,'blockedTopLevelNeverReachedServer':True,
          'endFromHomeCommitted':True,'bothGrantTabsRemoved':True,'delayedResponseCancelled':True,'newRequestWaitEnforced':True,'endFromDetails':True,'allowedTabPreserved':True,'policySettingsUnchanged':True,
          'originalDeadline':deadline,'consumedRequestCannotConfirmAgain':True,'endedRequestId':request['id']}
    finally:
        held.set();home();server.shutdown();server.server_close()
