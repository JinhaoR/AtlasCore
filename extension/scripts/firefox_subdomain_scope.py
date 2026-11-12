"""Optional Whitelist scopes through native UI, real Vault waits and isolated DNS.

Only the dedicated e2e mode resolves these reserved example.org fixture hosts to
loopback. No authorization state, browser security or system clock is replaced.
"""
from copy import deepcopy
import json
import time


def run_subdomain_scope(client, ui_handle, ui_url, port, wait_for, hits, artifacts):
    try:
        return _run_subdomain_scope(client, ui_handle, ui_url, port, wait_for, hits)
    except Exception as failure:
        # Keep hostnames and state codes only, before the harness closes its
        # disposable profile. Saved navigation URLs are never serialized.
        report = {'failureType': type(failure).__name__, 'fixtureHostsReached': sorted({host for host, _ in hits})}
        try:
            for handle in client.call('WebDriver:GetWindowHandles'):
                client.call('WebDriver:SwitchToWindow', handle=handle)
                if not client.script('return location.href.split(/[?#]/,1)[0]===arguments[0];', ui_url):
                    continue
                view = client.message({'kind': 'GET_VIEW'}).get('view') or {}
                controller = view.get('controller') or {}
                snapshot = controller.get('snapshot') or {}
                pending = (snapshot.get('vaultState') or {}).get('pendingProposal') or {}
                report.update({'controllerStatus': controller.get('status'), 'policyRevision': snapshot.get('policyRevision'),
                               'scopeBases': (snapshot.get('policy') or {}).get('whitelistSubdomains'),
                               'proposalScopeBases': (pending.get('candidatePolicy') or {}).get('whitelistSubdomains')})
                report['contexts'] = []
                for context in view.get('contexts') or []:
                    latest = context.get('latest') or {}
                    decision = latest.get('decision') or {}
                    report['contexts'].append({'hostname': context.get('hostname'), 'effect': context.get('effect'),
                                               'result': latest.get('type'), 'reason': latest.get('reason') or decision.get('reason'),
                                               'outcome': decision.get('outcome'), 'scopeRoot': decision.get('scopeRoot')})
                report['ui'] = client.script('''return Object.fromEntries(['site-save-feedback','destination-draft-status',
                  'site-field-error','vault-phase','status'].map(id=>[id,document.getElementById(id)?.textContent]));''')
                break
        except Exception as diagnostic_failure:
            report['diagnosticFailureType'] = type(diagnostic_failure).__name__
        (artifacts / 'scope-failure.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        raise


def _run_subdomain_scope(client, ui_handle, ui_url, port, wait_for, hits):
    checks = []
    base = 'scope.example.org'
    child = 'deep.scope.example.org'
    nested = 'nested.deep.scope.example.org'
    blocked = 'blocked.scope.example.org'

    def view():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']

    def state():
        return wait_for(lambda: (v := view()) and (v.get('controller') or {}).get('status') == 'READY'
                        and v['controller']['snapshot'], 'verified scope authority', 25)

    def access_terms(snapshot):
        # Normal observations advance the explicit clock/revision watermark;
        # permission records and the next request identity must not change.
        access = snapshot['accessState']
        return {key: access[key] for key in ['pendingRequests', 'grants', 'nextRequestId']}

    def ready():
        revision = state()['policyRevision']
        client.script('document.getElementById("show-sites").click();')
        wait_for(lambda: client.script('''return document.getElementById('status').dataset.ready==='true'
          && !document.getElementById('add-site').disabled
          && document.getElementById('sites-status').textContent.endsWith('revision '+arguments[0]);''', revision),
                 'Sites authority and editable draft at current revision', 25)

    def input_value(identity, value):
        client.script('''const el=document.getElementById(arguments[0]);el.value=arguments[1];
          el.dispatchEvent(new Event('input',{bubbles:true}));''', identity, value)

    def checkbox(identity, value):
        client.script('''const el=document.getElementById(arguments[0]);el.checked=arguments[1];
          el.dispatchEvent(new Event('input',{bubbles:true}));''', identity, value)

    def stage(host, classification, include_subdomains=False):
        client.script('document.getElementById("add-site").click();')
        wait_for(lambda: client.script('return !document.getElementById("site-draft").hidden;'), 'new editable destination')
        assert client.script('return document.getElementById("site-subdomains").checked;') is False, 'scopes must never be selected by default'
        input_value('site-name', 'Scoped research' if host == base else 'Blocked child')
        input_value('site-hostname', host)
        input_value('site-access', classification)
        input_value('site-category', 'Research')
        checkbox('site-www', False)
        if include_subdomains:
            wait_for(lambda: client.script('return !document.getElementById("site-subdomains").disabled;'), 'valid explicit scope choice')
            checkbox('site-subdomains', True)
            assert client.script('return document.getElementById("site-subdomains-help").textContent.includes("future");'), 'future-host breadth must be disclosed'
        client.script('document.getElementById("site-form").requestSubmit();')
        wait_for(lambda: client.script('''return document.getElementById('site-draft').hidden
          && document.getElementById('destination-draft-status').textContent.match(/^Saved (?:editable draft|locally)/);'''),
                 'destination staged and acknowledged')

    def review_submit():
        client.script('document.getElementById("review-destination-draft").click();')
        wait_for(lambda: client.script('return !document.getElementById("submit-destination-draft").disabled;'), 'reviewed complete batch')
        client.script('document.getElementById("submit-destination-draft").click();')
        return wait_for(lambda: state()['vaultState']['pendingProposal'], 'frozen scoped Vault proposal')

    def confirm(proposal):
        wait_for(lambda: time.time() * 1000 >= proposal['readyAt'], 'real protected Vault wait', 45)
        view()
        wait_for(lambda: client.script('''return !document.getElementById('confirm-policy').hidden
          && !document.getElementById('confirm-policy').disabled;'''), 'existing explicit confirmation available')
        client.script('document.getElementById("confirm-policy").click();')
        return wait_for(lambda: (s := state()) and s['vaultState']['pendingProposal'] is None and s,
                        'scoped policy commit acknowledged')

    def navigate(host, path, outcome, reason):
        before = len(hits)
        view()
        handles = client.call('WebDriver:GetWindowHandles')
        tab = client.script('''const [url,done]=arguments;
          browser.tabs.create({url,active:false}).then(t=>done(t.id));''', f'http://{host}:{port}/{path}', asynchronous=True)
        handle = wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in handles), None), 'native scoped navigation tab')

        def assessed():
            context = next((c for c in view()['contexts'] if c['tabId'] == tab), None)
            decision = ((context or {}).get('latest') or {}).get('decision', {})
            return context if decision.get('outcome') == outcome and decision.get('reason') == reason \
                and (outcome == 'ALLOW' or context.get('effect') == 'REMOVED') else None

        context = wait_for(assessed, f'{host} receives {outcome}/{reason}', 25)
        if outcome == 'ALLOW':
            wait_for(lambda: (host, '/'+path) in hits[before:], 'authorized request reached local fixture')
            client.call('WebDriver:SwitchToWindow', handle=handle)
            wait_for(lambda: client.script('return document.readyState==="complete" && document.querySelector("h1")?.textContent===arguments[0];', host),
                     'authorized scoped page displayed')
        else:
            assert context['effect'] == 'REMOVED', context
            assert (host, '/'+path) not in hits[before:], 'denied request must not reach local server'
        view()
        return context

    ready()
    initial = deepcopy(state())
    assert base not in initial['policy']['whitelist'] and not initial['policy'].get('whitelistSubdomains')
    navigate(child, 'before-scope', 'GREYLIST', 'UNLISTED')
    ready()
    stage(base, 'WHITELIST', True)
    stage(blocked, 'BLACKLIST')
    assert state()['policy'] == initial['policy'], 'editing a scoped draft cannot create permission'
    proposal = review_submit()
    assert proposal['candidatePolicy']['whitelistSubdomains'] == [base]
    assert base in proposal['candidatePolicy']['whitelist']
    assert blocked in proposal['candidatePolicy']['blacklist']
    assert state()['policy'] == initial['policy'], 'review and submission must retain active policy'
    assert client.message({'kind': 'CONFIRM_POLICY', 'proposalId': proposal['id']})['result']['reason'] == 'NOT_READY'
    navigate(child, 'while-waiting', 'GREYLIST', 'UNLISTED')
    committed = confirm(proposal)
    assert committed['policyRevision'] == initial['policyRevision'] + 1
    assert set(initial['policy']['whitelist']) <= set(committed['policy']['whitelist'])
    assert set(initial['policy']['blacklist']) <= set(committed['policy']['blacklist'])
    assert access_terms(committed) == access_terms(initial), 'a scope is not an Access Grant'
    checks.append('native checkbox defaults off; explicit current/future-subdomain opt-in is frozen in one batch, waits in real time and changes authority only after explicit confirmation')

    navigate(base, 'exact-base', 'ALLOW', 'WHITELISTED')
    scoped = navigate(child, 'scoped-child', 'ALLOW', 'WHITELISTED_SCOPE')
    assert scoped['latest']['decision']['scopeRoot'] == base
    navigate(nested, 'nested-child', 'ALLOW', 'WHITELISTED_SCOPE')
    navigate(blocked, 'blocked-child', 'DENY', 'BLACKLISTED')
    navigate('outside.localhost', 'unrelated', 'GREYLIST', 'UNLISTED')
    checks.append('exact base, direct child and deeper descendants navigate through Core; manual child Blacklist blocks before HTTP; unrelated tabs and hosts remain Greylist')

    # Reload only the disposable extension background: durable policy survives,
    # browser source evidence is rebuilt normally rather than copied by the test.
    saved_policy = deepcopy(state()['policy'])
    spare = client.script('const done=arguments[0];browser.tabs.create({url:"about:blank",active:false}).then(t=>done(t.id));', asynchronous=True)
    client.script('setTimeout(()=>browser.runtime.reload(),0);return true;')
    wait_for(lambda: ui_handle not in client.call('WebDriver:GetWindowHandles'), 'old scope UI closes on background reload')
    remaining_handles = client.call('WebDriver:GetWindowHandles')
    client.call('WebDriver:SwitchToWindow', handle=remaining_handles[0])
    client.call('Marionette:SetContext', value='chrome')
    client.script('gBrowser.selectedTab=gBrowser.addTrustedTab(arguments[0]);', ui_url)
    client.call('Marionette:SetContext', value='content')
    ui_handle = wait_for(lambda: next((handle for handle in client.call('WebDriver:GetWindowHandles')
                                      if handle not in remaining_handles), None), 'new control tab after background reload')
    client.call('WebDriver:SwitchToWindow', handle=ui_handle)
    wait_for(lambda: client.script('return location.href.split(/#/,1)[0]===arguments[0] && document.readyState==="complete";', ui_url), 'fresh scope UI')
    assert state()['policy'] == saved_policy
    navigate(child, 'after-reload', 'ALLOW', 'WHITELISTED_SCOPE')
    client.script('const [tab,done]=arguments;browser.tabs.remove(tab).then(()=>done(true));', spare, asynchronous=True)
    checks.append('background restart reloads scoped policy from real IndexedDB without inventing grants or transferring a Journey')

    ready()
    input_value('sites-search', base)
    wait_for(lambda: client.script('return [...document.querySelectorAll(".site-row")].some(row=>row.dataset.destinationId===arguments[0]);', 'host:'+base), 'committed scoped destination in Sites')
    client.script('[...document.querySelectorAll(".site-row")].find(row=>row.dataset.destinationId===arguments[0]).click();document.getElementById("edit-site").click();', 'host:'+base)
    wait_for(lambda: client.script('return !document.getElementById("site-draft").hidden && document.getElementById("site-hostname").value===arguments[0];', base), 'selected committed scope editor')
    assert client.script('return document.getElementById("site-subdomains").checked;') is True
    input_value('site-access', 'WHITELIST')
    checkbox('site-subdomains', False)
    client.script('document.getElementById("site-form").requestSubmit();')
    wait_for(lambda: client.script('return document.getElementById("site-draft").hidden;'), 'scope removal staged')
    assert state()['policy'] == saved_policy
    client.script('document.getElementById("review-destination-draft").click();')
    wait_for(lambda: client.script('return !document.getElementById("submit-destination-draft").disabled && document.getElementById("submit-destination-draft").textContent==="Apply Whitelist removals now";'), 'reviewed immediate scope removal')
    client.script('document.getElementById("submit-destination-draft").click();')
    final = wait_for(lambda: (s := state()) and s['policyRevision'] == committed['policyRevision'] + 1 and s, 'scope removal committed without another Vault wait')
    assert final['vaultState']['pendingProposal'] is None
    assert final['vaultState']['nextProposalId'] == committed['vaultState']['nextProposalId']
    assert final['vaultState']['lastApplied'] == committed['vaultState']['lastApplied']
    assert final['policyRevision'] == committed['policyRevision'] + 1
    assert base in final['policy']['whitelist'] and not final['policy'].get('whitelistSubdomains')
    navigate(child, 'after-removal', 'GREYLIST', 'UNLISTED')
    navigate(base, 'exact-retained', 'ALLOW', 'WHITELISTED')
    assert access_terms(state()) == access_terms(initial)
    checks.append('reopened scope preference is removed after review without another cooldown or fabricated Vault marker; descendants return to Greylist while the exact base remains Whitelisted')
    print('PASS native scoped Whitelist opt-in, wait, exact/manual precedence, nested navigation, restart and immediate removal', flush=True)
    return {'checks': checks, 'backgroundRestarts': 1, 'realVaultConfirmations': 1, 'immediateScopeRemovals': 1,
            'policyRevisionBefore': initial['policyRevision'], 'policyRevisionAfter': final['policyRevision'],
            'isolatedProfile': True, 'normalProfileAccessed': False, 'signedArtifactsModified': False}
