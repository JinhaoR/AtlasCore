import test from 'node:test';
import assert from 'node:assert/strict';
import { compileManagedBlacklist, createAtlasController, DOWNLOAD_LIFETIME_MS } from '@atlas/core';
import { FirefoxAdapter } from '../dist/lib/adapter/firefox-adapter.js';
import { isAttachment, hasUserActivation, downloadRedirectUrl } from '../dist/lib/adapter/download-response.js';
import { fixture, configuration, deferred } from './support/fixture.mjs';

async function root(f) {
  const tab = await f.firefox.tabs.create({});
  assert.deepEqual(await f.firefox.visit(tab.id, 'https://root.example/'), {});
  return tab.id;
}
async function child(f, source, url = 'https://cdn.example/file', originUrl = 'https://root.example/') {
  const tab = await f.firefox.tabs.create({});
  f.firefox.webNavigation.onCreatedNavigationTarget.emit({ sourceTabId:source,sourceFrameId:0,tabId:tab.id,
    url,timeStamp:f.firefox.eventTime++ });
  return { id:tab.id, result:await f.firefox.request(tab.id,url,{originUrl}) };
}
async function send(f,id,gesture=true) {
  return f.firefox.webRequest.onBeforeSendHeaders.emit({ ...f.firefox.requests.get(id), timeStamp:f.firefox.eventTime++,
    requestHeaders:gesture ? [{ name:'Sec-Fetch-User',value:'?1' }] : [] })[0];
}
async function headers(f,id,kind='FILE',statusCode=200,location=null) {
  return f.firefox.webRequest.onHeadersReceived.emit({ ...f.firefox.requests.get(id),timeStamp:f.firefox.eventTime++,statusCode,
    responseHeaders:kind==='FILE' ? [{name:'Content-Disposition',value:'attachment; filename="file.txt"'}]
      : kind==='HTML' ? [{name:'Content-Type',value:'text/html'}] : location ? [{name:'Location',value:location}] : [] })[0];
}
async function hop(f,id,url) {
  assert.deepEqual(await headers(f,id,'REDIRECT',302,url),{});
  const previous = f.firefox.requests.get(id);
  f.firefox.webRequest.onBeforeRedirect.emit({...previous,timeStamp:f.firefox.eventTime++,redirectUrl:url});
  return f.firefox.request(id,url,{requestId:previous.requestId,originUrl:'https://root.example/'});
}

test('new-tab attachment and redirect chain are operation scoped, with no grant or policy changes', async t => {
  const f=await fixture(t); const source=await root(f); const before=f.controller.getView().snapshot;
  const target=await child(f,source); assert.deepEqual(target.result,{});
  assert.deepEqual(await send(f,target.id),{});
  assert.deepEqual(await hop(f,target.id,'https://files.example/data'),{});
  assert.deepEqual(await send(f,target.id,false),{},'redirect uses original activation');
  assert.deepEqual(await headers(f,target.id),{});
  assert.equal((await headers(f,target.id)).cancel,true,'duplicate response cannot reuse consumed intent');
  assert.deepEqual(f.controller.getView().snapshot.policy,before.policy);
  assert.deepEqual(f.controller.getView().snapshot.accessState,before.accessState);
  assert.deepEqual(f.controller.getView().snapshot.journeyState,before.journeyState);
});

test('HTML and a filename-like URL receive normal Greylist before display', async t => {
  const f=await fixture(t); const target=await child(f,await root(f),'https://cdn.example/claimed.pdf');
  await send(f,target.id);
  assert.equal((await headers(f,target.id,'HTML')).cancel,true);
  await f.firefox.flush();
  const context=f.adapter.view().contexts.find(c=>c.tabId===target.id);
  assert.equal(context.latest.decision.outcome,'GREYLIST');
  assert.equal(context.effect,'REMOVED');
});

test('missing user activation cannot send the exceptional request', async t => {
  const f=await fixture(t); const target=await child(f,await root(f));
  assert.equal((await send(f,target.id,false)).cancel,true);
  assert.equal((await headers(f,target.id)).cancel,true);
});

test('opener alone, wrong origin, wrong target and nested source supply no download scope', async t => {
  for (const mode of ['opener','origin','url','frame']) {
    const f=await fixture(t); const source=await root(f); const tab=await f.firefox.tabs.create({});
    f.firefox.documents.get(tab.id).openerTabId=source;
    if(mode!=='opener') f.firefox.webNavigation.onCreatedNavigationTarget.emit({sourceTabId:source,
      sourceFrameId:mode==='frame'?1:0,tabId:tab.id,url:mode==='url'?'https://wrong.example/':'https://cdn.example/file',timeStamp:f.firefox.eventTime++});
    const result=await f.firefox.request(tab.id,'https://cdn.example/file',{originUrl:mode==='origin'?'https://wrong.example/':'https://root.example/'});
    assert.equal(result.cancel,true,mode);
  }
});

