"""Bounded hostname/history checks in the caller's disposable Firefox profile."""
import time,json

def verify(c,h,shot):
    def js(code,*args):return c.script(code,*args)
    def async_js(code,*args):return c.script('const done=arguments[arguments.length-1];(async()=>{'+code+'})().then(done,e=>done({probeError:e.name,message:e.message}));',*args,asynchronous=True)
    # Match only the exported collection sizes, using wholly synthetic records.
    seeded=async_js('''const b=await browser.runtime.getBackgroundPage();
      return await new Promise((resolve,reject)=>{const q=b.indexedDB.open('atlas-authority-v1');
      q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,t=db.transaction('authority','readwrite'),s=t.objectStore('authority'),r=s.get('envelope');
        r.onsuccess=()=>{const e=r.result,a=e.snapshot.accessState,j=e.snapshot.journeyState,past=Math.min(a.lastObservedAt,j.lastObservedAt)-20000;
          for(let i=j.journeys.length;i<1596;i++)j.journeys.push({id:j.nextJourneyId++,contextId:'incident-history-'+i,rootHostname:'root.example',currentHostname:'root.example',startedAt:past,expiresAt:past+10000,hopCount:0,maxHops:12,policyRevision:e.snapshot.policyRevision,phase:'ENDED',endedAt:past+1,endReason:'REACHED'});
          for(let i=a.pendingRequests.length;i<8;i++)a.pendingRequests.push({id:a.nextRequestId++,hostname:'request-'+i+'.example',startedAt:past,readyAt:past+100,confirmBy:past+1000,grantDurationMs:1000,policyRevision:e.snapshot.policyRevision});
          for(let i=a.grants.length;i<49;i++)a.grants.push({requestId:a.nextRequestId++,hostname:'grant-'+i+'.example',issuedAt:past,expiresAt:past+1000,policyRevision:e.snapshot.policyRevision});
          e.storageVersion=b.crypto.randomUUID();s.put(e,'envelope');};
        t.oncomplete=()=>{db.close();resolve(true)};t.onabort=()=>reject(t.error);};});''')
    assert seeded is True,seeded
    h.wait_for(lambda:len(c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']['journeyState']['journeys'])==1596,'history validated')
    initialized=async_js('''window.__incidentCore=await import(browser.runtime.getURL('probe-core/index.js'));
      window.__incidentTarget=await import(browser.runtime.getURL('probe-core/target.js'));
      window.__incidentSnapshot=(await browser.runtime.sendMessage({kind:'GET_VIEW'})).view.controller.snapshot;
      return {valid:window.__incidentCore.validateAtlasSnapshot(window.__incidentSnapshot).ok,
        counts:[window.__incidentSnapshot.journeyState.journeys.length,window.__incidentSnapshot.accessState.pendingRequests.length,window.__incidentSnapshot.accessState.grants.length]};''')
    assert initialized['valid'] and initialized['counts']==[1596,8,49],initialized
    result={'fixture':initialized,'batches':[],'note':'Synthetic collection sizes only; no user policy or browsing history.'}
    start=time.monotonic()
    for batch in range(24):
        row=js('''const start=performance.now(),target=window.__incidentTarget.normalizeHostname;
          try{for(let i=0;i<100000;i++)if(target(i%2?'short.example':'a'.repeat(63)+'.'+'b'.repeat(63)+'.'+'c'.repeat(63)+'.'+'d'.repeat(61))===null)throw Error('unexpected rejection');
          for(let i=0;i<100;i++)if(!window.__incidentCore.validateAtlasSnapshot(window.__incidentSnapshot).ok)throw Error('invalid snapshot');
          return {hostnameChecks:100000,snapshotChecks:100,milliseconds:performance.now()-start};}
          catch(e){return {probeError:e.name,message:e.message,milliseconds:performance.now()-start};}''')
        result['batches'].append(row)
        if 'probeError' in row:break
        health=c.message({'kind':'GET_DIAGNOSTICS','tabId':None})
        if health['runtime']['controller']['status'] in ['UNAVAILABLE','RECONCILING'] or health['runtime']['faults']:
            result['fault']=health['runtime'];break
        if batch%6==0:print('NATIVE',batch,json.dumps(row),flush=True)
        time.sleep(2)
    result['oversizedInputs']=js('''return [254,10000,1000000].map(n=>{try{return {length:n,rejected:window.__incidentTarget.normalizeHostname('a'.repeat(n))===null}}catch(e){return {length:n,error:e.name,message:e.message}}});''')
    result['elapsedSeconds']=time.monotonic()-start
    health=c.message({'kind':'GET_DIAGNOSTICS','tabId':None})
    result['runtime']=health['runtime'];result['storage']=health['storage']
    print('NATIVE RESULT',json.dumps({'seconds':result['elapsedSeconds'],'batches':len(result['batches']),'status':result['runtime']['controller']['status'],'faults':result['runtime']['faults'],'oversized':result['oversizedInputs']}),flush=True)
    assert len(result['batches'])==24 and all('probeError' not in row for row in result['batches']),result
    assert not result['runtime']['faults'] and 'fault' not in result,result
    assert all(row.get('rejected') for row in result['oversizedInputs']),result
    return result
