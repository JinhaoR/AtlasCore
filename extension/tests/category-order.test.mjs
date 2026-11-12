import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { CategoryOrderSession, openCategoryOrderRepository, readCategoryOrder, orderCategories, categoryOrderKeys } from '../dist/lib/ui/category-order.js';
import { openHomeLayoutRepository } from '../dist/lib/ui/home-layout-storage.js';
const value = (mode='custom',keys=['research','university']) => ({version:1,mode,keys});
const categories = [{key:'university',label:'University'},{key:'research',label:'Research'},{key:'tools',label:'Tools'}];
const entry = (host,category) => ({id:`host:${host}`,hostname:host,hostnames:[host],label:host,category});
const record = score => ({score,count:score,lastOpenedAt:100});

test('whole-category rename retains custom position; partial moves remain distinct',()=>{
  const catalog={version:1,categories:[{key:'old',label:'Old',members:['host:a.test','host:b.test'],visible:false,collapsed:true},{key:'other',label:'Other',members:['host:c.test'],visible:true,collapsed:false}]};
  const saved={...value('custom',['other','old']),catalog};
  const current=[{key:'renamed',label:'Renamed',members:['host:a.test','host:b.test'],count:2},{key:'other',label:'Other',members:['host:c.test'],count:1}];
  assert.deepEqual(categoryOrderKeys(saved,current,catalog),['other','renamed']);
  const partial=[{...current[0],members:['host:a.test']},current[1]];
  assert.deepEqual(categoryOrderKeys(saved,partial,catalog),['other','old','renamed']);
  assert.equal(readCategoryOrder({...saved,catalog:{version:2,categories:[]}}),null);
});

test('order values reject unknown modes, duplicate keys and noncanonical categories',()=>{
  assert.deepEqual(readCategoryOrder(value()),value());
  for(const v of [null,{},value('random'),value('custom',['Research']),value('custom',['a','a']),value('custom',['']),{...value(),extra:1}]) assert.equal(readCategoryOrder(v),null);
});
test('legacy order is preserved; alphabetical and usage do not mutate the stored custom arrangement',()=>{
  const keys=['university','tools','research'], before=structuredClone(keys);
  assert.deepEqual(orderCategories(categories,'custom',keys).map(c=>c.key),keys);
  assert.deepEqual(orderCategories(categories,'alphabetic',keys).map(c=>c.key),['research','tools','university']);
  const entries=[entry('a.test','Research'),entry('b.test','Research'),entry('c.test','University')];
  const usage={'host:a.test':record(4),'host:b.test':record(4),'host:c.test':record(7)};
  assert.deepEqual(orderCategories(categories,'usage',keys,entries,usage,100).map(c=>c.key),['research','university','tools']);
  assert.deepEqual(keys,before);
});
test('usage counts each site once, breaks ties alphabetically and new categories remain discoverable',()=>{
  const e=entry('a.test','University');
  const result=orderCategories(categories,'usage',[],[e,e,entry('b.test','Research')],{'host:a.test':record(3),'host:b.test':record(4)},100);
  assert.deepEqual(result.map(c=>c.key),['research','university','tools']);
  assert.equal(orderCategories(categories,'custom',['research']).length,3);
});
async function setup(t){const factory=new IDBFactory(),r=await openCategoryOrderRepository(factory);t.after(()=>r.close());return {factory,r,s:new CategoryOrderSession(r,()=>{})};}
test('mode and custom order survive reopen without changing the legacy category layout',async t=>{
  const {factory,r,s}=await setup(t),layout=await openHomeLayoutRepository(factory);t.after(()=>layout.close());
  await layout.save(0,{version:1,categories:[]});const before=await layout.load();
  await s.refresh();assert.equal(s.saved.value,null);
  assert.equal(await s.change(value('usage')),true);
  const reopened=await openCategoryOrderRepository(factory);t.after(()=>reopened.close());
  const next=new CategoryOrderSession(reopened,()=>{});await next.refresh();assert.equal(next.saved.value.mode,'usage');
  assert.equal(await next.change(value('custom',['university','research'])),true);
  assert.deepEqual((await r.load()).value,value('custom',['university','research']));assert.deepEqual(await layout.load(),before);
});
test('failed and uncertain writes retain drafts and reconcile acknowledged outcomes without replay',async t=>{
  const {r}=await setup(t);let mode='FAILED',writes=0;
  const s=new CategoryOrderSession({...r,save:async(rev,v)=>{writes++;if(mode==='FAILED')return {type:mode};const result=await r.save(rev,v);return mode==='UNCERTAIN'?{type:mode}:result;}},()=>{});
  await s.refresh();assert.equal(await s.change(value('alphabetic')),false);assert.equal(s.saved.value,null);assert.ok(s.draft);
  mode='UNCERTAIN';assert.equal(await s.retry(),false);assert.equal(await s.retry(),true);assert.equal(writes,2);assert.equal(s.saved.value.mode,'alphabetic');
});
test('two pages cannot silently overwrite each other and recovery explicitly discards a conflict',async t=>{
  const {r,s:a}=await setup(t),b=new CategoryOrderSession(r,()=>{});await a.refresh();await b.refresh();
  await a.change(value('usage'));assert.equal(await b.change(value('alphabetic')),false);assert.equal(b.conflict,true);
  assert.equal(await b.retry(),false);assert.equal(b.draft.mode,'alphabetic');assert.equal((await r.load()).value.mode,'usage');
  await b.useSaved();assert.equal(b.draft,null);assert.equal(b.saved.value.mode,'usage');
});
test('unavailable reads never initialize over saved preferences and unchanged reads are quiet',async t=>{
  const {r}=await setup(t);let fail=false,changes=0;
  const s=new CategoryOrderSession({...r,load:()=>fail?Promise.reject(Error('failed')):r.load()},()=>changes++);
  await s.refresh();await s.change(value());const before=changes;await s.refresh();await s.refresh();assert.equal(changes,before);
  fail=true;await s.refresh();assert.equal(await s.change(value('usage')),false);assert.deepEqual((await r.load()).value,value());
  fail=false;await s.retry();assert.equal(s.failure,null);
});
