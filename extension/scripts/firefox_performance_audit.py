"""Numeric, synthetic UI workload. Instrumented copies never authorize or mutate Core outside ordinary commands."""
import ctypes
from ctypes import wintypes
import json
import os
import statistics
import time


def process_sample(root_pid):
    """Windows CPU/private-byte measurements for this disposable Firefox tree only."""
    if os.name != 'nt':
        return None
    class Entry(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('usage', wintypes.DWORD), ('pid', wintypes.DWORD),
                    ('heap', ctypes.c_size_t), ('module', wintypes.DWORD), ('threads', wintypes.DWORD),
                    ('parent', wintypes.DWORD), ('priority', wintypes.LONG), ('flags', wintypes.DWORD), ('exe', wintypes.WCHAR * 260)]
    class Memory(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('faults', wintypes.DWORD), *[(n, ctypes.c_size_t) for n in
                    ['peakWorking', 'working', 'peakPaged', 'paged', 'peakNonpaged', 'nonpaged', 'pagefile', 'peakPagefile', 'private']]]
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE, *[ctypes.POINTER(wintypes.FILETIME)] * 4]
    memory_api = ctypes.WinDLL('psapi', use_last_error=True).GetProcessMemoryInfo
    memory_api.argtypes = [wintypes.HANDLE, ctypes.POINTER(Memory), wintypes.DWORD]
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    rows = []
    entry = Entry(); entry.size = ctypes.sizeof(entry)
    try:
        available = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
        while available:
            rows.append((entry.pid, entry.parent))
            available = kernel.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel.CloseHandle(snapshot)
    pids = {root_pid}
    for _ in range(12):
        more = {pid for pid, parent in rows if parent in pids}
        if more <= pids: break
        pids |= more
    cpu = working = private = count = 0
    for pid in pids:
        handle = kernel.OpenProcess(0x410, False, pid)
        if not handle: continue
        try:
            created, ended, system, user = (wintypes.FILETIME() for _ in range(4))
            if kernel.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(ended), ctypes.byref(system), ctypes.byref(user)):
                cpu += ((system.dwHighDateTime << 32) + system.dwLowDateTime + (user.dwHighDateTime << 32) + user.dwLowDateTime) / 1e7
            mem = Memory(); mem.cb = ctypes.sizeof(mem)
            if memory_api(handle, ctypes.byref(mem), mem.cb):
                working += mem.working; private += mem.private; count += 1
        finally: kernel.CloseHandle(handle)
    return dict(cpuSeconds=round(cpu, 4), workingMiB=round(working/1048576, 2), privateMiB=round(private/1048576, 2), processes=count)


