"""D19 native checks, invoked by firefox-e2e.py --productization in its isolated profile."""
import base64
import json
import time


def run_productization(client, ui_handle, ui_url, port, wait_for, artifacts=None):
    checks = []
    handles_by_tab = {}

    def capture(name):
        if artifacts is not None:
            wait_for(lambda: client.script('return !document.getAnimations().some(animation => animation.playState === "running");'), 'presentation animations settle before screenshot')
            shot = client.call('WebDriver:TakeScreenshot', id=None, highlights=[], full=False)
            (artifacts / f'{name}.png').write_bytes(base64.b64decode(shot))

    def view():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']

    def snapshot():
        return view()['controller']['snapshot']

    def badge(tab_id):
        view()
        return client.script('''
          const [tabId, done] = arguments;
          Promise.all([browser.browserAction.getBadgeText({tabId}), browser.browserAction.getTitle({tabId})])
            .then(([text, title]) => done({text, title}));
        ''', tab_id, asynchronous=True)

    def close(tab_id):
        view()
        client.script('const [tabId, done] = arguments; browser.tabs.remove(tabId).then(() => done(true));', tab_id, asynchronous=True)

    def no_live_badges():
        view()
        return client.script('''
          const done = arguments[0]; browser.tabs.query({}).then(tabs => Promise.all(tabs.map(tab =>
            browser.browserAction.getBadgeText({tabId:tab.id})))).then(texts => done(texts.every(text => text !== 'J')));
        ''', asynchronous=True)

    def restart():
        nonlocal ui_handle
        view()
        previous = ui_handle
        client.script('const done = arguments[0]; browser.tabs.create({url:"about:blank",active:false}).then(() => done(true));', asynchronous=True)
        client.call('Marionette:SetContext', value='chrome')
        client.script('globalThis.__atlasPreviousPolicy = WebExtensionPolicy.getByID("atlas-development@atlas.invalid"); return true;')
        client.call('Marionette:SetContext', value='content')
        client.script('setTimeout(() => browser.runtime.reload(), 0); return true;')
        wait_for(lambda: previous not in client.call('WebDriver:GetWindowHandles'), 'productization UI closes')
        client.call('WebDriver:SwitchToWindow', handle=client.call('WebDriver:GetWindowHandles')[0])
        client.call('Marionette:SetContext', value='chrome')
        wait_for(lambda: client.script('const policy = WebExtensionPolicy.getByID("atlas-development@atlas.invalid"); return policy?.active === true && policy !== globalThis.__atlasPreviousPolicy;'), 'new extension registration')
        client.script('delete globalThis.__atlasPreviousPolicy;')
        previous_handles = set(client.call('WebDriver:GetWindowHandles'))
        client.script('gBrowser.selectedTab = gBrowser.addTrustedTab("about:blank");')
        client.call('Marionette:SetContext', value='content')
        ui_handle = next(handle for handle in client.call('WebDriver:GetWindowHandles') if handle not in previous_handles)
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        wait_for(lambda: client.script('return document.readyState === "complete";'), 'new automation tab')
        client.call('Marionette:SetContext', value='chrome')
        client.script('gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});', ui_url)
        client.call('Marionette:SetContext', value='content')
        try:
            wait_for(lambda: client.script('return location.href === arguments[0] && document.readyState === "complete";', ui_url), 'productization UI returns')
        except AssertionError:
            print('Isolated reload probe:', client.script('return {protocol:location.protocol,hostname:location.hostname,path:location.pathname,title:document.title,ready:document.readyState,extensionAPI:typeof browser};'), flush=True)
            raise
        ui_handle = client.call('WebDriver:GetWindowHandle')
        wait_for(lambda: view()['controller']['status'] == 'READY', 'productization authority reconciles')

    def open_url(path='/begin-login'):
        view()
        known_handles = set(client.call('WebDriver:GetWindowHandles'))
        result = client.message({'kind': 'OPEN_DESTINATION', 'url': f'http://root.localhost:{port}{path}'})
        assert result['opened'] is True and 'result' not in result
        tab_id = result['tabId']
        handles_by_tab[tab_id] = wait_for(lambda: next((handle for handle in client.call('WebDriver:GetWindowHandles') if handle not in known_handles), None), 'ordinary destination tab')
        context = wait_for(lambda: next((c for c in view()['contexts'] if c['tabId'] == tab_id and c['displayedHostname'] == 'login.localhost'), None), 'ordinary gate intermediate arrival')
        assert context['latest']['decision']['reason'] == 'ACTIVE_JOURNEY'
        return tab_id, context

    # Home/search use only saved White entries. A unique local fixture result has no
    # HTTPS server; its held HTTPS attempt still proves the ordinary BEGIN gate ran.
    view()
    client.script('document.getElementById("show-home").click();')
    assert client.script('return document.getElementById("settings").hidden;')
    assert client.script('return !document.getElementById("destination-search").hidden;')
    wait_for(lambda: client.script('return document.querySelectorAll("#destination-list .destination-card").length > 0;'), 'destination cards')
    sidebar_authority = snapshot()
    assert client.script('return [...document.querySelectorAll(".sidebar-nav button")].map(button => button.id);') == ['show-home', 'show-settings']
    assert client.script('return document.getElementById("sidebar-toggle").getAttribute("aria-controls") === "atlas-sidebar";')
    expanded = client.script('''
      return {state:document.body.dataset.sidebar,
        width:document.getElementById('atlas-sidebar').getBoundingClientRect().width,
        mainLeft:document.getElementById('main-content').getBoundingClientRect().left,
        named:[...document.querySelectorAll('.sidebar-nav button')].every(button => button.getAttribute('aria-label') === button.title && ['Home','Settings'].includes(button.title)),
        labels:[...document.querySelectorAll('.nav-label')].every(label => label.getBoundingClientRect().width > 0)};
    ''')
    assert expanded['state'] == 'expanded' and abs(expanded['width'] - 216) < 1 and expanded['named'] and expanded['labels'], expanded
    client.script('document.getElementById("sidebar-toggle").focus(); document.getElementById("sidebar-toggle").click();')
    wait_for(lambda: client.script('return Math.abs(document.getElementById("atlas-sidebar").getBoundingClientRect().width - 80) < 1;'), 'collapsed sidebar finishes layout transition')
    collapsed = client.script('''
      return {state:document.body.dataset.sidebar,
        width:document.getElementById('atlas-sidebar').getBoundingClientRect().width,
        mainLeft:document.getElementById('main-content').getBoundingClientRect().left,
        expanded:document.getElementById('sidebar-toggle').getAttribute('aria-expanded'),
        label:document.getElementById('sidebar-toggle').getAttribute('aria-label'),
        labelsHidden:[...document.querySelectorAll('.nav-label')].every(label => label.getBoundingClientRect().width === 0),
        current:document.getElementById('show-home').getAttribute('aria-current')};
    ''')
    assert collapsed['state'] == 'collapsed' and abs(collapsed['width'] - 80) < 1, collapsed
    assert collapsed['mainLeft'] < expanded['mainLeft'] and collapsed['expanded'] == 'false' and collapsed['label'] == 'Expand sidebar', collapsed
    assert collapsed['labelsHidden'] and collapsed['current'] == 'page', collapsed
    for key, expected in [(' ', 'expanded'), ('\ue007', 'collapsed')]:
        client.call('WebDriver:PerformActions', actions=[{'type':'key', 'id':'atlas-sidebar', 'actions':[{'type':'keyDown', 'value':key}, {'type':'keyUp', 'value':key}]}])
        assert client.script('return document.body.dataset.sidebar === arguments[0] && document.activeElement.id === "sidebar-toggle";', expected)
    assert client.script('return localStorage.getItem("atlas-sidebar-v1");') == 'collapsed'
    wait_for(lambda: client.script('return Math.abs(document.getElementById("atlas-sidebar").getBoundingClientRect().width - 80) < 1;'), 'keyboard collapse finishes layout transition')
    capture('home-collapsed')
    client.call('WebDriver:Refresh')
    wait_for(lambda: client.script('return document.readyState === "complete" && document.getElementById("status").dataset.ready === "true";'), 'collapsed UI reload')
    assert client.script('return document.body.dataset.sidebar === "collapsed" && document.getElementById("sidebar-toggle").getAttribute("aria-expanded") === "false";')
    failed_sidebar = client.script('''
      window.__atlasSidebarSend = browser.runtime.sendMessage; window.__atlasSidebarPolls = 0;
      browser.runtime.sendMessage = function(message, ...rest) {
        if (message?.kind === 'GET_VIEW') ++window.__atlasSidebarPolls;
        return window.__atlasSidebarSend.call(browser.runtime, message, ...rest);
      };
      const before = localStorage.getItem('atlas-sidebar-v1'); const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'atlas-sidebar-v1') throw new Error('synthetic unavailable presentation storage');
        return original.call(this, key, value);
      };
      try { document.getElementById('sidebar-toggle').click(); }
      finally { Storage.prototype.setItem = original; }
      return {stored:localStorage.getItem('atlas-sidebar-v1'), before,
        state:document.body.dataset.sidebar, expanded:document.getElementById('sidebar-toggle').getAttribute('aria-expanded')};
    ''')
    assert failed_sidebar == {'stored':'collapsed', 'before':'collapsed', 'state':'expanded', 'expanded':'true'}, failed_sidebar
    try:
        wait_for(lambda: client.script('return window.__atlasSidebarPolls > 0 && document.getElementById("status").dataset.ready === "true";'), 'UI keeps polling after sidebar preference save failure')
    finally:
        client.script('browser.runtime.sendMessage = window.__atlasSidebarSend; delete window.__atlasSidebarSend; delete window.__atlasSidebarPolls;')
    assert snapshot()['policy'] == sidebar_authority['policy'] and snapshot()['configuration'] == sidebar_authority['configuration']
    assert client.script('return document.getElementById("status").dataset.ready === "true";')
    client.call('WebDriver:Refresh')
    wait_for(lambda: client.script('return document.getElementById("status").dataset.ready === "true" && document.body.dataset.sidebar === "collapsed";'), 'failed sidebar save retains previous preference on reload')
    client.script('localStorage.setItem("atlas-sidebar-v1", "invalid preference");')
    client.call('WebDriver:Refresh')
    wait_for(lambda: client.script('return document.getElementById("status").dataset.ready === "true";'), 'corrupt sidebar preference reload')
    assert client.script('return document.body.dataset.sidebar === "expanded" && document.getElementById("sidebar-toggle").getAttribute("aria-expanded") === "true";')
    client.script('document.getElementById("sidebar-toggle").click();')
    assert client.script('return localStorage.getItem("atlas-sidebar-v1") === "collapsed";')
    # A second same-origin document writes the preference; the parent receives
    # native storage events rather than a synthetic event dispatched by the test.
    client.script('''
      const done = arguments[0]; window.__atlasSidebarStorageEvents = [];
      window.__atlasSidebarStorageObserver = event => {
        if (event.key === 'atlas-sidebar-v1') window.__atlasSidebarStorageEvents.push({trusted:event.isTrusted, value:event.newValue});
      };
      window.addEventListener('storage', window.__atlasSidebarStorageObserver);
      const frame = document.createElement('iframe'); frame.id = 'atlas-sidebar-storage-fixture'; frame.hidden = true;
      frame.onload = () => done(true); frame.src = 'about:blank'; document.body.append(frame);
    ''', asynchronous=True)
    try:
        for preference in ['expanded', 'collapsed']:
            client.script('document.getElementById("atlas-sidebar-storage-fixture").contentWindow.localStorage.setItem("atlas-sidebar-v1", arguments[0]);', preference)
            wait_for(lambda: client.script('return document.body.dataset.sidebar === arguments[0] && document.getElementById("sidebar-toggle").getAttribute("aria-expanded") === String(arguments[0] === "expanded");', preference), 'native cross-document sidebar preference sync')
        assert client.script('return window.__atlasSidebarStorageEvents;') == [{'trusted':True, 'value':'expanded'}, {'trusted':True, 'value':'collapsed'}]
    finally:
        client.script('document.getElementById("atlas-sidebar-storage-fixture").remove(); window.removeEventListener("storage", window.__atlasSidebarStorageObserver); delete window.__atlasSidebarStorageObserver; delete window.__atlasSidebarStorageEvents;')
    sidebar_after = snapshot()
    assert sidebar_after['policy'] == sidebar_authority['policy'] and sidebar_after['configuration'] == sidebar_authority['configuration']
    assert sidebar_after['policyRevision'] == sidebar_authority['policyRevision'] and sidebar_after['configurationRevision'] == sidebar_authority['configurationRevision']
    checks.append('native sidebar width, accessible icon controls, Space/Enter focus, UI reload, native cross-document storage sync, corrupt preference fallback and ephemeral layout after failed preference save')
    print('PASS native sidebar: collapse, keyboard, persisted reload and unavailable presentation writes', flush=True)
    wait_for(lambda: client.script('return document.querySelectorAll("#destination-list .destination-card").length > 0;'), 'destination cards after sidebar reload')
    assert client.script('return [...document.querySelectorAll(".service-mark")].every(mark => mark.textContent === "" && mark.querySelector("img.site-icon"));')
    icon_policy = snapshot()['policy']
    custom = client.message({'kind': 'OPEN_DESTINATION', 'url': f'http://root.localhost:{port}/icon-probe'})
    wait_for(lambda: any(c['tabId'] == custom['tabId'] and c['displayedHostname'] == 'root.localhost' for c in view()['contexts']), 'custom icon fixture arrives')
    client.script('const image = [...document.querySelectorAll(".site-icon")].find(image => image.dataset.hostname === "root.localhost"); image.scrollIntoView();')
    wait_for(lambda: client.script('const image = [...document.querySelectorAll(".site-icon")].find(image => image.dataset.hostname === "root.localhost"); return image.src.startsWith("blob:") && image.complete && image.naturalWidth > 0;'), 'custom hostname uses observed website icon')
    assert snapshot()['policy'] == icon_policy
    close(custom['tabId'])
    client.script('document.getElementById("show-home").click();')
    checks.append('native online website icons, observed favicon on a custom host, decoded image rendering and no letter tiles')
    print('PASS native site icons: custom-host Firefox metadata, decoded images, unchanged policy', flush=True)
    authority_before_pins = snapshot()
    for pin_id in ['service:github.com', 'service:canvas.kth.se', 'service:webmail.kth.se']:
        wait_for(lambda: client.script('return !document.querySelector("#destination-list [data-pin-id=" + CSS.escape(arguments[0]) + "]").disabled;', pin_id), 'pin control ready')
        client.script('document.querySelector("#destination-list [data-pin-id=" + CSS.escape(arguments[0]) + "]").click();', pin_id)
        wait_for(lambda: client.script('return [...document.querySelectorAll("#pinned-list .destination-card")].some(card => card.dataset.destinationId === arguments[0]);', pin_id), 'pin saved and displayed')
    client.script('''
      const pin = document.querySelector('#pinned-list [data-pin-id="service:github.com"]');
      pin.focus(); pin.click();
    ''')
    assert client.script('''
      const focused = document.activeElement;
      return focused.isConnected && focused.matches('#destination-list .pin-button')
        && focused.dataset.pinId === 'service:github.com' && !focused.closest('[hidden]')
        && !document.querySelector('#pinned-list [data-pin-id="service:github.com"]');
    ''')
    client.script('document.activeElement.click();')
    wait_for(lambda: client.script('return document.querySelectorAll("#pinned-list .destination-card").length === 3;'), 'focused destination can be pinned again')
    checks.append('unpinning a focused Pinned card moves focus to its visible destination pin')
    assert snapshot()['policy'] == authority_before_pins['policy']
    assert snapshot()['configuration'] == authority_before_pins['configuration']
    assert len(snapshot()['accessState']['grants']) == len(authority_before_pins['accessState']['grants'])
    assert client.script('return document.getElementById("access-panel").hidden;')
    assert client.script('return document.querySelector("#destination-list .service-group").dataset.category === "University";')
    assert client.script('return document.querySelector(".category-toggle").getAttribute("aria-expanded") === "false";')
    assert client.script('return document.querySelector(".category-toggle").closest("section").querySelectorAll(".destination-card:not([hidden])").length === 4;')
    client.script('document.querySelector(".category-toggle").click();')
    assert client.script('return document.querySelector(".category-toggle").getAttribute("aria-expanded") === "true" && document.querySelector(".category-toggle").closest("section").querySelectorAll(".destination-card:not([hidden])").length > 4;')
    client.script('document.querySelector(".category-toggle").click();')
    # Presentation-storage failure cannot change pins or stop the authority UI.
    failed_pin = client.script('''
      const before = localStorage.getItem('atlas-home-pins-v1'); const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function() { throw new Error('synthetic unavailable presentation storage'); };
      try { document.querySelector('#destination-list [data-pin-id="service:chatgpt.com"]').click(); }
      finally { Storage.prototype.setItem = original; }
      return {unchanged:localStorage.getItem('atlas-home-pins-v1') === before, count:document.querySelectorAll('#pinned-list .destination-card').length,
        feedback:document.getElementById('feedback').textContent};
    ''')
    assert failed_pin['unchanged'] and failed_pin['count'] == 3 and 'could not be saved' in failed_pin['feedback'], failed_pin
    client.script('const pin = document.querySelector("#destination-list [data-pin-id=" + CSS.escape(arguments[0]) + "]"); pin.click(); pin.click();', 'service:webmail.kth.se')
    assert client.script('return document.getElementById("feedback").hidden && document.querySelectorAll("#pinned-list .destination-card").length === 3;')
    # Unpin focus can scroll down to its category. Bring Pinned back into view so
    # these newly rebuilt cards enter the normal lazy icon-loading path.
    client.script('document.getElementById("show-home").click(); document.getElementById("pinned-section").scrollIntoView({block:"nearest"});')
    assert client.script('return [...document.querySelectorAll("#pinned-list .site-icon")].every(image => { const rect = image.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0; });'), 'pinned icon cards are visible before checking lazy loads'
    try:
        wait_for(lambda: client.script('return [...document.querySelectorAll("#pinned-list .site-icon")].every(image => image.src.startsWith("blob:") && image.complete && image.naturalWidth > 0);'), 'pinned public website icons render', 15)
    except AssertionError:
        print('Pinned icon presentation:', client.script('return [...document.querySelectorAll("#pinned-list .site-icon")].map(image => { const rect = image.getBoundingClientRect(); return {hostname:image.dataset.hostname, websiteIcon:image.src.startsWith("blob:"), decoded:image.complete && image.naturalWidth > 0, visible:rect.top < innerHeight && rect.bottom > 0}; });'), flush=True)
        raise
    capture('home-viewport')
    print('Curated icon presentation:', client.script('return [...document.querySelectorAll("#pinned-list .site-icon")].map(image => ({hostname:image.dataset.hostname, websiteIcon:image.src.startsWith("blob:"), decoded:image.complete && image.naturalWidth > 0}));'), flush=True)
    client.script('document.getElementById("show-settings").click();')
    capture('settings-overview')
    client.script('document.getElementById("policy-whitelist").focus();')
    client.script('document.getElementById("policy-whitelist").dispatchEvent(new KeyboardEvent("keydown", {key:"/", bubbles:true}));')
    assert client.script('return !document.getElementById("settings").hidden && document.activeElement.id === "policy-whitelist";')
    client.script('document.getElementById("show-home").click(); document.dispatchEvent(new KeyboardEvent("keydown", {key:"/", bubbles:true}));')
    assert client.script('return document.activeElement.id === "destination-search";')
    stable = client.script('''
      const done = arguments[0]; const firstCard = document.querySelector('#destination-list .destination-card');
      const counts = {cards: 0, pins: 0}; const observers = [];
      for (const [id, key] of [['destination-list', 'cards'], ['pinned-list', 'pins']]) {
        const observer = new MutationObserver(records => { counts[key] += records.length; });
        observer.observe(document.getElementById(id), {childList:true, subtree:true, characterData:true}); observers.push(observer);
      }
      setTimeout(() => { observers.forEach(observer => observer.disconnect());
        done({...counts, sameCard: firstCard === document.querySelector('#destination-list .destination-card'), sameFocus:document.activeElement.id === 'destination-search'}); }, 2200);
    ''', asynchronous=True)
    assert stable == {'cards': 0, 'pins': 0, 'sameCard': True, 'sameFocus': True}, stable
    client.script('document.getElementById("show-settings").click();')
    assert client.script('return !document.getElementById("settings").hidden && document.getElementById("show-settings").getAttribute("aria-current") === "page";')
    for target, content in [('timing-settings', 'settings-form'), ('vault-section', 'vault-empty'), ('managed-section', 'managed-status'), ('diagnostics', 'diagnostic-scope')]:
        assert client.script('return document.getElementById(arguments[0]).tagName === "DETAILS" && !document.getElementById(arguments[0]).open;', target)
        client.script('const summary = document.getElementById(arguments[0]).querySelector(":scope > summary"); summary.scrollIntoView({block:"center"}); summary.click();', target)
        assert client.script('''
          const detail = document.getElementById(arguments[0]); const content = document.getElementById(arguments[1]);
          const position = detail.querySelector(':scope > summary').getBoundingClientRect();
          return detail.open && content.getBoundingClientRect().height > 0
            && position.top >= 0 && position.top < innerHeight
            && document.getElementById('show-settings').getAttribute('aria-current') === 'page';
        ''', target, content)
        client.script('const summary = document.getElementById(arguments[0]).querySelector(":scope > summary"); summary.scrollIntoView({block:"center"}); summary.click();', target)
        assert client.script('return !document.getElementById(arguments[0]).open;', target)
    client.script('document.getElementById("show-home").click();')
    client.call('WebDriver:SetWindowRect', width=500, height=900)
    assert client.script('return document.documentElement.scrollWidth <= document.documentElement.clientWidth;'), 'small screen overflow'
    assert client.script('return getComputedStyle(document.querySelector(".sidebar")).position === "static";'), 'small screen navigation'
    assert client.script('return getComputedStyle(document.getElementById("sidebar-toggle")).display === "none" && document.body.dataset.sidebar === "collapsed";'), 'small screen keeps desktop preference while hiding its toggle'
    assert client.script('return [...document.querySelectorAll(".nav-label")].every(label => label.getBoundingClientRect().width > 0);'), 'small screen keeps Home and Settings labels visible'
    capture('home-small-screen')
    client.call('WebDriver:SetWindowRect', width=350, height=900)
    narrow = client.script('''
      return {requestedOuterWidth:350, innerWidth, outerWidth,
        scrollWidth:document.documentElement.scrollWidth, clientWidth:document.documentElement.clientWidth,
        labels:[...document.querySelectorAll('.nav-label')].map(label => {
          const rect = label.getBoundingClientRect();
          return {text:label.textContent, width:rect.width, left:rect.left, right:rect.right, visibility:getComputedStyle(label).visibility};
        })};
    ''')
    print('Native narrow viewport:', narrow, flush=True)
    assert narrow['scrollWidth'] <= narrow['clientWidth'], narrow
    assert [label['text'] for label in narrow['labels']] == ['Home', 'Settings'], narrow
    assert all(label['width'] > 0 and label['left'] >= 0 and label['right'] <= narrow['innerWidth'] and label['visibility'] == 'visible' for label in narrow['labels']), narrow
    checks.append(f'native narrow layout: requested 350px outer width, actual {narrow["innerWidth"]}px viewport, no horizontal overflow and fully visible Home/Settings labels')
    capture('home-narrow-screen')
    client.call('WebDriver:SetWindowRect', width=1280, height=1100)
    wait_for(lambda: client.script('return Math.abs(document.getElementById("atlas-sidebar").getBoundingClientRect().width - 80) < 1 && document.body.dataset.sidebar === "collapsed";'), 'desktop restores collapsed sidebar after compact layout')
    checks.append('native Home/Settings navigation and actual settings disclosures, local pin persistence, ordinary cards, search shortcut, stable DOM and small-screen layout')
    print('PASS native UI polish: sidebar, saved pins, keyboard shortcut, stable cards and small-screen layout', flush=True)
    client.script('''
      const input = document.getElementById('destination-search'); input.focus(); input.value = 'mail';
      input.dispatchEvent(new Event('input')); input.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true}));
    ''')
    assert client.script('return document.getElementById("destination-search").getAttribute("aria-activedescendant") === "search-result-0";')
    assert 'KTH Mail' in client.script('return document.getElementById("search-results").textContent;')
    client.script('''
      const input = document.getElementById('destination-search'); input.value = 'www.github'; input.dispatchEvent(new Event('input'));
    ''')
    assert 'GitHub' in client.script('return document.getElementById("search-results").textContent;')
    client.script('''
      const input = document.getElementById('destination-search'); input.value = 'black.localhost'; input.dispatchEvent(new Event('input'));
    ''')
    assert client.script('return document.getElementById("search-results").children.length === 0;')
    count_before = len(snapshot()['journeyState']['journeys'])
    tabs_before = client.script('const done = arguments[0]; browser.tabs.query({}).then(tabs => done(tabs.map(t => t.id)));', asynchronous=True)
    client.script('''
      const input = document.getElementById('destination-search'); input.value = 'root.localhost'; input.dispatchEvent(new Event('input'));
    ''')
    assert client.script('return document.getElementById("search-results").children.length === 1;')
    # Real Enter key, not a direct Core command or privileged Journey creation.
    client.call('WebDriver:PerformActions', actions=[{'type': 'key', 'id': 'atlas-search', 'actions': [{'type':'keyDown', 'value':'\ue007'}, {'type':'keyUp', 'value':'\ue007'}]}])
    def search_request():
        current = snapshot()
        return len(current['journeyState']['journeys']) > count_before
    wait_for(search_request, 'search Enter uses held Whitelist request')
    assert snapshot()['journeyState']['journeys'][-1]['rootHostname'] == 'root.localhost'
    new_tabs = client.script('const done = arguments[0]; browser.tabs.query({}).then(tabs => done(tabs.map(t => t.id)));', asynchronous=True)
    for tab_id in set(new_tabs) - set(tabs_before):
        close(tab_id)
    checks.append('native local search, aliases, blacklist exclusion, keyboard selection and ordinary gate')
    print('PASS native local destination search and Enter through ordinary navigation gate', flush=True)

    active_id, context = open_url()
    assert badge(active_id)['text'] == 'J'
    assert 'Journey' in badge(active_id)['title'] and 'root.localhost' in badge(active_id)['title'] and 'remaining' in badge(active_id)['title']
    unrelated_id = client.script('const done = arguments[0]; browser.tabs.create({url:"about:blank",active:true}).then(tab => done(tab.id));', asynchronous=True)
    assert badge(unrelated_id)['text'] != 'J'
    assert badge(active_id)['text'] == 'J'
    client.script('const [tabId, done] = arguments; browser.tabs.update(tabId,{active:true}).then(() => done(true));', active_id, asynchronous=True)
    assert badge(active_id)['text'] == 'J'
    close(unrelated_id)
    client.call('WebDriver:SwitchToWindow', handle=handles_by_tab[active_id])
    client.script('document.getElementById("identity").click();')
    wait_for(lambda: any(c['tabId'] == active_id and c['displayedHostname'] == 'identity.localhost' for c in view()['contexts']), 'badge Journey identity step')
    assert badge(active_id)['text'] == 'J'
    client.call('WebDriver:SwitchToWindow', handle=handles_by_tab[active_id])
    wait_for(lambda: client.script('return document.getElementById("finish");'), 'return link')
    client.script('document.getElementById("finish").click();')
    wait_for(lambda: any(c['tabId'] == active_id and c['journey']['phase'] == 'ENDED' for c in view()['contexts']), 'badge Journey completion')
    assert badge(active_id)['text'] != 'J'
    close(active_id)
    active_id, context = open_url()
    assert client.message({'kind':'CANCEL_JOURNEY','tabId':active_id})['result']['type'] == 'COMMITTED'
    wait_for(lambda: badge(active_id)['text'] != 'J', 'cancel clears native badge')
    close(active_id)

    # Migrate a known legacy fixture on real IndexedDB, preserving a pending policy proposal.
    old = snapshot()
    candidate = {'whitelist': [*old['policy']['whitelist'], 'migration.localhost'], 'blacklist': old['policy']['blacklist']}
    proposed = client.message({'kind':'PROPOSE_POLICY','candidatePolicy':candidate})
    assert proposed['result']['type'] == 'COMMITTED'
    before = snapshot()
    client.script('''
      const done = arguments[0]; const request = indexedDB.open('atlas-authority-v1', 1);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction(['authority'], 'readwrite', {durability:'strict'});
        const store = tx.objectStore('authority'); const get = store.get('envelope');
        get.onsuccess = () => {
          const record = get.result; record.schemaVersion = 1;
          delete record.snapshot.configuration; delete record.snapshot.configurationRevision;
          const vault = record.snapshot.vaultState;
          delete vault.pendingProposal.candidateConfiguration; delete vault.pendingProposal.baseConfigurationRevision;
          if (vault.lastApplied) delete vault.lastApplied.configurationRevision;
          store.put(record, 'envelope');
        };
        tx.oncomplete = () => { db.close(); done(true); }; tx.onabort = () => { db.close(); done(false); };
      }; request.onerror = () => done(false);
    ''', asynchronous=True)
    restart()
    after = snapshot()
    assert client.script('return document.body.dataset.sidebar === "collapsed" && document.getElementById("sidebar-toggle").getAttribute("aria-expanded") === "false";'), 'collapsed sidebar survives extension restart'
    wait_for(lambda: client.script('return document.querySelectorAll("#pinned-list .destination-card").length === 3;'), 'pins survive extension restart')
    assert after['configuration'] == before['configuration']
    assert after['policy'] == before['policy'] and after['policyRevision'] == before['policyRevision']
    assert after['accessState']['pendingRequests'] == before['accessState']['pendingRequests']
    assert after['accessState']['grants'] == before['accessState']['grants']
    assert after['vaultState']['pendingProposal']['readyAt'] == before['vaultState']['pendingProposal']['readyAt']
    assert after['vaultState']['pendingProposal']['candidatePolicy'] == before['vaultState']['pendingProposal']['candidatePolicy']
    assert client.message({'kind':'CANCEL_POLICY','proposalId':after['vaultState']['pendingProposal']['id']})['result']['type'] == 'COMMITTED'
    checks.append('native atomic schema-1 migration, unchanged policy/runtime terms and frozen pending policy wait')
    print('PASS native schema migration preserves policy, runtime terms and pending Vault timestamps', flush=True)

    view()
    client.script('document.getElementById("show-settings").click();')
    assert client.script('return !document.getElementById("settings").hidden && document.getElementById("workspace").hidden;')
    assert client.script('return document.getElementById("page-title").textContent === "Settings";')
    assert client.script('return document.getElementById("diagnostics") && document.getElementById("recover") && document.getElementById("propose-defaults");')
    client.script('document.querySelector("#timing-settings > summary").click();')
    assert client.script('return document.getElementById("timing-settings").open;')
    wait_for(lambda: client.script('return document.getElementById("vault-wait").value === "30";'), 'active settings in form')
    client.script('''
      document.getElementById('vault-wait').value = '2'; document.getElementById('access-wait').value = '2';
      document.getElementById('grant-duration').value = '20'; document.getElementById('journey-lifetime').value = '2';
      document.getElementById('journey-hops').value = '2'; document.getElementById('settings-form').requestSubmit();
    ''')
    pending = wait_for(lambda: snapshot()['vaultState']['pendingProposal'], 'native frozen settings proposal')
    wait_for(lambda: client.script('return document.querySelectorAll("#vault-settings-rows tr").length > 0 && !document.getElementById("settings-nav-status").hidden && !document.getElementById("settings-pending").hidden && document.getElementById("vault-section").open && !document.getElementById("vault-panel").hidden;'), 'frozen human-readable timing review and Settings pending marker')
    capture('vault-review')
    assert pending['readyAt'] - pending['createdAt'] == 30000
    assert pending['confirmBy'] - pending['readyAt'] == 60000
    assert snapshot()['configuration']['vaultTiming']['waitMs'] == 30000
    assert client.message({'kind':'CONFIRM_POLICY','proposalId':pending['id']})['result']['reason'] == 'NOT_READY'
    active_id, context = open_url()
    old_journey = context['journey']
    assert old_journey['expiresAt'] - old_journey['startedAt'] == 300000
    assert old_journey['maxHops'] == 12
    assert badge(active_id)['text'] == 'J'
    restart()
    assert snapshot()['vaultState']['pendingProposal'] == pending
    wait_for(no_live_badges, 'restart removes unsupported live badge')
    view()
    client.script('document.getElementById("show-settings").click(); document.getElementById("review-pending").click();')
    assert client.script('return document.getElementById("vault-section").open && document.activeElement.id === "vault-heading" && document.getElementById("show-settings").getAttribute("aria-current") === "page";')
    # Wait under old protection, then deliberately create a still-waiting old-term request
    # and an old Journey just before committing the settings change.
    wait_for(lambda: time.time() * 1000 >= pending['readyAt'] - 1000, 'old native Vault delay', 40)
    known_handles = set(client.call('WebDriver:GetWindowHandles'))
    unknown = client.message({'kind':'OPEN_DESTINATION','url':f'http://settings-grey.localhost:{port}/'})
    unknown_id = unknown['tabId']
    unknown_handle = wait_for(lambda: next((h for h in client.call('WebDriver:GetWindowHandles') if h not in known_handles), None), 'focused access tab')
    wait_for(lambda: any(c['tabId'] == unknown_id and c['effect'] == 'REMOVED' for c in view()['contexts']), 'old-term Greylist page')
    assert client.message({'kind':'START_ACCESS','tabId':unknown_id})['result']['type'] == 'COMMITTED'
    old_request = next(r for r in snapshot()['accessState']['pendingRequests'] if r['hostname'] == 'settings-grey.localhost')
    client.call('WebDriver:SwitchToWindow', handle=unknown_handle)
    wait_for(lambda: client.script('return document.getElementById("show-home");'), 'focused access UI')
    client.script('document.getElementById("show-home").click();')
    assert client.script('return !document.getElementById("destinations").hidden && document.getElementById("page-title").textContent === "Atlas";')
    active_id, context = open_url(); old_journey = context['journey']
    wait_for(lambda: client.script('return !document.getElementById("confirm-policy").hidden && !document.getElementById("confirm-policy").disabled;'), 'native settings confirmation', 10)
    assert snapshot()['configuration']['vaultTiming']['waitMs'] == 30000
    client.script('document.getElementById("confirm-policy").focus(); document.getElementById("confirm-policy").click();')
    wait_for(lambda: snapshot()['vaultState']['pendingProposal'] is None, 'native settings saved activation')
    assert client.script('return document.activeElement.id === "vault-heading" && document.getElementById("vault-panel").hidden && document.getElementById("settings-nav-status").hidden && document.getElementById("settings-pending").hidden;'), 'saved Vault confirmation keeps focus and clears pending presentation'
    committed = snapshot()
    assert committed['configuration']['vaultTiming']['waitMs'] == 2000
    assert committed['configurationRevision'] == 1 and committed['policyRevision'] == before['policyRevision']
    assert committed['policy'] == before['policy']
    assert next(r for r in committed['accessState']['pendingRequests'] if r['id'] == old_request['id']) == old_request
    saved_journey = next(j for j in committed['journeyState']['journeys'] if j['id'] == old_journey['id'])
    assert saved_journey['expiresAt'] == old_journey['expiresAt'] and saved_journey['maxHops'] == 12
    assert badge(active_id)['text'] == 'J'
    close(active_id)
    new_id, context = open_url()
    assert context['journey']['expiresAt'] - context['journey']['startedAt'] == 2000
    assert context['journey']['maxHops'] == 2
    wait_for(lambda: badge(new_id)['text'] != 'J', 'new native Journey expires', 6)
    close(new_id)
    wait_for(lambda: time.time() * 1000 >= old_request['readyAt'], 'original Greylist wait', 15)
    result = client.message({'kind':'CONFIRM_ACCESS','requestId':old_request['id']})
    assert result['result']['type'] == 'COMMITTED'
    grant = next(g for g in snapshot()['accessState']['grants'] if g['requestId'] == old_request['id'])
    assert grant['expiresAt'] - grant['issuedAt'] == 60000
    new_pending = client.message({'kind':'PROPOSE_SETTINGS','candidateConfiguration':before['configuration']})
    assert new_pending['result']['type'] == 'COMMITTED'
    pending2 = snapshot()['vaultState']['pendingProposal']
    assert pending2['readyAt'] - pending2['createdAt'] == 2000
    restart()
    assert snapshot()['configuration'] == committed['configuration']
    assert snapshot()['vaultState']['pendingProposal'] == pending2
    assert next(g for g in snapshot()['accessState']['grants'] if g['requestId'] == old_request['id']) == grant
    assert client.message({'kind':'CANCEL_POLICY','proposalId':pending2['id']})['result']['type'] == 'COMMITTED'
    checks.extend(['native per-tab badge/title, cancellation, expiry and restart clearing', 'native old-term settings wait, explicit confirmation, atomic activation and frozen Access/Journey terms', 'native committed settings and pending proposal restart', 'Home/Settings preserve policy, managed list, Vault, diagnostics and recovery tools'])
    print('PASS native protected timing settings: old wait, explicit save, frozen terms, new values, restart', flush=True)
    view(); client.script('document.getElementById("show-home").click();')
    wait_for(lambda: client.script('return !document.getElementById("propose-settings").disabled;'), 'fresh settings controls after cancellation')
    return ui_handle, {'checks': checks, 'configurationRevision': snapshot()['configurationRevision']}
