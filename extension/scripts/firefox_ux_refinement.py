"""Pointer/viewport evidence in the caller's disposable Firefox profile."""
import time, math

def verify(c,wait,shot,record):
    def js(s,*args):return c.script(s,*args)
    def click(s):js('document.querySelector(arguments[0]).click();',s)
    def pointer(actions):c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'ux-mouse','parameters':{'pointerType':'mouse'},'actions':actions}])
    def move(x,y,duration=0):return {'type':'pointerMove','origin':'viewport','x':round(x),'y':round(y),'duration':duration}
    def style():return js('return document.querySelector("#pinned-primary .compass-pin").style.cssText;')
    wait(lambda:js('return !document.getElementById("compass-handle").disabled;'),'pins ready')
    pins=js('return localStorage.getItem("atlas-home-pins-v1");');bookmarks=record();layout=record('current')
    box=js('const r=document.getElementById("compass-handle").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width};')
    assert box['w']>=260
    x,y=box['x'],box['y']
    # Between pin buttons, on the outer ring, with a real captured mouse gesture.
    actions=[move(x+118,y),{'type':'pointerDown','button':0}]
    for angle in [15,30,45,60,75]:actions.append(move(x+118*math.cos(math.radians(angle)),y+118*math.sin(math.radians(angle)),30))
    actions.append({'type':'pointerUp','button':0});pointer(actions)
    released=style();time.sleep(.16);coasting=style();assert released!=coasting,'no inertia after outer-ring flick'
    time.sleep(4.2);stopped=style();time.sleep(.2);assert stopped==style(),'coast did not settle within its four-second bound'
    shot('home-wheel')
    assert js('const e=document.getElementById("pinned-section");return getComputedStyle(e).overflowY!=="auto"&&getComputedStyle(e).overflowY!=="scroll";')
    # Escape stops an in-progress gesture, without a saved order change.
    pointer([move(x+70,y-40),{'type':'pointerDown','button':0},move(x+80,y+50,80)])
    c.call('WebDriver:PerformActions',actions=[{'type':'key','id':'escape','actions':[{'type':'keyDown','value':'\ue00c'},{'type':'keyUp','value':'\ue00c'}]}])
    pointer([{'type':'pointerUp','button':0}]);cancelled=style();time.sleep(.3);assert cancelled==style()
    c.call('Marionette:SetContext',value='chrome');c.script('Services.prefs.setIntPref("ui.prefersReducedMotion",1);');c.call('Marionette:SetContext',value='content')
    wait(lambda:js('return matchMedia("(prefers-reduced-motion: reduce)").matches;'),'reduced motion')
    pointer([move(x+65,y-30),{'type':'pointerDown','button':0},move(x+55,y+40,80),{'type':'pointerUp','button':0}]);reduced=style();time.sleep(.2);assert reduced==style()
    c.call('Marionette:SetContext',value='chrome');c.script('Services.prefs.clearUserPref("ui.prefersReducedMotion");');c.call('Marionette:SetContext',value='content')
    # Drag preview has a following ghost and displaced neighbours before any save.
    points=js('return [...document.querySelectorAll(".category-shortcut")].slice(0,4).map(b=>{const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});')
    a,b=points[0],points[3];revision=record('current')['revision']
    pointer([move(a['x'],a['y']),{'type':'pointerDown','button':0},move(b['x'],b['y'],300)])
    assert js('return !!document.querySelector(".category-drag-ghost")&&[...document.querySelectorAll(".category-shortcut:not(.category-drag-ghost)")].some(b=>b.style.transform&&!b.dataset.dragging);')
    assert record('current')['revision']==revision;shot('category-drag-preview')
    c.call('WebDriver:PerformActions',actions=[{'type':'key','id':'escape','actions':[{'type':'keyDown','value':'\ue00c'},{'type':'keyUp','value':'\ue00c'}]}]);pointer([{'type':'pointerUp','button':0}])
    assert record('current')==layout
    click('#show-settings');click('[data-settings-panel="home-settings"]');click('.category-icon-choice');shot('icon-picker')
    c.call('WebDriver:PerformActions',actions=[{'type':'key','id':'escape','actions':[{'type':'keyDown','value':'\ue00c'},{'type':'keyUp','value':'\ue00c'}]}])
    assert js('return document.activeElement.classList.contains("category-icon-choice");')
    click('#show-vault');assert js('return !document.getElementById("settings").hidden&&!document.getElementById("vault-section").hidden&&document.querySelector(".sidebar-nav #show-vault")===null;');shot('vault-in-settings')
    state=c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot'];candidate={**state['policy'],'whitelist':state['policy']['whitelist']+['ux-proposal.example']}
    assert c.message({'kind':'PROPOSE_POLICY','candidatePolicy':candidate})['result']['type']=='COMMITTED'
    wait(lambda:js('return !document.getElementById("vault-panel").hidden;'),'pending Vault within Settings');shot('vault-waiting')
    assert c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']['policy']==state['policy']
    click('#cancel-policy');wait(lambda:c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']['vaultState']['pendingProposal'] is None,'cancel protected proposal')
    click('[data-settings-panel="timing-settings"]');assert js('return document.getElementById("vault-section").hidden&&!document.getElementById("timing-settings").hidden;')
    click('#show-sites');shot('sites-quiet-draft');click('#show-home')
    assert js('return localStorage.getItem("atlas-home-pins-v1");')==pins and record()==bookmarks
    sizes=[]
    for width,height,zoom in [(2538,1261,1),(1488,1143,1),(1200,900,1),(1488,1143,1.25),(1488,1143,1.5),(1488,1143,2),(500,900,1),(500,900,2)]:
        c.call('WebDriver:SetWindowRect',width=width,height=height)
        c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.browsingContext.fullZoom=arguments[0];',zoom);c.call('Marionette:SetContext',value='content');time.sleep(.2)
        geometry=js('return {width:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth};');assert geometry['scroll']<=geometry['client']+1,geometry
        sizes.append({'zoom':zoom,**geometry});shot('ux-'+str(width)+'-'+str(zoom))
    return {'outerRingDrag':True,'frictionSettles':True,'reducedMotion':True,'escapeCancels':True,'dragPreviewBeforeSave':True,'vaultInSettings':True,'vaultProposalRemainsProtected':True,'pinAndLayoutStateUnchanged':True,'viewports':sizes}
