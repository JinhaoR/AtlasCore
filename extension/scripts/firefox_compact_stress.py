"""Presentation-only scale, missing-icon and chooser overflow checks."""
import time

def run_stress(c, wait, shot):
    checks=[]
    def click(s):c.script('document.querySelector(arguments[0]).click();',s)
    def refresh():c.call('WebDriver:Refresh');wait(lambda:c.script('return !!document.querySelector("#pinned-primary .compass-pin:not(:disabled)");'),'ready pins',30)
    def overflow():return c.script('return document.documentElement.scrollWidth>document.documentElement.clientWidth+1;')
    # Synthetic bookmark fixture: real validation/read/render path; no permission.
    c.script('const done=arguments[0],q=indexedDB.open("atlas-home-layout-v1");q.onsuccess=()=>{const db=q.result,t=db.transaction("layout","readwrite");t.objectStore("layout").put({revision:1,value:{version:1,groups:[{parentId:"service:webmail.kth.se",pages:Array.from({length:20},(_,i)=>({id:"page-"+i,label:("A long, identifiable page name "+i+" ").padEnd(100,"x"),url:"https://webmail.kth.se/path/"+i+"?query="+"y".repeat(150)+"#section"}))}]}},"bookmarks-v1");t.oncomplete=()=>{db.close();done(true);};};',asynchronous=True)
    refresh();click('#pinned-primary .compass-pin');wait(lambda:c.script('return document.getElementById("pin-chooser").matches(":popover-open");'),'long chooser')
    c.script('document.getElementById("pin-chooser").scrollTop=300;');time.sleep(.3)
    assert c.script('return document.getElementById("pin-chooser").matches(":popover-open") && document.querySelectorAll("#pin-chooser-pages button").length===20;')
    assert not overflow();shot('long-bookmark-chooser')
    c.script('document.getElementById("pin-chooser").hidePopover();');click('#edit-pins');wait(lambda:c.script('return document.getElementById("bookmark-editor").open;'),'large editor')
    # Reorder and remove using the real editor; IDs move, URLs stay intact.
    first=c.script('return document.querySelector("#bookmark-pages li").dataset.pageId;')
    click('#bookmark-pages li:first-child [data-action=down]')
    assert c.script('return document.querySelectorAll("#bookmark-pages li")[1].dataset.pageId;',)==first
    click('#bookmark-pages li:first-child [data-action=remove]');click('#save-bookmarks');wait(lambda:c.script('return !document.getElementById("bookmark-editor").open;'),'order save')
    click('#edit-pins');wait(lambda:c.script('return document.querySelectorAll("#bookmark-pages li").length===19;'),'saved order reopened')
    c.call('WebDriver:SetWindowRect',width=500,height=985);assert not overflow();shot('bookmark-editor-small')
    # Removing every page restores defaults rather than making an empty group.
    c.script('while(document.querySelector("#bookmark-pages [data-action=remove]"))document.querySelector("#bookmark-pages [data-action=remove]").click();')
    click('#save-bookmarks');wait(lambda:c.script('return !document.getElementById("bookmark-editor").open;'),'remove override')
    assert c.script('return document.querySelector("#pinned-primary .compass-pin").getAttribute("aria-haspopup")===null;')
    checks.append('20 long named URLs, native scrolling chooser stays open; reorder/remove/save/reopen; small editor; all pages removed restores default single-target launcher')
    c.call('WebDriver:SetWindowRect',width=1488,height=1143)
    # Thirty presentation categories based on actual known entries, unchanged policy.
    metadata=c.script('return [...document.querySelectorAll("#destination-list .destination-card")].slice(0,60).map((card,i)=>{const e=JSON.parse(card.dataset.entry);return {id:card.dataset.destinationId,label:(e.label+" — long descriptive destination name").slice(0,100),category:("Category "+(i%30)+" for mathematical physics and research").slice(0,64),primaryHostname:e.hostname,hostnames:e.hostnames};});')
    assert len(metadata)>=30
    c.script('localStorage.setItem("atlas-destinations-v1",JSON.stringify({version:1,destinations:arguments[0],pending:null}));',metadata);refresh()
    click('.browse-categories');wait(lambda:c.script('return document.querySelectorAll(".category-directory-item").length>=30;'),'thirty categories')
    shot('crowded-category-directory');assert not overflow()
    click('.category-directory-item');wait(lambda:c.script('return !document.querySelector(".service-group:not([hidden]) .destination-grid").hidden;'),'long destination rows')
    shot('long-category-labels');assert not overflow()
    click('#close-category-workspace')
    # Duplicate/unavailable favicon bytes retain named keyboard targets and no overflow.
    c.script('for(const i of document.querySelectorAll("#pinned-primary img")){i.src="missing-fixture-icon.png";}')
    wait(lambda:c.script('return [...document.querySelectorAll("#pinned-primary img")].every(i=>i.src.endsWith("site.svg"));'),'local icon fallback')
    labels=c.script('return [...document.querySelectorAll("#pinned-primary .compass-pin")].map(b=>b.getAttribute("aria-label"));')
    assert len(set(labels))==len(labels) and all(labels)
    for width in [1000,500,320]:
        c.call('WebDriver:SetWindowRect',width=width,height=985);assert not overflow()
    checks.append('30 long category names, long destination labels, repeated render, duplicate/missing icons remain named and usable at 320/500/1000 pixels')
    return checks
