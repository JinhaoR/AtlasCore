"""Clock catch-up in a disposable Firefox profile; never change the OS clock.

Only this background realm's Date.now is patched. This reproduces the guarded
clock condition and old latch, not the cause of the user's OS clock correction.
"""
import time


def run_clock_recovery(client, ui_handle, port, wait_for, baseline=False):
    checks, observations = [], []

    def state():
        client.call('WebDriver:SwitchToWindow', handle=ui_handle)
        return client.message({'kind': 'GET_VIEW'})['view']

    def ready():
        return wait_for(lambda: (v := state())['controller']['status'] == 'READY' and v, 'clock fixture ready', 20)

    def background(script, *args):
        return client.script('''const [values,done]=arguments;browser.runtime.getBackgroundPage().then(window=>{
          try{done((function(args){''' + script + '''})(values));}catch{done({fixtureError:true});}
          },()=>done({fixtureError:true}));''', list(args), asynchronous=True)

    def open_tab(host):
        return client.script('''const [url,done]=arguments;browser.tabs.create({url,active:false}).then(t=>done(t.id));''',
                             f'http://{host}:{port}/', asynchronous=True)

    def context(tab):
        return next((c for c in state()['contexts'] if c['tabId'] == tab), None)

    def allowed_root():
        c = context(root_tab)
        return c and c['effect'] == 'NONE' and (c.get('latest') or {}).get('decision', {}).get('reason') == 'WHITELISTED'

    original = ready()['controller']['snapshot']
    root_tab = open_tab('root.localhost')
    wait_for(allowed_root, 'allowed page retained')
    try:
        # Cover both reported deficits. Freeze below the checkpoint for several
        # real timer ticks, then restore the actual clock without sending RECOVER.
        for deficit in [2538, 5993]:
            before = ready()
            floor = max(before['controller']['snapshot'][name]['lastObservedAt']
                        for name in ['accessState', 'vaultState', 'journeyState'])
            assert background('''window.__clockProbe={now:window.Date.now,frozen:args[0]};
              window.Date.now=()=>window.__clockProbe.frozen;return true;''', floor - deficit) is True
            failed = wait_for(lambda: (v := state())['controller']['reason'] == 'CLOCK_ROLLBACK' and v,
                              'rollback guard closes authority')
            wait_for(lambda: context(root_tab)['effect'] == 'REMOVED', 'retained content removed during rollback')
            time.sleep(2.2)
            held = state()
            assert held['controller']['reason'] == 'CLOCK_ROLLBACK'
            assert held['storage']['committedWrites'] == failed['storage']['committedWrites']
            assert held['controller']['snapshot']['policy'] == original['policy']
            issue = held['authorityInterruption']
            assert issue['reason'] == 'CLOCK_ROLLBACK'
            assert background('''window.Date.now=window.__clockProbe.now;delete window.__clockProbe;return true;''') is True
            if baseline:
                time.sleep(3.2)
                assert state()['controller']['reason'] == 'CLOCK_ROLLBACK', 'old code stays latched after actual time catches up'
                observations.append({'deficitMs': deficit, 'afterCatchUp': 'UNAVAILABLE', 'recoveredWithoutCommand': False})
                client.message({'kind': 'RECOVER'})
            recovered = ready()
            assert recovered['authorityInterruption'] == issue
            assert recovered['controller']['snapshot']['policy'] == original['policy']
            assert recovered['controller']['snapshot']['configuration'] == original['configuration']
            assert recovered['storage']['failedCommits'] == 0
            assert client.message({'kind': 'GET_DIAGNOSTICS', 'tabId': None})['authorityInterruption'] == issue
            if not baseline:
                observations.append({'deficitMs': deficit, 'afterCatchUp': 'READY', 'recoveredWithoutCommand': True,
                                     'failedCommits': recovered['storage']['failedCommits']})
            # Removed documents remain removed until an ordinary gated launch.
            assert context(root_tab)['effect'] == 'REMOVED'
            client.message({'kind': 'OPEN_HOME', 'tabId': root_tab})
            wait_for(allowed_root, 'ordinary gated retry after clock catch-up')
        black = open_tab('black.localhost')
        wait_for(lambda: (c := context(black)) and c['effect'] == 'REMOVED'
                 and (c.get('latest') or {}).get('decision', {}).get('reason') == 'BLACKLISTED', 'Blacklist still enforced')
        grey = open_tab('grey.localhost')
        wait_for(lambda: (c := context(grey)) and c['effect'] == 'REMOVED'
                 and (c.get('latest') or {}).get('decision', {}).get('outcome') == 'GREYLIST', 'unrequested Greylist still denied')
        checks.extend(['actual timer remains closed while the clock is behind',
                       'old latch reproduced' if baseline else 'actual timer restores READY after clock catch-up without Recovery',
                       'policy and configuration unchanged; no failed commits; diagnosis retained',
                       'removed pages need a fresh gated launch; Blacklist and Greylist remain enforced'])
    finally:
        background('''if(window.__clockProbe){window.Date.now=window.__clockProbe.now;delete window.__clockProbe;}return true;''')
    for check in checks:
        print('PASS ' + check, flush=True)
    return {'suite': 'clock-recovery', 'baseline': baseline, 'checks': checks, 'observations': observations}
