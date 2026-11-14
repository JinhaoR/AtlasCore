"""Theme checks in the disposable Firefox harness. No production probes."""
import time

def capture(c,h,shot,prefix):
    def wait(code,label):h.wait_for(lambda:c.script(code),label,25)
    def click(s):c.script('document.querySelector(arguments[0]).click();',s)
    def sample(s):return c.script('''return [...document.querySelectorAll(arguments[0])].filter(e=>e.getClientRects().length).map(e=>{
      const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,id:e.id,box:[r.x,r.y,r.width,r.height],
      color:s.color,background:s.backgroundColor,border:s.borderColor,font:s.font,shadow:s.boxShadow};});''',s)
    c.call('WebDriver:SetWindowRect',width=1752,height=1202)
    click('#show-home');time.sleep(.4)
    result={'home':sample('.home-intro, #search-form, .compass, .compass-pin')};shot(prefix+'-home')
    click('#show-sites');wait('return document.querySelectorAll("#sites-categories button").length>4;','categories')
    result['categories']=sample('#sites-categories button');shot(prefix+'-categories')
    click('#sites-categories button');wait('return !!document.querySelector(".site-row");','site rows')
    result['sites']=sample('.site-row');shot(prefix+'-sites')
    click('.site-row');wait('return document.querySelector("#sites-editor").open;','site dialog')
    result['dialog']=sample('#sites-editor, #sites-editor button');shot(prefix+'-dialog')
    c.script('document.querySelector("#sites-editor").close();')
    click('#show-settings');click('[data-settings-panel="timing-settings"]');time.sleep(.3)
    result['settings']=sample('#timing-settings input, #timing-settings button');shot(prefix+'-settings')
    click('[data-settings-panel="appearance-settings"]');time.sleep(.2)
    assert c.script('return !document.querySelector("#appearance-settings").hidden && document.querySelector("#atlas-theme").getBoundingClientRect().height>0;')
    result['appearance']=sample('#appearance-settings');shot(prefix+'-appearance')
    click('#show-home');time.sleep(.2)
    return result

