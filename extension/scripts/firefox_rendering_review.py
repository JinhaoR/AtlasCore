"""Small repeatable UI measurements, used only by the disposable startup fixture."""
import base64
import time


def measure_rendering(client, run, baseline):
    def js(code, *args): return client.script(code, *args)
    def click(id): js('document.getElementById(arguments[0]).click();', id)
    def measure(action):
        js('window.__atlasPerf.reset();')
        start = time.monotonic()
        action()
        result = js('return window.__atlasPerf.stop();')
        result['roundTripMs'] = round((time.monotonic()-start)*1000, 1)
        return result
    result = {'cases': {}}
    for name in ['show-sites', 'show-home', 'show-settings', 'show-home', 'show-vault', 'show-home']:
        result['cases'].setdefault(name, []).append(measure(lambda: click(name)))
    click('show-sites')
    result['rows'] = js('''const rows=[...document.querySelectorAll('.site-row')];
      return {count:rows.length,viewport:[innerWidth,innerHeight],rows:rows.slice(0,8).map(e=>{
        const r=e.getBoundingClientRect();return {height:r.height,scroll:e.scrollHeight,
          overflow:[...e.children].some(c=>{const b=c.getBoundingClientRect();return b.top<r.top||b.bottom>r.bottom}),
          tracks:getComputedStyle(e).gridTemplateRows}})};''')
    (run/'directory-rows.png').write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)))
    if not baseline:
        assert result['rows']['count']>100 and not any(r['overflow'] for r in result['rows']['rows']),result['rows']
    # User interactions dispatch actual handlers; no policy or storage substitution.
    search = js('return document.querySelector("#sites-section input[type=search]").id;')
    result['filter'] = measure(lambda: js('const e=document.getElementById(arguments[0]);e.value="research";e.dispatchEvent(new Event("input",{bubbles:true}));',search))
    js('const e=document.getElementById(arguments[0]);e.value="";e.dispatchEvent(new Event("input",{bubbles:true}));',search)
    click('show-home')
    result['customize'] = measure(lambda: click('customize-home'))
    click('close-home-customization')
    result['category'] = measure(lambda: js('document.querySelector(".category-shortcut").click();'))
    js('window.__retainedReviewIcons=[...document.querySelectorAll(".site-icon")];')
    result['repeatedNavigation'] = measure(lambda: js('for(let i=0;i<10;i++){document.getElementById("show-sites").click();document.getElementById("show-home").click();}'))
    result['iconsRetained'] = js('return window.__retainedReviewIcons.every(n=>n.isConnected);')
    assert result['iconsRetained']
    time.sleep(1.2)  # Let the fixture's newly visible icon requests settle before idle counts.
    result['idle'] = measure(lambda: time.sleep(3))
    if not baseline:
        # Persist one hidden category through the real controls, then refresh.
        # No frame may show the default category before its saved layout arrives.
        click('customize-home')
        hidden = js('''const row=document.querySelector('#home-layout-list [data-layout-category]');
          const input=row.querySelector('input');input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));
          return {key:row.dataset.layoutCategory,label:row.querySelector('.layout-category-name').textContent};''')
        deadline=time.monotonic()+8
        while js('return [...document.querySelectorAll(".category-shortcut span")].some(n=>n.textContent===arguments[0]);',hidden['label']):
            assert time.monotonic()<deadline
            time.sleep(.1)
        click('close-home-customization')
        client.call('WebDriver:Refresh')
        time.sleep(1.2)
        frames=js('return window.__startupProbe.frames;')
        assert frames and all(hidden['label'] not in f['categoryLabels'] for f in frames),frames
        assert js('return document.getElementById("status").dataset.ready;')=='true'
        assert not any(f['recoveryBanner'] for f in frames)
        result['refreshHiddenCategory']={'frames':len(frames),'readyAt':js('return window.__startupProbe.readyAt;'),'defaultFlash':False}
        click('customize-home')
        js('''const row=[...document.querySelectorAll('#home-layout-list [data-layout-category]')].find(r=>r.dataset.layoutCategory===arguments[0]);
          const input=row.querySelector('input');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));''',hidden['key'])
        deadline=time.monotonic()+8
        while not js('return [...document.querySelectorAll(".category-shortcut span")].some(n=>n.textContent===arguments[0]);',hidden['label']):
            assert time.monotonic()<deadline
            time.sleep(.1)
        click('close-home-customization')
        # A failed query must still display recovery and disable launchers, even
        # though ordinary initial loading no longer uses a warning banner.
        js('window.__reviewSend=browser.runtime.sendMessage.bind(browser.runtime);browser.runtime.sendMessage=m=>m.kind==="GET_VIEW"?Promise.reject(new Error("FIXTURE_UNAVAILABLE")):window.__reviewSend(m);')
        deadline = time.monotonic()+8
        while js('return document.getElementById("destinations").dataset.phase;') != 'UNAVAILABLE':
            assert time.monotonic()<deadline
            time.sleep(.1)
        assert js('return !document.getElementById("destination-state").hidden && [...document.querySelectorAll(".destination-open")].every(b=>b.disabled);')
        (run/'unavailable.png').write_bytes(base64.b64decode(client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)))
        js('browser.runtime.sendMessage=window.__reviewSend;delete window.__reviewSend;document.getElementById("retry-destinations").click();')
        deadline=time.monotonic()+8
        while js('return document.getElementById("destinations").dataset.phase;') != 'READY':
            assert time.monotonic()<deadline
            time.sleep(.1)
        assert js('return document.getElementById("destination-state").hidden;')
        result['unavailableRecovery'] = True
    return result
