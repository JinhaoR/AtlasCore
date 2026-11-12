"""Real Core-gated bookmark launches and unchanged access workflows in a local fixture."""
import time, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def run_access(c, h, shot, record):
    hits=[]
    class Page(BaseHTTPRequestHandler):
        def do_GET(self):
            hits.append((self.headers.get('Host',''),self.path));body=b'<!doctype html><title>Atlas bookmark fixture</title><h1>Saved page</h1>'
            self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Page);threading.Thread(target=server.serve_forever,daemon=True).start();port=server.server_port
    ui=c.call('WebDriver:GetWindowHandle');checks=[]
    def view():return c.message({'kind':'GET_VIEW'})['view']
    def state():return view()['controller']['snapshot']
    def click(s):c.script('document.querySelector(arguments[0]).click();',s)
    def home():c.call('WebDriver:SwitchToWindow',handle=ui);click('#show-home');c.script('window.scrollTo(0,0);')
    def workspace():return c.script('const done=arguments[0],q=indexedDB.open("atlas-destination-drafts-v1");q.onsuccess=()=>{const db=q.result,t=db.transaction("workspace","readonly"),r=t.objectStore("workspace").get("current");r.onsuccess=()=>done(r.result);t.oncomplete=()=>db.close();};',asynchronous=True)
    try:
        policy=state()['policy'];policy['whitelist'].append('bookmark.localhost');policy['blacklist'].append('denied.localhost')
        h.configure_policy(c,policy)
        config=state()['configuration'];config['accessTiming']['grantDurationMs']=6000
        proposed=c.message({'kind':'PROPOSE_SETTINGS','candidateConfiguration':config});assert proposed['result']['type']=='COMMITTED'
        proposal=proposed['view']['controller']['snapshot']['vaultState']['pendingProposal']
        h.wait_for(lambda:time.time()*1000>=proposal['readyAt'],'real settings wait',40)
        assert c.message({'kind':'CONFIRM_POLICY','proposalId':proposal['id']})['result']['type']=='COMMITTED'
        home();h.wait_for(lambda:c.script('return !document.getElementById("edit-pins").disabled;'),'Home ready')
        if c.script('return !!document.getElementById("advanced-pin-settings");'):
            click('#show-settings');click('[data-settings-panel="home-settings"]')
            c.script('document.getElementById("advanced-pin-settings").open=true;')
        click('#edit-pins');h.wait_for(lambda:c.script('return document.getElementById("bookmark-editor").open;'),'edit')
        c.script('const p=document.getElementById("bookmark-parent");p.value="service:webmail.kth.se";p.dispatchEvent(new Event("change"));')
        h.wait_for(lambda:c.script('return document.querySelectorAll("#bookmark-pages li").length===2;'),'saved group')
        urls=[f'http://bookmark.localhost:{port}/paper?q=a%2Bb&view=full#section',f'http://denied.localhost:{port}/blocked#fragment']
        c.script('for(const [i,url] of arguments[0].entries()){const e=document.querySelectorAll("#bookmark-pages input[data-field=url]")[i];e.value=url;e.dispatchEvent(new Event("input",{bubbles:true}));}',urls)
        click('#save-bookmarks');h.wait_for(lambda:c.script('return !document.getElementById("bookmark-editor").open;'),'saved exact links')
        home()
        c.script('window.__commands=[];window.__send=browser.runtime.sendMessage;browser.runtime.sendMessage=function(command,...rest){if(command.kind==="OPEN_DESTINATION")window.__commands.push(command);return window.__send.call(this,command,...rest);};')
        trigger='#pinned-primary [data-destination-id="service:webmail.kth.se"]'
        click(trigger);click('#pin-chooser-pages button')
        h.wait_for(lambda:any(host.startswith('bookmark.localhost:') and path=='/paper?q=a%2Bb&view=full' for host,path in hits),'exact allowed page reached')
        home();assert c.script('return window.__commands.at(-1).url;',)==urls[0]
        # A bookmark in an authorized parent is still denied on its own target.
        click(trigger);c.script('document.querySelectorAll("#pin-chooser-pages button")[1].click();')
        home();h.wait_for(lambda:any(x.get('hostname')=='denied.localhost' and x.get('effect')=='REMOVED' for x in view()['contexts']),'blacklisted bookmark blocked')
        assert not any(host.startswith('denied.localhost:') for host,path in hits)
        assert c.script('return window.__commands.at(-1).url;')==urls[1]
        c.script('browser.runtime.sendMessage=window.__send;')
        checks.append('exact full URL sent through OPEN_DESTINATION; path/query delivered, fragment retained; Blacklist target blocked without HTTP request despite trusted parent')
        opened=c.message({'kind':'OPEN_DESTINATION','url':f'http://pending.localhost:{port}/'})
        tab=opened['tabId'];home()
        h.wait_for(lambda:any(x['tabId']==tab and x['effect']=='REMOVED' for x in view()['contexts']),'Greylist blocked')
        prepared=c.message({'kind':'PREPARE_ACCESS','tabId':tab});scope=next(x['accessScope'] for x in prepared['view']['contexts'] if x['tabId']==tab)
        assert c.message({'kind':'START_ACCESS','tabId':tab,'scopeId':scope['id']})['result']['type']=='COMMITTED'
        pending=state()['accessState']['pendingRequests'][-1]
        h.wait_for(lambda:c.script('return document.querySelector("#pending-access-list .temporary-scope")?.textContent.startsWith("Waiting");'),'Home wait label')
        shot('home-access-wait')
        click('#pending-access-list button');assert c.script('return document.getElementById("context").value===String(arguments[0]);',tab)
        assert state()['accessState']['grants']==[];home()
        h.wait_for(lambda:c.script('return document.querySelector("#pending-access-list .temporary-scope")?.textContent.startsWith("Confirmation available");'),'Home ready label',20)
        assert state()['accessState']['grants']==[]
        click('#pending-access-list button');h.wait_for(lambda:c.script('return !document.getElementById("confirm-access").disabled;'),'existing confirmation')
        click('#confirm-access');home();h.wait_for(lambda:state()['accessState']['grants'],'explicit grant')
        grant=state()['accessState']['grants'][-1];h.wait_for(lambda:c.script('return !!document.querySelector("#temporary-list .temporary-time");'),'Home grant')
        assert c.script('return Number(document.querySelector("#temporary-list .temporary-time").dataset.expiresAt);')==grant['expiresAt']
        assert c.script('const slot=document.querySelector(".home-access-slot"),row=document.querySelector("#temporary-list .temporary-row");return !slot||row.getBoundingClientRect().bottom<=slot.getBoundingClientRect().bottom+1;'),'single access row should be fully visible'
        shot('home-access-active');h.wait_for(lambda:time.time()*1000>=grant['expiresAt'],'real grant expiry',10)
        h.wait_for(lambda:c.script('return document.getElementById("temporary-list").hidden;'),'expired grant has no action')
        assert grant['expiresAt']-grant['issuedAt']==6000
        checks.append('real wait to readiness gives no permission; Home opens existing confirmation; original grant deadline displayed and expired action removed')
        # Synthetic unavailable query only tests truthful projection, not a cause or repair of INTERNAL_ERROR.
        c.script('window.__send=browser.runtime.sendMessage;browser.runtime.sendMessage=async function(command,...rest){const r=await window.__send.call(this,command,...rest);if(command.kind==="GET_VIEW"&&r.view?.controller){r.view.controller.status="UNAVAILABLE";r.view.controller.reason="INTERNAL_ERROR";}return r;};')
        h.wait_for(lambda:c.script('return !document.getElementById("destination-state").hidden && [...document.querySelectorAll(".compass-pin")].every(b=>b.disabled);'),'unavailable disables bookmark launches')
        shot('home-unavailable');c.script('browser.runtime.sendMessage=window.__send;');h.wait_for(lambda:c.script('return document.getElementById("destination-state").hidden;'),'query restored')
        checks.append('synthetic unavailable authority retains presentation and disables launches without inventing permission')
        # Existing persistent draft alongside bookmarks, with no submission.
        click('#show-sites');h.wait_for(lambda:c.script('return !document.getElementById("add-site").disabled;'),'Sites ready');click('#add-site')
        c.script('for(const [id,v] of [["site-name","Retained compact Home draft"],["site-hostname","unsaved-fixture.localhost"],["site-category","Synthetic category"]]){const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));}')
        h.wait_for(lambda:(w:=workspace()) and w['value']['draft'] and w['value']['draft']['editor'] and w['value']['draft']['editor']['name']=='Retained compact Home draft','acknowledged editor draft')
        home();return {'checks':checks,'draft':workspace(),'grantDeadline':grant['expiresAt']}
    finally:server.shutdown();server.server_close()
