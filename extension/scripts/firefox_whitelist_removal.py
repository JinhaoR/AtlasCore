"""Reviewed Whitelist subtraction and mixed Vault batches in a disposable profile."""
from copy import deepcopy
import time


def run_whitelist_removal(client, ui_handle, ui_url, port, wait_for, restart_browser):
    checks = []

    def view():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']

    def state():
        return wait_for(lambda: (v := view()) and (v.get('controller') or {}).get('status') == 'READY'
                        and v['controller']['snapshot'], 'verified removal authority', 25)

    def workspace():
        return client.script('''const done=arguments[0],o=indexedDB.open('atlas-destination-drafts-v1');
          o.onsuccess=()=>{const db=o.result,t=db.transaction('workspace','readonly'),r=t.objectStore('workspace').get('current');
            t.oncomplete=()=>{const w=r.result?.value;db.close();done(w?{kind:w.receipt?.kind,phase:w.receipt?.phase,
              count:w.draft?.changes.length??0,editor:w.draft?.editor??null}:null)};};''', asynchronous=True)

    def sites():
        revision = state()['policyRevision']
        client.script('document.getElementById("show-sites").click();')
        wait_for(lambda: client.script('''return !document.getElementById('add-site').disabled
          && document.getElementById('sites-status').textContent.endsWith('revision '+arguments[0]);''', revision),
                 'Sites displays current authoritative revision', 25)

    def input_value(identity, value):
        client.script('const e=document.getElementById(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event("input",{bubbles:true}));', identity, value)

    def staged(count):
        return wait_for(lambda: (w := workspace()) and w['count'] == count and w['editor'] is None
                        and client.script('return document.getElementById("destination-draft-status").textContent.match(/^Saved (?:editable draft|locally)/);'),
                        'acknowledged staged batch', 25)

    def remove(hostname, count):
        sites(); input_value('sites-search', hostname)
        selector = '''return [...document.querySelectorAll('#sites-list .site-row')].some(r=>r.title.split(', ').includes(arguments[0]));'''
        wait_for(lambda: client.script(selector, hostname), 'committed destination to remove')
        client.script('''[...document.querySelectorAll('#sites-list .site-row')].find(r=>r.title.split(', ').includes(arguments[0])).click();
          document.getElementById('remove-site').click();''', hostname)
        staged(count)

    def review(expected_label):
        client.script('document.getElementById("review-destination-draft").click();')
        wait_for(lambda: client.script('''const b=document.getElementById('submit-destination-draft');return !b.disabled && b.textContent===arguments[0];''', expected_label),
                 'reviewed batch selects the correct Core workflow')

    initial = deepcopy(state())
    tab = client.script('const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));', f'http://root.localhost:{port}/', asynchronous=True)
    wait_for(lambda: any(c['tabId'] == tab and (c.get('latest') or {}).get('decision', {}).get('reason') == 'WHITELISTED' for c in view()['contexts']), 'initial Whitelist document')
    remove('root.localhost', 1); remove('github.com', 2)
    assert state()['policy'] == initial['policy'], 'staging changes no permission'
    review('Apply Whitelist removals now')
    started = time.monotonic()
    client.script('document.getElementById("submit-destination-draft").click();')
    reduced = wait_for(lambda: (s := state()) and s['policyRevision'] == initial['policyRevision'] + 1 and s, 'immediate committed reduction', 25)
    wait_for(lambda: (w := workspace()) and w['kind'] == 'REMOVAL' and w['phase'] == 'DONE', 'removal display completion acknowledged', 25)
    elapsed_ms = round((time.monotonic()-started)*1000, 2)
    assert elapsed_ms < initial['configuration']['vaultTiming']['waitMs']
    assert not {'root.localhost', 'github.com', 'www.github.com'} & set(reduced['policy']['whitelist'])
    assert reduced['policy']['blacklist'] == initial['policy']['blacklist'] and reduced['configuration'] == initial['configuration']
    assert reduced['vaultState']['pendingProposal'] is None
    assert reduced['vaultState']['nextProposalId'] == initial['vaultState']['nextProposalId']
    assert reduced['vaultState']['lastApplied'] == initial['vaultState']['lastApplied']
    wait_for(lambda: any(c['tabId'] == tab and c['effect'] == 'REMOVED' and
                         (c.get('latest') or {}).get('decision', {}).get('outcome') == 'GREYLIST' for c in view()['contexts']),
             'already displayed removed site is governed by Greylist', 25)
    checks.append('real Sites review removes a loaded custom host and both curated GitHub aliases without Vault or a fabricated proposal marker; Core withdraws the retained page')

    client, ui_handle = restart_browser()
    assert state()['policy'] == reduced['policy'] and state()['policyRevision'] == reduced['policyRevision']
    assert workspace()['kind'] == 'REMOVAL' and workspace()['phase'] == 'DONE'
    sites(); input_value('sites-search', 'github.com')
    wait_for(lambda: client.script('return document.getElementById("sites-empty").hidden===false;'), 'removed curated entry stays absent')
    checks.append('full Firefox restart preserves the reduced policy and new receipt; curated migration does not restore removed GitHub hosts')

    # A mixed batch must remain whole: the removal cannot take effect early,
    # and restoring the root cannot borrow immediate-reduction authority.
    sites(); client.script('document.getElementById("add-site").click();')
    wait_for(lambda: client.script('return !document.getElementById("site-draft").hidden;'), 'new destination editor')
    for identity, value in [('site-name', 'Restored fixture root'), ('site-hostname', 'root.localhost'), ('site-category', 'University'), ('site-access', 'WHITELIST')]:
        input_value(identity, value)
    client.script('document.getElementById("site-form").requestSubmit();'); staged(1)
    remove('chatgpt.com', 2)
    review('Submit complete batch to Vault')
    client.script('document.getElementById("submit-destination-draft").click();')
    pending = wait_for(lambda: state()['vaultState']['pendingProposal'], 'one mixed frozen proposal')
    assert state()['policy'] == reduced['policy']
    assert pending['readyAt'] - pending['createdAt'] == reduced['configuration']['vaultTiming']['waitMs']
    assert client.message({'kind': 'CONFIRM_POLICY', 'proposalId': pending['id']})['result']['reason'] == 'NOT_READY'
    assert 'root.localhost' in pending['candidatePolicy']['whitelist'] and 'chatgpt.com' not in pending['candidatePolicy']['whitelist']
    checks.append('mixed restore/remove batch stays frozen and unchanged; early confirmation is rejected under the configured Vault wait')
    wait_for(lambda: time.time()*1000 >= pending['readyAt'], 'real mixed-batch Vault cooldown', 45)
    wait_for(lambda: client.script('return !document.getElementById("confirm-policy").hidden && !document.getElementById("confirm-policy").disabled;'), 'existing explicit confirmation is available')
    client.script('document.getElementById("confirm-policy").click();')
    final = wait_for(lambda: (s := state()) and s['vaultState']['pendingProposal'] is None and s, 'mixed batch committed only after confirmation')
    wait_for(lambda: (w := workspace()) and w['kind'] == 'POLICY' and w['phase'] == 'DONE', 'normal Vault display receipt completed')
    assert 'root.localhost' in final['policy']['whitelist'] and 'chatgpt.com' not in final['policy']['whitelist']
    assert final['policyRevision'] == reduced['policyRevision'] + 1
    assert final['configuration'] == initial['configuration'] and final['policy']['blacklist'] == initial['policy']['blacklist']
    assert final['vaultState']['nextProposalId'] == reduced['vaultState']['nextProposalId'] + 1
    checks.append('one real wait and explicit confirmation applies the whole mixed batch, preserving settings and Blacklist')
    client, ui_handle = restart_browser()
    assert state()['policy'] == final['policy'] and state()['policyRevision'] == final['policyRevision']
    assert workspace()['kind'] == 'POLICY' and workspace()['phase'] == 'DONE'
    checks.append('second full restart retains normal Vault receipt compatibility and the committed mixed result')
    print('PASS native immediate Whitelist removal, aliases, retained-content enforcement, mixed Vault wait and two restarts', flush=True)
    return {'checks': checks, 'immediateApplyMs': elapsed_ms, 'configuredVaultWaitMs': initial['configuration']['vaultTiming']['waitMs'],
            'fullFirefoxRestarts': 2, 'realMixedVaultConfirmations': 1,
            'policyRevisionBefore': initial['policyRevision'], 'policyRevisionAfterRemoval': reduced['policyRevision'], 'policyRevisionAfterMixed': final['policyRevision'],
            'normalProfileAccessed': False, 'signedArtifactsModified': False}