test('lineage is one-use and stale target events cannot renew a request', async t => {
  const f=await fixture(t); const target=await child(f,await root(f));
  await send(f,target.id);
  assert.equal((await f.firefox.request(target.id,'https://cdn.example/file',{originUrl:'https://root.example/'})).cancel,true);
  const source=await root(f); const tab=await f.firefox.tabs.create({});
  f.firefox.webNavigation.onCreatedNavigationTarget.emit({sourceTabId:source,sourceFrameId:0,tabId:tab.id,url:'https://cdn.example/file',timeStamp:f.firefox.eventTime++});
  f.clock.time+=3000;
  assert.equal((await f.firefox.request(tab.id,'https://cdn.example/file',{originUrl:'https://root.example/'})).cancel,true);
});

test('unrelated tabs and stolen request IDs cannot continue a download', async t => {
  const f=await fixture(t); const target=await child(f,await root(f)); await send(f,target.id);
  const other=await f.firefox.tabs.create({});
  assert.equal((await f.firefox.request(other.id,'https://cdn.example/file',{
    requestId:f.firefox.requests.get(target.id).requestId,originUrl:'https://root.example/'})).cancel,true);
  const original=f.firefox.requests.get(target.id);
  f.firefox.webRequest.onBeforeRedirect.emit({...original,redirectUrl:'https://other.example/'});
  assert.equal((await f.firefox.request(target.id,'https://other.example/',{requestId:original.requestId,originUrl:'https://root.example/'})).cancel,true,
    'no accepted redirect response');
});

test('explicit and managed Blacklist deny initial destinations and later redirects', async t => {
  for(const hostname of ['blocked.example','managed.example']) {
    const managed=compileManagedBlacklist(['managed.example']);
    const f=await fixture(t,true,{managedBlacklist:()=>managed});
    const source=await root(f);
    assert.equal((await child(f,source,`https://${hostname}/file`)).result.cancel,true);
    const target=await child(f,source); await send(f,target.id);
    assert.equal((await hop(f,target.id,`https://${hostname}/file`)).cancel,true);
  }
});

test('fixed expiry and redirect exhaustion fail closed without renewal', async t => {
  for(const mode of ['expiry','redirects']) {
    const f=await fixture(t); const target=await child(f,await root(f)); await send(f,target.id);
    if(mode==='expiry') {
      f.clock.time+=DOWNLOAD_LIFETIME_MS;
      assert.equal((await headers(f,target.id)).cancel,true);
    } else {
      for(let n=0;n<5;n++) {assert.deepEqual(await hop(f,target.id,`https://cdn.example/file-${n}`),{});await send(f,target.id);}
      assert.equal((await hop(f,target.id,'https://cdn.example/too-many')).cancel,true);
    }
  }
});

test('source closure, source navigation and policy changes invalidate delayed responses', async t => {
  for(const mode of ['closed','navigated','policy']) {
    const f=await fixture(t); const source=await root(f); const target=await child(f,source); await send(f,target.id);
    if(mode==='closed') await f.firefox.tabs.remove(source);
    if(mode==='navigated') await f.firefox.visit(source,'https://root.example/other');
    if(mode==='policy') {
      const proposal=await f.controller.handle({kind:'PROPOSE_POLICY',candidatePolicy:{whitelist:['root.example','added.example'],blacklist:['blocked.example']}});
      f.clock.time+=configuration.vaultTiming.waitMs;
      await f.controller.handle({kind:'CONFIRM_POLICY',proposalId:proposal.referenceId});
    }
    assert.equal((await headers(f,target.id)).cancel,true,mode);
  }
});

test('failed, conflicted and uncertain checkpoints never publish file authorization', async t => {
  for(const phase of ['PREPARE','ATTACHMENT']) for(const outcome of ['NOT_WRITTEN','CONFLICT','UNKNOWN']) {
    const f=await fixture(t); const source=await root(f);
    let target;
    if(phase==='ATTACHMENT') {target=await child(f,source);await send(f,target.id);}
    f.clock.time++;
    f.repository.commit=async request=>({type:outcome,commitId:request.commitId});
    if(phase==='PREPARE') assert.equal((await child(f,source)).result.cancel,true);
    else assert.equal((await headers(f,target.id)).cancel,true);
    assert.deepEqual(f.controller.getView().snapshot.accessState.grants,[]);
  }
});

