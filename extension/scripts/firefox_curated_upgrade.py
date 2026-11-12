"""One-time preset upgrade through real Firefox/IndexedDB, never an everyday profile."""
from copy import deepcopy
import time


def run_curated_upgrade(client, port, wait_for, restart_browser, configure_policy, already_applied=False):
    if already_applied:
        return run_applied_curated_upgrade(client, port, wait_for, restart_browser, configure_policy)
    checks = []

    def view():
        return client.message({'kind': 'GET_VIEW'})['view']

    def ready():
        return wait_for(lambda: (v := view()) and (v.get('controller') or {}).get('status') == 'READY' and v, 'verified upgrade authority', 30)

    initial = ready()['controller']['snapshot']
    assert 'curatedUpgrade' not in view(), 'fixture must start on the preserved 0.1.17 runtime'
    legacy_policy = {'whitelist': [h for h in initial['policy']['whitelist'] if h not in ['youtube.com', 'www.youtube.com']] + ['outside-preset.localhost'],
                     'blacklist': ['black.localhost', 'figma.com']}
    configure_policy(client, legacy_policy)
    changed_configuration = deepcopy(ready()['controller']['snapshot']['configuration'])
    changed_configuration['accessTiming']['grantDurationMs'] += 12345
    proposed = client.message({'kind': 'PROPOSE_SETTINGS', 'candidateConfiguration': changed_configuration})
    assert proposed['result']['type'] == 'COMMITTED'
    proposal = proposed['view']['controller']['snapshot']['vaultState']['pendingProposal']
    wait_for(lambda: time.time()*1000 >= proposal['readyAt'], 'real protected settings wait', 45)
    assert client.message({'kind': 'CONFIRM_POLICY', 'proposalId': proposal['id']})['result']['type'] == 'COMMITTED'
    pins = client.script('localStorage.setItem("atlas-home-pins-v1",JSON.stringify(["service:github.com"]));return localStorage.getItem("atlas-home-pins-v1");')
    checks.append('preserved signed baseline stores custom extra hosts, a manual Blacklist, removed defaults, pins and custom protected timing through real Vault waits')

    tab = client.script('const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));', f'http://pending.localhost:{port}/', asynchronous=True)
    wait_for(lambda: any(c['tabId'] == tab and c['effect'] == 'REMOVED' for c in view()['contexts']), 'legacy Greylist request page')
    prepared = client.message({'kind': 'PREPARE_ACCESS', 'tabId': tab})
    scope = next(c['accessScope'] for c in prepared['view']['contexts'] if c['tabId'] == tab)
    assert client.message({'kind': 'START_ACCESS', 'tabId': tab, 'scopeId': scope['id']})['result']['type'] == 'COMMITTED'
    candidate = deepcopy(ready()['controller']['snapshot']['policy'])
    candidate['whitelist'].append('frozen-proposal.localhost')
    assert client.message({'kind': 'PROPOSE_POLICY', 'candidatePolicy': candidate})['result']['type'] == 'COMMITTED'
    before = deepcopy(ready()['controller']['snapshot'])

    # Production deployment replaces the XPI with Firefox closed. Model that
    # boundary, preserving the signed baseline's origin/storage across restart.
    client, _ = restart_browser()
    after_view = ready()
    after = after_view['controller']['snapshot']
    receipt = after_view['curatedUpgrade']
    assert receipt['kind'] == 'UPGRADED' and receipt['id'] == 'research-infrastructure-2026-10-v3'
    assert set(before['policy']['whitelist']) <= set(after['policy']['whitelist'])
    assert after['policy']['blacklist'] == before['policy']['blacklist']
    assert len(after['policy']['whitelist']) == len(set(after['policy']['whitelist']))
    assert after['policyRevision'] == before['policyRevision'] + 1
    assert after['configuration'] == before['configuration'] and after['configurationRevision'] == before['configurationRevision']
    assert after['accessState']['pendingRequests'] == before['accessState']['pendingRequests']
    assert after['vaultState']['pendingProposal'] == before['vaultState']['pendingProposal']
    assert 'figma.com' in receipt['skippedBlacklisted'] and 'figma.com' not in after['policy']['whitelist']
    assert 'youtube.com' not in after['policy']['whitelist'] and 'www.youtube.com' not in after['policy']['whitelist']
    assert not {'wikipedia.org', 'www.wikipedia.org', 'en.wikipedia.org', 'sv.wikipedia.org'} & set(after['policy']['whitelist'])
    assert 'drive.google.com' in after['policy']['whitelist']
    assert 'www.damtp.cam.ac.uk' in after['policy']['whitelist']
    assert client.script('return localStorage.getItem("atlas-home-pins-v1");') == pins
    checks.append('native update atomically adds curated destinations while retaining every custom host, manual Blacklist, pins and protected settings')

    assert client.message({'kind': 'CONFIRM_ACCESS', 'requestId': before['accessState']['pendingRequests'][0]['id']})['result']['reason'] == 'POLICY_CHANGED'
    assert client.message({'kind': 'CONFIRM_POLICY', 'proposalId': before['vaultState']['pendingProposal']['id']})['result']['reason'] == 'POLICY_CHANGED'
    diagnostic = client.message({'kind': 'GET_DIAGNOSTICS', 'tabId': None})
    assert diagnostic['curatedUpgrade'] == receipt
    assert diagnostic['entries'] is not None
    checks.append('old pending requests and frozen Vault proposal keep their timestamps and fail confirmation under existing Core revision rules; diagnostics reports exact migration outcomes')

    assert client.message({'kind': 'CANCEL_POLICY', 'proposalId': before['vaultState']['pendingProposal']['id']})['result']['type'] == 'COMMITTED'
    removed = deepcopy(ready()['controller']['snapshot']['policy'])
    removed['whitelist'].remove('zotero.org')
    configure_policy(client, removed)
    saved = deepcopy(ready()['controller']['snapshot'])
    client, _ = restart_browser()
    restarted = ready()
    assert restarted['controller']['snapshot']['policy'] == saved['policy']
    assert restarted['controller']['snapshot']['configuration'] == changed_configuration
    assert restarted['controller']['snapshot']['policyRevision'] == saved['policyRevision']
    assert restarted['curatedUpgrade'] == receipt
    assert client.script('return localStorage.getItem("atlas-home-pins-v1");') == pins
    checks.append('full Firefox restart retains the receipt and later Vault removal; startup never re-adds a subsequently removed curated hostname')
    return {'checks': checks, 'fullFirefoxRestarts': 2, 'migration': receipt,
            'customHostsPreserved': ['root.localhost', 'outside-preset.localhost'],
            'policyRevisionBefore': before['policyRevision'], 'policyRevisionAfter': after['policyRevision'],
            'signedArtifactsModified': False, 'normalProfileAccessed': False}