def verify(c,h,shot):
    def js(code,*args):return c.script(code,*args)
    def click(s):js('document.querySelector(arguments[0]).click();',s)
    def wait(code,label):h.wait_for(lambda:js(code),label,25)
    def choose(value):js('const e=document.querySelector("#atlas-theme");e.value=arguments[0];e.dispatchEvent(new Event("change",{bubbles:true}));',value)
    before=c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    js('''window.__themeProbe={mutations:0,calls:[],icons:performance.getEntriesByType('resource').length};
      window.__pinBefore=document.querySelector('.compass-pin');window.__compassBefore=document.querySelector('#pin-compass');
      window.__themeObserver=new MutationObserver(ms=>window.__themeProbe.mutations+=ms.filter(m=>m.type==='childList').length);
      window.__themeObserver.observe(document.querySelector('#destinations'),{childList:true,subtree:true});
      window.__originalSend=browser.runtime.sendMessage;browser.runtime.sendMessage=function(m,...args){window.__themeProbe.calls.push(m.kind);return window.__originalSend.call(this,m,...args);};''')
    choose('light-test')
    wait('return document.documentElement.dataset.theme==="light-test";','theme applied')
    switch=js('''window.__themeObserver.disconnect();browser.runtime.sendMessage=window.__originalSend;
      return {...window.__themeProbe,extraResources:performance.getEntriesByType('resource').length-window.__themeProbe.icons,
      samePins:window.__pinBefore===document.querySelector('.compass-pin'),sameCompass:window.__compassBefore===document.querySelector('#pin-compass')};''')
    assert switch['mutations']==0 and switch['extraResources']==0 and switch['calls']==[] and switch['samePins'] and switch['sameCompass'],switch
    result={'switch':switch,'light':capture(c,h,shot,'light')}
    click('#show-settings');click('#show-vault');time.sleep(.2);shot('light-vault');click('#show-home')
    assert js('return getComputedStyle(document.body).backgroundColor;')=='rgb(244, 241, 233)'
    # Search and dirty editor DOM/caret are untouched by selection changes.
    js('const e=document.querySelector("#destination-search");e.value="github";e.dispatchEvent(new Event("input",{bubbles:true}));')
    wait('return !!document.querySelector("#search-results button");','search')
    js('window.__resultBefore=document.querySelector("#search-results button");')
    choose('default');choose('light-test')
    assert js('return document.querySelector("#destination-search").value==="github" && window.__resultBefore===document.querySelector("#search-results button");')
    shot('light-search')
    click('#show-sites');click('.site-row');wait('return document.querySelector("#sites-editor").open;','editor')
    click('#edit-site')
    js('const e=document.querySelector("#site-name");e.value="Theme preserved edit";e.dispatchEvent(new Event("input",{bubbles:true}));e.focus();e.setSelectionRange(4,8);window.__fieldBefore=e;')
    choose('default');choose('light-test')
    assert js('const e=document.querySelector("#site-name");return e===window.__fieldBefore && e.value==="Theme preserved edit" && e.selectionStart===4 && e.selectionEnd===8 && document.activeElement===e;')
    shot('light-editing')
    # Keep the draft; close the native modal through its regular Escape interaction.
    c.call('WebDriver:PerformActions',actions=[{'type':'key','id':'theme-key','actions':[{'type':'keyDown','value':'\ue00c'},{'type':'keyUp','value':'\ue00c'}]}])
    click('#show-settings');click('[data-settings-panel="home-settings"]');shot('light-appearance')
    # Actual Firefox storage events across two control pages, without timers/buses.
    first=c.call('WebDriver:GetWindowHandle')
    js('window.open(location.href,"_blank");')
    h.wait_for(lambda:len(c.call('WebDriver:GetWindowHandles'))>1,'second page')
    other=[handle for handle in c.call('WebDriver:GetWindowHandles') if handle!=first][-1]
    c.call('WebDriver:SwitchToWindow',handle=other)
    wait('return !!document.querySelector("#atlas-theme");','second theme control')
    choose('default');c.call('WebDriver:SwitchToWindow',handle=first)
    wait('return document.documentElement.dataset.theme==="default";','native cross-page update')
    choose('light-test');c.call('WebDriver:SwitchToWindow',handle=other)
    wait('return document.documentElement.dataset.theme==="light-test";','other page update')
    c.call('WebDriver:CloseWindow');c.call('WebDriver:SwitchToWindow',handle=first)
    # A thrown presentation save cannot claim success or discard the requested choice.
    js('window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==="atlas-theme-v1")throw Error("synthetic");return window.__setItem.call(this,k,v);};')
    choose('default')
    assert js('return document.documentElement.dataset.theme==="light-test" && !document.querySelector("#theme-retry").hidden && document.querySelector("#atlas-theme").value==="default";')
    shot('save-failure');js('Storage.prototype.setItem=window.__setItem;');click('#theme-retry')
    assert js('return document.documentElement.dataset.theme==="default" && document.querySelector("#theme-retry").hidden;')
    choose('light-test');click('#show-home')
    # Readability fixtures use the existing UI classes; they create no Core requests/grants.
    js('''const s=document.querySelector('#temporary-section');s.hidden=false;
      document.querySelector('#temporary-empty').hidden=true;document.querySelector('#temporary-unavailable').hidden=true;
      document.querySelector('#pending-access-list').innerHTML=['waiting','ready','active'].map((tone,i)=>`<li class="temporary-row"><div class="temporary-copy"><strong class="temporary-name">Example ${i+1}</strong><span class="temporary-scope">example.localhost</span></div><div class="temporary-actions"><button class="access-cancel">Cancel</button><button class="access-signal" data-tone="${tone}">${tone} Â· 12:30</button></div></li>`).join('');''')
    shot('light-greylist');choose('default');shot('default-greylist');choose('light-test')
    c.call('WebDriver:SetWindowRect',width=540,height=900);time.sleep(.3)
    assert js('return document.documentElement.scrollWidth<=innerWidth+1;')
    shot('light-narrow')
    c.call('WebDriver:SetWindowRect',width=1752,height=1202)
    c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=2;');c.call('Marionette:SetContext',value='content');time.sleep(.3)
    assert js('return document.documentElement.scrollWidth<=innerWidth+1;')
    shot('light-zoom-200')
    c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=1;');c.call('Marionette:SetContext',value='content')
    after=c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    for key in ['policy','policyRevision','configuration','configurationRevision']:assert before[key]==after[key],key
    for area in ['accessState','vaultState']:
        assert {k:v for k,v in before[area].items() if k!='lastObservedAt'}=={k:v for k,v in after[area].items() if k!='lastObservedAt'},area
    result.update({'searchAndDirtyEditorRetained':True,'crossPageStorageEvents':True,'failedSaveRetry':True,'noAuthorityChanges':True,'narrowAnd200PercentZoom':True})
    # Reuse the real popup document (appearance check, not simulated toolbar authority).
    js('window.open(new URL("popup.html",location.href).href,"_blank");')
    other=[handle for handle in c.call('WebDriver:GetWindowHandles') if handle!=first][-1]
    c.call('WebDriver:SwitchToWindow',handle=other)
    wait('return !!document.querySelector("#popup-host");','popup document')
    assert js('return document.documentElement.dataset.theme==="light-test" && getComputedStyle(document.body).backgroundColor==="rgb(244, 241, 233)";')
    result['popupDocumentSharesTheme']=True
    c.call('WebDriver:CloseWindow');c.call('WebDriver:SwitchToWindow',handle=first)
    return result

