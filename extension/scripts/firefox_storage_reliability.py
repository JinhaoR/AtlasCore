"""Storage fault injection in disposable Firefox profiles, never an everyday profile.

Patches the existing background's native IndexedDB methods only in this fixture.
No production test hooks, raw URLs, credentials or private saved state are used.
"""
import json
import time


def run_storage_reliability(client, ui_handle, ui_url, port, wait_for, artifacts, baseline=False, read_baseline=False):
    checks, observations = [], []

    def passed(message):
        checks.append(message)
        print('PASS ' + message, flush=True)

    def ui():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)

    def background(script, *args):
        return client.script('''const [values, done] = arguments;
          browser.runtime.getBackgroundPage().then(b => {
            try { const window=b, IDBDatabase=b.IDBDatabase, IDBObjectStore=b.IDBObjectStore, DOMException=b.DOMException;
              done((function(args){''' + script + '''})(values)); }
            catch { done({fixtureError:true}); }
          }, () => done({fixtureError:true}));''', list(args), asynchronous=True)

    def state():
        ui()
        return client.message({'kind':'GET_VIEW'})['view']

    def checkpoint(view):
        snapshot = (view.get('controller') or {}).get('snapshot') or {}
        return max((value for name in ['accessState','vaultState','journeyState']
                    if isinstance(value := (snapshot.get(name) or {}).get('lastObservedAt'), (int,float))
                    and not isinstance(value, bool)), default=None)

    def failure_summary(value):
        return None if not isinstance(value, dict) else {key:value.get(key) for key in ['sequence','operation','stage','cause']}

    def capture_failure():
        # Keep a useful diagnosis if a fixture unexpectedly stalls. Explicitly
        # select closed fields: never dump a snapshot, URLs or exception text.
        try:
            view = state(); controller = view.get('controller') or {}; storage = view.get('storage')
            issue = view.get('authorityInterruption')
            if isinstance(storage, dict):
                storage = {**{key:storage.get(key) for key in ['readTransactions','writeTransactions','committedWrites','failedCommits']},
                           'lastFailure':failure_summary(storage.get('lastFailure'))}
            if isinstance(issue, dict):
                issue = {**{key:issue.get(key) for key in ['status','reason','observedAt','checkpointAt']},
                         'latestStorageFailure':failure_summary(issue.get('latestStorageFailure'))}
            now = background('return window.Date.now();')
            diagnostic = {'status':controller.get('status'),'reason':controller.get('reason'),
                          'pendingCommit':controller.get('pendingCommitId') is not None,
                          'storage':storage,'authorityInterruption':issue,'checkpointAt':checkpoint(view),
                          'backgroundNow':now if isinstance(now,(int,float)) and not isinstance(now,bool) else None}
        except Exception:
            diagnostic = {'diagnosticsUnavailable':True}
        try:
            (artifacts/'authority-failure.json').write_text(json.dumps(diagnostic,indent=2),encoding='utf-8')
        except Exception:
            pass  # Preserve the original test failure even if artifact storage fails.

    def ready():
        try:
            return wait_for(lambda: (v := state())['controller']['status'] == 'READY' and v, 'verified authority')
        except Exception:
            capture_failure()
            raise

    def independent_cycle():
        # READY can appear inside the same recheck that consumed its recovery
        # budget. Do not arm another supposedly independent incident there.
        # Each retained tab is assessed once per recheck: two fresh full passes
        # prove a later healthy recheck started, without resetting product state.
        anchor = checkpoint(ready()) or 0
        for _ in range(2):
            def fresh_pass():
                view = state()
                contexts = [c for c in view.get('contexts',[]) if c['tabId'] in tabs]
                if view['controller']['status'] != 'READY' or len(contexts) != len(tabs):
                    return None
                if all((c.get('latest') or {}).get('type') == 'ASSESSMENT'
                       and (c.get('latest') or {}).get('observedAt',0) > anchor for c in contexts):
                    return view
                return None
            try:
                view = wait_for(fresh_pass,'later complete healthy retained-tab check cycle',20)
            except Exception:
                capture_failure()
                raise
            anchor = max([checkpoint(view) or 0, *[c['latest']['observedAt'] for c in view['contexts'] if c['tabId'] in tabs]])

    ui()
    initial = ready()['controller']['snapshot']
    tabs = client.script('''const [url, done] = arguments;
      Promise.all([1,2,3].map(() => browser.tabs.create({url,active:false}))).then(ts=>done(ts.map(t=>t.id)));''', f'http://root.localhost:{port}/', asynchronous=True)
    wait_for(lambda: len([c for c in state()['contexts'] if c['tabId'] in tabs and c['latest'] and c['latest'].get('decision',{}).get('outcome')=='ALLOW' and c['journey'] and c['journey']['phase']=='ENDED']) == 3, 'three loaded authorized tabs')
    assert background('''window.__storageProbe={reads:0,writes:0,failures:0,remaining:0,readFailures:0,readRemaining:0,cause:'AbortError'};
      const transaction=IDBDatabase.prototype.transaction,add=IDBObjectStore.prototype.add,get=IDBObjectStore.prototype.get;
      IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(this.name==='atlas-authority-v1'){
        window.__storageProbe[mode==='readonly'?'reads':'writes']++;}return transaction.call(this,stores,mode,...rest);};
      IDBObjectStore.prototype.get=function(...values){const request=get.apply(this,values),p=window.__storageProbe;
        if(this.name==='authority'&&this.transaction.db.name==='atlas-authority-v1'
          &&this.transaction.mode==='readonly'&&values[0]==='envelope'&&p.readRemaining>0){
          p.readRemaining--;p.readFailures++;this.transaction.abort();}
        return request;};
      IDBObjectStore.prototype.add=function(...values){const p=window.__storageProbe;
        if(this.name==='receipts'&&p.remaining>0){p.remaining--;p.failures++;
          if(p.cause==='AbortError'){const request=add.apply(this,values);this.transaction.abort();return request;}
          throw new DOMException('Synthetic storage failure',p.cause);}
        return add.apply(this,values);};return true;''') is True
    time.sleep(5)
    counts = background('return {...window.__storageProbe};')
    observations.append({'case':'five-second-steady-browsing','reads':counts['reads'],'writes':counts['writes']})
    assert counts['writes'] > 0
    if not baseline:
        assert counts['reads'] > counts['writes'], counts
    passed('steady browsing uses real persisted checkpoints; ordinary loads use readonly transactions' if not baseline else 'baseline records write transactions used for ordinary authority reads')

    if not baseline:
        # The preserved 0.1.17 fix covered writes, but not this independent read
        # path. Aborting an actual readonly transaction cannot modify policy.
        independent_cycle()
        background('window.__storageProbe.readRemaining=1;return true;')
        wait_for(lambda: background('return window.__storageProbe.readFailures;') == 1, 'one native readonly load abort')
        if read_baseline:
            wait_for(lambda: state()['controller']['reason']=='STORAGE_UNAVAILABLE', 'baseline sticky readonly failure')
            time.sleep(3)
            read_failed = state()
            assert read_failed['controller']['status'] == 'UNAVAILABLE'
            assert read_failed['storage']['failedCommits'] == 0
            assert read_failed['storage']['lastFailure']['operation'] == 'LOAD'
            assert read_failed['storage']['lastFailure']['stage'] == 'TRANSACTION_ABORT'
            assert read_failed['storage']['lastFailure']['cause'] == 'ABORTED'
            assert read_failed['controller']['snapshot']['policy'] == initial['policy']
            assert all(c['effect'] in ['REMOVED','REMOVING'] for c in read_failed['contexts'] if c['tabId'] in tabs)
            observations.append({'case':'native-readonly-abort-before-fix','status':read_failed['controller']['status'],'reason':read_failed['controller']['reason'],'storage':read_failed['storage'],'policyRetained':True})
            client.message({'kind':'RECOVER'}); ready()
            passed('one readonly LOAD abort reproduces the 0.1.17 unavailable latch and three tab removals with zero failed commits; explicit Recovery restores authority')
            return {'suite':'storage-reliability','baseline':True,'readBaseline':True,'checks':checks,'observations':observations}

        ready(); time.sleep(3)
        read_recovered = ready()
        assert read_recovered['storage']['lastFailure']['operation'] == 'LOAD', read_recovered['storage']
        assert read_recovered['storage']['lastFailure']['stage'] == 'TRANSACTION_ABORT'
        assert read_recovered['storage']['lastFailure']['cause'] == 'ABORTED'
        assert read_recovered['storage']['failedCommits'] == 0, 'an aborted read is not an aborted commit'
        assert read_recovered['controller']['snapshot']['policy'] == initial['policy']
        assert all(c['effect']=='NONE' and c['latest']['decision']['outcome']=='ALLOW'
                   for c in read_recovered['contexts'] if c['tabId'] in tabs)
        observations.append({'case':'native-readonly-abort-after-fix','status':read_recovered['controller']['status'],'storage':read_recovered['storage']})
        passed('one real readonly LOAD abort recovers before three Whitelist tabs are replaced; diagnostics retains the read failure')

    independent_cycle()
    background('window.__storageProbe.remaining=1;return true;')
    wait_for(lambda: background('return window.__storageProbe.failures;') == 1, 'one native transaction abort')
    if baseline:
        wait_for(lambda: state()['controller']['reason']=='WRITE_FAILED', 'baseline sticky write failure')
        time.sleep(3)
        before_recovery = state()
        assert before_recovery['controller']['status'] == 'UNAVAILABLE'
        assert all(c['effect'] in ['REMOVED','REMOVING'] for c in before_recovery['contexts'] if c['tabId'] in tabs)
        observations.append({'case':'native-abort-before-fix','status':before_recovery['controller']['status'],'reason':before_recovery['controller']['reason'],'policyRetained':before_recovery['controller']['snapshot']['policy']==initial['policy']})
        client.message({'kind':'RECOVER'})
        ready()
        passed('one aborted checkpoint reproduces persistent WRITE_FAILED and tab removal; explicit Recovery restores authority')
        return {'suite':'storage-reliability','baseline':True,'checks':checks,'observations':observations}

    recovered = ready()
    time.sleep(3)
    recovered = ready()
    assert recovered['storage']['lastFailure']['cause'] == 'ABORTED', recovered['storage']
    assert recovered['storage']['failedCommits'] == 1
    assert recovered['controller']['snapshot']['policy'] == initial['policy']
    assert all(c['effect']=='NONE' and c['latest']['decision']['outcome']=='ALLOW' for c in recovered['contexts'] if c['tabId'] in tabs)
    observations.append({'case':'native-abort-after-fix','status':recovered['controller']['status'],'storage':recovered['storage']})
    passed('one native abort recovers through verified Core open before any Whitelist tab is replaced')

    # Save one ordinary temporary grant using the actual waiting/confirmation path.
    grey_tab = client.script('''const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));''', f'http://grey.localhost:{port}/', asynchronous=True)
    wait_for(lambda: any(c['tabId']==grey_tab and c['effect']=='REMOVED' for c in state()['contexts']), 'blocked Greylist tab')
    prepared = client.message({'kind':'PREPARE_ACCESS','tabId':grey_tab})
    scope = next(c['accessScope'] for c in prepared['view']['contexts'] if c['tabId']==grey_tab)
    assert scope['status'] == 'READY', scope
    started = client.message({'kind':'START_ACCESS','tabId':grey_tab,'scopeId':scope['id']})
    assert started['result']['type'] == 'COMMITTED', started
    request_id = started['result']['referenceId']
    pending = next(r for r in ready()['controller']['snapshot']['accessState']['pendingRequests'] if r['id']==request_id)
    wait_for(lambda: time.time()*1000 >= pending['readyAt'], 'real Greylist wait', 20)
    confirmed = client.message({'kind':'CONFIRM_ACCESS_AND_OPEN','tabId':grey_tab,'requestId':request_id})
    assert confirmed['result']['type']=='COMMITTED' and confirmed['opened'], confirmed
    grant = next(g for g in ready()['controller']['snapshot']['accessState']['grants'] if g['requestId']==request_id)
    candidate = {'whitelist':initial['policy']['whitelist']+['uncommitted.localhost'],'blacklist':initial['policy']['blacklist']}
    proposal = client.message({'kind':'PROPOSE_POLICY','candidatePolicy':candidate})
    assert proposal['result']['type']=='COMMITTED'
    frozen = ready()['controller']['snapshot']['vaultState']['pendingProposal']
    independent_cycle()
    background('window.__storageProbe.remaining=1;return true;')
    wait_for(lambda: background('return window.__storageProbe.failures;') == 2, 'second native abort')
    after = ready()['controller']['snapshot']
    assert next(g for g in after['accessState']['grants'] if g['requestId']==request_id) == grant
    assert after['vaultState']['pendingProposal'] == frozen
    assert after['policy'] == initial['policy']
    passed('real Greylist grant and frozen Vault proposal keep exact timestamps and policy across abort recovery')

    independent_cycle()
    background('window.__storageProbe.readRemaining=1;return true;')
    wait_for(lambda: background('return window.__storageProbe.readFailures;') == 2, 'readonly abort with live grant and frozen proposal')
    ready(); time.sleep(2)
    after_read = ready()['controller']['snapshot']
    assert next(g for g in after_read['accessState']['grants'] if g['requestId']==request_id) == grant
    assert after_read['vaultState']['pendingProposal'] == frozen
    assert after_read['policy'] == initial['policy']
    passed('readonly LOAD recovery preserves exact grant/proposal terms and does not replay confirmation')

    independent_cycle()
    before = background('window.__storageProbe.remaining=100;return window.__storageProbe.failures;')
    wait_for(lambda: state()['controller']['status']=='UNAVAILABLE', 'persistent abort unavailable')
    wait_for(lambda: background('return window.__storageProbe.failures;')==before+2, 'one bounded recovery write')
    time.sleep(3)
    assert background('return window.__storageProbe.failures;') == before+2
    assert state()['controller']['reason']=='WRITE_FAILED'
    passed('persistent abort performs at most one automatic recovery and then withholds browsing without a retry loop')
    background('window.__storageProbe.remaining=0;return true;')
    client.message({'kind':'RECOVER'}); ready()
    passed('explicit Recovery remains usable after the bounded automatic attempt fails')

    independent_cycle()
    read_before = background('window.__storageProbe.readRemaining=100;return window.__storageProbe.readFailures;')
    wait_for(lambda: state()['controller']['status']=='UNAVAILABLE', 'persistent readonly abort unavailable')
    wait_for(lambda: background('return window.__storageProbe.readFailures;') == read_before+2, 'one bounded recovery load')
    time.sleep(3)
    read_failed = state()
    assert background('return window.__storageProbe.readFailures;') == read_before+2
    assert read_failed['controller']['reason'] == 'STORAGE_UNAVAILABLE'
    assert read_failed['storage']['lastFailure']['operation'] == 'LOAD'
    assert read_failed['storage']['lastFailure']['cause'] == 'ABORTED'
    assert read_failed['controller']['snapshot']['policy'] == initial['policy']
    observations.append({'case':'persistent-readonly-abort','status':read_failed['controller']['status'],'reason':read_failed['controller']['reason'],'storage':read_failed['storage']})
    passed('persistent readonly abort receives one recovery load and remains closed without a retry loop')
    background('window.__storageProbe.readRemaining=0;return true;')
    client.message({'kind':'RECOVER'}); ready()
    passed('explicit Recovery restores verified authority after a persistent readonly failure clears')

    independent_cycle()
    before = background("window.__storageProbe.cause='QuotaExceededError';window.__storageProbe.remaining=100;return window.__storageProbe.failures;")
    wait_for(lambda: state()['controller']['reason']=='WRITE_FAILED', 'quota unavailable')
    time.sleep(2)
    quota = state()
    assert background('return window.__storageProbe.failures;') == before+1
    assert quota['storage']['lastFailure']['cause']=='QUOTA_EXCEEDED'
    assert quota['controller']['snapshot']['policy']==initial['policy']
    client.script('document.getElementById("show-settings").click();')
    wait_for(lambda: client.script('return document.getElementById("policy").textContent.includes("QUOTA_EXCEEDED");'), 'specific storage diagnostic in recovery UI')
    diagnostics = client.message({'kind':'GET_DIAGNOSTICS','tabId':None})
    assert diagnostics['storage']['lastFailure']['cause']=='QUOTA_EXCEEDED'
    observations.append({'case':'quota-failure','storage':quota['storage'],'status':quota['controller']['status']})
    passed('quota failure stays closed, reports a safe cause and retains saved authority without resetting or automatic retry')
    background('window.__storageProbe.remaining=0;return true;')
    client.message({'kind':'RECOVER'}); ready()
    client.script('''const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));''', f'http://black.localhost:{port}/', asynchronous=True)
    wait_for(lambda: any(c.get('hostname')=='black.localhost' and (c.get('latest') or {}).get('decision',{}).get('reason')=='BLACKLISTED' for c in state()['contexts']), 'Blacklist after recovery')
    passed('recovered authority still enforces the existing explicit Blacklist')

    # Exercise observability for an independent non-storage interruption. This
    # does not attribute the user's incident to clock rollback or change Core's
    # existing clock boundary. Only this disposable background realm is patched.
    independent_cycle()
    assert background('''window.__storageClockRealNow=window.Date.now;
      window.Date.now=()=>window.__storageClockRealNow()-5000;return true;''') is True
    try:
        wait_for(lambda: (v := state())['controller']['status']=='UNAVAILABLE'
                 and v['controller']['reason']=='CLOCK_ROLLBACK', 'native clock rollback stays unavailable')
        clock_issue = wait_for(lambda: (v := state()).get('authorityInterruption')
                               and v['authorityInterruption']['reason']=='CLOCK_ROLLBACK' and v,
                               'retained controller clock diagnostic')
        assert clock_issue['controller']['snapshot']['policy'] == initial['policy']
        retained_clock = clock_issue['authorityInterruption']
        observations.append({'case':'clock-rollback-observability','status':clock_issue['controller']['status'],
                             'reason':clock_issue['controller']['reason'],'authorityInterruption':retained_clock})
    finally:
        background('''if(window.__storageClockRealNow){window.Date.now=window.__storageClockRealNow;
          delete window.__storageClockRealNow;}return true;''')
    client.message({'kind':'RECOVER'})
    clock_recovered = ready()
    assert clock_recovered['authorityInterruption'] == retained_clock
    assert clock_recovered['controller']['snapshot']['policy'] == initial['policy']
    exported = client.message({'kind':'GET_DIAGNOSTICS','tabId':None})
    assert exported['authorityInterruption'] == retained_clock
    client.script('document.getElementById("show-settings").click();')
    wait_for(lambda: client.script('return document.getElementById("policy").textContent.includes("CLOCK_ROLLBACK");'),
             'recovered clock issue remains visible in Policy and recovery')
    passed('clock rollback stays closed and its retained reason survives explicit Recovery, UI rendering and diagnostics export')
    return {'suite':'storage-reliability','baseline':False,'checks':checks,'observations':observations}
