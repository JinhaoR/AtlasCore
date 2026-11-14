"""Fresh-profile compass and ordinary site actions, in the isolated harness."""
import time

def verify(c,h,shot,pins,baseline=False):
    def js(code,*args,**kwargs):return c.script(code,*args,**kwargs)
    def click(selector):js('document.querySelector(arguments[0]).click();',selector)
    def pointer(selector):
        node=c.call('WebDriver:FindElement',using='css selector',value=selector)
        c.call('WebDriver:ElementClick',id=node['element-6066-11e4-a52e-4f735466cecf'])
    def wait(code,label):return h.wait_for(lambda:js(code),label,30)
    def geometry():return js('''const e=document.querySelector('#pin-compass'),r=e.getBoundingClientRect();
      return {viewport:[innerWidth,innerHeight],pins:document.querySelectorAll('.compass-pin').length,
        visible:r.width>0&&r.height>0&&getComputedStyle(e).display!=='none',
        compass:[r.x,r.y,r.width,r.height],overflow:document.documentElement.scrollWidth>innerWidth+1};''')
    before=c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    result={'baseline':baseline,'freshProfile':geometry(),'geometry':[]}
    js('const s=document.querySelector("#atlas-theme");s.value="parchment";s.dispatchEvent(new Event("change",{bubbles:true}));')
    for count in [0,1,6]:
        pins(count)
        wait('return document.querySelectorAll(".compass-pin").length===arguments[0];'.replace('arguments[0]',str(count)),'pin fixture')
        for width,height,zoom in [(1488,1143,1),(980,900,1),(540,900,1),(720,1000,2)]:
            c.call('WebDriver:SetWindowRect',width=width,height=height)
            c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=arguments[0];',zoom);c.call('Marionette:SetContext',value='content');time.sleep(.15)
            sample=geometry();result['geometry'].append(sample)
            assert not sample['overflow'],sample
            if not baseline:assert sample['visible'],sample
            elif count<2 or sample['viewport'][0]<=1000:assert not sample['visible'],sample
            if count in [0,1] or width==980:shot(f'compass-{count}-{width}-{zoom}')
        c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=1;');c.call('Marionette:SetContext',value='content')
    c.call('WebDriver:SetWindowRect',width=1488,height=1143);pins(0)
    click('#show-sites');click('#sites-show-all')
    js('const e=document.querySelector("#sites-search");e.value="chatgpt.com";e.dispatchEvent(new Event("input",{bubbles:true}));')
    wait('return !!document.querySelector(".site-row");','ChatGPT directory entry');pointer('.site-row')
    wait('return document.querySelector("#sites-editor").open;','details dialog');shot('site-details')
    if baseline:
        assert js('return !document.querySelector("#open-site");')
        result['missingOpenAction']=True
        return result
    assert js('return !document.querySelector("#open-site").disabled && !document.querySelector("#pin-site").disabled;')
    assert js('return getComputedStyle(document.querySelector("#site-detail-hosts")).fontFamily===getComputedStyle(document.body).fontFamily && !document.querySelector(".site-help").open;')
    ui=c.call('WebDriver:GetWindowHandle')
    js('''window.__launches=[];window.__send=browser.runtime.sendMessage;
      browser.runtime.sendMessage=async function(m,...a){const r=await window.__send.call(this,m,...a);
        if(m.kind==='OPEN_DESTINATION')window.__launches.push({url:m.url,opened:r.opened,tabId:r.tabId});return r;};''')
    pointer('#open-site');c.call('WebDriver:SwitchToWindow',handle=ui)
    wait('return window.__launches.length===1;','ordinary launch command')
    launch=js('return window.__launches[0];');assert launch['url']=='https://chatgpt.com/' and launch['opened'],launch
    js('const [id,done]=arguments;browser.tabs.remove(id).then(()=>done(true));',launch['tabId'],asynchronous=True)
    result['ordinaryGatedLaunch']=launch
    js('window.__hostRow=document.querySelector("#site-detail-hosts li");')
    pointer('#pin-site');wait('return document.querySelector("#pin-site").textContent==="Unpin from Home" && !document.querySelector("#pin-site").disabled;','acknowledged pin')
    assert js('return window.__hostRow===document.querySelector("#site-detail-hosts li");')
    click('#sites-back');click('#show-home')
    wait('return document.querySelectorAll(".compass-pin").length===1;','one visible pin')
    assert geometry()['visible'];shot('pinned-compass')
    c.call('WebDriver:Refresh');wait('return document.querySelectorAll(".compass-pin:not(:disabled)").length===1;','saved pin after reload')
    assert geometry()['visible'];result['pinSurvivesReload']=True
    after=c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    for key in ['policy','policyRevision','configuration','configurationRevision']:assert before[key]==after[key],key
    result['authorityUnchanged']=True
    return result
