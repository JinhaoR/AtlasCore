import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessState, createVaultState, createJourneyState, startAccess, confirmAccess, endAccess,
  evaluateAccess, createAtlasController } from '../dist/index.js';
import { FakeRepository, deferred } from './support/fake-repository.mjs';

const policy = { whitelist: ['root.example'], blacklist: ['blocked.example'] };
const timing = { waitMs: 10, confirmationWindowMs: 20, grantDurationMs: 100 };
const ctx = (state, now = 10, policyRevision = 0) => ({ state, now, policy, policyRevision });
function granted() {
  const started = startAccess('grey.example', ctx(createAccessState(), 0), timing, ['grey.example','www.grey.example']);
  return confirmAccess(started.request.id, ctx(started.nextState)).nextState;
}
test('ending a grant removes its whole exact scope without changing policy, other requests or deadlines', () => {
  const state = startAccess('other.example', ctx(granted()), timing).nextState;
  const before = structuredClone(state), result = endAccess(1, ctx(state, 20));
  assert.equal(result.type, 'ENDED');
  assert.deepEqual(state, before);
  assert.deepEqual(result.nextState.pendingRequests, before.pendingRequests);
  assert.equal(result.nextState.nextRequestId, before.nextRequestId);
  for (const host of ['grey.example','www.grey.example']) assert.equal(evaluateAccess(host,ctx(result.nextState,20)).decision.outcome,'GREYLIST');
  assert.equal(confirmAccess(1,ctx(result.nextState,20)).reason,'REQUEST_NOT_FOUND');
  assert.equal(endAccess(1,ctx(result.nextState,20)).reason,'GRANT_NOT_FOUND');
  const next = startAccess('grey.example',ctx(result.nextState,20),timing);
  assert.equal(next.request.readyAt,30);
  assert.equal(confirmAccess(next.request.id,ctx(next.nextState,20)).reason,'NOT_READY');
});
test('end validates state, time, ID, revision and expiry; one grant cannot affect another', () => {
  const state = granted();
  for (const [id,c,reason] of [[0,ctx(state),'INVALID_REQUEST_ID'],[2,ctx(state),'GRANT_NOT_FOUND'],
    [1,ctx(state,110),'GRANT_EXPIRED'],[1,ctx(state,10,1),'POLICY_CHANGED'],[1,ctx(state,9),'CLOCK_ROLLBACK'],[1,ctx({}),'INVALID_STATE']])
    assert.equal(endAccess(id,c).reason,reason);
  const request = startAccess('another.example',ctx(state),timing);
  const two = confirmAccess(request.request.id,ctx(request.nextState,20)).nextState;
  assert.deepEqual(endAccess(1,ctx(two,20)).nextState.grants,[two.grants[1]]);
});
async function fixture() {
  const configuration = { accessTiming:timing, vaultTiming:{waitMs:10,confirmationWindowMs:20},journeyLimits:{lifetimeMs:100,maxHops:2} };
  const snapshot={policy,policyRevision:0,configuration,configurationRevision:0,accessState:granted(),vaultState:createVaultState(),journeyState:createJourneyState()};
  const repository=new FakeRepository(snapshot),clock={now:()=>20};
  const create=ownerId=>createAtlasController({repository,clock,configuration,ownerId});
  const controller=create('first');assert.equal((await controller.open()).status,'READY');
  return {repository,controller,create};
}
const end={kind:'END_ACCESS',requestId:1};
test('ending publishes only after acknowledgement, survives restart and cannot be replayed into permission',async()=>{
  const {repository,controller,create}=await fixture();const entered=deferred(),release=deferred();
  repository.steps.push(async(req,repo)=>{entered.resolve();await release.promise;return repo.apply(req);});
  const ending=controller.handle(end);await entered.promise;
  assert.equal(controller.getView().snapshot.accessState.grants.length,1);
  release.resolve();assert.equal((await ending).type,'COMMITTED');
  const restarted=create('second');assert.equal((await restarted.open()).status,'READY');
  assert.deepEqual(restarted.getView().snapshot.accessState.grants,[]);
  assert.equal((await restarted.handle(end)).reason,'GRANT_NOT_FOUND');
  assert.equal((await restarted.handle({kind:'CONFIRM_ACCESS',requestId:1})).reason,'REQUEST_NOT_FOUND');
  assert.deepEqual(restarted.getView().snapshot.policy,policy);
});
test('failed, conflicting and unknown end commits never claim success or replay automatically',async()=>{
  for(const mode of ['failed','conflict','unknown-written','unknown-unwritten']){
    const {repository,controller}=await fixture();
    repository.steps.push((req,repo)=>mode==='failed'?repo.fail(req):mode==='conflict'?(repo.replace(repo.envelope.snapshot),repo.apply(req)):repo.unknown(req,mode==='unknown-written'));
    const result=await controller.handle(end);assert.notEqual(result.type,'COMMITTED',mode);
    assert.equal(controller.getView().snapshot.accessState.grants.length,1,mode);
    if(mode.startsWith('unknown'))repository.settle(repository.commits.at(-1).commitId);
    await controller.open();
    assert.equal(controller.getView().snapshot.accessState.grants.length,mode==='unknown-written'?0:1,mode);
  }
});
