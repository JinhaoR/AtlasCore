"""Unexpected controller exception evidence in a disposable Firefox profile.

Deliberate fault injection verifies observability and conservative behavior. It
does not establish which exception caused a real user's interruption.
"""
from copy import deepcopy
import json
import time


def run_internal_fault(client, ui_handle, ui_url, port, wait_for, baseline=False, artifacts=None):
    checks, observations = [], []
    expected_version = client.script('return browser.runtime.getManifest().version;')

    def state():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']

    def ready():
        return wait_for(lambda: (v := state()) and (v.get('controller') or {}).get('status') == 'READY' and v, 'verified fault fixture authority', 25)

    def background(script, *args):
        return client.script('''const [values,done]=arguments;browser.runtime.getBackgroundPage().then(window=>{
          try{done((function(args){''' + script + '''})(values));}catch{done({fixtureError:true});}
          },()=>done({fixtureError:true}));''', list(args), asynchronous=True)

    def open_tab(host):
        return client.script('''const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));''',
                             f'http://{host}:{port}/', asynchronous=True)

    def terms(snapshot):
        return {key: deepcopy(snapshot[key]) for key in ['policy', 'policyRevision', 'configuration', 'configurationRevision']}

    tabs = [open_tab('root.localhost') for _ in range(3)]
    wait_for(lambda: len([c for c in state()['contexts'] if c['tabId'] in tabs and
                         (c.get('latest') or {}).get('decision', {}).get('reason') == 'WHITELISTED']) == 3,
             'three independently allowed retained pages', 25)
    grey_tab = open_tab('grey.localhost')
    wait_for(lambda: any(c['tabId'] == grey_tab and c['effect'] == 'REMOVED' for c in state()['contexts']), 'fixture Greylist page')
    prepared = client.message({'kind': 'PREPARE_ACCESS', 'tabId': grey_tab})
    scope = next(c['accessScope'] for c in prepared['view']['contexts'] if c['tabId'] == grey_tab)
    request = client.message({'kind': 'START_ACCESS', 'tabId': grey_tab, 'scopeId': scope['id']})
    assert request['result']['type'] == 'COMMITTED'
    pending = next(r for r in ready()['controller']['snapshot']['accessState']['pendingRequests'] if r['id'] == request['result']['referenceId'])
    wait_for(lambda: time.time()*1000 >= pending['readyAt'], 'real Greylist wait', 20)
    confirmed = client.message({'kind': 'CONFIRM_ACCESS_AND_OPEN', 'tabId': grey_tab, 'requestId': pending['id']})
    assert confirmed['result']['type'] == 'COMMITTED' and confirmed['opened']
    initial = ready()['controller']['snapshot']
    proposal = client.message({'kind': 'PROPOSE_POLICY', 'candidatePolicy': {
        **initial['policy'], 'whitelist': initial['policy']['whitelist'] + ['uncommitted.localhost']}})
    assert proposal['result']['type'] == 'COMMITTED'
    before = deepcopy(ready()['controller']['snapshot'])
    original_terms = terms(before)
    original_access = deepcopy(before['accessState'])
    original_proposal = deepcopy(before['vaultState']['pendingProposal'])
    checks.append('actual Greylist wait/confirmation creates one fixed grant; a separate policy proposal remains frozen and inactive')

    # Patch only this isolated background's standard runtime functions. No
    # production hook, browser clock replacement or page-origin command is added.
    assert background('''window.__atlasFaultProbe={values:window.Object.values,keys:window.Object.keys,stringify:window.JSON.stringify,
      armed:null,triggered:0};return true;''') is True
    try:
        for index, (probe, expected_stage, expected_error) in enumerate([
            ('PLAN', 'PLAN', 'TYPE_ERROR'), ('VERIFY_AUTHORITY', 'VERIFY_AUTHORITY', 'RANGE_ERROR')], start=1):
            ready()
            assert background('''const p=window.__atlasFaultProbe;p.armed=args[0];
              window.Object.keys=function(value){if(p.armed==='VERIFY_AUTHORITY'&&value?.policy&&value?.accessState
                &&(new window.Error().stack||'').split(String.fromCharCode(10)).some(line=>/^sameAtlasData[0-9]*@/.test(line))){
                  p.armed=null;p.triggered++;window.Object.keys=p.keys;throw new window.RangeError('Synthetic private token=do-not-export');}
                return p.keys(value);};
              window.Object.values=function(value){if(p.armed==='PLAN'&&value?.result?.type==='OBSERVED'
                &&window.Object.hasOwn(value,'observationSnapshot')
                &&(new window.Error().stack||'').split(String.fromCharCode(10)).some(line=>/^handle[0-9]*@/.test(line))){p.armed=null;p.triggered++;
                window.Object.values=p.values;throw new window.TypeError('Synthetic private token=do-not-export');}
                return p.values(value);};
              window.JSON.stringify=function(value,...rest){if(p.armed==='VERIFY_AUTHORITY'&&value?.policy
                &&value?.accessState&&value?.vaultState&&value?.journeyState){p.armed=null;p.triggered++;
                window.JSON.stringify=p.stringify;throw new window.RangeError('Synthetic private token=do-not-export');}
                return p.stringify(value,...rest);};return true;''', probe) is True
            wait_for(lambda: background('return window.__atlasFaultProbe.triggered;') == index, 'idle timer reaches the injected runtime exception', 20)
            failed = wait_for(lambda: (v := state()) and v['controller']['status'] == 'UNAVAILABLE'
                              and v['controller']['reason'] == 'INTERNAL_ERROR' and v, 'global internal-error latch', 15)
            print('OBSERVED idle fault ' + probe + ': INTERNAL_ERROR', flush=True)
            wait_for(lambda: all(c['effect'] == 'REMOVED' for c in state()['contexts'] if c['tabId'] in tabs), 'denied retained documents actually replaced', 20)
            issue = failed['authorityInterruption']
            assert failed['storage']['failedCommits'] == 0 and failed['storage']['lastFailure'] is None
            assert terms(failed['controller']['snapshot']) == original_terms
            assert failed['controller']['snapshot']['accessState']['grants'] == original_access['grants']
            assert failed['controller']['snapshot']['vaultState']['pendingProposal'] == original_proposal
            if baseline:
                assert 'internalFault' not in issue, 'old code discarded the exception stage/class'
            else:
                fault = issue['internalFault']
                assert fault['sequence'] == index and fault['operation'] == 'OBSERVE_TIME'
                assert fault['stage'] == expected_stage and fault['error'] == expected_error
                assert fault['pendingCommitId'] is None
                counts = fault['stateCounts']
                assert counts['grants'] == len(original_access['grants']) and counts['requests'] == len(original_access['pendingRequests'])
                wait_for(lambda: client.script('return document.getElementById("storage-diagnostic").textContent.includes(arguments[0]);', expected_stage),
                         'safe fault stage visible in Diagnostics')
            storage_before = deepcopy(state()['storage'])
            time.sleep(3)
            assert state()['controller']['reason'] == 'INTERNAL_ERROR'
            assert state()['storage'] == storage_before, 'periodic blocked calls cannot auto-recover or retry writes'
            diagnostic = client.message({'kind': 'GET_DIAGNOSTICS', 'tabId': None})
            assert diagnostic['authorityInterruption'] == issue
            if not baseline:
                runtime = diagnostic['runtime']
                recorded = [r for r in runtime['faults'] if r['subsystem'] == 'CONTROLLER' and r['controller']['stage'] == expected_stage]
                assert recorded and recorded[-1]['error'] == expected_error and recorded[-1]['frames'], runtime
                assert all(set(frame) == {'asset', 'line', 'column'} for frame in recorded[-1]['frames'])
                assert runtime['controller']['policyRevision'] == original_terms['policyRevision']
            serialized = client.script('return JSON.stringify(arguments[0]);', diagnostic)
            assert 'do-not-export' not in serialized and 'token=' not in serialized
            client.message({'kind': 'RECOVER'})
            recovered = ready()
            assert recovered['authorityInterruption'] == issue
            assert terms(recovered['controller']['snapshot']) == original_terms
            assert recovered['controller']['snapshot']['accessState']['grants'] == original_access['grants']
            assert recovered['controller']['snapshot']['vaultState']['pendingProposal'] == original_proposal
            observations.append({'case': probe, 'reason': failed['controller']['reason'], 'failedCommits': 0,
                                 'fault': issue.get('internalFault'), 'retainedAcrossRecovery': True,
                                 'policyAndDeadlinesPreserved': True, 'exceptionTextExported': False,
                                 'runtime': diagnostic.get('runtime')})
            checks.append(f'{probe}: idle runtime exception reproduces the closed global latch with no failed storage commits; explicit Recovery preserves policy, original grant and frozen proposal')
            # Deliberately reopen a trusted page through the ordinary gate. A
            # recovered diagnostic does not navigate or revive a Journey.
            tab = open_tab('root.localhost'); tabs = [tab]
            wait_for(lambda: any(c['tabId'] == tab and (c.get('latest') or {}).get('decision', {}).get('reason') == 'WHITELISTED'
                                 for c in state()['contexts']), 'fresh ordinary navigation after explicit recovery')
        blocked = open_tab('black.localhost')
        wait_for(lambda: any(c['tabId'] == blocked and c['effect'] == 'REMOVED' and
                             (c.get('latest') or {}).get('decision', {}).get('reason') == 'BLACKLISTED' for c in state()['contexts']),
                 'manual Blacklist still denies after recovery')
        checks.append('recovered authority still enforces manual Blacklist; no permission or new deadline comes from diagnostics')
        if not baseline:
            assert background('''for(let i=0;i<4;i++)window.Promise.reject(new window.TypeError('synthetic private rejection'));
              return true;''') is True
            wait_for(lambda: any(r['subsystem'] == 'UNHANDLED_REJECTION' and r['count'] == 4
                                 for r in client.message({'kind':'GET_DIAGNOSTICS','tabId':None})['runtime']['faults']),
                     'actual native unhandled rejection captured and deduplicated')
            assert state()['controller']['status'] in ['READY', 'LOADING', 'COMMITTING']
            checks.append('actual background unhandled rejections are separately classified and deduplicated; they do not invent a controller INTERNAL_ERROR')
            wait_for(lambda: background('''const saved=JSON.parse(window.localStorage.getItem('atlas-runtime-diagnostic-v1'));
              return saved?.faults.some(f=>f.subsystem==='UNHANDLED_REJECTION'&&f.count===4);'''), 'sanitized diagnostic journal persisted')
            prior = client.message({'kind':'GET_DIAGNOSTICS','tabId':None})['runtime']
            assert background('window.setTimeout(()=>window.location.reload(),0);return true;') is True
            restarted = wait_for(lambda: (d:=client.message({'kind':'GET_DIAGNOSTICS','tabId':None}))
                                and d.get('runtime',{}).get('startedAt') not in [None,prior['startedAt']]
                                and d['runtime'].get('retention')=='READY' and d, 'diagnostics available after background restart',30)
            assert restarted['runtime']['previousSession']['faults']==prior['faults']
            assert restarted['runtime']['previousSession']['version']==expected_version
            assert not restarted['runtime']['faults']
            recovered = ready()
            assert terms(recovered['controller']['snapshot'])==original_terms
            assert recovered['controller']['snapshot']['accessState']['grants']==original_access['grants']
            assert recovered['controller']['snapshot']['vaultState']['pendingProposal']==original_proposal
            checks.append('background restart retains sanitized previous-version evidence without restoring runtime authority or altering saved terms')
    except Exception:
        if artifacts is not None:
            try:
                view = state()
                report = {'controller': {key: view['controller'].get(key) for key in ['status', 'reason', 'internalFault']},
                          'interruption': view.get('authorityInterruption'), 'storage': view.get('storage'),
                          'probe': background('const p=window.__atlasFaultProbe;return {armed:p?.armed,triggered:p?.triggered};')}
                (artifacts/'internal-fault-failure.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            except Exception:
                pass
        raise
    finally:
        background('''const p=window.__atlasFaultProbe;if(p){window.Object.values=p.values;window.Object.keys=p.keys;window.JSON.stringify=p.stringify;
          delete window.__atlasFaultProbe;}return true;''')
    print('PASS native idle internal-fault observability, conservative latch, recovery and unchanged permission terms', flush=True)
    return {'suite': 'internal-fault', 'baseline': baseline, 'checks': checks, 'observations': observations,
            'causeOfUserIncidentEstablished': False, 'normalProfileAccessed': False, 'releaseArtifactsModified': False}
