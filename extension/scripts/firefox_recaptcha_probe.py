"""Public login-page observation only; no login, credentials or challenge solving."""
import time

def verify(c,h,shot):
    ui=c.call('WebDriver:GetWindowHandle')
    policy=c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']['policy']
    policy['whitelist'].append('myanimelist.net');h.configure_policy(c,policy)
    observations=[]
    try:
        for enabled in [True,False]:
            if not enabled:
                c.call('Marionette:SetContext',value='chrome')
                c.script('const done=arguments[arguments.length-1];ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager.getAddonByID(arguments[0]).then(a=>a.disable()).then(()=>done(true));',h.ADDON_ID,asynchronous=True)
                c.call('Marionette:SetContext',value='content')
            c.call('WebDriver:Navigate',url='https://myanimelist.net/login.php')
            time.sleep(8)
            observation=c.script('''const host=u=>{try{return new URL(u).hostname;}catch{return null;}};return {hostname:location.hostname,title:document.title,blockedMessage:document.body.innerText.includes('reCAPTCHA is currently blocked'),challengePage:/Just a moment|Checking your browser|Access Denied|Access denied/.test(document.body.innerText),recaptchaAPI:typeof window.grecaptcha,resourceHosts:[...new Set(performance.getEntriesByType('resource').map(r=>host(r.name)))],frameHosts:[...document.querySelectorAll('iframe')].map(f=>host(f.src))};''')
            observations.append({'atlasEnabled':enabled,**observation});shot('myanimelist-'+('atlas' if enabled else 'without-atlas'))
        return {'publicOnly':True,'observations':observations,'limitation':'No account login or challenge completion. An isolated profile does not contain other installed blockers or privacy preferences.'}
    finally:
        c.call('Marionette:SetContext',value='chrome')
        c.script('const done=arguments[arguments.length-1];ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager.getAddonByID(arguments[0]).then(a=>a.enable()).then(()=>done(true));',h.ADDON_ID,asynchronous=True)
        c.call('Marionette:SetContext',value='content')
