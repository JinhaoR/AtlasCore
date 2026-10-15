"""D30 native controls and browser effects, using only synthetic public fixtures."""
import base64
import time


def run_destination_polish(client, ui_handle, ui_url, port, wait_for, hits, artifacts):
    checks = []

    def view():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']

    def snapshot():
        return view()['controller']['snapshot']

    def capture(name):
        wait_for(lambda: client.script('return !document.getAnimations().some(a => a.playState === "running");'), 'layout settles')
        shot = client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)
        (artifacts / f'{name}.png').write_bytes(base64.b64decode(shot))

    def input_value(id, value):
        client.script('const el=document.getElementById(arguments[0]); el.value=arguments[1]; el.dispatchEvent(new Event("input",{bubbles:true}));', id, value)

    def proposal():
        return snapshot()['vaultState']['pendingProposal']

    def workspace():
        return client.script('''const done=arguments[0];const r=indexedDB.open('atlas-destination-drafts-v1',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('workspace','readonly');const q=tx.objectStore('workspace').get('current');q.onsuccess=()=>done(q.result?.value??null);tx.oncomplete=()=>db.close();};''', asynchronous=True)

    def submit_draft():
        client.script('document.getElementById("review-destination-draft").click();')
        wait_for(lambda: client.script('return !document.getElementById("submit-destination-draft").disabled;'), 'reviewed batch ready')
        client.script('document.getElementById("submit-destination-draft").click();')

    def stage_submit():
        wait_for(lambda: client.script('return !document.getElementById("site-draft").hidden && !document.getElementById("propose-site").disabled;'), 'visible editable form ready')
        client.script('document.getElementById("site-form").requestSubmit();')
        try:
            wait_for(lambda: client.script('return document.getElementById("site-draft").hidden && document.getElementById("destination-draft-status").textContent.startsWith("Saved editable draft");'), 'local change staged')
        except AssertionError:
            print('Staging diagnostic:', client.script('return {hidden:document.getElementById("site-draft").hidden,disabled:document.getElementById("propose-site").disabled,fieldError:document.getElementById("site-field-error")?.textContent,status:document.getElementById("destination-draft-status").textContent};'), flush=True)
            capture('staging-failure')
            raise
        submit_draft()

    def edit_selected():
        wait_for(lambda: client.script('return !document.getElementById("site-detail").hidden && !document.getElementById("edit-site").disabled;'), 'selected destination ready for editing')
        client.script('document.getElementById("edit-site").click();')
        wait_for(lambda: client.script('return !document.getElementById("site-draft").hidden && !document.getElementById("propose-site").disabled;'), 'selected editor ready')

    def confirm(pending):
        assert client.message({'kind': 'CONFIRM_POLICY', 'proposalId': pending['id']})['result']['reason'] == 'NOT_READY'
        wait_for(lambda: time.time() * 1000 >= pending['readyAt'], 'real protected wait', 40)
        wait_for(lambda: client.script('return !document.getElementById("confirm-policy").hidden && !document.getElementById("confirm-policy").disabled;'), 'ready confirmation UI')
        client.script('document.getElementById("confirm-policy").click();')
        wait_for(lambda: proposal() is None, 'commit persisted')
        assert client.message({'kind': 'CONFIRM_POLICY', 'proposalId': pending['id']})['result']['type'] == 'REJECTED'

    baseline = snapshot()
    client.call('WebDriver:SetWindowRect', width=1440, height=1100)
    wait_for(lambda: client.script('return document.getElementById("destinations").dataset.columns === "5";'), 'five responsive columns')
    assert client.script('return !document.getElementById("sidebar-toggle") && document.getElementById("atlas-sidebar").getBoundingClientRect().width === 60;')
    assert client.script('return [...document.querySelectorAll(".nav-label")].every(n=>n.getBoundingClientRect().width===0) && [...document.querySelectorAll(".sidebar-nav button")].every(b=>b.title===b.getAttribute("aria-label"));')
    metrics = client.script('''return {rail:document.getElementById('atlas-sidebar').getBoundingClientRect().width,
      card:document.querySelector('[data-destination-id="service:arxiv.org"] .destination-open').getBoundingClientRect().height,
      names:[...document.querySelectorAll('.destination-name')].every(n=>n.textContent.trim()),
      hiddenHosts:[...document.querySelectorAll('.destination-host')].every(n=>getComputedStyle(n).display==='none')};''')
    assert metrics['rail'] == 60 and metrics['card'] == 54 and metrics['names'] and metrics['hiddenHosts'], metrics
    client.script("window.__atlasLayoutCard = document.querySelector('[data-destination-id=\"service:arxiv.org\"]');")
    layouts = []
    for width in [500, 800, 1000, 1440, 2100]:
        client.call('WebDriver:SetWindowRect', width=width, height=1100)
        def layout():
            return client.script('''const area = document.getElementById('destinations'), css = getComputedStyle(area);
              const expected = Math.max(1, Math.min(5, Math.floor((area.getBoundingClientRect().width + parseFloat(css.getPropertyValue('--destination-gap'))) /
                (parseFloat(css.getPropertyValue('--destination-min-width')) + parseFloat(css.getPropertyValue('--destination-gap'))))));
              const grids = [...document.querySelectorAll('#destination-list .destination-grid')];
              return {width:innerWidth, columns:Number(area.dataset.columns), expected,
                counts:grids.map(g=>[...g.children].filter(c=>!c.hidden).length),
                singleRow:grids.every(g=>new Set([...g.children].filter(c=>!c.hidden).map(c=>Math.round(c.getBoundingClientRect().top))).size <= 1),
                maxRow:Math.max(...[...document.querySelectorAll('.destination-grid')].flatMap(g=>{
                  const rows=new Map(); [...g.children].filter(c=>!c.hidden).forEach(c=>{const y=Math.round(c.getBoundingClientRect().top); rows.set(y,(rows.get(y)||0)+1);}); return [...rows.values()]; })),
                fixedHeight:[...document.querySelectorAll('.destination-open')].filter(c=>!c.closest('[hidden]')).every(c=>c.getBoundingClientRect().height===54),
                sameCard:window.__atlasLayoutCard===document.querySelector('[data-destination-id="service:arxiv.org"]'),
                overflow:document.documentElement.scrollWidth>innerWidth};''')
        sample = wait_for(lambda: (value := layout()) and value['columns']==value['expected'] and value, 'layout adapts without a reload')
        assert sample['singleRow'] and sample['fixedHeight'] and sample['sameCard'] and not sample['overflow'], sample
        assert max(sample['counts']) <= sample['columns'] <= 5 and sample['maxRow'] <= 5, sample
        layouts.append(sample)
    assert layouts[0]['columns'] == 2 and layouts[-1]['columns'] == 5
    client.call('WebDriver:SetWindowRect', width=1440, height=1100)
    wait_for(lambda: client.script('return document.getElementById("destinations").dataset.columns === "5";'), 'desktop five columns restored')
    research = "[...document.querySelectorAll('.service-group')].find(g=>g.dataset.category==='Scholar / Research')"
    client.script(f'{research}.querySelector(".category-toggle").click();')
    assert client.script(f'return [...{research}.querySelector(".destination-grid").children].every(c=>!c.hidden);')
    client.script(f'{research}.querySelector(".category-toggle").click();')
    capture('compact-home-collapsed')
    # Even a long display label keeps the same row height; the full name remains accessible.
    assert client.script('''const button = document.querySelector('[data-destination-id="service:arxiv.org"] .destination-open');
      const name = button.querySelector('.destination-name'), previous = name.textContent;
      name.textContent = 'A deliberately long research destination label that must stay on one line';
      const fixed = button.getBoundingClientRect().height === 54 && getComputedStyle(name).textOverflow === 'ellipsis';
      name.textContent = previous; return fixed;''')
    client.script('localStorage.setItem("atlas-sidebar-v1", "expanded");')
    client.call('WebDriver:Refresh')
    wait_for(lambda: client.script('return !document.getElementById("sidebar-toggle") && document.getElementById("status").dataset.ready==="true";'), 'permanent rail reload')
    assert snapshot()['policy'] == baseline['policy']
    checks.append('54px launchers, one responsive preview row, two to five columns in tested windows, maximum five per row, stable cards and permanent 60px accessible rail')

    # Configuration uses current protection; candidate wait never shortens this first wait.
    client.script('document.getElementById("show-settings").click();')
    assert client.script('return document.getElementById("timing-settings").open && !document.getElementById("policy-whitelist");')
    assert '300' in client.script('return document.getElementById("active-journey-lifetime").textContent;')
    input_value('journey-lifetime', '3')
    input_value('vault-wait', '2')
    client.script('document.getElementById("settings-form").requestSubmit();')
    pending = wait_for(proposal, 'timing proposal')
    assert snapshot()['configuration'] == baseline['configuration']
    assert pending['readyAt']-pending['createdAt'] == baseline['configuration']['vaultTiming']['waitMs']
    capture('protected-timing-review')
    confirm(pending)
    assert snapshot()['configuration']['journeyLimits']['lifetimeMs'] == 3000
    checks.append('Journey lifetime visible, old-term Vault wait, no early application, saved explicit confirmation')
    print('PASS native compact Home/rail and protected Journey lifetime', flush=True)

    # Read-only policy, draft www disclosure, freezing and cancellation.
    client.script('document.getElementById("show-sites").click();')
    wait_for(lambda: client.script('return document.querySelectorAll(".site-row").length>0;'), 'Sites read-only list')
    assert client.script('return !document.querySelector("#sites-section textarea");')
    original = snapshot()['policy']
    client.script('document.getElementById("add-site").click();')
    input_value('site-name', 'WolframAlpha')
    input_value('site-hostname', 'wolframalpha.com')
    client.script('document.getElementById("site-www").checked=true;document.getElementById("site-www").dispatchEvent(new Event("input"));')
    input_value('site-category', 'Scholar / Research')
    client.script('document.getElementById("site-pin").checked=true;')
    assert client.script('return document.getElementById("site-www").checked && document.getElementById("site-scope-preview").textContent.includes("www.wolframalpha.com");')
    assert snapshot()['policy'] == original
    stage_submit()
    pending = wait_for(proposal, 'destination proposal')
    assert {'wolframalpha.com', 'www.wolframalpha.com'} <= set(pending['candidatePolicy']['whitelist'])
    assert snapshot()['policy'] == original
    assert client.script('return !(JSON.parse(localStorage.getItem("atlas-destinations-v1"))?.destinations??[]).some(d=>d.label==="WolframAlpha");')
    client.script('document.getElementById("cancel-policy").click();')
    wait_for(lambda: proposal() is None, 'proposal cancellation')
    wait_for(lambda: workspace()['receipt']['phase']=='RESOLVED', 'cancelled frozen display receipt resolved')
    assert snapshot()['policy'] == original

    client.script('document.getElementById("show-sites").click(); document.getElementById("add-site").click();')
    input_value('site-name', 'WolframAlpha')
    input_value('site-hostname', 'wolframalpha.com')
    client.script('document.getElementById("site-www").checked=true;document.getElementById("site-www").dispatchEvent(new Event("input"));')
    input_value('site-category', 'Scholar / Research')
    client.script('document.getElementById("site-pin").checked=true;')
    stage_submit()
    pending = wait_for(proposal, 'second destination proposal')
    confirm(pending)
    wait_for(lambda: client.script('return JSON.parse(localStorage.getItem("atlas-destinations-v1")).destinations.some(d=>d.label==="WolframAlpha");'), 'committed metadata')
    assert snapshot()['policy']['blacklist'] == original['blacklist']
    assert set(snapshot()['policy']['whitelist']) == set(original['whitelist']) | {'wolframalpha.com', 'www.wolframalpha.com'}
    assert client.script('return JSON.parse(localStorage.getItem("atlas-home-pins-v1")).includes("host:wolframalpha.com");')
    client.script('document.getElementById("show-sites").click();')
    client.script('document.getElementById("add-site").click();')
    input_value('site-name', 'Duplicate service')
    input_value('site-hostname', 'www.wolframalpha.com')
    client.script('document.getElementById("site-form").requestSubmit();')
    wait_for(lambda: client.script('return document.getElementById("destination-draft-conflicts").textContent.includes("also belongs");'), 'conflicting hostname shown')
    assert proposal() is None
    client.script('document.querySelector("#destination-draft-items .text-button").click();')
    wait_for(lambda: len(workspace()['draft']['changes'])==0, 'conflicting item removed from draft')
    input_value('sites-search', 'WolframAlpha')
    wait_for(lambda: client.script('return document.querySelectorAll(".site-row").length===1;'), 'Sites name search')
    client.script('document.querySelector(".site-row").click();')
    wait_for(lambda: client.script('return !document.getElementById("site-detail").hidden;'), 'readonly exact details')
    capture('sites-active-details')
    edit_selected()
    input_value('site-name', 'Wolfram research')
    assert client.script('return !document.getElementById("save-site-display").hidden;')
    before = snapshot()
    client.script('document.getElementById("save-site-display").click();')
    wait_for(lambda: workspace()['receipt']['phase']=='DONE', 'presentation edit saved')
    assert snapshot()['policy'] == before['policy'] and snapshot()['policyRevision'] == before['policyRevision']
    assert proposal() is None
    input_value('sites-search', 'Wolfram research')
    client.script('document.querySelector(".site-row").click();')
    edit_selected()
    input_value('site-access', 'BLACKLIST')
    stage_submit()
    pending = wait_for(proposal, 'blacklist proposal')
    assert snapshot()['policy'] == before['policy']
    confirm(pending)
    assert {'wolframalpha.com', 'www.wolframalpha.com'} <= set(snapshot()['policy']['blacklist'])
    client.script('document.getElementById("show-home").click();')
    assert client.script('return ![...document.querySelectorAll("#destination-list .destination-card")].some(c=>c.dataset.destinationId==="host:wolframalpha.com");')
    client.script('document.getElementById("show-sites").click();')
    input_value('sites-search', 'Wolfram research')
    client.script('document.querySelector(".site-row").click(); document.getElementById("remove-site").click();')
    wait_for(lambda: (w := workspace()) and w['draft'] and len(w['draft']['changes'])==1, 'removal staged locally')
    submit_draft()
    pending = wait_for(proposal, 'removal proposal')
    assert 'wolframalpha.com' in snapshot()['policy']['blacklist']
    confirm(pending)
    assert set(snapshot()['policy']['whitelist'])==set(original['whitelist']) and set(snapshot()['policy']['blacklist'])==set(original['blacklist'])
    checks.append('Sites search/details, explicit PSL www pair, freeze/cancel/commit, presentation-only edit, Blacklist and removal through Vault')
    print('PASS native Sites draft/Vault/add/edit/Blacklist/removal', flush=True)

    # Real Firefox requests: an automatic root return cannot renew an expired Journey.
    for mode in ['http', 'script', 'meta']:
        before_auth = hits.count(('login.localhost', '/'))
        known_handles = set(client.call('WebDriver:GetWindowHandles'))
        response = client.message({'kind': 'OPEN_DESTINATION', 'url': f'http://root.localhost:{port}/timeout-{mode}-arm'})
        tab_id = response['tabId']
        tab_handle = wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in known_handles), None), 'owning timeout tab')
        def context():
            return next((c for c in view()['contexts'] if c['tabId'] == tab_id), None)
        active = wait_for(lambda: (c := context()) and c['displayedHostname']=='login.localhost' and c, 'allowed authentication redirect')
        journey = active['journey']
        ended = wait_for(lambda: (c := context()) and c['journey']['endReason']=='EXPIRED' and c['effect']=='REMOVED' and c, 'timeout return and denied automatic continuation')
        assert ended['journey']['id'] == journey['id'] and ended['journey']['expiresAt'] == journey['expiresAt']
        assert hits.count(('root.localhost', '/')) >= 1
        assert hits.count(('login.localhost', '/')) == before_auth + 1
        assert snapshot()['accessState']['grants'] == [] and snapshot()['policy'] == original
        time.sleep(1.1)
        assert context()['journey']['id'] == journey['id'] and hits.count(('login.localhost', '/')) == before_auth + 1
        retry = client.message({'kind': 'RESTART_JOURNEY', 'tabId': tab_id, 'journeyId': journey['id']})
        assert retry['opened']
        renewed = wait_for(lambda: (c := context()) and c['displayedHostname']=='login.localhost' and c['journey']['id']!=journey['id'] and c, 'explicit restart creates fresh bounded attempt')
        assert renewed['journey']['expiresAt'] > journey['expiresAt']
        if mode == 'meta':
            expired = wait_for(lambda: (c := context()) and c['journey']['endReason']=='EXPIRED' and c['effect']=='REMOVED' and c, 'second meta attempt expires')
            client.call('WebDriver:SwitchToWindow', handle=tab_handle)
            client.call('Marionette:SetContext', value='chrome')
            client.script('gURLBar.value=arguments[0]; gURLBar.handleCommand();', f'http://root.localhost:{port}/static-root')
            client.call('Marionette:SetContext', value='content')
            arrived = wait_for(lambda: (c := context()) and c['displayedHostname']=='root.localhost' and c, 'real address-bar destination arrival')
            assert arrived['journey']['id'] == expired['journey']['id'] and arrived['journey']['phase']=='ENDED'
            client.call('WebDriver:SwitchToWindow', handle=tab_handle)
            client.script('location.href=arguments[0];', f'http://login.localhost:{port}/')
            departed = wait_for(lambda: (c := context()) and c['displayedHostname']=='login.localhost' and c['journey']['id']!=expired['journey']['id'] and c, 'loaded-root departure after attested user arrival')
            assert departed['journey']['phase']=='IN_TRANSIT'
            view()
        client.script('const [id,done]=arguments; browser.tabs.remove(id).then(()=>done(true));', tab_id, asynchronous=True)
    checks.append('native timeout returns recorded origin; HTTP, immediate JS and same-origin meta-refresh cannot renew; explicit Restart and real address-bar document arrival allow subsequent attempts without grants')
    print('PASS native timeout HTTP/JS/meta-refresh renewal veto and explicit retry', flush=True)

    # Presentation persists independently; normal browser restart retains authoritative timing.
    usage = client.script('return JSON.parse(localStorage.getItem("atlas-destination-usage-v1"));')
    assert usage['host:root.localhost']['count'] >= 4
    client.script('document.getElementById("show-sites").click();')
    input_value('sites-search', 'arxiv.org')
    client.script('document.querySelector(".site-row").click();')
    wait_for(lambda: client.script('return !document.getElementById("site-detail").hidden && !document.getElementById("edit-site").disabled;'), 'curated edit available')
    edit_selected()
    assert client.script('return !document.getElementById("site-draft").hidden;')
    input_value('site-name', 'arXiv papers')
    client.script('document.getElementById("save-site-display").click();')
    wait_for(lambda: workspace()['receipt']['phase']=='DONE', 'curated label preference saved')
    metadata = wait_for(lambda: client.script('const p=JSON.parse(localStorage.getItem("atlas-destinations-v1")); return p.destinations.some(d=>d.label==="arXiv papers") && p;'), 'curated metadata saved')
    assert metadata['destinations'][0]['id'] == 'service:arxiv.org'
    edit_selected()
    input_value('site-name', 'Unsaved display label')
    client.script('''window.__atlasPreferenceSet=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key==='atlas-destinations-v1')throw new Error('synthetic presentation failure');return window.__atlasPreferenceSet.call(this,key,value);};
      document.getElementById('save-site-display').click();''')
    wait_for(lambda: client.script('return document.getElementById("site-name").value==="Unsaved display label" && !document.getElementById("retry-site-save").hidden;'), 'frozen failed display values retained')
    assert client.script('return JSON.parse(localStorage.getItem("atlas-destinations-v1"));') == metadata
    client.script('Storage.prototype.setItem=window.__atlasPreferenceSet; delete window.__atlasPreferenceSet;')
    saved = snapshot()
    client.script('const done=arguments[0]; browser.tabs.create({url:"about:blank",active:false}).then(()=>done(true));', asynchronous=True)
    client.call('Marionette:SetContext', value='chrome')
    client.script('globalThis.__atlasPreviousPolicy=WebExtensionPolicy.getByID("atlas-development@atlas.invalid"); return true;')
    client.call('Marionette:SetContext', value='content')
    client.script('setTimeout(()=>browser.runtime.reload(),0); return true;')
    wait_for(lambda: ui_handle not in client.call('WebDriver:GetWindowHandles'), 'UI closes on extension restart')
    client.call('WebDriver:SwitchToWindow', handle=client.call('WebDriver:GetWindowHandles')[0])
    client.call('Marionette:SetContext', value='chrome')
    wait_for(lambda: client.script('const p=WebExtensionPolicy.getByID("atlas-development@atlas.invalid"); return p?.active && p!==globalThis.__atlasPreviousPolicy;'), 'new extension registration')
    client.script('delete globalThis.__atlasPreviousPolicy;')
    previous_handles = set(client.call('WebDriver:GetWindowHandles'))
    client.script('gBrowser.selectedTab=gBrowser.addTrustedTab("about:blank");')
    client.call('Marionette:SetContext', value='content')
    ui_handle = next(h for h in client.call('WebDriver:GetWindowHandles') if h not in previous_handles)
    client.call('WebDriver:SwitchToWindow', handle=ui_handle)
    client.call('Marionette:SetContext', value='chrome')
    client.script('gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});', ui_url)
    client.call('Marionette:SetContext', value='content')
    wait_for(lambda: client.script('return location.href.split(/#/,1)[0]===arguments[0] && document.readyState==="complete";', ui_url), 'restarted UI')
    wait_for(lambda: (view()['controller'] or {}).get('status')=='READY', 'IndexedDB restart authority')
    assert snapshot()['policy'] == saved['policy'] and snapshot()['configuration'] == saved['configuration']
    assert client.script('return !document.getElementById("sidebar-toggle") && document.getElementById("atlas-sidebar").getBoundingClientRect().width===60;')
    assert client.script('return JSON.parse(localStorage.getItem("atlas-destinations-v1"));') == metadata
    assert client.script('return JSON.parse(localStorage.getItem("atlas-destination-usage-v1"));') == usage
    client.call('WebDriver:SetWindowRect', width=500, height=1000)
    assert client.script('return document.documentElement.scrollWidth<=innerWidth && getComputedStyle(document.getElementById("atlas-sidebar")).position==="static";')
    capture('compact-home-small')
    client.script('document.getElementById("show-sites").click();')
    wait_for(lambda: client.script('return document.querySelector(".site-row") && document.getElementById("status").dataset.ready==="true";'), 'restarted Sites view is rendered and verified')
    assert client.script('return document.documentElement.scrollWidth<=innerWidth;')
    capture('sites-small')
    client.script('document.querySelector(".site-row").click();')
    wait_for(lambda: client.script('return document.activeElement.id==="site-detail" && document.getElementById("site-detail").getBoundingClientRect().top>=0 && document.getElementById("site-detail").getBoundingClientRect().top<innerHeight;'), 'narrow Sites selection reveals focused details')
    capture('sites-small-details')
    checks.append('real IndexedDB settings restart, metadata/ranking reload, failed presentation write without permission changes and 500px Home/Sites without horizontal overflow')
    return {'checks': checks, 'metrics': metrics, 'layouts': layouts}
