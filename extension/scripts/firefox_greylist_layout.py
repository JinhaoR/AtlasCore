"""Measure Greylist-driven layout changes in a disposable native Firefox profile."""
import time

def verify(c,h,shot,baseline=False):
    def js(code,*args):return c.script(code,*args)
    # This is a paint/geometry fixture, not an access-state fixture. Keep the
    # existing refresh owner from replacing synthetic rows during screenshots.
    js('Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));')
    def geometry():return js('''const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
      const rows=document.querySelector('#temporary-section .home-access-rows');
      return {logo:box('.home-intro'),search:box('#search-form'),compass:box('.compass-composition'),
        access:box('#temporary-section'),rowHeight:rows.clientHeight,rowScroll:rows.scrollHeight,
        overflow:document.documentElement.scrollWidth>innerWidth+1};''')
    def paint(count,tone='waiting'):
        js('''const [count,tone]=arguments;document.querySelector('#temporary-section').hidden=count===0;
          document.querySelector('#temporary-empty').hidden=true;document.querySelector('#temporary-unavailable').hidden=true;
          document.querySelector('#pending-access-list').innerHTML=Array.from({length:count},(_,i)=>`<li class="temporary-row"><div class="temporary-copy"><strong class="temporary-name">Research ${i+1}</strong><span class="temporary-scope">sample.localhost</span></div><div class="temporary-actions"><button class="access-cancel">Cancel</button><button class="access-signal" data-tone="${tone}">${tone} &middot; 12:30</button></div></li>`).join('');''',count,tone)
    results={}
    for theme in ['default','light-test','celestial','parchment']:
        js('const e=document.querySelector("#atlas-theme");e.value=arguments[0];e.dispatchEvent(new Event("change",{bubbles:true}));',theme)
        c.call('WebDriver:SetWindowRect',width=1752,height=1202);time.sleep(.2)
        samples=[]
        for count,tone in [(0,'waiting'),(1,'waiting'),(2,'ready'),(5,'active'),(0,'waiting')]:
            paint(count,tone);sample=geometry();samples.append(sample)
            if theme in ['celestial','parchment'] and count in [0,2] and len(samples)<5:shot(f'{theme}-{count}-rows')
        excursions={key:max(abs(sample[key][i]-samples[0][key][i]) for sample in samples for i in range(4)) for key in ['logo','search','compass']}
        assert all(not s['overflow'] for s in samples),samples
        assert samples[2]['rowHeight']==128 and samples[3]['rowHeight']==128 and samples[3]['rowScroll']>128,samples
        if not baseline:assert max(excursions.values())<1,excursions
        results[theme]={'excursionPx':excursions,'samples':samples}
    # At smaller sizes/zoom the document remains scrollable; controls above a
    # following status box must still remain stationary. Test actual Firefox zoom.
    results['responsive']=[]
    for width,height,zoom in [(1300,950,1),(980,850,1),(540,900,1),(1752,1202,1.25),(1752,1202,2)]:
        c.call('WebDriver:SetWindowRect',width=width,height=height)
        c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=arguments[0];',zoom);c.call('Marionette:SetContext',value='content');time.sleep(.2)
        js('window.scrollTo(0,0);document.querySelector("main").scrollTop=0;')
        paint(0);before=geometry();paint(2);after=geometry()
        if not baseline:
            for key in ['logo','search','compass']:assert max(abs(a-b) for a,b in zip(before[key],after[key]))<1,(width,zoom,key,before,after)
        assert not after['overflow'],after
        shot(f'responsive-{width}-{zoom}')
        results['responsive'].append({'width':width,'height':height,'zoom':zoom,'before':before,'after':after})
    c.call('Marionette:SetContext',value='chrome');c.script('gBrowser.selectedBrowser.fullZoom=1;');c.call('Marionette:SetContext',value='content')
    return results
