"""Storage fault injection in disposable Firefox profiles, never an everyday profile.

Patches the existing background's native IndexedDB methods only in this fixture.
No production test hooks, raw URLs, credentials or private saved state are used.
"""
import time


def run_storage_reliability(client, ui_handle, ui_url, port, wait_for, artifacts, baseline=False):
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

    def ready():
        return wait_for(lambda: (v := state())['controller']['status'] == 'READY' and v, 'verified authority')

    ui()
    initial = ready()['controller']['snapshot']
    tabs = client.script('''const [url, done] = arguments;
      Promise.all([1,2,3].map(() => browser.tabs.create({url,active:false}))).then(ts=>done(ts.map(t=>t.id)));''', f'http://root.localhost:{port}/', asynchronous=True)
    wait_for(lambda: len([c for c in state()['contexts'] if c['tabId'] in tabs and c['latest'] and c['latest'].get('decision',{}).get('outcome')=='ALLOW' and c['journey'] and c['journey']['phase']=='ENDED']) == 3, 'three loaded authorized tabs')
    assert background('''window.__storageProbe={reads:0,writes:0,failures:0,remaining:0,cause:'AbortError'};
      const transaction=IDBDatabase.prototype.transaction,add=IDBObjectStore.prototype.add;
      IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(this.name==='atlas-authority-v1'){
        window.__storageProbe[mode==='readonly'?'reads':'writes']++;}return transaction.call(this,stores,mode,...rest);};
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
    background('window.__storageProbe.remaining=1;return true;')
    wait_for(lambda: background('return window.__storageProbe.failures;') == 2, 'second native abort')
    after = ready()['controller']['snapshot']
    assert next(g for g in after['accessState']['grants'] if g['requestId']==request_id) == grant
    assert after['vaultState']['pendingProposal'] == frozen
    assert after['policy'] == initial['policy']
    passed('real Greylist grant and frozen Vault proposal keep exact timestamps and policy across abort recovery')

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
    return {'suite':'storage-reliability','baseline':False,'checks':checks,'observations':observations}
