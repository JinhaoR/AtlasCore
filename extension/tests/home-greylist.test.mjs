import test from 'node:test';
import assert from 'node:assert/strict';
import { Node } from './support/ui-fixture.mjs';
import { initializeHomeGreylist } from '../dist/lib/ui/home-greylist.js';

function fixture(t) {
  const previous=globalThis.document,roots=new Map(),commands=[],prepared=[],dismissed=[];
  class Element extends Node {
    querySelector(selector) { return this.children.flatMap(c=>[c,c.querySelector(selector)]).find(c=>c?.className?.split(' ').includes(selector.slice(1)))??null; }
    get isConnected(){return !!this.parentElement||[...roots.values()].includes(this);}
  }
  const el=id=>{if(!roots.has(id))roots.set(id,new Element());return roots.get(id);};
  globalThis.document={getElementById:el,createElement:()=>new Element(),activeElement:null};
  t.after(()=>{globalThis.document=previous;});
  let response={result:{type:'COMMITTED'}};
  const owner=initializeHomeGreylist({send:async c=>{commands.push(c);return response;},prepare:c=>prepared.push(c),label:h=>h,dismiss:(...args)=>dismissed.push(args)});
  const view={controller:{status:'READY'},contexts:[],pendingAccess:[],temporaryAccess:[]};
  return {owner,el,view,commands,prepared,dismissed,response:value=>{response=value;},signal:()=>el('pending-access-list').children[0]?.querySelector('.access-signal'),cancel:()=>el('pending-access-list').children[0]?.querySelector('.access-cancel')};
}

test('the access page distinguishes empty lists from unavailable authority',t=>{
  const f=fixture(t);
  f.owner.render(f.view,50,false,'');
  assert.equal(f.el('temporary-empty').hidden,false);
  assert.equal(f.el('journeys-empty').hidden,false);
  assert.equal(f.el('temporary-unavailable').hidden,true);
  assert.equal(f.el('journeys-unavailable').hidden,true);
  f.view.controller.status='UNAVAILABLE';f.owner.render(f.view,50,false,'');
  assert.equal(f.el('temporary-empty').hidden,true);
  assert.equal(f.el('journeys-empty').hidden,true);
  assert.equal(f.el('temporary-unavailable').hidden,false);
  assert.equal(f.el('journeys-unavailable').hidden,false);
});

