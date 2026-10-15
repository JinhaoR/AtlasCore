"""Milestone B: native UI + real IndexedDB in a disposable Firefox profile."""
import base64
import time


def run_destination_batch(client, ui_handle, ui_url, wait_for, artifacts, restart_browser):
    checks = []

    def state():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']['controller']['snapshot']

    def workspace():
        return client.script('''const done=arguments[0];const r=indexedDB.open('atlas-destination-drafts-v1',1);
          r.onsuccess=()=>{const db=r.result;const tx=db.transaction('workspace','readonly');const q=tx.objectStore('workspace').get('current');q.onsuccess=()=>done(q.result?.value??null);tx.oncomplete=()=>db.close();};r.onerror=()=>done(null);''', asynchronous=True)

    def input_value(id, value):
        client.script('const el=document.getElementById(arguments[0]);el.value=arguments[1];el.dispatchEvent(new Event("input",{bubbles:true}));', id, value)

    def ready():
        revision = state()['policyRevision']
        wait_for(lambda: client.script('return document.getElementById("status").dataset.ready==="true" && !document.getElementById("add-site").disabled && document.getElementById("sites-status").textContent.endsWith("revision "+arguments[0]);', revision), 'verified authority and draft storage ready at current revision', 20)

    def stage(host, classification='WHITELIST', label=None, category='Books', www=False):
        client.script('document.getElementById("show-sites").click();document.getElementById("add-site").click();')
        input_value('site-name', label or host)
        input_value('site-hostname', host)
        input_value('site-access', classification)
        input_value('site-category', category)
        client.script('document.getElementById("site-www").checked=arguments[0];document.getElementById("site-www").dispatchEvent(new Event("input"));', www)
        client.script('document.getElementById("site-form").requestSubmit();')
        wait_for(lambda: client.script('return document.getElementById("site-draft").hidden && document.getElementById("destination-draft-status").textContent.startsWith("Saved editable draft");'), 'staged destination acknowledged')

    def review_submit():
        client.script('document.getElementById("review-destination-draft").click();')
        wait_for(lambda: client.script('return !document.getElementById("submit-destination-draft").disabled;'), 'valid reviewed batch')
        client.script('document.getElementById("submit-destination-draft").click();')

    def confirm(p):
        wait_for(lambda: time.time() * 1000 >= p['readyAt'], 'existing real Vault wait', 45)
        wait_for(lambda: client.script('return !document.getElementById("confirm-policy").hidden && !document.getElementById("confirm-policy").disabled;'), 'Core confirmation available')
        client.script('document.getElementById("confirm-policy").click();')
        wait_for(lambda: state()['vaultState']['pendingProposal'] is None, 'complete authoritative commit')

    def open_ui():
        client.call('Marionette:SetContext', value='chrome')
        client.script('gBrowser.selectedTab=gBrowser.addTrustedTab(arguments[0]);', ui_url)
        client.call('Marionette:SetContext', value='content')
        handle = client.call('WebDriver:GetWindowHandles')[-1]
        client.call('WebDriver:SwitchToWindow', handle=handle)
        wait_for(lambda: client.script('return document.readyState==="complete" && location.href.split(/#/,1)[0]===arguments[0];', ui_url), 'reopened Atlas page')
        return handle

    ready()
    initial = state()
    stage('batch-one.example', label='First research')
    stage('batch-two.example')
    stage('batch-three.example')
    stage('batch-block-one.example', 'BLACKLIST')
    stage('batch-block-two.example', 'BLACKLIST')
    input_value('sites-search', 'black.localhost')
    client.script('document.querySelector(".site-row").click();document.getElementById("remove-site").click();')
    wait_for(lambda: len(workspace()['draft']['changes']) == 6, 'explicit removal staged')
    input_value('sites-search', 'root.localhost')
    client.script('document.querySelector(".site-row").click();document.getElementById("edit-site").click();')
    input_value('site-name', 'Research root')
    input_value('site-category', ' BOOKS ')
    client.script('document.getElementById("site-pin").checked=true;document.getElementById("site-pin").dispatchEvent(new Event("input"));document.getElementById("site-form").requestSubmit();')
    wait_for(lambda: (w := workspace()) and len(w['draft']['changes']) == 7 and w['draft']['editor'] is None, 'mixed seven-item draft saved')
    assert state()['policy'] == initial['policy'] and state()['vaultState']['pendingProposal'] is None
    assert client.script('return [...document.querySelectorAll("#site-categories option")].map(o=>o.value);').count('Books') == 1
    checks.append('three Whitelist additions, two Blacklist additions, explicit removal and name/category/pin edit staged together without policy or waiting')

    # Close/reopen the actual UI, then fully restart the Firefox process before submission.
    client.call('Marionette:SetContext', value='chrome')
    client.script('gBrowser.addTrustedTab("about:blank");')
    client.call('Marionette:SetContext', value='content')
    client.call('WebDriver:CloseWindow')
    ui_handle = open_ui()
    ready()
    assert len(workspace()['draft']['changes']) == 7
    client, ui_handle = restart_browser()
    ready()
    assert len(workspace()['draft']['changes']) == 7 and state()['policy'] == initial['policy']
    client.script('document.getElementById("show-sites").click();')
    review_submit()
    pending = wait_for(lambda: state()['vaultState']['pendingProposal'], 'one complete frozen batch')
    assert pending['readyAt'] - pending['createdAt'] == initial['configuration']['vaultTiming']['waitMs']
    assert state()['policy'] == initial['policy']
    assert client.message({'kind': 'CONFIRM_POLICY', 'proposalId': pending['id']})['result']['reason'] == 'NOT_READY'
    wait_for(lambda: client.script('return !document.getElementById("vault-destination-review").hidden && document.querySelectorAll("#vault-destination-items li").length===7;'), 'complete frozen destination review')
    wait_for(lambda: client.script('return document.getElementById("vault-phase").textContent==="Waiting" && document.getElementById("vault-impact").textContent.startsWith("Policy changes invalidate");'), 'verified Core wait and policy impact before review capture')
    shot = client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)
    (artifacts / 'batch-vault-review.png').write_bytes(base64.b64decode(shot))
    checks.append('editable draft survives closing UI and a full Firefox process restart; complete destination review and unchanged old-term Vault wait')

    # Fail the display stage after the real Core commit, then restart before explicit retry.
    client.script('''window.__atlasWrite=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='atlas-destinations-v1')throw Error('synthetic presentation failure');return window.__atlasWrite.call(this,k,v);};''')
    confirm(pending)
    wait_for(lambda: (w := workspace()) and w['receipt']['phase'] == 'APPLYING', 'durable failed display receipt')
    wait_for(lambda: client.script('return document.getElementById("site-save-feedback").textContent.startsWith("Policy committed and is active");'), 'truthful partial success')
    committed = state()
    assert {'batch-one.example', 'batch-two.example', 'batch-three.example'} <= set(committed['policy']['whitelist'])
    assert {'batch-block-one.example', 'batch-block-two.example'} <= set(committed['policy']['blacklist'])
    assert 'black.localhost' not in committed['policy']['blacklist']
    assert committed['policyRevision'] == initial['policyRevision'] + 1
    assert client.message({'kind': 'CONFIRM_POLICY', 'proposalId': pending['id']})['result']['reason'] == 'ALREADY_COMMITTED'
    client, ui_handle = restart_browser()
    wait_for(lambda: client.script('return document.getElementById("status").dataset.ready==="true" && !document.getElementById("retry-site-save").hidden && !document.getElementById("retry-site-save").disabled;'), 'pending display retry after full restart')
    assert workspace()['receipt']['phase'] == 'APPLYING', 'restart must not repeat failed writes automatically'
    client.script('document.getElementById("show-sites").click();document.getElementById("retry-site-save").click();')
    try:
        wait_for(lambda: workspace()['receipt']['phase'] == 'DONE', 'explicit idempotent display recovery')
    except AssertionError:
        print('Display retry diagnostics:', client.script('return {feedback:document.getElementById("site-save-feedback").textContent,phase:document.getElementById("destination-receipt-status").textContent,disabled:document.getElementById("retry-site-save").disabled,status:document.getElementById("destination-draft-status").textContent};'), flush=True)
        raise
    assert state()['policy'] == committed['policy'] and state()['vaultState']['nextProposalId'] == committed['vaultState']['nextProposalId']
    assert client.script('return JSON.parse(localStorage.getItem("atlas-destinations-v1")).destinations.find(d=>d.id==="host:root.localhost").label;') == 'Research root'
    assert client.script('return JSON.parse(localStorage.getItem("atlas-home-pins-v1")).includes("host:root.localhost");')
    checks.append('one explicit confirmation commits entire candidate once; replay rejected; post-commit display failure survives full restart and retries only presentation')

    # An unrelated Core commit makes a preserved draft stale; it cannot submit until accepted.
    ready()
    stage('stale-draft.example')
    before = state()
    proposal = client.message({'kind': 'PROPOSE_POLICY', 'candidatePolicy': {'whitelist': before['policy']['whitelist'] + ['elsewhere.example'], 'blacklist': before['policy']['blacklist']}})['view']['controller']['snapshot']['vaultState']['pendingProposal']
    client.script('document.getElementById("show-settings").click();document.getElementById("vault-section").open=true;')
    confirm(proposal)
    client.script('document.getElementById("show-sites").click();document.getElementById("review-destination-draft").click();')
    wait_for(lambda: client.script('return !document.getElementById("destination-draft-stale").hidden && document.getElementById("submit-destination-draft").disabled;'), 'stale draft blocks submission')
    client.script('document.getElementById("reconcile-destination-draft").click();')
    wait_for(lambda: client.script('return !document.getElementById("draft-reconciliation").hidden && !document.getElementById("accept-draft-reconciliation").disabled;'), 'verified reconciliation preview')
    assert workspace()['draft']['baseline']['policyRevision'] == before['policyRevision']
    client.script('document.getElementById("accept-draft-reconciliation").click();')
    wait_for(lambda: workspace()['draft']['baseline']['policyRevision'] == state()['policyRevision'], 'explicit accepted reconciliation')
    assert state()['vaultState']['pendingProposal'] is None
    checks.append('unrelated commit stales preserved draft; explicit reconciliation preview and acceptance do not create permission or submit automatically')
    client.script('document.getElementById("show-home").click();')
    wait_for(lambda: client.script('return [...document.querySelectorAll(".service-group")].some(g=>g.dataset.category==="Books");'), 'Home groups committed custom category')
    checks.append('custom Books category reused across editor and committed Home grouping without rewriting legacy records or changing category ordering controls')

    # Two actual Atlas pages share one versioned draft, without silent overwrites.
    first_handle = ui_handle
    ui_handle = open_ui()
    ready()
    client.script('document.getElementById("show-sites").click();document.getElementById("add-site").click();')
    input_value('site-name', 'Second Atlas page')
    wait_for(lambda: workspace()['draft']['editor']['name']=='Second Atlas page', 'second-page input saved')
    second_handle = ui_handle
    ui_handle = first_handle
    client.call('WebDriver:SwitchToWindow', handle=ui_handle)
    client.script('document.getElementById("show-sites").click();')
    wait_for(lambda: client.script('return !document.getElementById("reload-shared-draft").hidden && document.getElementById("add-site").disabled;'), 'first-page conflict retained')
    assert workspace()['draft']['editor']['name'] == 'Second Atlas page'
    client.script('setTimeout(()=>document.getElementById("reload-shared-draft").click(),0);')
    def prompt():
        try:
            return client.call('WebDriver:GetAlertText')
        except RuntimeError:
            return None
    wait_for(prompt, 'explicit shared-draft reload prompt')
    client.call('WebDriver:AcceptAlert')
    wait_for(lambda: client.script('return document.getElementById("site-name").value==="Second Atlas page" && document.getElementById("reload-shared-draft").hidden;'), 'shared draft reloaded explicitly')
    client.call('WebDriver:SwitchToWindow', handle=second_handle)
    client.call('WebDriver:CloseWindow')
    client.call('WebDriver:SwitchToWindow', handle=ui_handle)
    checks.append('two native Atlas pages detect a changed shared draft, retain local work and explicitly reload without overwriting the other page')

    # Fail only draft writes, leaving Core's distinct database unaffected.
    client.script('''window.__atlasPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='workspace')throw Error('synthetic draft write failure');return window.__atlasPut.call(this,value,...args);};''')
    input_value('site-hostname', 'unsaved-local.example')
    wait_for(lambda: client.script('return document.getElementById("destination-draft-status").textContent.startsWith("Unsaved local work");'), 'draft write failure surfaced')
    assert client.script('return document.getElementById("site-hostname").value;') == 'unsaved-local.example'
    assert workspace()['draft']['editor']['hostname'] == ''
    assert client.script('return document.getElementById("submit-destination-draft").disabled;')
    client.script('IDBObjectStore.prototype.put=window.__atlasPut;delete window.__atlasPut;document.getElementById("retry-destination-draft").click();')
    wait_for(lambda: workspace()['draft']['editor']['hostname']=='unsaved-local.example', 'explicit local draft persistence retry')
    client.script('document.getElementById("site-form").requestSubmit();')
    wait_for(lambda: workspace()['draft']['editor'] is None and len(workspace()['draft']['changes'])==2, 'continued draft saved without submission')
    assert state()['vaultState']['pendingProposal'] is None and 'unsaved-local.example' not in state()['policy']['whitelist']
    shot = client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)
    (artifacts / 'batch-local-editor.png').write_bytes(base64.b64decode(shot))
    checks.append('real draft transaction failure retains raw inputs and blocks submission; explicit local retry saves work without policy commands')
    persisted_policy = state()['policy']
    client, ui_handle = restart_browser()
    ready()
    assert len(workspace()['draft']['changes'])==2
    assert state()['policy']==persisted_policy and state()['vaultState']['pendingProposal'] is None
    assert client.script('return JSON.parse(localStorage.getItem("atlas-destinations-v1")).destinations.find(d=>d.id==="host:root.localhost").label;') == 'Research root'
    checks.append('final full process restart retains completed policy/display/pins and separately preserves the next editable unsubmitted draft')
    # A lost submission followed by another proposal leaves ambiguous history.
    # Recovery must settle Core, then discard only explicitly chosen local terms.
    client.script('''window.__atlasSend=browser.runtime.sendMessage;window.__atlasLost=true;window.__atlasProposals=0;
      browser.runtime.sendMessage=function(message,...rest){if(message?.kind==='PROPOSE_POLICY'){++window.__atlasProposals;if(window.__atlasLost){window.__atlasLost=false;return Promise.resolve(undefined);}}return window.__atlasSend.call(browser.runtime,message,...rest);};
      document.getElementById('show-sites').click();''')
    review_submit()
    wait_for(lambda: workspace()['receipt']['phase']=='PREPARED', 'frozen uncertain submission')
    other = client.message({'kind':'PROPOSE_POLICY','candidatePolicy':{'whitelist':persisted_policy['whitelist']+['other-proposal.example'],'blacklist':persisted_policy['blacklist']}})['view']['controller']['snapshot']['vaultState']['pendingProposal']
    client.message({'kind':'CANCEL_POLICY','proposalId':other['id']})
    wait_for(lambda: client.script('return !document.getElementById("keep-current-display").hidden && !document.getElementById("keep-current-display").disabled && document.getElementById("keep-current-display").textContent==="Discard uncorrelated local batch";'), 'safe exit for uncorrelated history')
    attempts = client.script('return window.__atlasProposals;')
    client.script('setTimeout(()=>document.getElementById("keep-current-display").click(),0);')
    wait_for(prompt, 'explicit local intent discard prompt')
    client.call('WebDriver:AcceptAlert')
    wait_for(lambda: workspace()['receipt']['phase']=='KEPT' and workspace()['draft'] is None, 'verified recovery and acknowledged local-only discard')
    assert state()['policy']==persisted_policy and state()['vaultState']['pendingProposal'] is None
    assert client.script('return window.__atlasProposals;')==attempts, 'local recovery cannot submit another policy'
    client.script('browser.runtime.sendMessage=window.__atlasSend;delete window.__atlasSend;delete window.__atlasLost;delete window.__atlasProposals;')
    checks.append('lost response plus unrelated proposal ID advancement has an explicit local discard after Core recovery; saved policy retained and no repeat proposal or confirmation')
    print('PASS native persistent batch, full Firefox restarts, one Vault cycle, frozen review, partial display retry and stale reconciliation', flush=True)
    return {'checks': checks, 'fullFirefoxRestarts': 3, 'isolatedProfile': True, 'signedReleaseModified': False, 'coreSemanticsChanged': False}
