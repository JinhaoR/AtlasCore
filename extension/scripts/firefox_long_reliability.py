"""Bounded native soak with synthetic history, real IndexedDB and tab races.

Only the disposable profile is seeded. No test clock or production hooks. This
is minutes of evidence, not a claim to reproduce a week of daily browsing.
"""
import statistics
import time
import json
from firefox_performance_audit import process_sample


def run_long_reliability(client, ui_handle, ui_url, port, wait_for, run, root_pid, extended=False):
    def view():
        return client.message({'kind': 'GET_VIEW'})['view']

    def diag():
        return client.message({'kind': 'GET_DIAGNOSTICS', 'tabId': None})

    def ready():
        return wait_for(lambda: (v := view()) and v.get('controller') and v['controller']['status'] == 'READY' and v, 'ready native authority', 30)

    def script(code, *args):
        return client.script('''const [args,done]=arguments;(async()=>{
          const b=await browser.runtime.getBackgroundPage();
          return await (async()=>{''' + code + '''})();})().then(done,()=>done({fixtureError:true}));''', list(args), asynchronous=True)

    def tab(host):
        return client.script('''const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));''',
                             f'http://{host}:{port}/', asynchronous=True)

    def remove(ids):
        client.script('const [ids,done]=arguments;browser.tabs.remove(ids).then(()=>done(true));', ids, asynchronous=True)

    def allowed(identity):
        return any(c['tabId'] == identity and (c.get('latest') or {}).get('decision', {}).get('reason') == 'WHITELISTED'
                   for c in view()['contexts'])

    ready()
    original = view()['controller']['snapshot']
    terms = {k: original[k] for k in ['policy', 'policyRevision', 'configuration', 'configurationRevision']}
    first = tab('root.localhost')
    wait_for(lambda: allowed(first), 'initial trusted navigation')
    start = diag()
    if extended:
        # Hold only the adapter's arrival read, close the actual native tab, then
        # invoke Firefox's real get on that closed ID. No error text is retained.
        assert script('''const id=args[0],get=b.browser.tabs.get.bind(b.browser.tabs);
          b.__atlasArrivalProbe={entered:false,rejected:false};let release;
          const gate=new Promise(r=>release=r);b.__atlasArrivalProbe.release=release;
          b.browser.tabs.get=async tabId=>{if(tabId!==id)return get(tabId);
            b.__atlasArrivalProbe.entered=true;await gate;
            try{return await get(tabId)}catch(e){b.__atlasArrivalProbe.rejected=true;throw e}
            finally{b.browser.tabs.get=get;}};return true;''', first) is True
        client.script('const [id,url,done]=arguments;browser.tabs.update(id,{url}).then(()=>done(true));', first,
                      f'http://root.localhost:{port}/arrival-race', asynchronous=True)
        wait_for(lambda:script('return b.__atlasArrivalProbe.entered;'),'arrival read held before tab closure')
        remove([first]); script('b.__atlasArrivalProbe.release();return true;')
        wait_for(lambda:script('return b.__atlasArrivalProbe.rejected;'),'real Firefox rejects closed tab read')
        wait_for(lambda:diag()['runtime']['adapter']['queued']==0,'closed arrival queue drained')
        assert not diag()['runtime']['faults']
        first=tab('root.localhost');wait_for(lambda:allowed(first),'normal navigation after arrival race')
        print('PASS native arrival read rejects after actual tab close: retired context, no stale effect or fault',flush=True)
    # Append history in the isolated fixture database, preserving actual policy and
    # current state. A new storage version forces ordinary full Core validation.
    seeded = script('''return await new Promise((resolve,reject)=>{
      const open=b.indexedDB.open('atlas-authority-v1');open.onerror=()=>reject();open.onsuccess=()=>{
        const db=open.result,tx=db.transaction('authority','readwrite'),store=tx.objectStore('authority'),get=store.get('envelope');
        get.onsuccess=()=>{const e=get.result,s=e.snapshot,j=s.journeyState,a=s.accessState,
          past=Math.min(j.lastObservedAt,a.lastObservedAt)-20000;
          for(let i=0;i<2500;i++)j.journeys.push({id:j.nextJourneyId++,contextId:'soak-history-'+i,rootHostname:'root.localhost',
            currentHostname:'root.localhost',startedAt:past,expiresAt:past+10000,hopCount:0,maxHops:12,
            policyRevision:Math.max(0,s.policyRevision-1),phase:'ENDED',endedAt:past+1,endReason:'REACHED'});
          for(let i=0;i<300;i++)a.grants.push({requestId:a.nextRequestId++,hostname:'grant-'+i+'.example',
            issuedAt:past,expiresAt:past+1000,policyRevision:i%2?s.policyRevision:Math.max(0,s.policyRevision-1)});
          for(let i=0;i<100;i++)a.pendingRequests.push({id:a.nextRequestId++,hostname:'request-'+i+'.example',
            startedAt:past,readyAt:past+100,confirmBy:past+1000,grantDurationMs:1000,
            policyRevision:i%2?s.policyRevision:Math.max(0,s.policyRevision-1)});
          e.storageVersion=b.crypto.randomUUID();store.put(e,'envelope');};
        tx.oncomplete=()=>{db.close();resolve(true)};tx.onabort=()=>{db.close();reject()};
      };});''')
    assert seeded is True
    wait_for(lambda: len(ready()['controller']['snapshot']['journeyState']['journeys']) >= 2500, 'full history load')
    assert view()['temporaryAccess'] == [] and view()['pendingAccess'] == []
    print('PASS native history: 2500 ended Journeys, 300 expired grants, 100 expired/stale requests', flush=True)
    if extended:
        assert script('''return await new Promise((resolve,reject)=>{
          const o=b.indexedDB.open('atlas-authority-v1');o.onsuccess=()=>{
            const db=o.result,t=db.transaction('receipts','readwrite'),s=t.objectStore('receipts');
            for(let i=0;i<100000;i++)s.add({type:'COMMITTED',commitId:'soak-receipt-'+i,storageVersion:'soak-version-'+i},'soak-receipt-'+i);
            t.oncomplete=()=>{db.close();resolve(true)};t.onabort=()=>{db.close();reject()};};});''') is True
        print('PASS native receipt fixture: 100,000 preserved replay receipts', flush=True)

    # A real transaction holds the store. Do not fake a successful commit, invoke
    # a recovery, abandon a pending promise or modify native transaction handlers.
    assert script('''b.__atlasSoakHold={active:false,done:false};
      const r=b.indexedDB.open('atlas-authority-v1');r.onsuccess=()=>{
        const db=r.result,tx=db.transaction('authority','readwrite'),store=tx.objectStore('authority'),end=Date.now()+4000;
        b.__atlasSoakHold.active=true;const keep=()=>{const q=store.get('initialized');q.onsuccess=()=>{if(Date.now()<end)keep();};};keep();
        tx.oncomplete=()=>{b.__atlasSoakHold.done=true;db.close();};};return true;''') is True
    wait_for(lambda: script('return b.__atlasSoakHold.active;'), 'native transaction held')
    held = wait_for(lambda: (d := diag()) and d['runtime']['controller']['activity']['active'] and
                    d['runtime']['controller']['activity']['stage'] == 'LOAD' and d, 'controller waiting on real storage')
    assert held['runtime']['controller']['status'] == 'LOADING'
    pending_tab = tab('root.localhost')
    remove([pending_tab, first])
    wait_for(lambda: script('return b.__atlasSoakHold.done;'), 'held transaction completes')
    ready()
    wait_for(lambda: diag()['runtime']['adapter']['queued'] == 0, 'queued tab close/navigation drains')
    assert all(c['tabId'] not in [pending_tab, first] for c in view()['contexts'])
    print('PASS native delayed read and concurrent navigation/tab closure; no recovery or premature permission', flush=True)

    # UI lifetimes while ordinary background navigation continues.
    for _ in range(8):
        identity = client.script('const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));', ui_url, asynchronous=True)
        time.sleep(.25)
        remove([identity])
    latencies = []
    for _ in range(30):
        began = time.monotonic(); identity = tab('root.localhost')
        wait_for(lambda: allowed(identity), 'repeated exact Whitelist navigation')
        latencies.append((time.monotonic()-began)*1000)
        remove([identity])
    retained = tab('root.localhost'); wait_for(lambda: allowed(retained), 'retained trusted page')
    before_idle = diag(); resource_before = process_sample(root_pid)
    samples = []
    began = time.monotonic()
    activity_cycles = 0
    # Actual one-second loop and real disk commits; extended mode interleaves
    # ordinary commands with idle time, keeping the same background owner.
    while time.monotonic()-began < (600 if extended else 300):
        time.sleep(5)
        d = diag(); runtime = d['runtime']
        assert runtime['controller']['status'] in ['READY', 'LOADING', 'COMMITTING'], runtime
        if runtime['faults']:
            (run/'soak-fault.json').write_text(json.dumps({'runtime':runtime,'storage':d['storage'],'samples':samples},indent=2),encoding='utf-8')
        assert not runtime['faults'], runtime['faults']
        samples.append({'seconds': round(time.monotonic()-began, 1), 'completed': runtime['controller']['activity']['completed'],
                        'queued': runtime['adapter']['queued'], 'reads': d['storage']['readTransactions'], 'writes': d['storage']['writeTransactions']})
        if len(samples) % 6 == 0: print('SOAK ' + str(samples[-1]), flush=True)
        if extended and len(samples) % 6 == 0:
            identity = tab('unknown.localhost')
            wait_for(lambda:any(c['tabId']==identity and c['effect']=='REMOVED' for c in view()['contexts']), 'soak Greylist block')
            prepared = client.message({'kind':'PREPARE_ACCESS','tabId':identity})
            scope = next(c for c in prepared['view']['contexts'] if c['tabId']==identity)['accessScope']
            result = client.message({'kind':'START_ACCESS','tabId':identity,'scopeId':scope['id']})
            assert result['result']['type']=='COMMITTED'
            pending = next(r for r in result['view']['controller']['snapshot']['accessState']['pendingRequests'] if r['hostname']=='unknown.localhost')
            cancelled = client.message({'kind':'CANCEL_ACCESS','requestId':pending['id']})
            assert cancelled['result']['type']=='COMMITTED'
            remove([identity])
            journey = client.message({'kind':'OPEN_JOURNEY','url':f'http://root.localhost:{port}/begin-login'})
            assert journey['result']['type']=='COMMITTED'
            wait_for(lambda:any(c['tabId']==journey['tabId'] and c['displayedHostname']=='login.localhost' for c in view()['contexts']), 'soak login Journey')
            remove([journey['tabId']]); ready()
            identity = client.script('const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));', ui_url, asynchronous=True)
            remove([identity]); activity_cycles += 1
    after_idle = diag(); resource_after = process_sample(root_pid)
    (run/'soak-checkpoint.json').write_text(json.dumps({'samples': samples, 'before': before_idle['runtime'],
      'after': after_idle['runtime'], 'storage': after_idle['storage'], 'processBefore': resource_before,
      'processAfter': resource_after}, indent=2), encoding='utf-8')
    assert samples[-1]['completed'] > samples[0]['completed'] + 200
    assert all(row['queued'] < 10 for row in samples)
    assert after_idle['storage']['failedCommits'] == 0 and not after_idle['authorityInterruption']
    assert allowed(retained)
    before_restart = ready()['controller']['snapshot']
    old_session = after_idle['runtime']['startedAt']
    assert script('b.setTimeout(()=>b.location.reload(),0);return true;') is True
    def reconnected():
        response = client.message({'kind': 'GET_DIAGNOSTICS', 'tabId': None})
        return response.get('runtime', {}).get('startedAt') not in [None, old_session] and response
    restarted = wait_for(reconnected, 'background document reload and new owner', 30)
    after_restart = ready()['controller']['snapshot']
    assert {k: after_restart[k] for k in terms} == terms
    assert after_restart['accessState']['grants'] == before_restart['accessState']['grants']
    assert after_restart['accessState']['pendingRequests'] == before_restart['accessState']['pendingRequests']
    assert not restarted['runtime']['faults']
    print('PASS native background reload: new session, original policy/deadlines and complete history', flush=True)
    black = tab('black.localhost')
    wait_for(lambda: any(c['tabId'] == black and (c.get('latest') or {}).get('decision', {}).get('reason') == 'BLACKLISTED'
                        and c['effect'] == 'REMOVED' for c in view()['contexts']), 'Blacklist after restart')
    grey = tab('grant-1.example')  # reserved example domain; blocked before network
    wait_for(lambda: any(c['tabId'] == grey and (c.get('latest') or {}).get('decision', {}).get('outcome') == 'GREYLIST'
                        for c in view()['contexts']), 'expired history cannot grant access')
    client.call('Marionette:SetContext', value='chrome')
    try:
        console = client.script('''const base=arguments[0];return Services.console.getMessageArray().filter(m=>
          typeof m.sourceName==='string'&&m.sourceName.startsWith(base)).map(m=>({
            background:m.sourceName===base+'background.js',line:m.lineNumber||0,column:m.columnNumber||0,flags:m.flags||0})).slice(-30);''', ui_url.split('ui/index.html')[0])
    finally:
        client.call('Marionette:SetContext', value='content')
    return {'suite': 'long-reliability', 'idleSeconds': samples[-1]['seconds'], 'samples': samples,
            'history': {'journeys': 2500, 'expiredGrants': 300, 'expiredOrStaleRequests': 100},
            'heldStorage': held['runtime'],
            'beforeIdle': {k: before_idle[k] for k in ['runtime', 'storage', 'authorityInterruption']},
            'afterIdle': {k: after_idle[k] for k in ['runtime', 'storage', 'authorityInterruption']},
            'processBeforeIdle': resource_before, 'processAfterIdle': resource_after,
            'navigationMs': {'median': statistics.median(latencies), 'max': max(latencies), 'count': len(latencies)},
            'uiOpenCloseCycles': 8+activity_cycles, 'interleavedAccessJourneyCycles': activity_cycles,
            'seededReceiptCount': 100000 if extended else 0,
            'backgroundReload': True, 'consoleLocations': console,
            'minidumpFiles': len(list(run.rglob('*.dmp'))), 'originalIncidentReproduced': False,
            'normalProfileAccessed': False}
