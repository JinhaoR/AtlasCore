"""Everyday controls in a disposable Firefox profile, called by compact harness."""
import time

def run_everyday(get_client,h,shot,record,stop,start):
    def c(): return get_client()
    def js(source,*args): return c().script(source,*args)
    def msg(value): return c().message(value)
    def click(selector):js('document.querySelector(arguments[0]).click();',selector)
    def wait(source,label):return h.wait_for(lambda:js(source),label,15)
    def api(source,*args):return c().script('const done=arguments[arguments.length-1];(async()=>{'+source+'})().then(done,e=>done({error:String(e)}));',*args,asynchronous=True)
    def chrome(source,*args):
        c().call('Marionette:SetContext',value='chrome')
        try:return c().script(source,*args)
        finally:c().call('Marionette:SetContext',value='content')
    r={}
    # Fixed geometry at desktop; category, directory and search replace one panel.
    geometry='return ["search-form","pinned-section","temporary-section"].map(id=>{const b=document.getElementById(id).getBoundingClientRect();return [id,b.x,b.y,b.width];});'
    before=js(geometry);layout=record('current')
    r['compassOverflow']=js('const e=document.getElementById("pinned-section");return {client:e.clientWidth,scroll:e.scrollWidth};')
    assert r['compassOverflow']['scroll']<=r['compassOverflow']['client']+1
    click('.category-shortcut');time.sleep(.3);assert js(geometry)==before
    shot('everyday-category')
    click('#category-workspace .service-group:not([hidden]) .category-toggle');time.sleep(.2)
    js('document.getElementById("category-workspace").focus();')
    c().call('WebDriver:PerformActions',actions=[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue00f'},{'type':'keyUp','value':'\ue00f'}]}])
    time.sleep(.3)
    r['keyboardPanelScroll']=js('return document.getElementById("category-workspace").scrollTop>0;')
    assert r['keyboardPanelScroll']
    if js('return !!document.getElementById("back-to-categories");'):
        click('#back-to-categories');time.sleep(.2);assert js(geometry)==before
        shot('everyday-directory');click('#close-category-workspace')
    else:
        click('#close-category-workspace');time.sleep(.2);assert js(geometry)==before
        shot('everyday-category-grid')
    js('const e=document.getElementById("destination-search");e.value="Google";e.dispatchEvent(new Event("input",{bubbles:true}));')
    time.sleep(.3);assert js(geometry)==before;shot('everyday-search')
    js('const e=document.getElementById("destination-search");e.value="";e.dispatchEvent(new Event("input",{bubbles:true}));')
    assert record('current')==layout
    r['stableDesktop']=True
    # Search-to-add uses the existing editor and never creates policy.
    authority=msg({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    click('#show-sites');js('const e=document.getElementById("sites-search");e.value="https://new-site.example/path";e.dispatchEvent(new Event("input",{bubbles:true}));')
    click('#add-site');wait('return document.getElementById("site-name").value==="https://new-site.example/path";','search name')
    assert js('return document.getElementById("site-hostname").value;')=='new-site.example'
    shot('everyday-search-add')
    # Preserve this dirty editor through a popup shortcut instead of cancelling it.
    c().call('Marionette:SetContext',value='chrome')
    c().script('CustomizableUI.addWidgetToArea("atlas-development_atlas_invalid-browser-action",CustomizableUI.AREA_NAVBAR);')
    button=c().call('WebDriver:FindElement',using='css selector',value='#atlas-development_atlas_invalid-browser-action')
    c().call('WebDriver:ElementClick',id=button['element-6066-11e4-a52e-4f735466cecf'])
    r['headlessToolbarClickOpenedPanel']=c().script('return [...document.querySelectorAll("panel")].some(p=>p.state==="open");')
    c().call('Marionette:SetContext',value='content')
    assert api('await browser.browserAction.openPopup();return true;') is True
    wait('return browser.extension.getViews({type:"popup"}).length===1;','native popup')
    wait('return browser.extension.getViews({type:"popup"})[0]?.document.getElementById("popup-status").textContent!=="Checking status…";','popup status')
    r['popup']=js('const d=browser.extension.getViews({type:"popup"})[0].document;return {status:d.getElementById("popup-status").textContent,host:d.getElementById("popup-host").textContent,buttons:[...d.querySelectorAll("[data-page]")].map(b=>b.textContent)};')
    # Native popup is a separate document. It must refuse the control page command surface.
    denied=api('return await browser.extension.getViews({type:"popup"})[0].browser.runtime.sendMessage({kind:"RECOVER"});')
    assert denied.get('error')=='INVALID_COMMAND'
    # Marionette sends keys to its selected tab, not this native popup document.
    # Earlier probing activated the underlying site's draft form. Do not repeat
    # that unrelated action or count it as popup keyboard verification.
    r['popupKeyboardActivation']='Not verified: headless Marionette retains the underlying tab as its keyboard target.'
    js('browser.extension.getViews({type:"popup"})[0].document.querySelector("[data-page=home]").click();')
    wait('return document.body.dataset.section==="home";','popup reuse home')
    click('#show-sites');wait('return document.getElementById("site-name").value==="https://new-site.example/path";','retained site editor')
    r['popupRetainedEditor']=True
    click('#show-home')
    # One real toolbar connection button requests Firefox permission and merges.
    js('document.getElementById("home-connect-bookmarks").focus();')
    c().call('WebDriver:PerformActions',actions=[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue007'},{'type':'keyUp','value':'\ue007'}]}])
    h.wait_for(lambda:chrome('return !!document.getElementById("addon-webext-permissions-notification")?.button;'),'native optional permission prompt',15)
    r['permissionPrompt']=chrome('return [...PopupNotifications.panel.children].map(n=>({id:n.id,button:n.getAttribute("buttonlabel")}));')
    chrome('document.getElementById("addon-webext-permissions-notification").button.click();')
    h.wait_for(lambda:record('firefox-sync-v1') and record('firefox-sync-v1')['value']['scope']=='toolbar' and record('firefox-sync-v1')['value']['issue']=='NONE' and not record('firefox-sync-v1')['value']['pending'],'connected toolbar',20)
    assert js('return !document.getElementById("bookmark-sync-dialog").open&&!document.getElementById("bookmark-editor").open&&!document.getElementById("sync-preview");')
    click('#home-connect-bookmarks');wait('return document.getElementById("bookmark-sync-dialog").open;','connection settings')
    c().call('WebDriver:PerformActions',actions=[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue00c'},{'type':'keyUp','value':'\ue00c'}]}])
    wait('return !document.getElementById("bookmark-sync-dialog").open&&document.activeElement.id==="home-connect-bookmarks";','sync dismissal restores focus')
    r['oneClickToolbarConnection']=True
    sync=record('firefox-sync-v1')['value'];root=sync['root'];assert len(sync['groups'])>=6 and not sync['pending']
    r['connectedGroups']=len(sync['groups']);click('#show-home')
    folder=api('return await browser.bookmarks.create({parentId:"toolbar_____",title:"Untouched folder"});')
    nested=api('return await browser.bookmarks.create({parentId:arguments[0],title:"Nested",url:"https://nested-fixture.test/private"});',folder['id'])
    time.sleep(.4)
    assert 'host:nested-fixture.test' not in msg({'kind':'PRESENTATION_READ'})['pins']
    r['foldersExcluded']=True
    # Unknown pages join presentation only, with real Firefox events.
    imported=api('return await browser.bookmarks.create({parentId:arguments[0],title:"Unknown fixture",url:"https://unknown-bookmark.example/chapter?q=1#part"});',root)
    wait('return [...document.querySelectorAll(".compass-pin")].some(b=>b.dataset.destinationId==="host:unknown-bookmark.example");','native bookmark import')
    state=record('firefox-sync-v1')['value'];g=next(g for g in state['groups'] if g['id']=='host:unknown-bookmark.example');assert g['pages'][0]['url']=='https://unknown-bookmark.example/chapter?q=1#part'
    api('return await browser.bookmarks.update(arguments[0],{title:"Renamed in Firefox"});',imported['id'])
    wait('return [...document.querySelectorAll(".compass-pin")].find(b=>b.dataset.destinationId==="host:unknown-bookmark.example")?.title.includes("No saved access rule");','truthful unknown status')
    click('#show-settings');click('[data-settings-panel="home-settings"]');click('#advanced-pin-settings > summary')
    click('#edit-pins');wait('return document.getElementById("bookmark-editor").open;','advanced page editor')
    js('const e=document.getElementById("bookmark-parent");e.value="host:unknown-bookmark.example";e.dispatchEvent(new Event("change"));')
    wait('return document.querySelector("#bookmark-pages [data-field=label]")?.value==="Renamed in Firefox";','native edit reaches Atlas')
    js('const e=document.querySelector("#bookmark-pages [data-field=label]");e.value="Edited in Atlas";e.dispatchEvent(new Event("input",{bubbles:true}));')
    # A real Firefox event during a dirty page edit must not overwrite the field.
    api('return await browser.bookmarks.update(arguments[0],{title:"Concurrent Firefox edit"});',imported['id'])
    wait('return !document.getElementById("review-bookmark-conflict").hidden;','dirty editor conflict')
    assert js('return document.querySelector("#bookmark-pages [data-field=label]").value;')=='Edited in Atlas'
    click('#review-bookmark-conflict');wait('return !document.getElementById("save-reviewed-bookmarks").disabled;','compare newer pages')
    click('#save-reviewed-bookmarks');wait('return !document.getElementById("bookmark-editor").open;','pages saved')
    r['nativeEventRetainsDirtyEditor']=True
    assert api('return (await browser.bookmarks.get(arguments[0]))[0].title;',imported['id'])=='Edited in Atlas'
    r['bidirectional']=True;click('#show-home');shot('everyday-connected-home')
    imported_before=msg({'kind':'PRESENTATION_READ'})['bookmarks']['value']
    msg({'kind':'PIN_SET','id':'host:unknown-bookmark.example','pinned':False,'hosts':[]})
    wait('return !document.querySelector(`.compass-pin[data-destination-id="host:unknown-bookmark.example"]`);','unpin reflected')
    assert api('return await browser.bookmarks.get(arguments[0]).then(()=>false,()=>true);',imported['id']) is True
    assert api('return (await browser.bookmarks.get(arguments[0]))[0].parentId;',nested['id'])==folder['id']
    assert msg({'kind':'PRESENTATION_READ'})['bookmarks']['value']==imported_before
    msg({'kind':'PIN_SET','id':'host:unknown-bookmark.example','pinned':True,'hosts':[]})
    h.wait_for(lambda:record('firefox-sync-v1')['value']['issue']=='NONE' and not record('firefox-sync-v1')['value']['pending'],'repin finished')
    r['unpinDeletesOnlyToolbarBookmark']=True
    current=msg({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    for key in ['policy','policyRevision','configuration','configurationRevision']:assert current.get(key)==authority.get(key),key
    r['noAuthorityChanges']=True
    # Real restart: local policy, draft, pins, layout and both bookmark copies survive.
    saved={key:record(key) for key in ['current','bookmarks-v1','firefox-sync-v1']};pins=js('return localStorage.getItem("atlas-home-pins-v1");')
    stop();start();time.sleep(2)
    for key in saved:
        after_record=record(key)
        if key=='firefox-sync-v1' and after_record['value']['issue']=='PERMISSION':
            expected={**saved[key]['value'],'issue':'PERMISSION'}
            assert after_record['value']==expected
            r['temporaryOverlayRestart']='Firefox revoked optional permission while reverting to the older signed baseline, whose manifest does not request bookmarks. Both copies retained; reconnect is required.'
        else:assert after_record==saved[key],key
    assert js('return localStorage.getItem("atlas-home-pins-v1");')==pins
    after=msg({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    for key in ['policy','policyRevision','configuration','configurationRevision']:assert after.get(key)==authority.get(key),key
    click('#show-sites');wait('return document.getElementById("site-name").value==="https://new-site.example/path";','restored persisted site editor')
    r['restartPreserved']=True;click('#show-home')
    if r.get('temporaryOverlayRestart'):
        click('#show-settings');click('[data-settings-panel="home-settings"]');click('#settings-connect-bookmarks');wait('const b=document.getElementById("grant-bookmark-permission");return !b.hidden&&!b.disabled;','restart permission action')
        e=c().call('WebDriver:FindElement',using='css selector',value='#grant-bookmark-permission');c().call('WebDriver:ElementClick',id=e['element-6066-11e4-a52e-4f735466cecf'])
        h.wait_for(lambda:chrome('return !!document.getElementById("addon-webext-permissions-notification")?.button;'),'restart permission prompt',15)
        r['restartPromptShown']=chrome('document.getElementById("addon-webext-permissions-notification").button.click();return true;')
        wait('return document.getElementById("bookmark-sync-status").textContent==="Bookmarks are connected.";','reconnected after permission restoration')
        assert record('firefox-sync-v1')['value']==saved['firefox-sync-v1']['value']
        click('#close-bookmark-sync');click('#show-home');r['permissionRestorationPreservedCopies']=True
    r['viewports']=[]
    for width,zoom in [(1488,1.25),(1488,1.5),(1488,2),(800,1),(500,1),(500,2)]:
        c().call('WebDriver:SetWindowRect',width=width,height=1143)
        chrome('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,arguments[0]);',zoom);time.sleep(.25)
        measured=js('return {width:innerWidth,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth};')
        assert measured['scroll']<=measured['client']+1,(width,zoom,measured)
        r['viewports'].append({'window':width,'zoom':zoom,**measured});shot(f'everyday-{width}-{zoom}')
    chrome('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,1);');c().call('WebDriver:SetWindowRect',width=1488,height=1143)
    # Reuse the native gated-launch/access fixture, with two explicit pages in its
    # selected parent. This fixture changes only synthetic isolated policy via Vault.
    view=msg({'kind':'PRESENTATION_READ'});pages=view['bookmarks']['value']
    target=next(g for g in pages['groups'] if g['parentId']=='service:webmail.kth.se')
    target['pages'].append({'id':'native-second','label':'Second fixture','url':'https://example.org/second'})
    assert msg({'kind':'BOOKMARK_SAVE','revision':view['bookmarks']['revision'],'value':pages})['type']=='SAVED'
    from firefox_compact_access import run_access
    access=run_access(c(),h,shot,record);r['access']={k:v for k,v in access.items() if k!='draft'}
    return r
