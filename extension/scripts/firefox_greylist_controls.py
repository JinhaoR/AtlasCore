"""Greylist controls and wheel stability in the caller's disposable profile only."""
import time


def verify(c,h,shot,baseline=False):
    def js(code,*args):return c.script(code,*args)
    def click(selector):js('document.querySelector(arguments[0]).click();',selector)
    def view():return c.message({'kind':'GET_VIEW'})['view']
    def state():return view()['controller']['snapshot']['accessState']
    ui=c.call('WebDriver:GetWindowHandle')
    tab=c.message({'kind':'OPEN_DESTINATION','url':'http://grey.localhost/'})['tabId']
    c.call('WebDriver:SwitchToWindow',handle=ui)
    def open_request():
        c.call('WebDriver:Navigate',url=h.UI_URL+f'?view=access&tab={tab}')
        h.wait_for(lambda:js('return document.querySelector("#pending-access-list .access-signal")?.textContent==="Request access"&&!document.querySelector("#pending-access-list .access-signal").disabled;'),'request row')
        h.wait_for(lambda:js('return !!document.querySelector(".compass-pin:not(:disabled)");'),'pins')
    open_request()
    if not baseline:
        assert js('return !!document.querySelector(".access-cancel");')
        click('.access-cancel')
        h.wait_for(lambda:js('return !document.querySelector("#pending-access-list li");'),'dismiss unstarted')
        assert not state()['pendingRequests']
        c.call('WebDriver:Refresh')
        h.wait_for(lambda:js('return !!document.querySelector(".compass-pin:not(:disabled)");'),'reload after dismiss')
        assert js('return !document.querySelector("#pending-access-list li");')
        open_request()
    # Delay only delivery to the UI, never clocks or controller persistence.
    # Sample computed opacity synchronously and across real animation frames.
    js('''window.__originalSend=browser.runtime.sendMessage;
      browser.runtime.sendMessage=async function(command,...args){const response=await window.__originalSend.call(this,command,...args);
        if(['START_ACCESS','CANCEL_ACCESS','END_ACCESS','CONFIRM_ACCESS'].includes(command.kind))await new Promise(r=>setTimeout(r,180));return response;};
      window.__pin=document.querySelector('.compass-pin');window.__opacities=[];window.__sampling=true;
      const sample=()=>{if(!window.__sampling)return;window.__opacities.push(getComputedStyle(window.__pin).opacity);requestAnimationFrame(sample);};sample();''')
    click('.access-signal')
    during=js('return {opacity:getComputedStyle(window.__pin).opacity,disabled:window.__pin.disabled};')
    h.wait_for(lambda:len(state()['pendingRequests'])==1,'start committed')
    h.wait_for(lambda:js('return document.querySelector(".access-signal")?.textContent.startsWith("Waiting");'),'waiting row')
    h.wait_for(lambda:js('return !document.querySelector(".compass-pin").disabled;'),'action finished')
    samples=js('window.__sampling=false;return {opacities:[...new Set(window.__opacities)],samePin:window.__pin===document.querySelector(".compass-pin")};')
    shot('waiting')
    if baseline:
        click('.access-signal')
        h.wait_for(lambda:not state()['pendingRequests'],'cancel committed')
        h.wait_for(lambda:js('return document.querySelector(".access-signal")?.textContent==="Request access";'),'old request reappears')
        return {'baseline':True,'during':during,**samples,'cancelRecreatedRequest':True}
    assert during=={'opacity':'1','disabled':True},during
    assert samples=={'opacities':['1'],'samePin':True},samples
    assert js('return document.querySelector(".access-signal").disabled;'),'waiting signal is status only'
    h.wait_for(lambda:js('return !document.querySelector(".access-cancel").disabled;'),'cancel enabled')
    # A reported write failure must retain the request and its cancel action.
    js('''window.__normalSend=browser.runtime.sendMessage;window.__failCancel=true;
      browser.runtime.sendMessage=function(command,...args){if(command.kind==='CANCEL_ACCESS'&&window.__failCancel){window.__failCancel=false;return Promise.resolve({result:{type:'BLOCKED',reason:'WRITE_FAILED'}});}return window.__normalSend.call(this,command,...args);};''')
    click('.access-cancel');time.sleep(.25)
    assert len(state()['pendingRequests'])==1 and js('return !!document.querySelector(".access-cancel:not(:disabled)");')
    shot('failed-cancel')
    click('.access-cancel')
    h.wait_for(lambda:not state()['pendingRequests'],'cancel waiting')
    h.wait_for(lambda:js('return !document.querySelector("#pending-access-list li");'),'cancelled row removed')
    time.sleep(1.2)
    assert js('return !document.querySelector("#pending-access-list li");')
    open_request();click('.access-signal')
    h.wait_for(lambda:js('return document.querySelector(".access-signal")?.textContent.startsWith("Allow");'),'ready',40)
    assert not state()['grants']
    shot('ready');click('.access-signal')
    h.wait_for(lambda:bool(state()['grants']),'confirmed grant')
    h.wait_for(lambda:js('return !!document.querySelector(".access-cancel:not(:disabled)")&&!!document.querySelector(".access-signal[data-tone=active]");'),'active')
    shot('active');click('.access-cancel')
    h.wait_for(lambda:not state()['grants'],'grant ended')
    h.wait_for(lambda:js('return !document.querySelector("#pending-access-list li");'),'ended row removed')
    c.call('WebDriver:Refresh')
    h.wait_for(lambda:js('return !!document.querySelector(".compass-pin:not(:disabled)");'),'reload ended')
    assert not state()['grants'] and not state()['pendingRequests']
    assert js('return !document.querySelector("#pending-access-list li");')
    shot('cancelled-clean')
    return {'baseline':False,'during':during,**samples,'unstartedDismissed':True,'waitingCancelled':True,'failedCancelRetained':True,'explicitConfirmation':True,'activeEnded':True,'cancelledRowsStayRemovedAfterRefresh':True}
