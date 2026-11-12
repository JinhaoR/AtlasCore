"""Matched UI/projection measurements; no writes to authority or normal profiles."""
import base64
import statistics
import time
from firefox_performance_audit import process_sample


def run_engineering_review(client, wait_for, run, root_pid, baseline=False):
    wait_for(lambda: client.script('return document.getElementById("status").dataset.ready==="true" && !document.getElementById("add-site").disabled;'), 'ready control page', 30)
    assert client.script('return !!window.__atlasPerf;'), 'instrumented disposable copy required'
    # Real browser JS engine, but synthetic inputs to the read-only projection.
    projection = client.script('''const done=arguments[0];
      (async()=>{const b=await browser.runtime.getBackgroundPage(),v=(await browser.runtime.sendMessage({kind:'GET_VIEW'})).view.controller;
        const p=b.__atlasAccessProjection,now=Date.now(),results=[];
        for(const count of [0,25,100,300]){
          const input=structuredClone(v);input.status='READY';
          input.snapshot.accessState={pendingRequests:[],grants:Array.from({length:count},(_,i)=>({requestId:i+1,
            hostname:'expired-'+i+'.example',issuedAt:now-10000,expiresAt:now-1,policyRevision:input.snapshot.policyRevision})),
            nextRequestId:count+1,lastObservedAt:now,policyRevision:input.snapshot.policyRevision};
          const samples=[];let valid=true;
          for(let n=0;n<8;n++){const started=performance.now(),result=p.accessOverview?p.accessOverview(input,now):
            {temporaryAccess:p.temporaryAccessView(input,now),pendingAccess:p.pendingAccessView(input,now)};
            if(n)samples.push(performance.now()-started);valid&&=result.temporaryAccess?.length===0&&result.pendingAccess?.length===0;}
          samples.sort((a,b)=>a-b);results.push({historicalGrants:count,medianMs:samples[3],p95Ms:samples[6],samples,valid});
        }done(results);})().catch(()=>done(null));''', asynchronous=True)
    assert projection and all(row['valid'] for row in projection), projection
    client.script('document.getElementById("show-home").click();window.__atlasPerf.reset();')
    before = process_sample(root_pid)
    start = time.monotonic()
    latencies = []
    for _ in range(20):
        tick = time.monotonic()
        client.script('document.getElementById("show-sites").click();document.getElementById("show-settings").click();document.getElementById("show-home").click();')
        latencies.append((time.monotonic()-tick)*1000)
    time.sleep(10)
    measured = client.script('return window.__atlasPerf.stop();')
    if not baseline:
        assert measured['functions'].get('draftBaseline', {}).get('calls', 0) == 0, measured
    # Hidden categories are valid only while their complete presentation is verified.
    client.script('document.getElementById("customize-home").click();')
    for _ in range(50):
        changed = client.script('const c=document.querySelector("#home-layout-list input:checked:not(:disabled)");if(!c)return false;c.click();return true;')
        if not changed:
            break
        wait_for(lambda: client.script('return !document.querySelector("#home-layout-list input:disabled");'), 'saved category visibility')
    assert client.script('return !document.querySelector("#home-layout-list input:checked");')
    client.script('document.getElementById("close-home-customization").click();')
    wait_for(lambda: client.script('return !document.getElementById("home-categories-empty").hidden;'), 'verified hidden-category explanation')
    if not baseline:
        client.script('''window.__auditSend=browser.runtime.sendMessage;browser.runtime.sendMessage=async function(c,...a){
          const r=await window.__auditSend.call(this,c,...a);if(c?.kind==='GET_VIEW')r.view.controller.status='LOADING';return r;};
          document.getElementById('retry-destinations').click();''')
        time.sleep(1)
        assert client.script('return !document.getElementById("home-categories-empty").hidden;'), 'housekeeping must not flicker acknowledged layout copy'
        client.script('browser.runtime.sendMessage=window.__auditSend;delete window.__auditSend;')
    # Failed GET_VIEW must show unavailable, never the "you hid every category" message.
    client.script('''window.__auditSend=browser.runtime.sendMessage;browser.runtime.sendMessage=function(c,...a){
      return c?.kind==='GET_VIEW'?Promise.reject(Error('synthetic read failure')):window.__auditSend.call(this,c,...a)};
      document.getElementById('retry-destinations').click();''')
    wait_for(lambda: client.script('return document.getElementById("destinations").dataset.phase==="UNAVAILABLE";'), 'unavailable presentation')
    hidden = client.script('return document.getElementById("home-categories-empty").hidden;')
    if not baseline:
        assert hidden, 'unverified layout must not claim all categories were deliberately hidden'
    (run/'unavailable-home.png').write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=True)))
    client.script('browser.runtime.sendMessage=window.__auditSend;delete window.__auditSend;document.getElementById("retry-destinations").click();')
    wait_for(lambda: client.script('return document.getElementById("destinations").dataset.phase==="READY";'), 'read retry recovery')
    (run/'home.png').write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=True)))
    samples = sorted(latencies)
    return {'baseline': baseline, 'accessHistory': projection, 'emptyWorkspace': measured,
            'navigationMs': {'median': statistics.median(samples), 'p95': samples[18], 'samples': samples},
            'seconds': time.monotonic()-start, 'processBefore': before, 'processAfter': process_sample(root_pid),
            'unavailableCategoryMessageHidden': hidden,
            'checks': ['synthetic expired history retains empty access summary', '20 Home/Sites/Settings cycles',
                       'no draft baseline construction without a draft' if not baseline else 'baseline construction measured',
                       'read failure and explicit read retry without policy mutation'],
            'limits': ['Native JS timings include instrumentation and scheduling.', 'Seven timed samples per history size; p95 is the maximum.',
                       'Ten-second idle measurement is not a long-term memory-leak test.']}
