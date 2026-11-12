import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './support/fixture.mjs';
const popup=f=>({id:f.runtime.id,url:f.runtime.getURL('ui/popup.html'),frameId:0});
test('popup is read-only and current-context scoped, with no snapshot or privileged commands',async t=>{
 const {firefox:f,controller,adapter}=await fixture(t);
 const tab=await f.tabs.create({});await f.visit(tab.id,'https://unknown.example/');
 const before=controller.getView().snapshot;
 const {status}=await f.send({kind:'GET_TOOLBAR_STATUS',tabId:tab.id},popup(f));
 assert.equal(status.hostname,'unknown.example');assert.equal(status.decision.outcome,'GREYLIST');assert.equal(status.ready,true);
 assert.equal(Object.hasOwn(status,'snapshot'),false);assert.deepEqual(controller.getView().snapshot,before);
 for(const kind of ['GET_VIEW','RECOVER','START_ACCESS','CONFIRM_POLICY','PRESENTATION_READ','PIN_SET'])assert.equal((await f.send({kind},popup(f))).error,'INVALID_COMMAND');
 assert.equal(await f.send({kind:'GET_TOOLBAR_STATUS',tabId:tab.id},{...popup(f),frameId:3}),false);
 assert.equal((await f.send({kind:'OPEN_CONTROL_PAGE',page:'access',tabId:tab.id,contextId:'stolen'},popup(f))).error,'CONTEXT_CLOSED');
 await f.tabs.remove(tab.id);await adapter.whenIdle();
 assert.equal((await f.send({kind:'OPEN_CONTROL_PAGE',page:'access',tabId:tab.id,contextId:status.contextId},popup(f))).error,'CONTEXT_CLOSED');
 assert.equal((await f.send({kind:'GET_TOOLBAR_STATUS',tabId:tab.id},popup(f))).status.contextId,null);
});
test('popup shortcuts navigate a same-window control page without replacing its URL or draft',async t=>{
 const {firefox:f}=await fixture(t);const source=await f.tabs.create({});const control=await f.tabs.create({url:f.runtime.getURL('ui/index.html?view=control#sites'),active:false});
 assert.deepEqual(await f.send({kind:'OPEN_CONTROL_PAGE',page:'vault',tabId:source.id,contextId:null},popup(f)),{opened:true});
 assert.equal(f.documents.size,2);assert.deepEqual(f.updates,[]);
 assert.deepEqual(f.controlMessages.at(-1),{kind:'CONTROL_NAVIGATE',controlTabId:control.id,page:'vault',tabId:source.id});
 f.runtime.sendMessage=async()=>undefined;
 assert.equal((await f.send({kind:'OPEN_CONTROL_PAGE',page:'settings',tabId:source.id,contextId:null},popup(f))).error,'CONTROL_UNAVAILABLE');
});
test('popup reports unavailable authority and unsupported pages neutrally',async t=>{
 const {firefox:f,controller,clock}=await fixture(t);const tab=await f.tabs.create({url:'about:config'});
 const {status}=await f.send({kind:'GET_TOOLBAR_STATUS',tabId:tab.id},popup(f));assert.equal(status.hostname,null);assert.equal(status.decision,null);
 clock.time=-1;await controller.handle({kind:'OBSERVE_TIME'});
 assert.equal((await f.send({kind:'GET_TOOLBAR_STATUS',tabId:tab.id},popup(f))).status.ready,false);
});

test('popup reflects the existing wait, confirmation and fixed grant deadline without granting access',async t=>{
 const {firefox:f,controller,clock,adapter}=await fixture(t);const tab=await f.tabs.create({});
 await f.visit(tab.id,'https://unknown.example/');
 const id=(await f.send({kind:'START_ACCESS',tabId:tab.id})).result.referenceId;
 const status=async()=>(await f.send({kind:'GET_TOOLBAR_STATUS',tabId:tab.id},popup(f))).status;
 assert.equal((await status()).decision.outcome,'WAIT');clock.time+=10;await adapter.refresh();
 assert.equal((await status()).decision.outcome,'REQUIRE_CONFIRMATION');assert.equal(controller.getView().snapshot.accessState.grants.length,0);
 await f.send({kind:'CONFIRM_ACCESS_AND_OPEN',tabId:tab.id,requestId:id});await f.visit(tab.id,'https://unknown.example/');
 const expiry=controller.getView().snapshot.accessState.grants[0].expiresAt;
 assert.equal((await status()).decision.reason,'ACTIVE_GRANT');assert.equal((await status()).decision.expiresAt,expiry);
 clock.time=expiry;await adapter.refresh();assert.equal((await status()).decision.outcome,'GREYLIST');
});

test('popup Journey belongs only to the requested tab and retains its original deadline',async t=>{
 const {firefox:f,controller}=await fixture(t);const root=await f.tabs.create({}),other=await f.tabs.create({url:'about:blank'});
 await f.visit(root.id,'https://root.example/');await f.request(root.id,'https://login.example/',{originUrl:'https://root.example/'});
 const journey=controller.getView().snapshot.journeyState.journeys.find(j=>j.phase!=='ENDED');assert.ok(journey);
 const current=(await f.send({kind:'GET_TOOLBAR_STATUS',tabId:root.id},popup(f))).status;
 assert.deepEqual(current.journey,{hostname:'root.example',expiresAt:journey.expiresAt});
 assert.equal((await f.send({kind:'GET_TOOLBAR_STATUS',tabId:other.id},popup(f))).status.journey,null);
});
