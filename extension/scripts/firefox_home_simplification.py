"""Native Home workflow checks. Only the caller's disposable profile is used."""
import time

def verify(c,h,shot,reload):
    def js(code,*args):return c.script(code,*args)
    def click(selector):js('document.querySelector(arguments[0]).click();',selector)
    def view():return c.message({'kind':'GET_VIEW'})['view']
    def async_js(code,*args):return c.script(code,*args,asynchronous=True)
    c.call('WebDriver:SetWindowRect',width=1752,height=1202)
    presentation=c.message({'kind':'PRESENTATION_READ'})
    assert presentation['sync']['enabled'] and presentation['sync']['scope']=='toolbar'
    assert 'bookmarks' in js('return browser.runtime.getManifest().permissions;')
    assert 'bookmarks' not in js('return browser.runtime.getManifest().optional_permissions??[];')
    before=view()['controller']['snapshot']
    folder=async_js('''const done=arguments[0];(async()=>{const f=await browser.bookmarks.create({parentId:'toolbar_____',title:'Research folder'});
      const n=await browser.bookmarks.create({parentId:f.id,title:'Notes'});
      await browser.bookmarks.create({parentId:n.id,title:'Exact note',url:'https://unlisted.localhost/path?q=1#fragment'});
      await browser.bookmarks.create({parentId:f.id,title:'Unsupported',url:'about:config'});done(f.id);})().catch(e=>done({error:e.name}));''')
    selector=f'[data-destination-id="folder:{folder}"]'
    h.wait_for(lambda:js('return !!document.querySelector(arguments[0]);',selector),'folder mirror',20)
    shot('home-resting');click(selector)
    h.wait_for(lambda:js('return document.querySelector("#pin-chooser-pages").textContent.includes("?q=1#fragment");'),'exact folder pages')
    assert 'Unsupported' not in js('return document.getElementById("pin-chooser-pages").textContent;')
    shot('folder-open')
    # Real keyboard dismissal restores the folder button; the page list keeps native focus.
    c.call('WebDriver:PerformActions',actions=[{'type':'key','id':'keys','actions':[{'type':'keyDown','value':'\ue00c'},{'type':'keyUp','value':'\ue00c'}]}])
    assert js('return document.activeElement===document.querySelector(arguments[0])&&!document.getElementById("pin-chooser").matches(":popover-open");',selector)
    click(selector)
    original_ui=c.call('WebDriver:GetWindowHandle');click('#pin-chooser-pages button')
    time.sleep(.3);c.call('WebDriver:SwitchToWindow',handle=original_ui)
    h.wait_for(lambda:any(x.get('hostname')=='unlisted.localhost' and x.get('latest',{}).get('decision',{}).get('outcome')=='GREYLIST' for x in view()['contexts']),'folder launch uses normal gate')
    assert not view()['controller']['snapshot']['accessState']['grants']
    click(selector)
    js('window.__sendIcon=browser.runtime.sendMessage;window.__failIcon=true;browser.runtime.sendMessage=function(m,...rest){if(m.kind==="FOLDER_ICON"&&window.__failIcon){window.__failIcon=false;return Promise.resolve({error:"FAILED"});}return window.__sendIcon.call(this,m,...rest);};')
    click('#edit-folder-icon');click('.category-icon-picker [data-icon="brain"]')
    h.wait_for(lambda:js('return !document.getElementById("retry-folder-icon").hidden&&!document.getElementById("retry-folder-icon").disabled;'),'failed icon retry')
    assert folder not in c.message({'kind':'PRESENTATION_READ'})['sync']['folderIcons']
    shot('folder-icon-retry');click('#retry-folder-icon')
    js('browser.runtime.sendMessage=window.__sendIcon;')
    h.wait_for(lambda:c.message({'kind':'PRESENTATION_READ'})['sync'].get('folderIcons',{}).get(folder)=='brain','saved icon')
    reload();h.wait_for(lambda:js('return document.querySelector(arguments[0]+" .folder-mark").dataset.icon==="brain";',selector),'icon reload')
    # Folders stay native and are not promoted into access policy.
    assert view()['controller']['snapshot']['policy']==before['policy']
    for i in range(12):assert c.message({'kind':'PIN_SET','id':f'host:overflow{i}.example','pinned':True,'hosts':[f'overflow{i}.example']})['type']=='SAVED'
    h.wait_for(lambda:js('return !!document.querySelector("#pinned-primary [data-destination-id=overflow]");'),'overflow folder')
    assert js('return document.querySelectorAll("#pinned-primary .compass-pin").length===10;')
    click('[data-destination-id="overflow"]');shot('overflow-folder')
    click('#pin-chooser-pages button')
    assert js('return document.getElementById("pin-chooser").matches(":popover-open");')
    js('document.getElementById("pin-chooser").hidePopover();')
    # Real requests, real waits and controller commits; no altered production clocks.
    ui=c.call('WebDriver:GetWindowHandle')
    tab=c.message({'kind':'OPEN_DESTINATION','url':'http://grey.localhost/'})['tabId']
    c.call('WebDriver:SwitchToWindow',handle=ui)
    c.call('WebDriver:Navigate',url=h.UI_URL+f'?view=access&tab={tab}')
    h.wait_for(lambda:js('return [...document.querySelectorAll(".access-signal")].some(b=>b.textContent==="Request access"&&!b.disabled);'),'inline request')
    assert js('return !document.getElementById("access-panel")&&document.body.dataset.page==="home";')
    click('.access-signal');h.wait_for(lambda:len(view()['controller']['snapshot']['accessState']['pendingRequests'])==1,'started')
    first=view()['controller']['snapshot']['accessState']['pendingRequests'][0]
    assert not view()['controller']['snapshot']['accessState']['grants']
    shot('greylist-waiting');click('.access-cancel')
    h.wait_for(lambda:not view()['controller']['snapshot']['accessState']['pendingRequests'],'cancel')
    h.wait_for(lambda:js('return !document.querySelector("#pending-access-list li");'),'cancelled row removed')
    c.call('WebDriver:Navigate',url=h.UI_URL+f'?view=access&tab={tab}')
    h.wait_for(lambda:js('return document.querySelector(".access-signal")?.textContent==="Request access";'),'new explicit request')
    click('.access-signal');h.wait_for(lambda:len(view()['controller']['snapshot']['accessState']['pendingRequests'])==1,'second request')
    request=view()['controller']['snapshot']['accessState']['pendingRequests'][0]
    h.wait_for(lambda:js('return document.querySelector(".access-signal")?.textContent.startsWith("Allow");'),'ready without permission',40)
    assert not view()['controller']['snapshot']['accessState']['grants']
    shot('greylist-ready');click('.access-signal')
    h.wait_for(lambda:len(view()['controller']['snapshot']['accessState']['grants'])==1,'explicit confirmation')
    grant=view()['controller']['snapshot']['accessState']['grants'][0]
    assert grant['requestId']==request['id'] and not view()['controller']['snapshot']['accessState']['pendingRequests']
    h.wait_for(lambda:js('return !!document.querySelector(".access-signal[data-tone=active]");'),'active')
    shot('greylist-active');click('.access-cancel')
    h.wait_for(lambda:not view()['controller']['snapshot']['accessState']['grants'],'termination')
    click('#show-home');click('.category-shortcut');shot('category-open')
    click('#close-category-workspace')
    # Both normal and effective high-zoom/narrow viewports keep controls reachable.
    sizes=[]
    for width,height in [(1280,900),(900,760),(640,620)]:
        c.call('WebDriver:SetWindowRect',width=width,height=height);time.sleep(.2)
        size=js('return {width:innerWidth,scroll:document.documentElement.scrollWidth,height:innerHeight};')
        assert size['scroll']<=size['width']+1,size;sizes.append(size);shot(f'home-{width}')
    c.call('WebDriver:SetWindowRect',width=1752,height=1202)
    for zoom in [1.25,1.5,2]:
        c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.browsingContext.fullZoom=arguments[0];',zoom);c.call('Marionette:SetContext',value='content')
        time.sleep(.2)
        assert js('return document.documentElement.scrollWidth<=innerWidth+1;')
        shot(f'home-zoom-{zoom}')
    c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.browsingContext.fullZoom=1;');c.call('Marionette:SetContext',value='content')
    click('#show-home');time.sleep(1)
    js('window.__mutations=0;window.__observer=new MutationObserver(m=>window.__mutations+=m.length);window.__observer.observe(document.querySelector(".compass-composition"),{subtree:true,childList:true,attributes:true});window.__resources=performance.getEntriesByType("resource").length;')
    time.sleep(2.2)
    idle=js('window.__observer.disconnect();return {mutations:window.__mutations,requests:performance.getEntriesByType("resource").length-window.__resources};')
    assert idle=={'mutations':0,'requests':0},idle
    return {'automaticConnection':True,'folderIcon':folder,'exactNestedPages':True,'overflow':True,'inlineWaitCancelConfirmEnd':True,'folderLaunchGated':True,'keyboardDismissal':True,'iconFailureRetry':True,'zoom':[1.25,1.5,2],'idle':idle,'sizes':sizes}