def run_performance_audit(client, ui_handle, ui_url, port, wait_for, run, root_pid, baseline=False):
    measurements, checks = [], []

    def view():
        return client.message({'kind': 'GET_VIEW'}).get('view', {})

    def ready():
        wait_for(lambda: client.script('return document.getElementById("status").dataset.ready==="true" && !document.getElementById("add-site").disabled;'), 'verified authority and draft repository', 30)

    def measure_start():
        client.script('window.__atlasPerf.reset();')
        client.script('const done=arguments[0];browser.runtime.getBackgroundPage().then(b=>{b.__atlasPerf.reset();done(true)});', asynchronous=True)
        return time.monotonic(), process_sample(root_pid)

    def measure_end(name, started, latencies=None):
        elapsed = time.monotonic() - started[0]
        data = dict(case=name, seconds=round(elapsed, 3), ui=client.script('return window.__atlasPerf.stop();'),
                    background=client.script('const done=arguments[0];browser.runtime.getBackgroundPage().then(b=>done(b.__atlasPerf.stop()));', asynchronous=True),
                    processBefore=started[1], processAfter=process_sample(root_pid))
        if latencies:
            data['operationMs'] = dict(count=len(latencies), median=round(statistics.median(latencies),2), max=round(max(latencies),2), samples=[round(x,2) for x in latencies])
        if data['processBefore'] and data['processAfter']:
            data['aggregateCpuPercent'] = round((data['processAfter']['cpuSeconds']-data['processBefore']['cpuSeconds'])/elapsed*100,2)
        measurements.append(data)
        (run/'measurements.json').write_text(json.dumps(measurements,indent=2),encoding='utf-8')
        print('MEASURE',name,'seconds',data['seconds'],'DOM creates',data['ui']['creates'],'render calls',data['ui']['functions'].get('render',{}).get('calls',0),'latency',data.get('operationMs',{}).get('median'),flush=True)
        return data

    def settled(count):
        wait_for(lambda: client.script('return document.getElementById("site-draft").hidden && document.querySelectorAll("#destination-draft-items>.draft-item").length===arguments[0] && document.getElementById("destination-draft-status").textContent.match(/^Saved (?:editable draft|locally)/);',count), 'acknowledged staged batch', 35)

    def stage(index):
        start=time.monotonic()
        client.script('''document.getElementById('add-site').click();
          for(const [id,value] of [['site-name','Audit '+arguments[0]],['site-hostname','audit-'+arguments[0]+'.example'],['site-category','Audit'],['site-access',Number(arguments[0])%3===0?'BLACKLIST':'WHITELIST']]){
            const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}
          document.getElementById('site-form').requestSubmit();''',f'{index:03d}')
        settled(index+1)
        return (time.monotonic()-start)*1000

    ready()
    initial=view()['controller']['snapshot']
    assert client.script('return !!window.__atlasPerf;'), 'instrumented test copy required'
    client.script('document.getElementById("show-sites").click();')
    for lower, upper in [(0,5),(5,25),(25,60)]:
        started=measure_start()
        latency=[stage(i) for i in range(lower,upper)]
        measure_end(f'add-draft-{lower}-to-{upper}',started,latency)
    checks.append('60 mixed Whitelist/Blacklist draft additions save without policy commands or permission changes')

    started=measure_start(); latency=[]
    for i in range(12):
        start=time.monotonic()
        client.script('''document.querySelector('#destination-draft-items [data-destination-id="host:audit-059.example"] [data-draft-action="EDIT"]').click();
          const e=document.getElementById('site-name');
          for(let k=0;k<12;k++){e.value='Edited '+arguments[0]+' '+k;e.dispatchEvent(new Event('input',{bubbles:true}));}
          document.getElementById('site-form').requestSubmit();''',i)
        settled(60);latency.append((time.monotonic()-start)*1000)
    edit=measure_end('rapid-edits-60-item-draft',started,latency)
    checks.append('rapid typing and repeated staging retain the final edit and all 60 entries')

    started=measure_start(); latency=[]
    for i in range(30):
        start=time.monotonic()
        client.script('document.getElementById(arguments[0]).click();', ['show-home','show-settings','show-sites'][i%3])
        latency.append((time.monotonic()-start)*1000)
    measure_end('30-page-navigation-actions',started,latency)
    client.script('document.getElementById("show-sites").click();document.getElementById("review-destination-draft").click();')
    ready(); time.sleep(1)
    started=measure_start(); time.sleep(30)
    idle=measure_end('30-second-idle-large-review',started)
    if not baseline:
        assert idle['ui']['creates']==0, idle
        # Entering Home starts bounded favicon fetch deadlines. Those may still
        # exist at the start of this phase; they are not refresh-loop chains.
        # After 30 seconds all probes have settled, leaving one visible-page poll.
        assert idle['ui']['activeTimers']<=1, idle
    checks.append('idle review retains staged data and bounded refresh timers')

    started=measure_start()
    for i in range(8):
        client.script('document.querySelector("#destination-draft-items [data-draft-action=REMOVE]").click();')
        settled(59-i)
    measure_end('remove-8-draft-items',started)
    assert view()['controller']['snapshot']['policy']==initial['policy']
    assert view()['controller']['snapshot']['vaultState']['pendingProposal'] is None
    checks.append('local edits/removals/navigation never submit or confirm a Vault proposal')

    # Reopen real extension pages repeatedly. The persisted draft belongs to the
    # repository; closing an old view must stop its timers/listeners.
    reopen=[]
    for i in range(6):
        before=process_sample(root_pid);start=time.monotonic()
        handles=set(client.call('WebDriver:GetWindowHandles'))
        client.call('Marionette:SetContext',value='chrome')
        client.script('gBrowser.selectedTab=gBrowser.addTrustedTab(arguments[0]);',ui_url)
        client.call('Marionette:SetContext',value='content')
        new_handles=set(client.call('WebDriver:GetWindowHandles'))-handles
        assert len(new_handles)==1, 'one new control page must be identified by its actual handle'
        new_handle=new_handles.pop()
        client.call('WebDriver:SwitchToWindow',handle=ui_handle);client.call('WebDriver:CloseWindow')
        ui_handle=new_handle;client.call('WebDriver:SwitchToWindow',handle=ui_handle)
        wait_for(lambda: client.script('return document.readyState==="complete" && !!window.__atlasPerf;'),'reopened instrumented view',30)
        ready();client.script('document.getElementById("show-sites").click();');settled(52)
        reopen.append(dict(iteration=i,ms=round((time.monotonic()-start)*1000,2),before=before,after=process_sample(root_pid),resources=client.script('return window.__atlasPerf.snapshot();')))
    checks.append('six close/reopen cycles retain the saved large draft and final edit without duplicate page timers/listeners')
    # Fast close/reopen bursts allocate fresh documents before Firefox's normal
    # collection cycle. Measure quiescent memory separately from those peaks.
    # This test-only browser service never runs in shipped extension code.
    quiescent=[]
    for i in range(4):
        client.call('Marionette:SetContext',value='chrome')
        collected=client.script('''const done=arguments[0];
          if(!Services.memMgr?.minimizeMemoryUsage){done(false);return;}
          Services.memMgr.minimizeMemoryUsage(()=>done(true));''',asynchronous=True)
        client.call('Marionette:SetContext',value='content')
        time.sleep(5)
        quiescent.append(dict(iteration=i,memoryMinimized=collected,process=process_sample(root_pid),resources=client.script('return window.__atlasPerf.snapshot();')))
    assert all(x['resources']['tabsListeners']==1 and x['resources']['activeGlobalListeners']==9 for x in reopen), reopen
    checks.append('page listener counts remain stable through close/reopen; quiescent process memory is recorded separately from allocation peaks')
    # Inspect only synthetic fixture records, never an everyday policy or input.
    stored=client.script('''const done=arguments[0],r=indexedDB.open('atlas-destination-drafts-v1',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('workspace','readonly'),q=tx.objectStore('workspace').get('current');q.onsuccess=()=>done({count:q.result.value.draft.changes.length,last:q.result.value.draft.changes.at(-1).after.metadata.label,revision:q.result.revision});tx.oncomplete=()=>db.close();};''',asynchronous=True)
    assert stored['count']==52 and stored['last']=='Edited 11 11',stored
    final=view()['controller']['snapshot']
    assert final['policy']==initial['policy'] and final['vaultState']['pendingProposal'] is None
    return dict(baseline=baseline,checks=checks,measurements=measurements,reopenCycles=reopen,quiescentSamples=quiescent,persistedSyntheticSummary=stored,
                finalControllerStatus=view()['controller']['status'],instrumentation='test-copy-only numeric AST function timing and native Windows process counters',
                limits=['Function times are inclusive wall times, not sampled CPU profiles.','RSS/private bytes are aggregate process snapshots and are not proof of retained JavaScript heap.','Accelerated repeated use does not reproduce multiple weeks of daily use.'])
