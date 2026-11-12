"""Run existing theme UI regression coverage and retain sanitized local evidence."""
from pathlib import Path
import sys, shutil
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'extension/scripts'))
import firefox_compact_home as harness
import firefox_theme_prototypes as scenario

original=scenario.verify
def verify(c,h,shot):
    before=c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    result=original(c,h,shot)
    after=c.message({'kind':'GET_VIEW'})['view']['controller']['snapshot']
    for key in ['policy','policyRevision','configuration','configurationRevision']:
        assert before[key]==after[key],key
    result['runtimeObservationChanges']={}
    for key in ['accessState','vaultState']:
        # Real gated pointer launches advance Core's observation watermark.
        # Compare every permission/proposal field, not that real-time metadata.
        assert {k:v for k,v in before[key].items() if k!='lastObservedAt'}=={k:v for k,v in after[key].items() if k!='lastObservedAt'},key
        assert after[key]['lastObservedAt']>=before[key]['lastObservedAt'],key
        result['runtimeObservationChanges'][key]={'before':before[key]['lastObservedAt'],'after':after[key]['lastObservedAt']}
    result['protectedStateUnchanged']=True
    return result

if __name__=='__main__':
    scenario.verify=verify
    before=set((ROOT/'.tools').glob('compact-home-native-*'))
    sys.argv=[str(__file__),'--theme-prototypes-only','--signed-baseline','0.2.8']
    try:harness.main()
    finally:
        created=set((ROOT/'.tools').glob('compact-home-native-*'))-before
        assert len(created)==1,created
        run=created.pop();out=HERE/'native-final';out.mkdir(exist_ok=True)
        for p in [*run.glob('*.png'),*run.glob('result.json')]:shutil.copy2(p,out/p.name)
        assert run.resolve().parent==(ROOT/'.tools').resolve()
        shutil.rmtree(run)