test('superseding navigation during an awaited save cannot release the old response', async t => {
  const f=await fixture(t); const target=await child(f,await root(f)); await send(f,target.id);
  f.clock.time++;
  const saved=f.repository.commit.bind(f.repository), pending=deferred(), entered=deferred();
  f.repository.commit=async request=>{entered.resolve();await pending.promise;return saved(request)};
  const response=headers(f,target.id); await entered.promise;
  const replacement=f.firefox.request(target.id,'https://other.example/'); pending.resolve();
  assert.equal((await response).cancel,true);
  assert.equal((await replacement).cancel,true);
});

test('completed downloads clear only their own flight and never revive an older callback', async t => {
  const f=await fixture(t); const target=await child(f,await root(f)); await send(f,target.id); await headers(f,target.id);
  const old=f.firefox.requests.get(target.id);
  f.firefox.webRequest.onErrorOccurred.emit({...old,timeStamp:f.firefox.eventTime++,error:'NS_BINDING_ABORTED'});
  await f.firefox.flush();
  const next=await f.firefox.request(target.id,'https://root.example/'); assert.deepEqual(next,{});
  f.firefox.webRequest.onCompleted.emit({...old,timeStamp:f.firefox.eventTime++});
  f.firefox.arrive(target.id,'https://root.example/'); await f.firefox.flush();
  assert.equal(f.adapter.view().contexts.find(c=>c.tabId===target.id).latest.decision.reason,'WHITELISTED');
});

test('restart loses intent bindings and cannot accept an old response or opener', async t => {
  const f=await fixture(t); const target=await child(f,await root(f)); await send(f,target.id);
  f.adapter.stop();
  const controller=createAtlasController({repository:f.repository,clock:f.clock,configuration,ownerId:'restart'});
  let id=0;
  const adapter=new FirefoxAdapter(f.firefox,Promise.resolve({controller,repository:f.repository}),()=>`restart_${++id}`,
    ()=>f.clock.now(),f.firefox.schedule,f.firefox.unschedule);
  t.after(()=>adapter.stop()); await adapter.ready;
  f.firefox.settle=()=>adapter.whenIdle();
  assert.equal((await headers(f,target.id)).cancel,true);
  assert.equal((await f.firefox.request(target.id,'https://cdn.example/file',{originUrl:'https://root.example/'})).cancel,true);
});

test('websites and the private UI cannot manufacture Download Intent commands', async t => {
  const f=await fixture(t);
  assert.equal(await f.firefox.send({kind:'CHECK_DOWNLOAD'}, {id:f.firefox.runtime.id,url:'https://root.example/',frameId:0}),false);
  assert.equal((await f.firefox.send({kind:'CHECK_DOWNLOAD'})).error,'INVALID_COMMAND');
});

test('header evidence rejects ambiguity, MIME-only files and claimed extensions', () => {
  assert.equal(isAttachment(200,[{name:'Content-Type',value:'application/pdf'}]),false);
  for(const value of ['inline; filename="file.pdf"','attachmentx','attachment\r\nX: bad','attachment, inline'])
    assert.equal(isAttachment(200,[{name:'Content-Disposition',value}]),false);
  assert.equal(isAttachment(200,[{name:'Content-Disposition',value:'attachment'},{name:'Content-Disposition',value:'inline'}]),false);
  assert.equal(isAttachment(500,[{name:'Content-Disposition',value:'attachment'}]),false);
  assert.equal(hasUserActivation([{name:'Sec-Fetch-User',value:'?1'},{name:'Sec-Fetch-User',value:'?0'}]),false);
  for (const value of ['data:text/html,synthetic','blob:https://cdn.example/synthetic','javascript:void(0)','file:///synthetic'])
    assert.equal(downloadRedirectUrl('https://cdn.example/file',[{name:'Location',value}]),null);
  assert.equal(downloadRedirectUrl('https://cdn.example/file',[{name:'Location',value:'/other'}]),'https://cdn.example/other');
});

