"""Management presentation checks. Only synthetic data in the harness's isolated profile."""
import base64
import time

def run_management_ux(client, ui_handle, ui_url, port, wait_for, run):
    def view(): return client.message({'kind':'GET_VIEW'})['view']
    def snapshot(): return wait_for(lambda:(c:=view().get('controller')) and c['status']=='READY' and c['snapshot'],'verified authority',30)
    def click(identity):
        wait_for(lambda:client.script('return !document.getElementById(arguments[0]).disabled;',identity),'enabled '+identity)
        client.script('document.getElementById(arguments[0]).click();',identity)
    def page(name):
        click('show-'+name)
        client.script('const done=arguments[0];requestAnimationFrame(()=>{scrollTo(0,0);done(true)});',asynchronous=True)
    def fields(values):
        client.script('for(const [id,v] of Object.entries(arguments[0])){const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event("input",{bubbles:true}));}',values)
    def shot(name):
        time.sleep(.25)
        (run/(name+'.png')).write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot',id=None,highlights=[],full=False)))
    def saved(): wait_for(lambda:client.script('return document.getElementById("destination-draft-status").textContent.includes("Saved locally");'),'local save')
    def stage():
        client.script('document.getElementById("site-form").requestSubmit();')
        wait_for(lambda:client.script('return document.getElementById("site-draft").hidden;'),'staged editor')
        saved()
    def select_github():
        fields({'sites-search':'github.com'})
        wait_for(lambda:client.script('return [...document.querySelectorAll(".site-row")].some(n=>n.dataset.destinationId==="service:github.com");'),'GitHub row')
        client.script('document.querySelector(\'.site-row[data-destination-id="service:github.com"]\').click();')
        wait_for(lambda:client.script('return !document.getElementById("site-detail").hidden;'),'selected detail')
    scroll_regions=[]
    def check_pane(identity):
        sample=client.script('const e=document.getElementById(arguments[0]),r=e.getBoundingClientRect();return {id:e.id,client:e.clientHeight,height:e.scrollHeight,top:r.y,bottom:r.bottom,overflow:getComputedStyle(e).overflowY,document:document.documentElement.scrollHeight,viewport:innerHeight};',identity)
        assert sample['client']>100 and sample['overflow']=='auto',sample
        assert 0<=sample['top']<sample['bottom']<=sample['viewport']+1,sample
        if sample['height']>sample['client']+1:
            client.script('document.getElementById(arguments[0]).focus();',identity)
            client.call('WebDriver:PerformActions',actions=[{'type':'key','id':'pane-keys','actions':[{'type':'keyDown','value':'\ue010'},{'type':'keyUp','value':'\ue010'}]}])
            time.sleep(.15)
            assert client.script('const e=document.getElementById(arguments[0]);return e.scrollTop>0;',identity),sample
            client.script('document.getElementById(arguments[0]).scrollTop=0;',identity)
        scroll_regions.append(sample)
    initial=snapshot();client.call('WebDriver:SetWindowRect',width=1586,height=1077)
    page('sites');client.script('const done=arguments[0];document.fonts.ready.then(()=>done(true));',asynchronous=True)
    wait_for(lambda:client.script('return document.querySelectorAll(".site-row").length>100;'),'directory')
    wait_for(lambda:client.script('return document.getElementById("sites-status").textContent.endsWith("revision "+arguments[0]);',initial['policyRevision']),'UI has observed the fixture policy revision')
    shot('directory')
    assert client.script('const a=document.querySelector(".sites-directory").getBoundingClientRect(),b=document.querySelector(".sites-editor").getBoundingClientRect();return b.x>a.right&&Math.abs(a.y-b.y)<2;'),'adjacent directory and workspace'
    select_github();shot('detail');click('edit-site');saved()
    fields({'site-name':'GitHub work'});saved();shot('edit');check_pane('sites-editor')
    assert client.script('return !document.getElementById("save-site-display").hidden;')
    click('save-site-display')
    try:
        wait_for(lambda:client.script('return document.getElementById("destination-receipt-status").textContent.startsWith("Applied batch");'),'display acknowledged')
    except AssertionError:
        print('DISPLAY SAVE STATE',client.script('return Object.fromEntries(["site-save-feedback","site-field-error","destination-draft-status","destination-receipt-status","draft-submit-help"].map(id=>[id,document.getElementById(id).textContent]));'),flush=True)
        shot('display-failure');raise
    assert snapshot()['policy']==initial['policy'] and snapshot()['vaultState']['pendingProposal'] is None
    # Two protected additions use the same persistent batch and one proposal.
    click('add-site');fields({'site-name':'Research portal','site-hostname':'research.example.org','site-category':'Research'});saved();stage()
    click('add-site');fields({'site-name':'Documentation','site-hostname':'docs.example.org','site-category':'Development'});saved()
    client.script('document.getElementById("site-subdomains").click();');saved();stage()
    click('review-destination-draft')
    wait_for(lambda:client.script('return document.getElementById("sites-section").dataset.view==="review";'),'dedicated review')
    assert client.script('return document.querySelectorAll("#destination-draft-items .change-comparison").length===2 && document.getElementById("destination-draft-items").textContent.includes("docs.example.org");')
    shot('review');check_pane('destination-draft-items')
    click('continue-destination-editing');click('add-site');fields({'site-name':'Unfinished notes','site-hostname':'unfinished.example.org'});saved()
    click('review-destination-draft');assert client.script('return document.getElementById("submit-destination-draft").disabled;')
    click('continue-destination-editing');assert client.script('return document.getElementById("site-name").value==="Unfinished notes";')
    # Real failing draft transaction, then return to list: error remains outside review.
    client.script('window.__managementPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==="workspace")throw new DOMException("Synthetic management save failure","AbortError");return window.__managementPut.apply(this,args);};')
    fields({'site-name':'Retained unfinished notes'})
    wait_for(lambda:client.script('return !document.getElementById("draft-problem").hidden;'),'prominent failed save')
    click('sites-back');client.script('scrollTo(0,0);');shot('save-failure')
    assert client.script('return document.getElementById("draft-problem").getBoundingClientRect().height>0 && !document.getElementById("retry-destination-draft").disabled;')
    client.script('IDBObjectStore.prototype.put=window.__managementPut;');click('retry-destination-draft')
    wait_for(lambda:client.script('return document.getElementById("draft-problem").hidden;'),'save retry')
    click('resume-destination-editor');assert client.script('return document.getElementById("site-name").value==="Retained unfinished notes";')
    # Sidebar, browser history and reload cannot discard incomplete fields.
    page('home');page('sites');assert client.script('return document.getElementById("site-name").value==="Retained unfinished notes";')
    click('review-destination-draft');client.script('history.back();')
    wait_for(lambda:client.script('return document.getElementById("sites-section").dataset.view==="detail";'),'Back restores editor')
    client.script('history.forward();')
    wait_for(lambda:client.script('return document.getElementById("sites-section").dataset.view==="review";'),'Forward restores review')
    client.call('WebDriver:Refresh')
    wait_for(lambda:client.script('return document.getElementById("sites-section").dataset.view==="review" && document.querySelectorAll("#destination-draft-items>li").length===2;'),'reload review and saved editor')
    click('continue-destination-editing');assert client.script('return document.getElementById("site-name").value==="Retained unfinished notes";')
    # Existing Close editor deliberately discards only this unstaged editor.
    client.script('window.confirm=()=>true;');click('cancel-site-draft')
    wait_for(lambda:client.script('return document.getElementById("site-draft").hidden;'),'close unstaged editor')
    click('review-destination-draft');click('submit-destination-draft')
    pending=wait_for(lambda:snapshot()['vaultState']['pendingProposal'],'frozen batch')
    wait_for(lambda:client.script('return !document.getElementById("vault-destination-review").hidden;'),'complete frozen review')
    wait_for(lambda:client.script('return document.getElementById("vault-phase").textContent==="Waiting";'),'verified waiting review')
    client.script('document.activeElement.blur();scrollTo(0,0);');shot('vault-waiting');check_pane('vault-contents')
    assert snapshot()['policy']==initial['policy']
    assert client.script('return document.getElementById("confirm-policy").hidden;')
    wait_for(lambda:client.script('return !document.getElementById("confirm-policy").hidden&&!document.getElementById("confirm-policy").disabled;'),'real Vault wait',40)
    assert client.script('const n=document.getElementById("vault-ready-at"),p=arguments[0];return n.title===`Ready at ${new Date(p.readyAt).toLocaleString()}. Confirm by ${new Date(p.confirmBy).toLocaleString()}.`;',pending),'tooltip retains both original deadlines'
    shot('vault-ready');assert snapshot()['vaultState']['pendingProposal']==pending
    click('confirm-policy');wait_for(lambda:snapshot()['vaultState']['pendingProposal'] is None,'confirmed batch')
    committed=snapshot();assert 'research.example.org' in committed['policy']['whitelist'] and 'docs.example.org' in committed['policy']['whitelistSubdomains']
    wait_for(lambda:client.script('return document.getElementById("destination-receipt-status").textContent.startsWith("Applied batch");'),'complete acknowledged receipt')
    shot('vault-completed')
    page('settings');fields({'grant-duration':'75'});shot('settings-edited');check_pane('settings-workspace')
    assert client.script('return document.getElementById("timing-edited-count").textContent.includes("1 edited value");')
    for section in ['curated-settings','managed-section','recovery-section','diagnostics']:
        client.script('document.querySelector("[data-settings-panel="+arguments[0]+"]").click();',section)
        assert client.script('return !document.getElementById(arguments[0]).hidden&&document.querySelectorAll(".settings-workspace>details:not([hidden])").length===1;',section)
        shot(section)
    client.script('history.back();')
    wait_for(lambda:client.script('return !document.getElementById("recovery-section").hidden;'),'Settings Back')
    client.script('document.querySelector("[data-settings-panel=timing-settings]").click();')
    assert client.script('return document.getElementById("grant-duration").value==="75";')
    assert snapshot()['configuration']==committed['configuration'],'editing settings alone grants nothing'
    # Native narrow directory/detail/editor, keyboard and real Firefox zoom.
    page('sites');click('sites-back');select_github();click('edit-site');saved()
    client.call('WebDriver:SetWindowRect',width=500,height=985);client.script('scrollTo(0,0);');shot('narrow-edit')
    assert client.script('return getComputedStyle(document.querySelector(".sites-directory")).display==="none";')
    click('sites-back');assert client.script('return document.getElementById("sites-search").value==="github.com";')
    shot('narrow-directory');click('resume-destination-editor')
    client.script('document.getElementById("site-name").focus();')
    client.call('WebDriver:PerformActions',actions=[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue004'},{'type':'keyUp','value':'\ue004'}]}])
    assert client.script('return document.activeElement.id==="site-category";')
    dimensions=[]
    for width,zoom in [(1586,1),(820,1),(500,1),(1440,2),(500,2)]:
        client.call('WebDriver:SetWindowRect',width=width,height=1000)
        client.call('Marionette:SetContext',value='chrome');client.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,arguments[0]);',zoom);client.call('Marionette:SetContext',value='content')
        for name in ['sites','settings','vault']:
            page(name)
            assert client.script('return document.documentElement.scrollWidth<=document.documentElement.clientWidth+1;'),(name,width,zoom)
            dimensions.append({'page':name,'width':width,'zoom':zoom,'overflow':False})
    return {'suite':'management-ux','referenceViewport':{'width':1586,'height':992},'checks':['adjacent detail and editor','acknowledged display-only save','two-change structured review','failed save visible from list and retry','unfinished editor retained through sidebar and history/reload','real waiting and explicit confirmation','one frozen proposal','complete receipt','Settings sections and Back retain edits','narrow return preserves filter','native Tab order'],'scrollRegions':scroll_regions,'dimensions':dimensions,'normalProfileAccessed':False}