test('Journey controls retain context fencing, explicit end and renewal commands',t=>{
  const f=fixture(t),context={tabId:3,contextId:'journey-tab',navigationId:4,hostname:'root.example',
    journey:{id:9,rootHostname:'root.example',phase:'ACTIVE',expiresAt:200}};
  f.view.contexts=[context];f.owner.render(f.view,50,false,'3');
  const end=f.el('other-journeys').children[0].querySelector('.access-signal');
  assert.equal(f.el('journeys-empty').hidden,true);
  end.click();assert.deepEqual(f.commands.pop(),{kind:'CANCEL_JOURNEY',tabId:3});
  f.owner.render(f.view,60,true,'3');assert.equal(end.disabled,true);
  f.owner.render(f.view,70,false,'3');assert.equal(end,f.el('other-journeys').children[0].querySelector('.access-signal'));
  f.view.contexts=[];f.owner.render(f.view,80,false,'3');end.click();assert.equal(f.commands.length,0);
  context.journey.phase='ENDED';context.retry={destinationLabel:'Research',journeyId:9};
  f.view.contexts=[context];f.owner.render(f.view,90,false,'3');
  const retry=f.el('other-journeys').children[0].querySelector('.access-signal');
  assert.equal(retry.textContent,'Start again');assert.equal(f.commands.length,0);
  retry.click();assert.deepEqual(f.commands.pop(),{kind:'RESTART_JOURNEY',tabId:3,journeyId:9});
});
test('waiting is status only and the same separate Cancel control remains available when ready',t=>{
  const f=fixture(t),p={requestId:7,hostnames:['example.org','www.example.org'],readyAt:100,confirmBy:200};
  f.view.pendingAccess=[p];const before=structuredClone(f.view);
  f.owner.render(f.view,50,false,'');const button=f.signal();assert.match(button.textContent,/Waiting/);button.click();
  assert.equal(f.commands.length,0);const cancel=f.cancel();assert.equal(cancel.textContent,'Cancel');cancel.click();
  assert.deepEqual(f.commands,[{kind:'CANCEL_ACCESS',requestId:7}]);f.commands.length=0;
  f.owner.render(f.view,100,false,'');assert.equal(button,f.signal());assert.match(button.textContent,/Allow/);assert.equal(f.commands.length,0);
  assert.equal(cancel,f.cancel());assert.equal(cancel.hidden,false);
  button.click();assert.deepEqual(f.commands,[{kind:'CONFIRM_ACCESS',requestId:7}]);assert.deepEqual(f.view,before);
  f.owner.render(f.view,200,false,'');assert.equal(f.signal(),undefined);
});
test('active green button opens through the ordinary gate; the red Cancel ends only its grant',t=>{
  const f=fixture(t);f.view.temporaryAccess=[{requestId:9,hostnames:['example.org'],expiresAt:200}];
  f.owner.render(f.view,50,false,'');f.cancel().click();assert.deepEqual(f.commands.pop(),{kind:'END_ACCESS',requestId:9});
  f.signal().click();assert.deepEqual(f.commands.pop(),{kind:'OPEN_DESTINATION',url:'https://example.org/'});
  assert.equal(f.view.temporaryAccess[0].expiresAt,200);f.owner.render(f.view,200,false,'');assert.equal(f.signal(),undefined);
});
test('busy and unavailable authority disable inline permission actions without falling back to cached access',t=>{
  const f=fixture(t);f.view.pendingAccess=[{requestId:7,hostnames:['example.org'],readyAt:0,confirmBy:200}];
  f.owner.render(f.view,50,true,'');f.signal().click();assert.equal(f.commands.length,0);
  f.cancel().click();assert.equal(f.commands.length,0);
  f.view.controller.status='UNAVAILABLE';f.owner.render(f.view,50,false,'');assert.equal(f.el('temporary-unavailable').hidden,false);assert.equal(f.signal(),undefined);
});
test('an intercepted site discloses prepared exact scope and never substitutes a missing context',t=>{
  const f=fixture(t),context={tabId:3,contextId:'one',navigationId:4,hostname:'example.org',latest:{type:'ASSESSMENT',decision:{outcome:'GREYLIST',reason:'UNLISTED'}},effect:'REMOVED',accessScope:null};
  f.view.contexts=[context];f.owner.render(f.view,50,false,'3');assert.deepEqual(f.prepared,[context]);assert.equal(f.signal().disabled,true);
  context.accessScope={status:'READY',id:'scope-one',hostnames:['example.org','www.example.org']};f.owner.render(f.view,50,false,'3');
  assert.match(f.el('pending-access-list').textContent,/example.org, www.example.org/);
  f.cancel().click();assert.deepEqual(f.dismissed,[['one',4]]);assert.equal(f.commands.length,0);
  const old=f.signal();old.click();assert.deepEqual(f.commands.pop(),{kind:'START_ACCESS',tabId:3,scopeId:'scope-one'});
  f.view.contexts=[];f.owner.render(f.view,50,false,'3');old.click();assert.equal(f.commands.length,0);assert.match(f.el('pending-access-list').textContent,/original tab has closed/);
});

test('cancelled prompt is detached only after acknowledged persistence, including its complete alias scope',async t=>{
  const f=fixture(t);
  f.view.contexts=[{tabId:3,contextId:'one',navigationId:4,hostname:'www.example.org'}];
  f.view.pendingAccess=[{requestId:7,hostnames:['example.org','www.example.org'],readyAt:100,confirmBy:200}];
  for(const response of [undefined,{result:{type:'BLOCKED',reason:'WRITE_FAILED'}},{result:{type:'BLOCKED',reason:'UNKNOWN_COMMIT'}},{result:{type:'REJECTED'}}]){
    f.response(response);f.owner.render(f.view,50,false,'3');f.cancel().click();await Promise.resolve();
    assert.deepEqual(f.dismissed,[]);assert.equal(f.el('pending-access-list').children.length,1);
  }
  f.response({result:{type:'COMMITTED'}});f.cancel().click();await Promise.resolve();assert.deepEqual(f.dismissed,[['one',4]]);
  f.view.pendingAccess=[];f.owner.render(f.view,50,false,'');assert.equal(f.el('pending-access-list').children.length,0);
});

test('ending access does not dismiss an unrelated selected site',async t=>{
  const f=fixture(t);f.view.contexts=[{tabId:3,contextId:'other',navigationId:4,hostname:'different.org',latest:{type:'ASSESSMENT',decision:{outcome:'ALLOW'}}}];
  f.view.temporaryAccess=[{requestId:9,hostnames:['example.org'],expiresAt:200}];
  f.owner.render(f.view,50,false,'3');f.cancel().click();await Promise.resolve();assert.deepEqual(f.dismissed,[]);
});
