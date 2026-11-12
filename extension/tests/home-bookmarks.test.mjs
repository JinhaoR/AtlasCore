import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { BookmarkSession, readHomeBookmarks, replaceBookmarkPages, bookmarkPages, defaultBookmarkPages } from '../dist/lib/ui/home-bookmarks.js';
import { openBookmarkRepository, openHomeLayoutRepository } from '../dist/lib/ui/home-layout-storage.js';
import { pinnedDestinations } from '../dist/lib/ui/home-model.js';
const parent = 'host:research.example';
const entry = { id: parent, label: 'Research', hostname: 'research.example', hostnames: ['research.example'], category: 'Research' };
const page = (id='one', url='https://research.example/papers?q=a%2Bb&x=1#section') => ({ id, label: `Page ${id}`, url });
const value = (pages=[page()]) => ({ version: 1, groups: [{ parentId: parent, pages }] });
async function setup(t) {
  const factory = new IDBFactory(), repository = await openBookmarkRepository(factory);
  t.after(()=>repository.close()); const session = new BookmarkSession(repository); await session.refresh();
  await session.edit(parent, defaultBookmarkPages(entry)); return { factory, repository, session };
}
test('URLs retain exact path, query and fragment; reject credentials, unsupported schemes and unbounded records',()=>{
  const data=value(); assert.deepEqual(readHomeBookmarks(data),data); assert.notEqual(readHomeBookmarks(data),data);
  for(const url of ['javascript:alert(1)','file:///secret','https://name:secret@example.org/','https://example.org\\evil','https://example.org/a b','example.org','https://127.0.0.1/']) assert.equal(readHomeBookmarks(value([page('one',url)])),null,url);
  for(const bad of [value([page(),page()]), value(Array.from({length:101},(_,i)=>page(String(i)))), {...data,authority:true}, value([{...page(),label:' '}]),value([{...page(),url:'https://example.org/'+ 'a'.repeat(4096)}])]) assert.equal(readHomeBookmarks(bad),null);
});
test('seeding creates no override; successful save retains exact targets and explicit order',async t=>{
  const {session,repository}=await setup(t); assert.equal((await repository.load()).value,null);
  const pages=[page('two'),page('one')]; session.update(pages); assert.equal(session.saved.value,null);
  assert.equal(await session.save(),true); assert.deepEqual((await repository.load()).value,value(pages));
  assert.deepEqual(bookmarkPages(session.saved.value,parent,entry),pages);
});
test('rename, unpin/re-pin and disappearance retain pages; changed IDs cannot inherit them',()=>{
  const saved=value(), before=structuredClone(saved);
  assert.deepEqual(bookmarkPages(saved,parent,{...entry,label:'New label'}),saved.groups[0].pages);
  assert.deepEqual(pinnedDestinations([entry],[]),[]); assert.deepEqual(pinnedDestinations([], [parent]),[]);
  assert.equal(pinnedDestinations([entry],[parent])[0],entry);
  const other={...entry,id:'host:other.example',hostname:'other.example',hostnames:['other.example']};
  assert.deepEqual(bookmarkPages(saved,other.id,other),defaultBookmarkPages(other));assert.deepEqual(saved,before);
});
test('removing every page deletes only that override and restores ordinary entry points',()=>{
  const other={parentId:'host:other.example',pages:[page('other')]};
  const next=replaceBookmarkPages({version:1,groups:[...value().groups,other]},parent,[]);
  assert.deepEqual(next,{version:1,groups:[other]}); assert.deepEqual(bookmarkPages(next,parent,entry),defaultBookmarkPages(entry));
});
test('bookmark and category records have independent revisions and survive reopen',async t=>{
  const {factory,repository,session}=await setup(t), layout=await openHomeLayoutRepository(factory);t.after(()=>layout.close());
  const original={version:1,categories:[]}; assert.equal((await layout.save(0,original)).type,'SAVED');
  session.update([page()]);await session.save();repository.close();
  const restarted=await openBookmarkRepository(factory);t.after(()=>restarted.close());
  assert.deepEqual(await restarted.load(),{revision:1,value:value()}); assert.deepEqual(await layout.load(),{revision:1,value:original});
});
test('atomic CAS prevents two pages overwriting; explicit reconciliation preserves other parents',async t=>{
  const {factory,session:a}=await setup(t), repo=await openBookmarkRepository(factory);t.after(()=>repo.close());
  const b=new BookmarkSession(repo);await b.refresh();await b.edit('host:other.example',[]);
  a.update([page('a')]); b.update([page('b')]);assert.equal(await a.save(),true);assert.equal(await b.save(),false);
  assert.equal(b.conflict,true);assert.equal(b.dirty,true);assert.equal(await b.save(),false);
  await b.reviewLatest();assert.equal(await b.save(true),true);
  assert.deepEqual((await repo.load()).value.groups.map(g=>g.pages[0].id),['a','b']);
});
test('writes after conflict review require another reconciliation; stale review cannot overwrite',async t=>{
  const {repository,session}=await setup(t);session.update([page('local')]);
  await repository.save(0,value([page('remote')]));await session.refresh();await session.reviewLatest();
  await repository.save(1,value([page('newer')]));assert.equal(await session.save(true),false);
  assert.equal(session.conflict,true);assert.equal(session.reviewed,null);assert.equal(session.draft[0].id,'local');
  assert.equal((await repository.load()).value.groups[0].pages[0].id,'newer');
});
for(const type of ['FAILED','UNCERTAIN']) test(`${type} retains draft and acknowledged Home until retry`,async t=>{
  const {repository}=await setup(t);let fail=true;const session=new BookmarkSession({...repository,save:(...args)=>fail?Promise.resolve({type}):repository.save(...args)});
  await session.refresh();await session.edit(parent,[]);session.update([page()]);assert.equal(await session.save(),false);
  assert.equal(session.saved.value,null);assert.equal(session.dirty,true);assert.equal(session.failure,type);
  fail=false;assert.equal(await session.save(),true);assert.deepEqual(session.saved.value,value());
});
test('uncertain committed candidate reconciles without repeating write',async t=>{
  const {repository}=await setup(t);let writes=0;
  const s=new BookmarkSession({...repository,async save(...args){writes++;await repository.save(...args);return {type:'UNCERTAIN'};}});
  await s.refresh();await s.edit(parent,[]);s.update([page()]);await s.save();await s.refresh();
  assert.equal(s.dirty,false);assert.equal(s.failure,null);assert.equal(writes,1);assert.deepEqual(s.saved.value,value());
});
test('read failures retain saved data and draft, recover without overwrite; unchanged refreshes are quiet',async t=>{
  const {repository}=await setup(t);let fail=false,changes=0;
  const s=new BookmarkSession({...repository,load:()=>{if(fail)throw Error('offline');return repository.load();}},()=>changes++);
  await s.refresh();await s.edit(parent,[]);s.update([page()]);const before=changes;
  for(let i=0;i<10;i++)await s.refresh();assert.equal(changes,before);
  fail=true;await s.refresh();assert.equal(s.failure,'UNAVAILABLE');assert.deepEqual(s.draft,[page()]);
  fail=false;await s.refresh();assert.equal(s.failure,null);assert.equal(s.dirty,true);
});
test('native refresh updates a clean page editor but retains a dirty editor for comparison',async t=>{
  const {repository,session}=await setup(t);
  await repository.save(0,value([page('native')]));await session.refresh();
  assert.equal(session.dirty,false);assert.equal(session.draft[0].id,'native');
  session.update([page('local')]);await repository.save(1,value([page('newer-native')]));await session.refresh();
  assert.equal(session.conflict,true);assert.equal(session.draft[0].id,'local');
  assert.equal(await session.save(),false);
  assert.equal((await repository.load()).value.groups[0].pages[0].id,'newer-native');
});

test('corrupt records are not reset or overwritten as first run',async t=>{
  const {factory,repository}=await setup(t);
  const db=await new Promise(resolve=>{const q=factory.open('atlas-home-layout-v1');q.onsuccess=()=>resolve(q.result);});
  await new Promise(resolve=>{const tx=db.transaction('layout','readwrite');tx.objectStore('layout').put({revision:1,value:{bad:true}},'bookmarks-v1');tx.oncomplete=resolve;});db.close();
  await assert.rejects(repository.load());assert.equal((await repository.save(0,value())).type,'FAILED');
});
