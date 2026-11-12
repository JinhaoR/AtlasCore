"""Completed-batch editor regression in a disposable Firefox profile.

Uses ordinary UI, a real Vault wait/confirmation and native IndexedDB. Numeric
instrumentation exists only in the supplied disposable runtime copy.
"""
import json
import statistics
import time
from firefox_performance_audit import process_sample


def run_editor_followup(client, ui_handle, ui_url, wait_for, artifacts, root_pid, baseline=False):
    checks, measurements, observations = [], [], []

    def capture_failure(label):
        # Read closed synthetic editor/status fields while the disposable browser
        # still exists. Never dump URLs, policy, credentials or exception text.
        try:
            controller=view().get('controller') or {}
            fields=client.script('''const ids=['site-name','site-hostname','site-category','site-access','site-extra'];
              return {fields:Object.fromEntries(ids.map(id=>{const e=document.getElementById(id);return[id,{value:e.value,disabled:e.disabled,valid:e.checkValidity?.()??null,invalid:e.getAttribute('aria-invalid')}]})),
                feedback:document.getElementById('site-save-feedback').textContent,fieldError:document.getElementById('site-field-error').textContent,
                draftStatus:document.getElementById('destination-draft-status').textContent,editorHidden:document.getElementById('site-draft').hidden,
                sitesStatus:document.getElementById('sites-status').textContent,editorTitle:document.getElementById('site-draft-title').textContent,
                editDisabled:document.getElementById('edit-site').disabled,reviewDisabled:document.getElementById('review-destination-draft').disabled,
                submitDisabled:document.getElementById('submit-destination-draft').disabled,pinned:document.getElementById('site-pin').checked,
                www:document.getElementById('site-www').checked,formValid:document.getElementById('site-form').checkValidity()};''')
            report={'case':label,'status':controller.get('status'),'reason':controller.get('reason'),
                    'policyRevision':(controller.get('snapshot') or {}).get('policyRevision'),'ui':fields,'workspace':workspace()}
        except Exception:
            report={'case':label,'diagnosticsUnavailable':True}
        (artifacts/'editor-failure.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

    def checked_wait(predicate,description,timeout=30):
        try:return wait_for(predicate,description,timeout)
        except Exception:
            capture_failure(description)
            raise

    def view():
        return client.message({'kind': 'GET_VIEW'})['view']

    def snapshot():
        return view()['controller']['snapshot']

    def workspace():
        return client.script('''const done=arguments[0],r=indexedDB.open('atlas-destination-drafts-v1',1);
          r.onsuccess=()=>{const db=r.result,t=db.transaction('workspace','readonly'),q=t.objectStore('workspace').get('current');
            q.onsuccess=()=>{const v=q.result?.value,d=v?.draft;done(v?{revision:q.result.revision,
              draft:d?{count:d.changes.length,editor:d.editor,policyRevision:d.baseline.policyRevision,
                baselineHasRoot:d.baseline.policy.whitelist.includes('root.localhost'),
                changes:d.changes.map(c=>({id:c.id,label:c.after?.metadata.label??c.before?.metadata.label,removed:c.after===null}))}:null,
              receipt:v.receipt?{phase:v.receipt.phase,count:v.receipt.draft.changes.length}:null}:null);};t.oncomplete=()=>db.close();};''', asynchronous=True)

    def ready():
        revision=snapshot()['policyRevision']
        checked_wait(lambda: client.script('return document.getElementById("status").dataset.ready==="true" && !document.getElementById("add-site").disabled && document.getElementById("sites-status").textContent.endsWith("revision "+arguments[0]);',revision), 'verified editor authority at current policy revision',30)

    def saved(count=None, name=None):
        def settled():
            w=workspace()
            return w and w['draft'] and (count is None or w['draft']['count']==count) and (name is None or w['draft']['editor'] and w['draft']['editor']['name']==name) and client.script('return document.getElementById("destination-draft-status").textContent.match(/^Saved (?:editable draft|locally)/);') and w
        return checked_wait(settled, 'acknowledged editor workspace', 45)

    def input_fields(values, pinned=None):
        client.script('''for(const [id,value]of Object.entries(arguments[0])){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}
          if(arguments[1]!==null){const e=document.getElementById('site-pin');e.checked=arguments[1];e.dispatchEvent(new Event('input',{bubbles:true}));}''', values, pinned)

    def select(host):
        input_fields({'sites-search':host})
        return client.script('''const row=[...document.querySelectorAll('#sites-list .site-row')].find(r=>r.title.split(', ').includes(arguments[0]));if(row){row.click();return true;}return false;''',host)

    def stage(count):
        client.script('document.getElementById("site-form").requestSubmit();')
        checked_wait(lambda: client.script('return document.getElementById("site-draft").hidden;'), f'closed acknowledged staged editor {count}',45)
        saved(count)

    def start_measure():
        client.script('window.__atlasPerf.reset();')
        client.script('const done=arguments[0];browser.runtime.getBackgroundPage().then(b=>{b.__atlasPerf.reset();done(true)});',asynchronous=True)
        return time.monotonic(),process_sample(root_pid)

    def finish(name,start,latencies=None):
        elapsed=time.monotonic()-start[0]
        data={'case':name,'seconds':round(elapsed,3),'ui':client.script('return window.__atlasPerf.stop();'),
              'background':client.script('const done=arguments[0];browser.runtime.getBackgroundPage().then(b=>done(b.__atlasPerf.stop()));',asynchronous=True),
              'processBefore':start[1],'processAfter':process_sample(root_pid)}
        if latencies:data['operationMs']={'count':len(latencies),'median':round(statistics.median(latencies),2),'max':round(max(latencies),2),'samples':[round(x,2)for x in latencies]}
        if data['processBefore'] and data['processAfter']:data['aggregateCpuPercent']=round((data['processAfter']['cpuSeconds']-data['processBefore']['cpuSeconds'])/elapsed*100,2)
        measurements.append(data)
        (artifacts/'measurements.json').write_text(json.dumps(measurements,indent=2),encoding='utf-8')
        print('MEASURE',name,'seconds',data['seconds'],'creates',data['ui']['creates'],'median',data.get('operationMs',{}).get('median'),flush=True)
        return data

    assert client.script('return !!window.__atlasPerf;'),'instrumented disposable runtime required'
    ready();initial=snapshot();initial_wikipedia=[h for h in initial['policy']['whitelist']if h in ['wikipedia.org','www.wikipedia.org','en.wikipedia.org','sv.wikipedia.org']]
    client.script('document.getElementById("show-sites").click();')
    started=start_measure();latency=[]
    for i in range(58):
        began=time.monotonic();client.script('document.getElementById("add-site").click();')
        if i==0:
            first=checked_wait(lambda:(w:=workspace())and w['draft']and w['draft']['editor']and w,'initial editor saved at fixture baseline')
            assert first['draft']['policyRevision']==initial['policyRevision'] and first['draft']['baselineHasRoot'], 'fixture draft must start against the already-committed root policy'
        input_fields({'site-name':f'Completed fixture {i}','site-hostname':f'completed-fixture-{i:03d}.example','site-category':'Editor follow-up','site-access':'WHITELIST'},True)
        stage(i+1);latency.append((time.monotonic()-began)*1000)
    # Prepare the same explicitly authorized Wikipedia fixture in both versions;
    # this is not default seeding or a write around Vault.
    existed=select('wikipedia.org')
    client.script('document.getElementById(arguments[0]).click();','edit-site'if existed else'add-site')
    fields={'site-name':'Wikipedia fixture','site-category':'Editor follow-up','site-access':'PRESERVE'if existed else'WHITELIST'}
    if not existed:fields.update({'site-hostname':'wikipedia.org','site-extra':'www.wikipedia.org, en.wikipedia.org, sv.wikipedia.org'})
    input_fields(fields,True);stage(59)
    assert select('root.localhost');client.script('document.getElementById("edit-site").click();')
    input_fields({'site-name':'Inet fixture','site-category':'Editor follow-up','site-access':'PRESERVE'},True);stage(60)
    finish('stage-60-pinned-changes',started,latency)
    assert snapshot()['policy']==initial['policy']
    client.script('document.getElementById("review-destination-draft").click();')
    wait_for(lambda: client.script('return !document.getElementById("submit-destination-draft").disabled;'),'reviewed complete first batch')
    client.script('document.getElementById("submit-destination-draft").click();')
    pending=wait_for(lambda:snapshot()['vaultState']['pendingProposal'],'saved first batch proposal')
    assert pending['readyAt']-pending['createdAt']==initial['configuration']['vaultTiming']['waitMs']
    wait_for(lambda:time.time()*1000>=pending['readyAt'],'real Vault wait',45)
    wait_for(lambda:client.script('return !document.getElementById("confirm-policy").hidden && !document.getElementById("confirm-policy").disabled;'),'explicit confirmation available',20)
    client.script('document.getElementById("confirm-policy").click();')
    wait_for(lambda:(w:=workspace())and w['receipt']and w['receipt']['phase']=='DONE','acknowledged completed receipt',45)
    committed=snapshot();assert committed['vaultState']['pendingProposal']is None
    assert committed['policyRevision']==initial['policyRevision']+1
    checks.append('60 mixed destination/pin changes use one real Vault wait and explicit confirmation; completion is acknowledged')
    client.script('document.getElementById("show-sites").click();');ready()
    started=start_measure();time.sleep(10);finish('idle-with-completed-60-item-receipt',started)
    started=start_measure();latency=[]
    for i in range(12):
        began=time.monotonic();client.script('document.getElementById(arguments[0]).click();','show-home'if i%2==0 else'show-sites');latency.append((time.monotonic()-began)*1000)
    finish('home-sites-with-completed-receipt',started,latency)
    # A real new control document measures cold presentation load with historical
    # receipt data. Its initial instrumentation is inactive; report wall time.
    began=time.monotonic();previous=ui_handle;handles=client.call('WebDriver:GetWindowHandles')
    client.call('Marionette:SetContext',value='chrome');client.script('gBrowser.selectedTab=gBrowser.addTrustedTab(arguments[0]);',ui_url)
    client.call('Marionette:SetContext',value='content');ui_handle=wait_for(lambda:next((h for h in client.call('WebDriver:GetWindowHandles')if h not in handles),None),'new control page')
    client.call('WebDriver:SwitchToWindow',handle=previous);client.call('WebDriver:CloseWindow');client.call('WebDriver:SwitchToWindow',handle=ui_handle)
    wait_for(lambda:client.script('return document.readyState==="complete" && !!window.__atlasPerf && document.getElementById("status").dataset.ready==="true";'),'reopened Home',30)
    home_ms=(time.monotonic()-began)*1000;began=time.monotonic();client.script('document.getElementById("show-sites").click();');ready()
    observations.append({'case':'reopen-completed-workspace','homeMs':round(home_ms,2),'sitesMs':round((time.monotonic()-began)*1000,2)})
    # Reproduce the screenshot: one staged Wikipedia removal plus a blank Add
    # editor, then select the committed Inet fixture and press Edit.
    assert select('wikipedia.org');client.script('document.getElementById("remove-site").click();');saved(1)
    client.script('document.getElementById("add-site").click();');saved(1,'')
    assert select('root.localhost');client.script('document.getElementById("edit-site").click();')
    if not baseline:wait_for(lambda:client.script('return document.getElementById("site-hostname").value==="root.localhost" && document.getElementById("site-name").value==="Inet fixture";'),'retarget pristine Add editor to Inet',20)
    else:time.sleep(.25)
    retarget=client.script('return {name:document.getElementById("site-name").value,hostname:document.getElementById("site-hostname").value,feedback:document.getElementById("site-save-feedback").textContent,reviewDisabled:document.getElementById("review-destination-draft").disabled};')
    observations.append({'case':'pristine-add-to-inet','retargeted':retarget['hostname']=='root.localhost',**retarget})
    if baseline and retarget['hostname']!='root.localhost':
        client.script('document.getElementById("cancel-site-draft").click();')
        wait_for(lambda:workspace()['draft']['editor']is None,'baseline explicit close workaround')
        assert select('root.localhost');client.script('document.getElementById("edit-site").click();')
        wait_for(lambda:client.script('return document.getElementById("site-hostname").value==="root.localhost";'),'baseline ordinary edit after closing blank editor')
    input_fields({'site-name':'Inet pending edit'});saved(1,'Inet pending edit')
    client.script('document.getElementById("review-destination-draft").click();')
    if not baseline:wait_for(lambda:client.script('return document.querySelector("#destination-draft-items .draft-item>div").children.length>=4;'),'review visible with open editor')
    review=client.script('return {reviewDisabled:document.getElementById("review-destination-draft").disabled,submitDisabled:document.getElementById("submit-destination-draft").disabled,editorVisible:!document.getElementById("site-draft").hidden,name:document.getElementById("site-name").value};')
    assert review['submitDisabled']and review['name']=='Inet pending edit'and review['editorVisible']
    if not baseline:assert not review['reviewDisabled']
    observations.append({'case':'review-with-open-editor',**review})
    # Let bounded icon probes settle before a matched raw-input workload.
    time.sleep(10);started=start_measure();latency=[];total_events=0
    for i in range(12):
        count=11 if i<4 else 12;total_events+=count;began=time.monotonic()
        client.script('''const e=document.getElementById('site-name');for(let k=0;k<arguments[1];k++){e.value='Inet pending edit '+arguments[0]+' '+k;e.dispatchEvent(new Event('input',{bubbles:true}));}''',i,count)
        saved(1,f'Inet pending edit {i} {count-1}');latency.append((time.monotonic()-began)*1000)
    rapid=finish('140-raw-inputs-after-completed-batch',started,latency);rapid['inputEvents']=total_events
    last=workspace();assert last['draft']['editor']['name']=='Inet pending edit 11 11'
    assert last['draft']['editor']['hostname']=='root.localhost'and last['draft']['count']==1
    assert last['receipt']['phase']=='DONE'and last['receipt']['count']==60
    checks.append('rapid raw inputs retain the final exact target and durable value beside an unchanged completed receipt')
    client.script('document.getElementById("site-form").requestSubmit();');saved(2)
    wait_for(lambda:client.script('return document.getElementById("site-draft").hidden;'),'stage edited Inet fixture')
    client.script('document.getElementById("review-destination-draft").click();')
    wait_for(lambda:client.script('return !document.getElementById("submit-destination-draft").disabled;'),'staged complete batch can be reviewed normally')
    final=snapshot();assert final['policy']==committed['policy']and final['policyRevision']==committed['policyRevision']
    assert final['vaultState']['pendingProposal']is None and final['vaultState']['nextProposalId']==committed['vaultState']['nextProposalId']
    if not baseline:checks.append('unused Add editor retargets to Inet; dirty editor can preview staged removal while submission stays blocked; staging then reviewing works')
    checks.append('all editable actions and review leave active policy and Vault counters unchanged')
    report={'baseline':baseline,'initialWikipediaHosts':initial_wikipedia,'completedItems':60,'measurements':measurements,'observations':observations,'checks':checks,
            'finalDraft':workspace(),'limits':['Synthetic instrumented Firefox timings are not actual user latency.','Native Windows process counters are not retained JavaScript heap measurements.','The same explicit Wikipedia fixture is added/reviewed through Vault for this workflow test; it is not a bundled default.']}
    (artifacts/'measurements.json').write_text(json.dumps(measurements,indent=2),encoding='utf-8')
    return report
