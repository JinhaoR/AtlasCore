"""Milestone A: rendered UI failure/retry tests in a disposable Firefox profile."""
import base64
import time


def run_ui_reliability(client, ui_handle, ui_url, port, wait_for, artifacts):
    checks = []

    def snapshot():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']['controller']['snapshot']

    def input_value(id, value):
        client.script('const el=document.getElementById(arguments[0]);el.value=arguments[1];el.dispatchEvent(new Event("input",{bubbles:true}));', id, value)

    def capture(name):
        shot = client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)
        (artifacts / f'{name}.png').write_bytes(base64.b64decode(shot))

    def workspace():
        return client.script('''const done=arguments[0];const r=indexedDB.open('atlas-destination-drafts-v1',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('workspace','readonly');const q=tx.objectStore('workspace').get('current');q.onsuccess=()=>done(q.result?.value??null);tx.oncomplete=()=>db.close();};''', asynchronous=True)

    def submit_batch():
        client.script('document.getElementById("site-form").requestSubmit();')
        wait_for(lambda: client.script('return document.getElementById("site-draft").hidden && document.getElementById("destination-draft-status").textContent.startsWith("Saved editable draft");'), 'local staged change saved')
        client.script('document.getElementById("review-destination-draft").click();')
        wait_for(lambda: client.script('return !document.getElementById("submit-destination-draft").disabled;'), 'batch valid against verified authority')
        client.script('document.getElementById("submit-destination-draft").click();')

    def confirm(proposal):
        wait_for(lambda: time.time() * 1000 >= proposal['readyAt'], 'protected Vault wait', 40)
        wait_for(lambda: client.script('return !document.getElementById("confirm-policy").hidden && !document.getElementById("confirm-policy").disabled;'), 'verified confirmation available')
        client.script('document.getElementById("confirm-policy").click();')
        wait_for(lambda: snapshot()['vaultState']['pendingProposal'] is None, 'acknowledged Vault commit')

    baseline = snapshot()
    wait_for(lambda: client.script('return document.getElementById("destinations").dataset.phase==="READY";'), 'initial verified Home')
    count = client.script('return document.querySelectorAll("#destination-list .destination-card").length;')
    client.script('''window.__atlasTransport=browser.runtime.sendMessage;
      browser.runtime.sendMessage=function(message,...rest){if(message?.kind==='GET_VIEW')return Promise.reject(new Error('synthetic unavailable UI'));return window.__atlasTransport.call(browser.runtime,message,...rest);};''')
    wait_for(lambda: client.script('return document.getElementById("destinations").dataset.phase==="UNAVAILABLE";'), 'failed Home query')
    assert client.script('return document.getElementById("empty-destinations").hidden && document.getElementById("pinned-empty").hidden && !document.getElementById("destination-state").hidden && [...document.querySelectorAll(".destination-open")].every(b=>b.disabled);')
    assert client.script('return document.querySelectorAll("#destination-list .destination-card").length;') == count
    assert 'last verified' in client.script('return document.getElementById("destination-state-message").textContent;')
    capture('ui-unavailable-stale')
    client.script('browser.runtime.sendMessage=window.__atlasTransport;delete window.__atlasTransport;document.getElementById("retry-destinations").click();')
    wait_for(lambda: client.script('return document.getElementById("destinations").dataset.phase==="READY";'), 'Home retry recovery')
    assert snapshot()['policy'] == baseline['policy']
    checks.append('failed authority query retains labelled stale cards, hides fake empty messages, disables openings and recovers')

    # Real search handlers must send the exact selected host through the ordinary adapter path.
    client.script('''window.__atlasSearchTransport=browser.runtime.sendMessage;window.__atlasSearchCommands=[];
      browser.runtime.sendMessage=function(message,...rest){if(message?.kind==='OPEN_DESTINATION')window.__atlasSearchCommands.push(message);return window.__atlasSearchTransport.call(browser.runtime,message,...rest);};''')
    input_value('destination-search', 'outlook.office.com')
    assert client.script('return document.querySelector("#search-results small").textContent;') == 'outlook.office.com'
    client.script('document.getElementById("search-result-0").click();')
    wait_for(lambda: client.script('return window.__atlasSearchCommands.length===1;'), 'search click translated')
    assert client.script('return window.__atlasSearchCommands[0].url;') == 'https://outlook.office.com/'
    # The request is actually evaluated, even though no successful remote login is claimed.
    wait_for(lambda: any(c['hostname'] == 'outlook.office.com' and c['latest'] for c in client.message({'kind': 'GET_VIEW'})['view']['contexts']), 'search passed to Core')
    input_value('destination-search', 'Outlook')
    assert client.script('return document.querySelector("#search-results small").textContent;') == 'outlook.com'
    input_value('destination-search', 'www.github.com')
    assert client.script('return document.querySelector("#search-results small").textContent;') == 'www.github.com'
    input_value('destination-search', 'outlook.')
    assert client.script('return [...document.querySelectorAll("#search-results small")].map(n=>n.textContent);').count('outlook.office.com') == 1
    input_value('destination-search', 'outlook.office.com.evil.example')
    assert client.script('return document.getElementById("search-results").hidden;')
    client.script('browser.runtime.sendMessage=window.__atlasSearchTransport;delete window.__atlasSearchTransport;delete window.__atlasSearchCommands;')
    # Search may create another Atlas page when a remote redirect is Greylist. Keep
    # one UI owner for page-local injected write failures (real quota failures are global).
    client.script('const done=arguments[0];browser.tabs.getCurrent().then(current=>browser.tabs.query({}).then(tabs=>Promise.all(tabs.filter(tab=>tab.id!==current.id).map(tab=>browser.tabs.remove(tab.id))))).then(()=>done(true));', asynchronous=True)
    input_value('destination-search', '')
    checks.append('rendered exact-host click goes through adapter/Core, aliases stay exact, service names default and ambiguous entry points are separate')

    def edit_arxiv(label):
        client.script('document.getElementById("show-sites").click();')
        input_value('sites-search', 'arxiv.org')
        wait_for(lambda: client.script('return document.querySelectorAll(".site-row").length===1 && !document.getElementById("add-site").disabled;'), 'Sites ready')
        client.script('document.querySelector(".site-row").click();document.getElementById("edit-site").click();')
        input_value('site-name', label)

    edit_arxiv('Failed native label')
    client.script('''window.__atlasWrite=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key==='atlas-destinations-v1')throw new Error('synthetic write failure');return window.__atlasWrite.call(this,key,value);};
      document.getElementById('save-site-display').click();''')
    wait_for(lambda: client.script('return document.getElementById("site-name").value==="Failed native label" && !document.getElementById("retry-site-save").hidden && document.getElementById("feedback").getAttribute("role")==="alert";'), 'failed display write retains frozen retry')
    assert client.script('return !(JSON.parse(localStorage.getItem("atlas-destinations-v1"))?.destinations??[]).some(d=>d.label==="Failed native label");')
    client.script('document.getElementById("add-site").click();')
    assert client.script('return document.getElementById("site-name").value;') == 'Failed native label'
    capture('ui-display-failed-draft')
    client.script('Storage.prototype.setItem=window.__atlasWrite;delete window.__atlasWrite;document.getElementById("retry-site-save").click();')
    wait_for(lambda: workspace()['receipt']['phase']=='DONE', 'explicit display retry')
    assert snapshot()['policy'] == baseline['policy'] and snapshot()['policyRevision'] == baseline['policyRevision']
    assert client.script('return document.getElementById("feedback").getAttribute("role");') == 'status'
    # Milestone C returns editing focus to the selected committed destination.
    assert client.script('return document.activeElement.dataset.destinationId;') == 'service:arxiv.org'
    client.call('WebDriver:Refresh')
    wait_for(lambda: client.script('return document.getElementById("status").dataset.ready==="true";'), 'reload after display retry')
    assert client.script('return JSON.parse(localStorage.getItem("atlas-destinations-v1")).destinations[0].label;') == 'Failed native label'
    checks.append('failed rendered display save preserves draft, no false saved values, explicit retry, focus return and reload persistence')

    # Reduce only fixture wait via a real protected settings proposal; first proposal uses old protection.
    client.script('document.getElementById("show-settings").click();')
    input_value('vault-wait', '0.1')
    input_value('vault-window', '60')
    client.script('document.getElementById("settings-form").requestSubmit();')
    pending = wait_for(lambda: snapshot()['vaultState']['pendingProposal'], 'settings proposal')
    wait_for(lambda: client.script('return document.getElementById("feedback").textContent.includes("Vault proposal saved") && document.getElementById("vault-phase").textContent==="Waiting";'), 'saved proposal feedback')
    assert client.script('return document.getElementById("feedback").getAttribute("role");') == 'status'
    client.script('document.getElementById("show-sites").click();')
    assert client.script('return !document.getElementById("sites-pending").hidden && document.getElementById("submit-destination-draft").disabled;')
    client.script('document.getElementById("sites-review-pending").click();')
    assert client.script('return document.getElementById("vault-section").open;')
    confirm(pending)
    wait_for(lambda: client.script('return document.getElementById("feedback").textContent.includes("Vault change committed");'), 'committed feedback')
    checks.append('saved proposal and waiting/ready/committed states, pending Sites explanation and link, routine status semantics')

    edit_arxiv('Protected native label')
    input_value('site-access', 'BLACKLIST')
    submit_batch()
    pending = wait_for(lambda: snapshot()['vaultState']['pendingProposal'], 'mixed policy/display proposal')
    wait_for(lambda: workspace()['receipt']['phase']=='PROPOSED', 'durable batch display receipt')
    client.script('''window.__atlasWrite=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key==='atlas-destinations-v1')throw new Error('synthetic post-commit display failure');return window.__atlasWrite.call(this,key,value);};''')
    confirm(pending)
    wait_for(lambda: client.script('return document.getElementById("site-save-feedback").textContent.startsWith("Policy committed and is active");'), 'truthful partial outcome')
    assert 'arxiv.org' in snapshot()['policy']['blacklist']
    assert client.script('return JSON.parse(localStorage.getItem("atlas-destinations-v1")).destinations[0].label;') == 'Failed native label'
    client.script('Storage.prototype.setItem=window.__atlasWrite;delete window.__atlasWrite;document.getElementById("show-sites").click();document.getElementById("retry-site-save").click();')
    wait_for(lambda: workspace()['receipt']['phase']=='DONE', 'display-only recovery after commit')
    assert client.script('return JSON.parse(localStorage.getItem("atlas-destinations-v1")).destinations[0].label;') == 'Protected native label'
    assert snapshot()['vaultState']['pendingProposal'] is None
    checks.append('actual Core commit with failed accompanying display write reports partial success and retries display without another proposal')

    saved_policy = snapshot()['policy']
    response = client.message({'kind': 'PROPOSE_POLICY', 'candidatePolicy': {'whitelist': [], 'blacklist': saved_policy['blacklist']}})
    pending = response['view']['controller']['snapshot']['vaultState']['pendingProposal']
    client.script('document.getElementById("show-settings").click();document.getElementById("vault-section").open=true;')
    confirm(pending)
    client.script('document.getElementById("show-home").click();')
    wait_for(lambda: client.script('return document.getElementById("destinations").dataset.phase==="EMPTY" && !document.getElementById("empty-destinations").hidden;'), 'verified empty Home')
    assert client.script('return document.getElementById("destination-state").hidden;')
    response = client.message({'kind': 'PROPOSE_POLICY', 'candidatePolicy': saved_policy})
    client.script('document.getElementById("show-settings").click();document.getElementById("vault-section").open=true;')
    confirm(response['view']['controller']['snapshot']['vaultState']['pendingProposal'])
    client.script('document.getElementById("show-home").click();')
    wait_for(lambda: client.script('return document.getElementById("destinations").dataset.phase==="READY";'), 'restored verified collection')
    checks.append('genuine empty collection is distinct from unavailable and recovers through ordinary protected policy changes')
    capture('ui-reliability-home')
    return {'checks': checks, 'profile': 'isolated synthetic fixture', 'signedReleaseModified': False}
