"""Measured UI polish; probes exist exclusively in disposable runtime copies."""
import json, shutil, time
from pathlib import Path

def instrument(source, target):
    shutil.copytree(source,target)
    shutil.copyfile(Path(__file__).with_name('ui-polish-probe.js'),target/'ui/ui-polish-probe.js')
    html=target/'ui/index.html'
    html.write_text(html.read_text(encoding='utf8').replace('<head>','<head><script src="ui-polish-probe.js"></script>',1),encoding='utf8')
    js=target/'ui/main.js';code=js.read_text(encoding='utf8')
    for name,args,next_name in [('renderHome','policy, ready','updateDestinationLayout'),('renderSettings','controller, ready, now','renderHome')]:
        start=code.index('  function '+name+'('+args+') {')
        end=code.index('\n  function '+next_name+'(',start)
        block=code[start:end];tail=block.rfind('  }')
        block=block[:tail]+'  } finally { (window.__polish.costs.'+name+' ??= []).push(performance.now()-__start); }\n'+block[tail:]
        block=block.replace('('+args+') {','('+args+') { const __start=performance.now(); try {',1)
        code=code[:start]+block+code[end:]
    js.write_text(code,encoding='utf8')
    return target

def verify(c,wait,shot,reload,baseline):
    out={'baseline':baseline,'reloads':[]}
    for _ in range(3):
        reload();time.sleep(1)
        out['reloads'].append(c.script('return window.__polish;'))
    shot('polish-home')
    # Changing only the read projection simulates a housekeeping phase. This
    # does not change Core state, persisted settings, or execute navigation.
    out['pinLabels']={}
    for status in [None,'LOADING','COMMITTING','UNAVAILABLE',None]:
        c.script('window.__polish.forceStatus=arguments[0];document.getElementById("retry-destinations").click();',status)
        time.sleep(.5)
        out['pinLabels'][status or 'READY']=c.script('return {labels:[...document.querySelectorAll("#pinned-primary .pin-label")].map(e=>e.textContent),disabled:[...document.querySelectorAll("#pinned-primary button")].map(e=>e.disabled),warning:!document.getElementById("destination-state").hidden};')
    c.script('window.__added=0;window.__attrs=0;window.__icons=performance.getEntriesByType("resource").length;window.__savedPin=document.querySelector(".compass-pin");window.__mut=new MutationObserver(ms=>ms.forEach(m=>{if(m.type==="childList")window.__added+=m.addedNodes.length+m.removedNodes.length;else window.__attrs++;}));window.__mut.observe(document.getElementById("destinations"),{subtree:true,childList:true,attributes:true});window.__polish.calls={};window.__polish.costs={};')
    time.sleep(5)
    out['idle']=c.script('window.__mut.disconnect();return {nodes:window.__added,attrs:window.__attrs,resources:performance.getEntriesByType("resource").length-window.__icons,samePin:window.__savedPin===document.querySelector(".compass-pin"),calls:window.__polish.calls,costs:window.__polish.costs};')
    out['navigationMs']=[c.script('const done=arguments[0],s=performance.now();document.getElementById("show-sites").click();document.getElementById("show-home").click();requestAnimationFrame(()=>done(performance.now()-s));',asynchronous=True) for _ in range(10)]
    def geometry():
        return c.script('return ["search-form","customize-home","pinned-list"].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round);});')
    resting=geometry();out['workspaceGeometry']=[resting]
    c.script('document.querySelector(".category-shortcut").click();');time.sleep(.1)
    out['workspaceGeometry'].append(geometry())
    shot('polish-category')
    out['category']=c.script('return {cards:document.querySelectorAll("#destination-list .destination-card").length,visible:[...document.querySelectorAll("#destination-list .destination-card")].filter(e=>e.getClientRects().length).length,scrollHeight:document.documentElement.scrollHeight,innerHeight};')
    c.script('document.getElementById("close-category-workspace").click();')
    for query in ['arxiv','no-matching-fixture-site']:
        c.script('const s=document.getElementById("destination-search");s.value=arguments[0];s.dispatchEvent(new Event("input"));',query)
        out['workspaceGeometry'].append(geometry())
    c.script('const s=document.getElementById("destination-search");s.value="";s.dispatchEvent(new Event("input"));')
    out['countdown']=[]
    for minutes in [10,9.95,100,99.95]:
        c.script('window.__polish.accessMinutes=arguments[0];document.getElementById("retry-destinations").click();',minutes);time.sleep(.2)
        out['countdown'].append(c.script('const row=document.querySelector("#pending-access-list li"),box=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round);};return {copy:box(row.firstElementChild),time:box(row.querySelector(".temporary-time")),action:box(row.querySelector("button")),footer:box(document.getElementById("customize-home"))};'))
    c.script('window.__polish.accessMinutes=null;document.getElementById("retry-destinations").click();');time.sleep(.2)
    out['sizes']=[]
    for width,height,zoom in [(1488,1143,1),(1150,880,1),(1488,1143,1.25),(1488,1143,1.5),(1488,1143,2),(600,850,1)]:
        c.call('WebDriver:SetWindowRect',width=width,height=height)
        c.call('Marionette:SetContext',value='chrome');c.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,arguments[0]);',zoom);c.call('Marionette:SetContext',value='content');time.sleep(.2)
        out['sizes'].append(c.script('return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,mainOverflow:getComputedStyle(document.getElementById("main-content")).overflowY,footerBottom:document.getElementById("customize-home").getBoundingClientRect().bottom,documentHeight:document.documentElement.scrollHeight};'))
        shot('polish-size-'+str(width)+'-'+str(zoom))
    c.call('Marionette:SetContext',value='chrome');c.script('ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser,1);');c.call('Marionette:SetContext',value='content')
    c.call('WebDriver:SetWindowRect',width=1488,height=1143)
    out['pages']={}
    for page in ['sites','vault','settings']:
        c.script('document.getElementById(arguments[0]).click();','show-'+page)
        reload();time.sleep(1)
        out['pages'][page]=c.script('return window.__polish.frames;')
        shot('polish-'+page)
    if not baseline:
        assert out['pinLabels']['READY']['labels']==out['pinLabels']['LOADING']['labels']==out['pinLabels']['COMMITTING']['labels'],out['pinLabels']
        assert all(out['pinLabels']['UNAVAILABLE']['disabled']) and out['pinLabels']['UNAVAILABLE']['warning']
        assert out['idle']['nodes']==0 and out['idle']['resources']==0 and out['idle']['samePin'],out['idle']
        for reload_result in out['reloads']:
            assert all(f['cards']==0 for f in reload_result['frames'])
            assert len({tuple(f['footer']) for f in reload_result['frames'] if f['footer']})==1,reload_result
        assert out['category']['visible']==12 and out['category']['cards']<122
        assert all(g==resting for g in out['workspaceGeometry']),out['workspaceGeometry']
        assert all(s['overflow']<=1 for s in out['sizes']),out['sizes']
        assert all(sample==out['countdown'][0] for sample in out['countdown']),out['countdown']
        # A parser frame before any main-page nodes exist is not a Home flash.
        for page,frames in out['pages'].items():
            painted=[f for f in frames if f['search'] or f['pins'] or f['footer'] or f['phase'] is not None]
            assert painted and all(f['page']==page for f in painted),(page,frames)
    return out
