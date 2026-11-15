"""Add/review/Vault usability in the existing isolated native Firefox harness."""
import base64
import json
import time


def run_site_workflow(c, ui_handle, wait_for, artifacts, baseline=False):
    def state():
        return c.message({'kind': 'GET_VIEW'})['view']['controller']

    def wait(script, label, timeout=20):
        try:
            return wait_for(lambda: c.script(script), label, timeout)
        except Exception:
            report=c.script('''return {page:location.hash,section:document.body.dataset.section,
              view:document.getElementById('sites-section').dataset.view,
              messages:['destination-draft-status','destination-draft-stale','site-field-error','feedback','draft-submit-help','draft-problem'].map(id=>[id,document.getElementById(id).textContent]),
              values:['site-name','site-hostname','site-category','site-access'].map(id=>[id,document.getElementById(id).value])};''')
            (artifacts/'workflow-failure.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            shot('workflow-failure')
            raise

    def click(identity):
        c.script('document.getElementById(arguments[0]).click();', identity)

    def fields(values):
        c.script('for(const [id,value] of Object.entries(arguments[0])){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event("input",{bubbles:true}));}', values)

    def shot(name):
        (artifacts/(name+'.png')).write_bytes(base64.b64decode(c.call('WebDriver:TakeScreenshot')))

    c.call('WebDriver:SwitchToWindow', handle=ui_handle)
    c.call('WebDriver:SetWindowRect', width=1440, height=1000)
    before = wait_for(lambda: (s := state())['status'] == 'READY' and s['snapshot'], 'workflow authority')
    # The shared harness changed its fixture policy through Core. Let this page
    # load that acknowledged revision before starting a user draft against it.
    c.call('WebDriver:Refresh')
    wait_for(lambda: c.script('return document.getElementById("policy")?.textContent.includes(arguments[0]) && !document.getElementById("add-site").disabled;',
                             'Policy revision: '+str(before['policyRevision'])), 'UI sees fixture policy', 25)
    click('show-settings')
    c.script('document.querySelector("[data-settings-panel=appearance-settings]").click();')
    fields({'atlas-theme': 'parchment'})
    c.script('document.getElementById("atlas-theme").dispatchEvent(new Event("change",{bubbles:true}));')
    click('show-sites'); click('add-site')
    wait('return document.getElementById("sites-editor").open;', 'site editor')
    fields({'site-name': 'Quiet reading', 'site-hostname': 'quiet.example', 'site-category': 'Reading'})
    c.script('document.getElementById("site-form").requestSubmit();')
    wait('return !document.getElementById("sites-editor").open && !document.getElementById("review-destination-draft").disabled && document.getElementById("sites-section").dataset.view!=="detail";', 'acknowledged draft')
    after_stage = c.script('return document.getElementById("sites-section").dataset.view;')
    if baseline:
        assert after_stage == 'browse'
        wait('return !document.getElementById("review-destination-draft").disabled;', 'saved review action')
        click('review-destination-draft')
    else:
        assert after_stage == 'review', f'saved edits go straight to review, got {after_stage}'
    wait('return !document.getElementById("submit-destination-draft").disabled;', 'review ready')
    shot('review-parchment')
    click('submit-destination-draft')
    wait('return location.hash==="#vault" && !document.getElementById("vault-panel").hidden;', 'saved Vault proposal')
    wait('return document.getElementById("vault-phase").textContent === "Waiting";', 'verified waiting phase')
    location = c.script('return {section:document.body.dataset.section,settingsHidden:document.getElementById("settings").hidden};')
    assert location['section'] == ('settings' if baseline else 'sites')
    if not baseline:
        assert location['settingsHidden']
        assert c.script('return !document.getElementById("sites-nav-status").hidden && document.getElementById("settings-nav-status").hidden;')
    pending = state()['snapshot']['vaultState']['pendingProposal']
    assert state()['snapshot']['policy'] == before['policy']
    assert c.script('return document.getElementById("confirm-policy").disabled || document.getElementById("confirm-policy").hidden;')
    shot('vault-parchment')
    # Native frames check retained content and stable positions during idle ticks.
    measured = c.script('''const done=arguments[0],ids=['vault-heading','vault-destination-items','return-to-sites'],
      nodes=ids.map(id=>document.getElementById(id)),before=nodes.map(n=>n.getBoundingClientRect().toJSON()),
      samples=[];const end=performance.now()+2200;function frame(){samples.push(nodes.map(n=>n.getBoundingClientRect().toJSON()));
      if(performance.now()<end)requestAnimationFrame(frame);else done({frames:samples.length,
        retained:nodes.every((n,i)=>n===document.getElementById(ids[i])),
        maxMovement:Math.max(...samples.flatMap(s=>s.map((r,i)=>Math.max(Math.abs(r.x-before[i].x),Math.abs(r.y-before[i].y)))))});}requestAnimationFrame(frame);''', asynchronous=True)
    assert measured['retained']
    if not baseline:
        assert measured['maxMovement'] <= 1
        c.call('WebDriver:SetWindowRect', width=720, height=1000)
        c.call('Marionette:SetContext', value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=2;');c.call('Marionette:SetContext', value='content')
        wait('return innerWidth < 500;', 'narrow viewport')
        assert c.script('return document.documentElement.scrollWidth<=innerWidth+1;'), 'no narrow horizontal overflow'
        shot('vault-narrow-parchment')
        c.call('Marionette:SetContext', value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=1;');c.call('Marionette:SetContext', value='content')
        c.call('WebDriver:SetWindowRect', width=1440, height=1000)
        # Back and forward retain the owning section and the same saved proposal.
        c.script('history.back();')
        wait('return location.hash==="#sites";', 'back to sites')
        c.script('history.forward();')
        wait('return location.hash==="#vault" && document.body.dataset.section==="sites";', 'forward to site Vault')
        c.call('WebDriver:Refresh')
        wait('return location.hash==="#vault" && document.body.dataset.section==="sites" && !document.getElementById("vault-destination-review").hidden;', 'reload preserves site Vault')
    wait_for(lambda: time.time()*1000 >= pending['readyAt'], 'real Vault waiting period', 40)
    wait('return !document.getElementById("confirm-policy").disabled && !document.getElementById("confirm-policy").hidden;', 'explicit confirmation available')
    assert state()['snapshot']['policy'] == before['policy'], 'time alone grants nothing'
    click('confirm-policy')
    wait_for(lambda: (s := state())['status'] == 'READY' and 'quiet.example' in s['snapshot']['policy']['whitelist'], 'acknowledged policy change')
    wait('return document.getElementById("vault-panel").hidden;', 'completed Vault')
    if not baseline:
        wait('return document.getElementById("vault-empty").textContent==="Access rules updated.";', 'accurate site completion')
    click('return-to-sites')
    wait('return document.body.dataset.section === "sites";', 'return to sites')
    if not baseline:
        click('show-settings')
        c.script('document.querySelector("[data-settings-panel=appearance-settings]").click();')
        fields({'atlas-theme': 'celestial'})
        c.script('document.getElementById("atlas-theme").dispatchEvent(new Event("change",{bubbles:true}));')
        click('show-sites'); wait('return !document.getElementById("add-site").disabled;', 'previous display save complete'); click('add-site')
        wait('return document.getElementById("sites-editor").open;', 'second site editor')
        fields({'site-name': 'Second site', 'site-hostname': 'second.example', 'site-category': 'Reading'})
        c.script('document.getElementById("site-form").requestSubmit();')
        wait('return !document.getElementById("submit-destination-draft").disabled;', 'second review')
        shot('review-celestial'); click('submit-destination-draft')
        wait('return location.hash==="#vault" && document.getElementById("vault-phase").textContent==="Waiting";', 'second Vault')
        shot('vault-celestial'); click('cancel-policy')
        wait_for(lambda: state()['snapshot']['vaultState']['pendingProposal'] is None, 'cancel without permission')
        assert 'second.example' not in state()['snapshot']['policy']['whitelist']
        # Timing changes remain within Settings, using the same Vault node.
        click('show-settings'); c.script('document.querySelector("[data-settings-panel=timing-settings]").click();')
        wait('return !document.getElementById("propose-settings").disabled;', 'timing editor ready')
        fields({'journey-hops': str(before['configuration']['journeyLimits']['maxHops'] + 1)})
        c.script('document.getElementById("settings-form").requestSubmit();')
        wait('return location.hash==="#vault" && document.body.dataset.section==="settings" && !document.getElementById("vault-panel").hidden;', 'settings Vault stays in Settings')
        assert c.script('return document.getElementById("sites-nav-status").hidden && !document.getElementById("settings-nav-status").hidden;')
        assert c.script('return document.querySelectorAll("#vault-section").length===1;')
        click('cancel-policy')
        wait_for(lambda: state()['snapshot']['vaultState']['pendingProposal'] is None, 'cancel timing change')
    return {'suite':'site-workflow','baseline':baseline,'afterStage':after_stage,'vaultLocation':location,
            'idle':measured,'waitedForRealDeadline':True,'explicitConfirmation':True,
            'candidateChecks':[] if baseline else ['narrow viewport','history back/forward','reload','both themes','cancellation','Settings context'],
            'normalProfileAccessed':False}
