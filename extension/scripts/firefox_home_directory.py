"""Home/directory presentation checks in the disposable native harness."""
import time

def verify(c,h,shot):
    def js(code,*args):return c.script(code,*args)
    def click(s):js('document.querySelector(arguments[0]).click();',s)
    def wait(code,label):h.wait_for(lambda:js(code),label,25)
    def fill(s,value):js('const e=document.querySelector(arguments[0]);e.focus();e.value=arguments[1];e.dispatchEvent(new Event("input",{bubbles:true}));',s,value)
    def key(k):c.call('WebDriver:PerformActions',actions=[{'type':'key','id':'directory-key','actions':[{'type':'keyDown','value':k},{'type':'keyUp','value':k}]}])
    def nav(name):js('location.hash=arguments[0];',name);time.sleep(.4)
    wait('return !!document.querySelector(".compass-pin:not(:disabled)");','pins')
    assert not js('return !!document.querySelector("#category-shortcuts");')
    assert js('return [...document.querySelectorAll(".compass-pin")].every(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});')
    shot('home')
    before=js('return document.querySelector(".compass-composition").getBoundingClientRect().y;')
    fill('#destination-search','research')
    wait('return !document.querySelector("#home-search-panel").hidden;','home search')
    assert js('return !!document.querySelector("#search-results button:last-child");')
    assert js('return document.querySelector(".compass-composition").getBoundingClientRect().y;')==before
    key('\ue00c');assert js('return document.querySelector("#home-search-panel").hidden;')
    nav('sites');wait('return document.querySelectorAll("#sites-categories .category-shortcut").length>4;','directory categories')
    assert not js('return document.querySelector("#sites-editor").open;')
    shot('directory')
    click('#sites-categories .category-shortcut');wait('return !document.querySelector("#sites-list").hidden;','category')
    c.call('WebDriver:Back');wait('return !document.querySelector("#sites-categories").hidden;','Back to categories')
    c.call('WebDriver:Forward');wait('return !document.querySelector("#sites-list").hidden;','Forward to category')
    shot('category')
    category=js('return document.querySelector("#sites-directory-title").textContent;')
    assert js('return document.querySelectorAll("#sites-list .site-row").length>0;')
    click('#sites-list .site-row');wait('return document.querySelector("#sites-editor").open;','details modal')
    shot('details')
    c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'outside-mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','origin':'viewport','x':10,'y':200,'duration':0},{'type':'pointerDown','button':0},{'type':'pointerUp','button':0}]}])
    assert not js('return document.querySelector("#sites-editor").open;')
    click('#sites-list .site-row');wait('return document.querySelector("#sites-editor").open;','reopen details')
    key('\ue00c');assert not js('return document.querySelector("#sites-editor").open;')
    assert js('return document.activeElement.classList.contains("site-row");')
    click('#sites-categories-back');click('#sites-show-all')
    count=js('return document.querySelectorAll("#sites-list .site-row").length;');assert count>60,count
    fill('#sites-search','github');wait('return !document.querySelector("#sites-search-results").hidden;','sites search')
    shot('sites-search');key('\ue015');key('\ue007')
    wait('return document.querySelector("#sites-editor").open;','keyboard inspection')
    click('#edit-site');wait('return !document.querySelector("#site-draft").hidden;','editor')
    fill('#site-name','Retained native edit');time.sleep(.6);key('\ue00c')
    assert not js('return document.querySelector("#sites-editor").open;')
    click('#add-site');wait('return document.querySelector("#sites-editor").open;','retained editor')
    assert js('return document.querySelector("#site-name").value;')=='Retained native edit'
    shot('editor')
    click('#cancel-site-draft');wait('return !document.querySelector("#sites-editor").open;','cancel editor')
    fill('#sites-search','New research lab');click('#add-site');wait('return document.querySelector("#sites-editor").open;','add')
    assert js('return document.querySelector("#site-name").value;')=='New research lab'
    fill('#site-hostname','invalid url');click('#propose-site')
    wait('return !document.querySelector("#site-field-error").hidden;','validation')
    assert js('return document.activeElement.id;')=='site-hostname'
    fill('#site-name','A long research destination name for a large directory with many carefully named resources')
    fill('#site-hostname','prepared.localhost');fill('#site-category','A long custom category for teaching and research')
    click('#propose-site');wait('return !document.querySelector("#sites-editor").open;','acknowledged stage')
    click('#review-destination-draft');wait('return document.querySelector("#sites-section").dataset.view==="review";','review staged change')
    shot('draft-review')
    click('#continue-destination-editing');time.sleep(.3)
    if js('return document.querySelector("#sites-editor").open;'):key('\ue00c')
    js('window.confirm=()=>true;');click('#discard-destination-draft');time.sleep(.5)

    fill('#sites-search','');click('#sites-categories-back')
    c.call('WebDriver:Refresh');wait('return document.querySelectorAll("#sites-categories .category-shortcut").length>4;','reload')
    assert not js('return document.querySelector("#sites-editor").open;')
    sizes=[]
    for width,height in [(1488,1143),(980,850),(540,850)]:
        c.call('WebDriver:SetWindowRect',width=width,height=height);time.sleep(.3)
        assert js('return document.documentElement.scrollWidth<=innerWidth+1;')
        shot('directory-'+str(width));nav('home');time.sleep(.4)
        assert js('return document.documentElement.scrollWidth<=innerWidth+1;')
        shot('home-'+str(width));sizes.append([width,height]);nav('sites')
    c.call('WebDriver:SetWindowRect',width=1488,height=1143);nav('home')
    # Real pointer hit testing and normal controller launch, no stubbed authorization.
    original=c.call('WebDriver:GetWindowHandle')
    js('window.__launchDone=0;window.__lastLaunch=null;const send=browser.runtime.sendMessage;browser.runtime.sendMessage=async function(m,...a){const r=await send.call(this,m,...a);if(m.kind==="OPEN_DESTINATION"){window.__lastLaunch=m.url;window.__launchDone++;}return r;};')
    x,y=js('const r=document.querySelector(arguments[0]).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];','[data-destination-id="service:github.com"]')
    c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'directory-mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','origin':'viewport','x':round(x),'y':round(y),'duration':0},{'type':'pointerDown','button':0},{'type':'pointerUp','button':0}]}])
    wait('return window.__launchDone===1;','pin gate response')
    c.call('WebDriver:SwitchToWindow',handle=original)
    assert js('return window.__lastLaunch;')=='https://github.com/'
    # No idle pin-node replacement or repeated favicon requests.
    js('window.__pinNodes=[...document.querySelectorAll(".compass-pin")];window.__resources=performance.getEntriesByType("resource").length;')
    time.sleep(3)
    stable=js('return window.__pinNodes.every(e=>e.isConnected)&&performance.getEntriesByType("resource").length===window.__resources;')
    assert stable
    # Firefox page zoom is browser-owned; keyboard controls remain reachable.
    for zoom in [1.25,2]:
        c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=arguments[0];',zoom);c.call('Marionette:SetContext',value='content');time.sleep(.4)
        assert js('return document.documentElement.scrollWidth<=innerWidth+1;')
        shot('home-zoom-'+str(zoom));nav('sites');shot('directory-zoom-'+str(zoom));nav('home')
    c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=1;');c.call('Marionette:SetContext',value='content')
    from firefox_greylist_controls import verify as greylist
    grey=greylist(c,h,shot)
    return {'greylist':grey,'realPinLaunch':True,'idleStable':stable,'zoom':[1.25,2],'category':category,'siteCount':count,'floatingSearch':True,'focusAndDirtyDraft':True,'reload':True,'sizes':sizes}