def run_applied_curated_upgrade(client, port, wait_for, restart_browser, configure_policy):
    """Exercise preserved 0.1.18 storage, including real legacy UI receipts.

    All mutations use ordinary UI/Vault operations in the disposable profile.
    The only direct IndexedDB operations below read compatibility evidence.
    """
    checks = []
    wikipedia = {'wikipedia.org', 'www.wikipedia.org', 'en.wikipedia.org', 'sv.wikipedia.org'}

    def view():
        return client.message({'kind': 'GET_VIEW'})['view']

    def ready():
        return wait_for(lambda: (v := view()) and (v.get('controller') or {}).get('status') == 'READY' and v,
                        'verified previously migrated authority', 30)

    def workspace():
        return client.script('''const done=arguments[0],r=indexedDB.open('atlas-destination-drafts-v1',1);
          r.onsuccess=()=>{const db=r.result,t=db.transaction('workspace','readonly'),q=t.objectStore('workspace').get('current');
            q.onsuccess=()=>done(q.result?.value??null);t.oncomplete=()=>db.close();};r.onerror=()=>done(null);''', asynchronous=True)

    def markers():
        return client.script('''const done=arguments[0],r=indexedDB.open('atlas-authority-v1',1);
          r.onsuccess=()=>{const db=r.result,t=db.transaction('authority','readonly'),s=t.objectStore('authority'),result={};
            for(const version of ['v2','v3']){const q=s.get('curated:research-infrastructure-2026-10-'+version);q.onsuccess=()=>{result[version]=q.result??null;};}
            t.oncomplete=()=>{db.close();done(result);};};r.onerror=()=>done(null);''', asynchronous=True)

    def layout():
        return client.script('''const done=arguments[0],r=indexedDB.open('atlas-home-layout-v1',1);
          r.onsuccess=()=>{const db=r.result,t=db.transaction('layout','readonly'),q=t.objectStore('layout').get('current');
            q.onsuccess=()=>done(q.result??null);t.oncomplete=()=>db.close();};r.onerror=()=>done(null);''', asynchronous=True)

    def input_values(values):
        client.script('''for(const [id,value]of Object.entries(arguments[0])){const e=document.getElementById(id);
          e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}''', values)

    def ui_ready():
        revision = ready()['controller']['snapshot']['policyRevision']
        wait_for(lambda: client.script('return document.getElementById("status").dataset.ready==="true" && !document.getElementById("add-site").disabled && document.getElementById("sites-status").textContent.endsWith("revision "+arguments[0]);', revision),
                 'legacy UI and durable workspace ready', 30)

    def stage_display(host, label, pinned=None):
        client.script('document.getElementById("show-sites").click();')
        ui_ready()
        input_values({'sites-search': host})
        assert client.script('''const row=[...document.querySelectorAll('#sites-list .site-row')].find(r=>r.title.split(', ').includes(arguments[0]));
          if(!row)return false;row.click();document.getElementById('edit-site').click();return true;''', host)
        input_values({'site-name': label, 'site-access': 'PRESERVE'})
        if pinned is not None:
            client.script('''const e=document.getElementById('site-pin');e.checked=arguments[0];
              e.dispatchEvent(new Event('input',{bubbles:true}));''', pinned)
        client.script('document.getElementById("site-form").requestSubmit();')
        wait_for(lambda: (w := workspace()) and w['draft'] and len(w['draft']['changes']) == 1 and w['draft']['editor'] is None,
                 'legacy display draft durably staged', 30)

    initial = ready()
    receipt = initial['curatedUpgrade']
    assert receipt['id'] == 'research-infrastructure-2026-10-v2'
    assert wikipedia <= set(initial['controller']['snapshot']['policy']['whitelist'])
    original_markers = markers()
    assert original_markers['v2'] == receipt and original_markers['v3'] is None
    legacy_policy = deepcopy(initial['controller']['snapshot']['policy'])
    legacy_policy['whitelist'] = sorted(set(legacy_policy['whitelist'] + ['outside-preset.localhost']))
    legacy_policy['blacklist'] = ['black.localhost', 'figma.com']
    configure_policy(client, legacy_policy)
    changed_configuration = deepcopy(ready()['controller']['snapshot']['configuration'])
    changed_configuration['accessTiming']['grantDurationMs'] = 3600000
    changed_configuration['accessTiming']['confirmationWindowMs'] = 3600000
    changed_configuration['vaultTiming']['confirmationWindowMs'] = 3600000
    proposed = client.message({'kind': 'PROPOSE_SETTINGS', 'candidateConfiguration': changed_configuration})
    assert proposed['result']['type'] == 'COMMITTED'
    proposal = proposed['view']['controller']['snapshot']['vaultState']['pendingProposal']
    wait_for(lambda: time.time()*1000 >= proposal['readyAt'], 'real protected settings wait', 45)
    assert client.message({'kind': 'CONFIRM_POLICY', 'proposalId': proposal['id']})['result']['type'] == 'COMMITTED'

    # The old runtime itself creates and validates the Wikipedia service grouping,
    # frozen display receipt and following draft baseline. No hand-written fixture
    # can accidentally bypass compatibility validation here.
    stage_display('wikipedia.org', 'Legacy Wikipedia display', pinned=True)
    client.script('document.getElementById("review-destination-draft").click();')
    wait_for(lambda: client.script('return !document.getElementById("submit-destination-draft").disabled;'), 'legacy reviewed display batch')
    client.script('document.getElementById("submit-destination-draft").click();')
    wait_for(lambda: (w := workspace()) and w.get('receipt') and w['receipt']['phase'] == 'DONE',
             'actual signed-runtime completed display receipt', 30)
    assert ready()['controller']['snapshot']['vaultState']['pendingProposal'] is None
    pins = client.script('return localStorage.getItem("atlas-home-pins-v1");')
    assert client.script('return JSON.parse(localStorage.getItem("atlas-home-pins-v1")).includes("service:wikipedia.org");')
    stage_display('root.localhost', 'Preserved editable root')
    stored_workspace = deepcopy(workspace())
    assert stored_workspace['receipt']['phase'] == 'DONE'
    assert any(e['metadata']['id'] == 'service:wikipedia.org' for e in stored_workspace['draft']['baseline']['entries'])
    assert stored_workspace['receipt']['draft']['changes'][0]['id'] == 'service:wikipedia.org'
    removed = deepcopy(ready()['controller']['snapshot']['policy'])
    removed['whitelist'] = [h for h in removed['whitelist'] if h not in wikipedia | {'zotero.org'}]
    configure_policy(client, removed)

    def request_access(host):
        tab=client.script('const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));',f'http://{host}:{port}/',asynchronous=True)
        wait_for(lambda:any(c['tabId']==tab and c['effect']=='REMOVED' for c in view()['contexts']),'old runtime Greylist blocked')
        response=client.message({'kind':'PREPARE_ACCESS','tabId':tab})
        scope=next(c['accessScope'] for c in response['view']['contexts'] if c['tabId']==tab)
        assert client.message({'kind':'START_ACCESS','tabId':tab,'scopeId':scope['id']})['result']['type']=='COMMITTED'
        return next(r for r in ready()['controller']['snapshot']['accessState']['pendingRequests'] if r['hostname']==host)

    access=request_access('grant-upgrade.localhost')
    wait_for(lambda:time.time()*1000>=access['readyAt'],'legacy real Greylist wait',30)
    assert client.message({'kind':'CONFIRM_ACCESS','requestId':access['id']})['result']['type']=='COMMITTED'
    request_access('pending-upgrade.localhost')
    candidate=deepcopy(ready()['controller']['snapshot']['policy'])
    candidate['whitelist'].append('frozen-upgrade.localhost')
    assert client.message({'kind':'PROPOSE_POLICY','candidatePolicy':candidate})['result']['type']=='COMMITTED'
    client.script('document.getElementById("show-home").click();document.getElementById("customize-home").click();')
    wait_for(lambda:client.script('return document.querySelectorAll("#home-layout-list input").length>1;'),'legacy layout controls')
    original_layout=layout()
    client.script('document.querySelector("#home-layout-list input").click();')
    wait_for(lambda:layout()['revision']>original_layout['revision'],'legacy visibility acknowledged')
    client.script('document.querySelectorAll("#home-layout-list [data-layout-action=UP]")[1].click();')
    wait_for(lambda:layout()['revision']>original_layout['revision']+1,'legacy order acknowledged')
    saved_layout=deepcopy(layout())
    assert saved_layout['value']!=original_layout['value']

    before = deepcopy(ready()['controller']['snapshot'])
    assert workspace() == stored_workspace
    assert layout()==saved_layout
    assert client.script('return localStorage.getItem("atlas-home-pins-v1");') == pins
    metadata = client.script('return localStorage.getItem("atlas-destinations-v1");')
    checks.append('signed 0.1.18 UI creates a DONE Wikipedia display receipt and saved draft baseline; real Vault removes Wikipedia and Zotero while retaining custom policy, Blacklist, timing and pins')

    client, _ = restart_browser()
    after_view = ready()
    after = after_view['controller']['snapshot']
    assert after_view['curatedUpgrade'] == receipt
    assert markers() == original_markers, 'valid v2 must not be replaced with a v3 marker'
    assert after['policy'] == before['policy'] and after['policyRevision'] == before['policyRevision']
    assert after['configuration'] == before['configuration'] and after['configurationRevision'] == before['configurationRevision']
    assert not wikipedia & set(after['policy']['whitelist']) and 'zotero.org' not in after['policy']['whitelist']
    assert 'outside-preset.localhost' in after['policy']['whitelist']
    assert after['policy']['blacklist'] == ['black.localhost', 'figma.com']
    assert client.script('return localStorage.getItem("atlas-home-pins-v1");') == pins
    assert client.script('return localStorage.getItem("atlas-destinations-v1");') == metadata
    assert workspace() == stored_workspace
    assert layout()==saved_layout
    assert after['accessState']['pendingRequests']==before['accessState']['pendingRequests']
    assert after['accessState']['grants']==before['accessState']['grants']
    # Restart observes time; it must not rewrite the frozen proposal or its deadlines.
    def same_vault_terms(current):
        assert current['lastObservedAt'] >= before['vaultState']['lastObservedAt']
        assert {k:v for k,v in current.items() if k!='lastObservedAt'} == {k:v for k,v in before['vaultState'].items() if k!='lastObservedAt'}
    same_vault_terms(after['vaultState'])
    assert 'frozen-upgrade.localhost' not in after['policy']['whitelist']
    ui_ready()
    client.script('document.getElementById("show-sites").click();')
    wait_for(lambda: client.script('return document.getElementById("destination-draft-status").textContent.match(/^Saved (?:editable draft|locally)/) && !document.getElementById("destination-draft-stale").hidden;'),
             'legacy saved draft decoded with truthful stale authority', 30)
    assert client.script('return document.getElementById("submit-destination-draft").disabled;')
    assert client.script('return document.getElementById("destination-receipt-status").textContent.includes("Applied batch");')
    checks.append('full process update accepts the identical frozen v2 receipt without a migration or revision bump; removed terms stay removed and old Wikipedia draft/DONE receipt decode without authorizing a stale draft')

    client, _ = restart_browser()
    final = ready()
    assert final['curatedUpgrade'] == receipt and markers() == original_markers
    assert final['controller']['snapshot']['policy'] == before['policy']
    assert final['controller']['snapshot']['policyRevision'] == before['policyRevision']
    assert workspace() == stored_workspace
    assert layout()==saved_layout
    assert final['controller']['snapshot']['accessState']['pendingRequests']==before['accessState']['pendingRequests']
    assert final['controller']['snapshot']['accessState']['grants']==before['accessState']['grants']
    same_vault_terms(final['controller']['snapshot']['vaultState'])
    assert client.script('return localStorage.getItem("atlas-home-pins-v1");') == pins
    checks.append('a second full Firefox restart preserves custom state and legacy presentation workspace without reapplying defaults')
    return {'checks': checks, 'baseline': '0.1.18', 'fullFirefoxRestarts': 2, 'migration': receipt,
            'migrationReapplied': False, 'legacyDraftPreserved': True, 'legacyDoneReceiptPreserved': True,
            'layoutPreserved':True,'pendingRequestPreserved':True,'grantDeadlinePreserved':True,'frozenVaultPreserved':True,
            'policyRevisionBefore': before['policyRevision'], 'policyRevisionAfter': after['policyRevision'],
            'signedArtifactsModified': False, 'normalProfileAccessed': False}
