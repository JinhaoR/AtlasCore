"""Matched native ring gesture/frame measurements, not an FPS guarantee."""
import math,time,statistics

def verify(c,h,shot):
    c.call('WebDriver:SetWindowRect',width=1752,height=1202)
    h.wait_for(lambda:c.script('return !document.getElementById("compass-handle").disabled;'),'ring ready')
    time.sleep(1)
    runs=[]
    for repeat in range(3):
        center=c.script('const r=document.getElementById("compass-handle").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];')
        c.script('''window.__frames=[];window.__pinWrites=0;window.__spinWrites=0;window.__measure=true;let last;
          function frame(t){if(last)window.__frames.push(t-last);last=t;if(window.__measure)requestAnimationFrame(frame);}requestAnimationFrame(frame);
          window.__motionObserver=new MutationObserver(ms=>{for(const m of ms){window.__spinWrites++;if(m.target.classList.contains('compass-pin'))window.__pinWrites++;}});
          window.__motionObserver.observe(document.querySelector('.compass-composition'),{attributes:true,subtree:true,attributeFilter:['style']});''')
        x,y=center;r=95
        move=lambda angle,duration:{'type':'pointerMove','origin':'viewport','x':round(x+r*math.cos(angle)),'y':round(y+r*math.sin(angle)),'duration':duration}
        actions=[move(0,0),{'type':'pointerDown','button':0}]
        for i in range(1,49):actions.append(move(i*math.pi/12,16))
        actions.append({'type':'pointerUp','button':0})
        c.call('WebDriver:PerformActions',actions=[{'type':'pointer','id':'spin','parameters':{'pointerType':'mouse'},'actions':actions}])
        time.sleep(1)
        metrics=c.script('window.__measure=false;window.__motionObserver.disconnect();return {frames:window.__frames,pinWrites:window.__pinWrites,allStyleWrites:window.__spinWrites};')
        frames=sorted(metrics.pop('frames'));metrics.update({'samples':len(frames),'medianMs':statistics.median(frames),'p95Ms':frames[min(len(frames)-1,int(.95*len(frames)))]})
        runs.append(metrics);time.sleep(4.1)
    shot('measured-compass')
    return {'runs':runs,'note':'Headless native Firefox; synthetic pointer path, actual browser rAF timestamps. Not a physical-display GPU profile.'}
