"""Signed-to-development scope migration in an isolated native profile."""
import time

KEY = 'curated:curated-subdomains-2026-11-v1'

def stored(c, database, store, key):
    return c.script('''const [name,store,key,done]=arguments,q=indexedDB.open(name,1);
      q.onsuccess=()=>{const db=q.result,t=db.transaction(store,'readonly'),r=t.objectStore(store).get(key);
      r.onsuccess=()=>done(r.result??null);t.oncomplete=()=>db.close();};''', database, store, key, asynchronous=True)

def snapshot(c): return c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']

def presentation(c):
    return {'metadata':c.script('return localStorage.getItem("atlas-destinations-v1");'),
            'pins':c.message({'kind':'PRESENTATION_READ'})['pins'],
            'pages':stored(c,'atlas-home-layout-v1','layout','bookmarks-v1'),
            'layout':stored(c,'atlas-home-layout-v1','layout','current'),
            'draft':stored(c,'atlas-destination-drafts-v1','workspace','current')}

def seed(c,h):
    policy={'whitelist':['kth.se','drive.google.com','notes.physics.kth.se','named.kth.se','pin.kth.se','custom.example'],
            'blacklist':['github.com','blocked.kth.se']}
    h.configure_policy(c,policy)
    metadata=[{'id':'host:named.kth.se','label':'My department','category':'My research','primaryHostname':'named.kth.se','hostnames':['named.kth.se']}]
    c.script('localStorage.setItem("atlas-destinations-v1",JSON.stringify({version:1,destinations:arguments[0],pending:null}));',metadata)
    for pin in c.message({'kind':'PRESENTATION_READ'})['pins']:
        assert c.message({'kind':'PIN_SET','id':pin,'pinned':False,'hosts':[]})['type']=='SAVED'
    for pin in ['host:pin.kth.se','service:kth.se']:
        assert c.message({'kind':'PIN_SET','id':pin,'pinned':True,'hosts':[]})['type']=='SAVED'
    view=c.message({'kind':'PRESENTATION_READ'})
    assert c.message({'kind':'BOOKMARK_SAVE','revision':view['bookmarks']['revision'],'value':{'version':1,'groups':[
      {'parentId':'host:pin.kth.se','pages':[{'id':'native-page','label':'My lecture','url':'https://pin.kth.se/lecture?course=physics#notes'}]}]}})['type']=='SAVED'
    c.call('WebDriver:Refresh')
    h.wait_for(lambda:c.script('return !!document.getElementById("show-sites");'),'UI')
    c.script('document.getElementById("show-sites").click();')
    h.wait_for(lambda:c.script('return !document.getElementById("add-site").disabled;'),'editor')
    c.script('document.getElementById("add-site").click();')
    for field,value in [('site-name','Unsubmitted fixture'),('site-hostname','draft.example'),('site-category','My research')]:
        c.script('const e=document.getElementById(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event("input",{bubbles:true}));',field,value)
    c.script('document.getElementById("site-www").checked=false;document.getElementById("site-form").requestSubmit();')
    h.wait_for(lambda:(v:=stored(c,'atlas-destination-drafts-v1','workspace','current')) and v['value']['draft'] and v['value']['draft']['changes'],'saved draft')
    proposed=c.message({'kind':'PROPOSE_POLICY','candidatePolicy':{**policy,'whitelist':policy['whitelist']+['frozen.example']}})
    assert proposed['result']['type']=='COMMITTED'
    c.script('document.getElementById("show-home").click();');time.sleep(.4)
    return {'snapshot':snapshot(c),'presentation':presentation(c)}

def verify(c,h,before,shot):
    after=snapshot(c)
    assert after['policy']['whitelist']==before['snapshot']['policy']['whitelist']
    assert after['policy']['blacklist']==before['snapshot']['policy']['blacklist']
    assert after['policy']['whitelistSubdomains']==['drive.google.com','kth.se']
    assert after['policyRevision']==before['snapshot']['policyRevision']+1
    for key in ['configuration','configurationRevision']:
        assert after[key]==before['snapshot'][key],key
    for key in ['accessState','vaultState','journeyState']:
        # Normal Core observations advance the clock/revision fences after load;
        # frozen requests, grants, proposals and their timestamps must not change.
        terms=lambda state:{k:v for k,v in state.items() if k not in ['lastObservedAt','policyRevision']}
        assert terms(after[key])==terms(before['snapshot'][key]),key
    saved=presentation(c)
    for key in ['metadata','pins','layout','draft']:
        assert saved[key]==before['presentation'][key],key
    old_pages=before['presentation']['pages']['value']['groups']
    new_pages=saved['pages']['value']['groups']
    assert all(group in new_pages for group in old_pages),'saved page IDs, URLs and ordering preserved'
    added_groups=[group for group in new_pages if group not in old_pages]
    if added_groups:
        # Required bookmark permission now starts the existing additive toolbar
        # connection, materializing the previously implicit KTH entry points.
        assert len(added_groups)==1 and added_groups[0]['parentId']=='service:kth.se'
        assert [p['url'] for p in added_groups[0]['pages']]==['https://kth.se/','https://intra.kth.se/','https://www.physics.kth.se/','https://physics.kth.se/']
        assert saved['pages']['revision']==before['presentation']['pages']['revision']+1
    else: assert saved['pages']==before['presentation']['pages']
    receipt=stored(c,'atlas-authority-v1','authority',KEY)
    assert receipt['added']==['drive.google.com','kth.se']
    assert 'github.com' in receipt['skippedBlacklisted'] and 'su.se' in receipt['skippedNotAllowed']
    c.script('document.getElementById("show-sites").click();')
    h.wait_for(lambda:c.script('return !!document.querySelector(".site-row");'),'Sites list')
    ids=c.script('return [...document.querySelectorAll(".site-row")].map(e=>e.dataset.destinationId);')
    assert 'host:notes.physics.kth.se' not in ids,ids
    assert 'service:kth.se' in ids and 'host:named.kth.se' in ids and 'host:pin.kth.se' in ids,ids
    shot('sites-merged')
    c.script('document.getElementById("sites-search").value="notes.physics.kth.se";document.getElementById("sites-search").dispatchEvent(new Event("input",{bubbles:true}));')
    h.wait_for(lambda:c.script('return document.querySelectorAll(".site-row").length===1;'),'exact child search')
    shot('exact-child-search')
    c.script('document.getElementById("show-home").click();');shot('home-preserved-pins')
    home=c.call('WebDriver:GetWindowHandle')
    opened=c.message({'kind':'OPEN_DESTINATION','url':'https://www.google.com/'})
    c.call('WebDriver:SwitchToWindow',handle=home)
    def blocked():
        contexts=c.message({'kind':'GET_VIEW'})['view']['contexts']
        return next((v for v in contexts if v['tabId']==opened['tabId'] and v.get('effect')=='REMOVED'),None)
    result=h.wait_for(blocked,'Google remains gated',20)
    assert result['latest']['decision']['outcome']=='GREYLIST',result
    c.script('browser.tabs.remove(arguments[0]);',opened['tabId'])
    return {'added':receipt['added'],'skippedBlacklisted':receipt['skippedBlacklisted'],
            'skippedNotAllowedCount':len(receipt['skippedNotAllowed']),'google':'GREYLIST',
            'automaticSyncMaterializedDefaultPages':bool(added_groups),'customPolicySettingsPinsPagesLayoutDraftsPreserved':True,'plainChildGrouped':True,'exactChildSearch':True}