test('a committed Greylist grant can initiate a same-tab download without extending its scope or lifetime', async t => {
  const f=await fixture(t);
  const pending=await f.controller.handle({kind:'START_ACCESS',target:{hostname:'granted.example'}});
  f.clock.time+=configuration.accessTiming.waitMs;
  await f.controller.handle({kind:'CONFIRM_ACCESS',requestId:pending.referenceId});
  const grants=structuredClone(f.controller.getView().snapshot.accessState.grants);
  const tab=await f.firefox.tabs.create({}); await f.firefox.visit(tab.id,'https://granted.example/');
  assert.deepEqual(await f.firefox.request(tab.id,'https://cdn.example/file',{originUrl:'https://granted.example/'}),{});
  assert.deepEqual(await send(f,tab.id),{});
  assert.deepEqual(await headers(f,tab.id),{});
  f.firefox.webRequest.onCompleted.emit({...f.firefox.requests.get(tab.id),timeStamp:f.firefox.eventTime++});
  await f.firefox.flush();
  assert.equal(f.adapter.view().contexts.find(c=>c.tabId===tab.id).displayedHostname,'granted.example');
  assert.deepEqual(f.controller.getView().snapshot.accessState.grants,grants);
  assert.equal((await f.firefox.request(tab.id,'https://cdn.example/')).cancel,true);
});

test('an active Journey source can initiate a separate file operation without sharing its Journey', async t => {
  const f=await fixture(t); const source=await f.firefox.tabs.create({});
  await f.firefox.request(source.id,'https://root.example/');
  await f.firefox.redirect(source.id,'https://login.example/');
  const journey=structuredClone(f.controller.getView().snapshot.journeyState.journeys[0]);
  const target=await child(f,source.id,'https://cdn.example/file','https://login.example/');
  assert.deepEqual(target.result,{}); assert.deepEqual(await send(f,target.id),{});
  assert.deepEqual(await headers(f,target.id),{});
  assert.deepEqual(f.controller.getView().snapshot.journeyState.journeys,[journey]);
});

test('optional download correlation cannot hide a failed checkpoint behind an earlier ordinary ALLOW', async t => {
  const f=await fixture(t);
  const pending=await f.controller.handle({kind:'START_ACCESS',target:{hostname:'granted.example'}});
  f.clock.time+=configuration.accessTiming.waitMs;
  await f.controller.handle({kind:'CONFIRM_ACCESS',requestId:pending.referenceId});
  const tab=await f.firefox.tabs.create({}); await f.firefox.visit(tab.id,'https://granted.example/');
  await f.firefox.request(tab.id,'https://granted.example/file',{originUrl:'https://granted.example/'});
  f.clock.time++;
  f.repository.commit=async request=>({type:'UNKNOWN',commitId:request.commitId});
  assert.equal((await send(f,tab.id)).cancel,true);
});

test('diagnostics contain hostnames and reason codes, never correlation URLs or header values', async t => {
  const f=await fixture(t); const target=await child(f,await root(f),'https://cdn.example/private-path?fixture-secret=synthetic');
  await send(f,target.id); await headers(f,target.id);
  const events=(await f.firefox.send({kind:'GET_DIAGNOSTICS',tabId:null})).entries;
  assert.ok(events.some(e=>e.event==='DOWNLOAD_FILE'));
  const text=JSON.stringify(events);
  assert.equal(/private-path|fixture-secret|filename|Sec-Fetch|Content-Disposition/.test(text),false);
});

test('unsupported redirect schemes and network errors consume a pending exception', async t => {
  for(const mode of ['scheme','error']) {
    const f=await fixture(t); const target=await child(f,await root(f)); await send(f,target.id);
    if(mode==='scheme') assert.equal((await headers(f,target.id,'REDIRECT',302,'data:text/html,synthetic')).cancel,true);
    else f.firefox.webRequest.onErrorOccurred.emit({...f.firefox.requests.get(target.id),timeStamp:f.firefox.eventTime++,error:'SYNTHETIC_ERROR'});
    assert.equal((await headers(f,target.id)).cancel,true);
    await f.firefox.flush();
    assert.equal(f.adapter.view().contexts.find(c=>c.tabId===target.id).effect,'REMOVED');
  }
});

test('redirect response evidence cannot be reused for a later unobserved redirect', async t => {
  const f=await fixture(t); const target=await child(f,await root(f)); await send(f,target.id);
  assert.deepEqual(await hop(f,target.id,'https://cdn.example/second'),{});
  await send(f,target.id);
  const second=f.firefox.requests.get(target.id);
  f.firefox.webRequest.onBeforeRedirect.emit({...second,timeStamp:f.firefox.eventTime++,redirectUrl:'https://cdn.example/third'});
  assert.equal((await f.firefox.request(target.id,'https://cdn.example/third',{requestId:second.requestId,originUrl:'https://root.example/'})).cancel,true);
});
