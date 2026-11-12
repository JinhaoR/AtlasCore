import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './support/fixture.mjs';

async function grant(f, hosts=['grey.example','www.grey.example']) {
  const r=await f.controller.handle({kind:'START_ACCESS',target:{hostname:hosts[0]},scopeHostnames:hosts});
  assert.equal(r.type,'COMMITTED');f.clock.time+=10;
  assert.equal((await f.firefox.send({kind:'CONFIRM_ACCESS',requestId:r.referenceId})).result.type,'COMMITTED');
  return r.referenceId;
}
test('ending access commits before removing alias tabs and leaves unrelated allowed pages alone',async t=>{
  const f=await fixture(t),id=await grant(f);
  const tabs=await Promise.all(['grey.example','www.grey.example','root.example'].map(async host=>{
    const tab=await f.firefox.tabs.create({});assert.deepEqual(await f.firefox.visit(tab.id,`https://${host}/`),{});return tab;
  }));
  const entered=deferred(),release=deferred(),commit=f.repository.commit.bind(f.repository);
  f.repository.commit=async req=>{entered.resolve();await release.promise;return commit(req);};
  const ending=f.firefox.send({kind:'END_ACCESS',requestId:id});await entered.promise;
  assert.equal(f.controller.getView().snapshot.accessState.grants.length,1);
  release.resolve();assert.equal((await ending).result.type,'COMMITTED');await f.firefox.flush();
  for(const tab of tabs.slice(0,2))assert.equal(f.adapter.view().contexts.find(c=>c.tabId===tab.id).effect,'REMOVED');
  assert.equal(f.adapter.view().contexts.find(c=>c.tabId===tabs[2].id).latest.decision.outcome,'ALLOW');
  assert.equal((await f.firefox.send({kind:'END_ACCESS',requestId:id})).result.reason,'GRANT_NOT_FOUND');
});
test('ending access invalidates a held navigation that relied on the grant',async t=>{
  const f=await fixture(t),id=await grant(f),tab=await f.firefox.tabs.create({});
  assert.deepEqual(await f.firefox.request(tab.id,'https://grey.example/next'),{});
  assert.equal((await f.firefox.send({kind:'END_ACCESS',requestId:id})).result.type,'COMMITTED');
  await f.firefox.flush();
  assert.equal(f.adapter.view().contexts.find(c=>c.tabId===tab.id).effect,'REMOVED');
  assert.equal((await f.firefox.request(tab.id,'https://grey.example/')).cancel,true);
});
test('website and read-only popup cannot end access; malformed command cannot widen its surface',async t=>{
  const f=await fixture(t),id=await grant(f),before=f.controller.getView().snapshot;
  for(const sender of [{id:f.firefox.runtime.id,url:'https://grey.example/',frameId:0},
    {id:f.firefox.runtime.id,url:f.firefox.runtime.getURL('popup/index.html'),frameId:0}]){
    const response=await f.firefox.send({kind:'END_ACCESS',requestId:id},sender);assert.ok(!response?.result || response.result.type!=='COMMITTED');
  }
  assert.equal((await f.firefox.send({kind:'END_ACCESS',requestId:id,hostname:'root.example'})).error,'INVALID_COMMAND');
  assert.deepEqual(f.controller.getView().snapshot,before);
});
test('embedded challenge resources are not top-level navigation, even on blocked hosts',async t=>{
  const f=await fixture(t),tab=await f.firefox.tabs.create({});
  await f.firefox.visit(tab.id,'https://root.example/');const before=f.controller.getView().snapshot;
  for(const [type,frameId] of [['script',0],['sub_frame',1],['xmlhttprequest',0],['image',0]])
    assert.deepEqual(await f.firefox.request(tab.id,'https://blocked.example/challenge',{type,frameId}),{});
  assert.deepEqual(f.controller.getView().snapshot,before);
  assert.equal((await f.firefox.request(tab.id,'https://blocked.example/')).cancel,true);
});
