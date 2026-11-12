import test from 'node:test';
import { readFileSync } from 'node:fs';
import { categoryIcons, categoryIconNames } from '../dist/lib/ui/category-icons.js';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { CategoryIconSession, openCategoryIconRepository, readCategoryIcons, defaultCategoryIcon } from '../dist/lib/ui/category-icons.js';
import { openHomeLayoutRepository, openBookmarkRepository } from '../dist/lib/ui/home-layout-storage.js';
const value=(key='my research',icon='book')=>({version:1,entries:[{key,icon}]});
async function setup(t) { const factory=new IDBFactory(),r=await openCategoryIconRepository(factory);t.after(()=>r.close());return {factory,r,s:new CategoryIconSession(r,()=>{})}; }
test('icons accept only bounded canonical categories and local symbols',()=>{
  assert.deepEqual(readCategoryIcons(value()),value());
  for(const v of [null,{},value(' Upper '),value(''),value('a'.repeat(65)),value('valid','https://example.com/icon.svg'),{...value(),extra:true},{version:1,entries:[...value().entries,...value().entries]},{version:1,entries:Array(4097).fill(value().entries[0])}])assert.equal(readCategoryIcons(v),null);
  assert.equal(defaultCategoryIcon('My custom category'),'category');assert.equal(defaultCategoryIcon('Research'),'book');
});
test('custom icons, automatic reset and absent categories survive restart without touching other records',async t=>{
  const {factory,r,s}=await setup(t);await s.refresh();assert.equal((await r.load()).revision,0);
  const layout=await openHomeLayoutRepository(factory),pages=await openBookmarkRepository(factory);t.after(()=>{layout.close();pages.close();});
  const before=[await layout.load(),await pages.load()];assert.equal(await s.change('my research','code'),true);
  const next=new CategoryIconSession(r,()=>{});await next.refresh();assert.equal(next.icon('my research','My research'),'code');
  assert.deepEqual([await layout.load(),await pages.load()],before);
  assert.equal(await next.change('my research',''),true);assert.equal(next.icon('my research','My research'),'book');
});
test('failed and uncertain icon saves retain work, show only acknowledged values and retry safely',async t=>{
  const {r}=await setup(t);let mode='FAILED',writes=0;
  const s=new CategoryIconSession({...r,save:async(rev,v)=>{writes++;if(mode==='FAILED')return {type:mode};const result=await r.save(rev,v);return mode==='UNCERTAIN'?{type:mode}:result;}},()=>{});
  await s.refresh();assert.equal(await s.change('custom','mail'),false);assert.equal(s.icon('custom','Custom'),'category');assert.ok(s.draft);
  mode='UNCERTAIN';assert.equal(await s.retry(),false);assert.equal(s.icon('custom','Custom'),'category');
  assert.equal(await s.retry(),true);assert.equal(writes,2);assert.equal(s.icon('custom','Custom'),'mail');assert.equal(s.draft,null);
});
test('concurrent icon edits cannot overwrite a newer record; conflict keeps local draft until explicit reconciliation',async t=>{
  const {r,s:a}=await setup(t),b=new CategoryIconSession(r,()=>{});await a.refresh();await b.refresh();
  await a.change('custom','book');assert.equal(await b.change('custom','code'),false);assert.equal(b.conflict,true);
  assert.equal(await b.retry(),false);assert.equal((await r.load()).value.entries[0].icon,'book');assert.equal(b.draft.entries[0].icon,'code');
  await b.useSaved();assert.equal(b.draft,null);assert.equal(b.icon('custom','Custom'),'book');
  await b.change('custom','mail');await a.refresh();assert.equal(a.icon('custom','Custom'),'mail');
});
test('unavailable icon storage does not initialize or erase data and unchanged reads are quiet',async t=>{
  const {r}=await setup(t);let fail=false,updates=0;
  const s=new CategoryIconSession({...r,load:()=>fail?Promise.reject(Error('unavailable')):r.load()},()=>updates++);
  await s.refresh();await s.change('custom','code');const before=updates;await s.refresh();await s.refresh();assert.equal(updates,before);
  fail=true;await s.refresh();assert.equal(s.failure,'UNAVAILABLE');assert.equal(await s.change('custom','book'),false);assert.equal(s.icon('custom','Custom'),'code');
  fail=false;await s.retry();assert.equal(s.failure,null);assert.equal((await r.load()).value.entries[0].icon,'code');
});

test('expanded palette has bundled symbols, accessible names and restart-safe selections',async t=>{
  const html=readFileSync(new URL('../dist/ui/index.html',import.meta.url),'utf8');
  const {r,s}=await setup(t);await s.refresh();
  assert.ok(categoryIcons.includes('brain') && categoryIcons.includes('atom'));
  for(const icon of categoryIcons){
    assert.ok(html.includes(`id="icon-${icon}"`),icon);assert.ok(categoryIconNames[icon]);
    assert.equal(await s.change('custom',icon),true);
    const restarted=new CategoryIconSession(r,()=>{});await restarted.refresh();assert.equal(restarted.icon('custom','Custom'),icon);
  }
});
