import { readToolbarIcons } from '../dist/lib/bookmarks/toolbar-folders.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBDatabase } from 'fake-indexeddb';
import { BookmarkSyncOwner } from '../dist/lib/bookmarks/owner.js';
import { emptySync, readSync, mergeGroups } from '../dist/lib/bookmarks/model.js';
import { siteSearchPrefill } from '../dist/lib/ui/search-prefill.js';
import { toolbarRequest } from '../dist/lib/adapter/toolbar.js';

const page=(id='p',url='https://example.org/path?q=1#part',label='Example')=>({id,url,label});
const group=(pages=[page()])=>({id:'host:example.org',hostname:'example.org',label:'Example',pinned:true,pages});
function event(){const listeners=new Set();return {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f),emit:(...a)=>{for(const f of listeners)f(...a);},listeners};}
async function setup(t,{pins=['host:example.org'],permission=true,required=false}={}){
  const values=new Map([['atlas-home-pins-v1',JSON.stringify(pins)]]);
  const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const factory=new IDBFactory(),nodes=new Map([['root________',{id:'root________',title:'',type:'folder'}],['toolbar_____',{id:'toolbar_____',parentId:'root________',title:'Bookmarks Toolbar',type:'folder',index:0}]]);
  let serial=0,allowed=permission,failCreate=false,failUpdate=false,failAfterCreate=false;
  const events={onCreated:event(),onChanged:event(),onMoved:event(),onRemoved:event()};
  const children=id=>[...nodes.values()].filter(n=>n.parentId===id).sort((a,b)=>a.index-b.index);
  const tree=id=>{const n=nodes.get(id);if(!n)throw Error('missing');return {...n,...(!n.url?{children:children(id).map(c=>tree(c.id))}:{})};};
  const bookmarks={...events,
    async get(id){if(!nodes.has(id))throw Error('missing');return [{...nodes.get(id)}];},
    async getChildren(id){return children(id).map(n=>({...n}));},async getSubTree(id){return [tree(id)];},async getTree(){return [tree('root________')];},
    async create(v){if(failCreate)throw Error('storage');const id=`n${++serial}`,n={...v,id,index:v.index??children(v.parentId).length,type:v.url?'bookmark':'folder'};nodes.set(id,n);events.onCreated.emit(id,{...n});if(failAfterCreate){failAfterCreate=false;throw Error('lost acknowledgement');}return {...n};},
    async update(id,v){if(failUpdate)throw Error('storage');Object.assign(nodes.get(id),v);events.onChanged.emit(id,v);return {...nodes.get(id)};},
    async move(id,v){const n=nodes.get(id),oldParentId=n.parentId;const peers=children(v.parentId).filter(p=>p.id!==id),index=v.index??peers.length;peers.splice(index,0,n);peers.forEach((p,i)=>p.index=i);n.parentId=v.parentId;events.onMoved.emit(id,{...n,oldParentId});return {...n};},
    async remove(id){const n=nodes.get(id);nodes.delete(id);events.onRemoved.emit(id,{parentId:n.parentId,node:n});},
  };
  const api={bookmarks,runtime:{id:'atlas',getManifest:()=>({permissions:required?['bookmarks']:[]}),getURL:p=>`moz-extension://fixture/${p}`,onMessage:event()},permissions:{contains:async()=>allowed,onAdded:event(),onRemoved:event()}};
  let owner=new BookmarkSyncOwner(api,storage,factory,()=>`token-${++serial}`);await owner.start();
  const sender={id:'atlas',url:api.runtime.getURL('ui/index.html'),frameId:0};
  const send=async(c,s=sender)=>{for(const listener of api.runtime.onMessage.listeners){const r=listener(c,s);if(r!==false)return await r;}return undefined;};
  const read=()=>send({kind:'PRESENTATION_READ'});
  const flush=async()=>{await owner.run(async()=>{});await owner.run(async()=>{});};
  const connect=async(root=null)=>{const p=await send({kind:'SYNC_PREVIEW',root});assert.ok(p.preview,JSON.stringify(p));const r=await send({kind:'SYNC_CONNECT',token:p.preview.token});assert.equal(r.error,undefined,JSON.stringify(r));await flush();return read();};
  t.after(()=>owner.dispose());
  return {send,read,connect,flush,api,nodes,storage,factory,
    setPermission:async v=>{allowed=v;api.permissions[v?'onAdded':'onRemoved'].emit({permissions:['bookmarks']});await flush();},
    failCreate:v=>{failCreate=v;},failUpdate:v=>{failUpdate=v;},
    failAfterCreate:()=>{failAfterCreate=true;},
    restart:async()=>{owner.dispose();owner=new BookmarkSyncOwner(api,storage,factory);await owner.start();await flush();},
    root:()=>[...nodes.values()].find(n=>n.title==='Atlas')?.id,
    folder:()=>[...nodes.values()].find(n=>n.parentId===[...nodes.values()].find(n=>n.title==='Atlas')?.id&&!n.url),
  };
}
test('site search prefill distinguishes a name from an exact URL without guessing',()=>{
  assert.deepEqual(siteSearchPrefill(' Zotero '),{name:'Zotero',hostname:''});
  assert.deepEqual(siteSearchPrefill('https://example.org/path?q=1'),{name:'https://example.org/path?q=1',hostname:'example.org'});
  assert.equal(siteSearchPrefill('user:pass@example.org').hostname,'');
  assert.equal(siteSearchPrefill('example.org').hostname,'example.org');
});
test('popup request allowlist excludes authority commands and malformed context',()=>{
  assert.ok(toolbarRequest({kind:'GET_TOOLBAR_STATUS',tabId:4}));
  assert.ok(toolbarRequest({kind:'OPEN_CONTROL_PAGE',page:'home',tabId:4,contextId:null}));
  for(const v of [{kind:'CONFIRM_ACCESS',requestId:1},{kind:'GET_TOOLBAR_STATUS',tabId:-1},{kind:'OPEN_CONTROL_PAGE',page:'home',tabId:4,contextId:null,policy:{}},null])assert.equal(toolbarRequest(v),false);
});
test('sync record validates bounded independent presentation state',()=>{
  assert.deepEqual(readSync(emptySync()),emptySync());assert.equal(readSync({...emptySync(),groups:[{...group(),pages:[page('p','javascript:alert(1)')]}]}),null);
  assert.equal(readSync({...emptySync(),groups:[group(),group()]}),null);
});
test('three-way merge combines independent page fields but rejects overlapping edits',()=>{
  const b=[group()],l=structuredClone(b),r=structuredClone(b);l[0].pages[0].label='New title';r[0].pages[0].url='https://example.org/new?q=x#y';
  assert.deepEqual(mergeGroups(b,l,r)[0].pages[0],{...r[0].pages[0],label:'New title'});
  r[0].pages[0].label='Different title';assert.equal(mergeGroups(b,l,r),null);
});
test('three-way merge preserves independent insertions and detects delete versus edit',()=>{
  const b=[group()],l=[group([])],r=[group([{...page(),label:'Changed'}])];assert.equal(mergeGroups(b,l,r),null);
  assert.equal(mergeGroups(b,[group([page(),page('two')])],[group([page(),page('three')])])[0].pages.length,3);
});
test('only trusted top-level UI may issue presentation commands',async t=>{
  const f=await setup(t);for(const sender of [{id:'atlas',url:'https://example.org'},{id:'atlas',url:f.api.runtime.getURL('ui/popup.html')},{id:'atlas',url:f.api.runtime.getURL('ui/index.html'),frameId:1}])assert.equal(await f.send({kind:'PIN_SET',id:'host:evil.test',pinned:true,hosts:[]},sender),undefined);
  assert.deepEqual((await f.read()).pins,['host:example.org']);
});
test('permission denied leaves existing pins and saved pages usable',async t=>{
  const f=await setup(t,{permission:false});assert.equal((await f.send({kind:'SYNC_SETUP'})).permission,false);
  assert.equal((await f.send({kind:'BOOKMARK_SAVE',revision:0,value:{version:1,groups:[{parentId:'host:example.org',pages:[page()]}]}})).type,'SAVED');
  assert.deepEqual((await f.read()).bookmarks.value.groups[0].pages,[page()]);assert.equal(f.root(),undefined);
});
test('initial merge exports pins once and preserves exact URLs through restart',async t=>{
  const f=await setup(t);await f.send({kind:'BOOKMARK_SAVE',revision:0,value:{version:1,groups:[{parentId:'host:example.org',pages:[page()]}]}});
  const r=await f.connect();assert.equal(r.sync.issue,'NONE');assert.equal(r.sync.enabled,true);
  assert.ok([...f.nodes.values()].some(n=>n.url===page().url));const count=f.nodes.size;await f.restart();assert.equal(f.nodes.size,count);assert.equal((await f.read()).sync.issue,'NONE');
});
test('Firefox title and URL changes reach Atlas without changing any policy storage',async t=>{
  const f=await setup(t);await f.connect();const folder=f.folder(),p=[...f.nodes.values()].find(n=>n.parentId===folder.id&&n.url);
  await f.api.bookmarks.update(p.id,{title:'Reading',url:'https://unknown.test/full?a=1#read'});await f.flush();
  const r=await f.read();assert.equal(r.bookmarks.value.groups[0].pages[0].url,'https://unknown.test/full?a=1#read');
  assert.equal(f.storage.getItem('atlas-authority-v1'),null);
});
test('Atlas page edits update Firefox and stale editor revisions cannot overwrite',async t=>{
  const f=await setup(t);await f.connect();const before=await f.read();const value=structuredClone(before.bookmarks.value);value.groups[0].pages[0].label='Edited here';
  assert.equal((await f.send({kind:'BOOKMARK_SAVE',revision:before.bookmarks.revision,value})).type,'SAVED');await f.flush();
  assert.ok([...f.nodes.values()].some(n=>n.title==='Edited here'));
  assert.equal((await f.send({kind:'BOOKMARK_SAVE',revision:before.bookmarks.revision,value:before.bookmarks.value})).type,'CONFLICT');
});
test('unpin archives, repin restores same group and native moves out unpin',async t=>{
  const f=await setup(t);await f.connect();const folder=f.folder();
  await f.send({kind:'PIN_SET',id:'host:example.org',pinned:false,hosts:[]});await f.flush();
  assert.equal((await f.read()).pins.length,0);assert.equal(f.nodes.get(folder.id).parentId,[...f.nodes.values()].find(n=>n.title==='Atlas — Unpinned').id);
  await f.send({kind:'PIN_SET',id:'host:example.org',pinned:true,hosts:[]});await f.flush();assert.equal(f.folder().id,folder.id);
  await f.api.bookmarks.move(folder.id,{parentId:'toolbar_____'});await f.flush();assert.equal((await f.read()).pins.length,0);
});
test('direct native bookmark imports as a gated presentation-only unknown site',async t=>{
  const f=await setup(t,{pins:[]});await f.connect();const p=await f.api.bookmarks.create({parentId:f.root(),title:'Unknown',url:'https://new.test/page?q=1#x'});await f.flush();
  const r=await f.read();assert.deepEqual(r.pins,['host:new.test']);assert.equal(r.sync.issue,'NONE');assert.equal(f.nodes.get(p.id).url,'https://new.test/page?q=1#x');
});

test('Firefox GUID underscores encode into stable valid Atlas page IDs',async t=>{
 const f=await setup(t,{pins:[]});await f.connect();
 const id='Ab_cd-Ef__12',node={id,parentId:f.root(),title:'Native GUID',url:'https://guid.example/page',index:0,type:'bookmark'};
 f.nodes.set(id,node);f.api.bookmarks.onCreated.emit(id,node);await f.flush();
 const before=await f.read();assert.equal(before.sync.issue,'NONE');
 const page=before.bookmarks.value.groups[0].pages[0];assert.equal(page.id,'firefox:Ab.cd-Ef..12');
 assert.equal(f.nodes.get(id).url,page.url);await f.restart();assert.deepEqual((await f.read()).bookmarks,before.bookmarks);
 await f.api.bookmarks.update(id,{title:'Updated'});await f.flush();
 assert.equal((await f.read()).bookmarks.value.groups[0].pages[0].id,page.id);
});
test('deleting final native page unpins without resurrecting default links',async t=>{
  const f=await setup(t);await f.connect();const p=[...f.nodes.values()].find(n=>n.url);await f.api.bookmarks.remove(p.id);await f.flush();
  assert.deepEqual((await f.read()).pins,[]);await f.restart();assert.equal([...f.nodes.values()].filter(n=>n.url).length,0);
});
test('deleted root pauses; no silent recreation, permission revocation preserves both copies',async t=>{
  const f=await setup(t);await f.connect();await f.setPermission(false);assert.equal((await f.read()).sync.issue,'PERMISSION');
  await f.setPermission(true);await f.api.bookmarks.remove(f.root());await f.flush();assert.equal((await f.read()).sync.issue,'ROOT_MISSING');assert.equal(f.root(),undefined);await f.restart();assert.equal(f.root(),undefined);
});
test('native write failure retains recoverable intent; retry does not duplicate',async t=>{
  const f=await setup(t);f.failCreate(true);const p=await f.send({kind:'SYNC_PREVIEW',root:null});
  assert.ok((await f.send({kind:'SYNC_CONNECT',token:p.preview.token})).error);assert.equal((await f.read()).sync.pending,true);
  f.failCreate(false);await f.send({kind:'SYNC_RETRY'});await f.flush();assert.equal((await f.read()).sync.issue,'NONE');assert.equal([...f.nodes.values()].filter(n=>n.title==='Atlas').length,1);
});
test('unsupported nested bookmarks remain in Firefox and are disclosed',async t=>{
  const f=await setup(t,{pins:[]});const root=await f.api.bookmarks.create({parentId:'toolbar_____',title:'Chosen'});const nested=await f.api.bookmarks.create({parentId:root.id,title:'Nested'});const deeper=await f.api.bookmarks.create({parentId:nested.id,title:'Deeper'});await f.api.bookmarks.create({parentId:deeper.id,title:'Do not flatten',url:'https://keep.test/'});
  const p=await f.send({kind:'SYNC_PREVIEW',root:root.id});assert.ok(p.preview.warnings.length);await f.send({kind:'SYNC_CONNECT',token:p.preview.token});assert.ok([...f.nodes.values()].some(n=>n.title==='Do not flatten'));
});

test('unknown native create outcome is reconciled on restart without duplicate folders',async t=>{
 const f=await setup(t);f.failAfterCreate();const p=await f.send({kind:'SYNC_PREVIEW',root:null});
 await f.send({kind:'SYNC_CONNECT',token:p.preview.token});await f.restart();
 const v=await f.read();assert.equal(v.sync.issue,'NONE');assert.equal(v.sync.pending,false);
 assert.equal([...f.nodes.values()].filter(n=>n.title==='Atlas').length,1);
 assert.equal([...f.nodes.values()].filter(n=>n.url).length,1);
});
test('initial duplicate site folders pause without discarding either copy',async t=>{
 const f=await setup(t,{pins:[]});const root=await f.api.bookmarks.create({parentId:'toolbar_____',title:'Explicitly selected'});
 for(const title of ['First','Second']){const folder=await f.api.bookmarks.create({parentId:root.id,title});await f.api.bookmarks.create({parentId:folder.id,title:'Page',url:'https://example.org/'});}
 assert.ok((await f.send({kind:'SYNC_PREVIEW',root:root.id})).error);assert.equal((await f.read()).sync.issue,'DUPLICATE');
 assert.equal([...f.nodes.values()].filter(n=>n.url).length,2);assert.deepEqual((await f.read()).pins,[]);
});
test('external edits during an Atlas page save conflict without replacing the editor candidate',async t=>{
 const f=await setup(t);await f.connect();const old=await f.read();const desired=structuredClone(old.bookmarks.value);desired.groups[0].pages[0].label='Atlas edit';
 const native=[...f.nodes.values()].find(n=>n.url);native.title='Concurrent Firefox edit'; // Actual browser state changes before its notification is processed.
 const result=await f.send({kind:'BOOKMARK_SAVE',revision:old.bookmarks.revision,value:desired});
 assert.ok(result.error);assert.equal((await f.read()).sync.issue,'CONFLICT');assert.equal(native.title,'Concurrent Firefox edit');
 assert.equal(desired.groups[0].pages[0].label,'Atlas edit');
 const compare=await f.send({kind:'SYNC_COMPARE'});native.title='Newer change';
 assert.equal((await f.send({kind:'SYNC_RESOLVE',side:'ATLAS',token:compare.comparison.token})).error,'COMPARISON_CHANGED');
});
test('independent Atlas URL and Firefox title edits merge',async t=>{
 const f=await setup(t);await f.connect();const old=await f.read(),desired=structuredClone(old.bookmarks.value);
 desired.groups[0].pages[0].url='https://example.org/changed?exact=%2B#fragment';const native=[...f.nodes.values()].find(n=>n.url);native.title='Firefox label';
 assert.equal((await f.send({kind:'BOOKMARK_SAVE',revision:old.bookmarks.revision,value:desired})).type,'SAVED');
 const p=(await f.read()).bookmarks.value.groups[0].pages[0];assert.equal(p.label,'Firefox label');assert.equal(p.url,desired.groups[0].pages[0].url);
});
test('Atlas deleting the final connected page empties and unpins instead of recreating a default link',async t=>{
 const f=await setup(t);await f.connect();const old=await f.read();
 assert.equal((await f.send({kind:'BOOKMARK_SAVE',revision:old.bookmarks.revision,value:{version:1,groups:[]}})).type,'SAVED');await f.flush();
 assert.deepEqual((await f.read()).pins,[]);assert.equal([...f.nodes.values()].filter(n=>n.url).length,0);
 await f.restart();assert.equal([...f.nodes.values()].filter(n=>n.url).length,0);
});
test('pin order and shortcut labels use comparison guards across control pages',async t=>{
 const f=await setup(t,{pins:['host:example.org','host:other.example']});await f.connect();const old=await f.read();
 const reverse=[...old.pins].reverse();assert.equal((await f.send({kind:'PIN_ORDER',before:old.pins,pins:reverse})).error,undefined);
 assert.equal((await f.send({kind:'PIN_ORDER',before:old.pins,pins:old.pins})).error,'CONFLICT');
 const id=old.pins[0],before=old.sync.labels[id];await f.send({kind:'PIN_LABEL',id,before,label:'Shortcuts'});
 assert.equal((await f.send({kind:'PIN_LABEL',id,before,label:'Stale'})).error,'CONFLICT');
 assert.equal((await f.read()).sync.labels[id],'Shortcuts');
});
test('disconnect stops unfinished work and leaves local page editing usable',async t=>{
 const f=await setup(t);f.failCreate(true);const p=await f.send({kind:'SYNC_PREVIEW',root:null});await f.send({kind:'SYNC_CONNECT',token:p.preview.token});
 await f.send({kind:'SYNC_DISABLE'});const old=await f.read();assert.equal(old.sync.pending,false);
 assert.equal((await f.send({kind:'BOOKMARK_SAVE',revision:old.bookmarks.revision,value:{version:1,groups:[{parentId:'host:example.org',pages:[page()]}]}})).type,'SAVED');
 f.failCreate(false);await f.restart();assert.equal(f.root(),undefined);
});
test('events outside the connected library do not write presentation records',async t=>{
 const f=await setup(t);await f.connect();const before=await f.read();
 await f.api.bookmarks.create({parentId:'toolbar_____',title:'Unrelated',url:'https://outside.example/'});await f.flush();
 assert.deepEqual(await f.read(),before);
});
test('failed intent persistence performs no native mutations and can be retried',async t=>{
 const f=await setup(t);const preview=await f.send({kind:'SYNC_PREVIEW',root:null});
 const original=IDBDatabase.prototype.transaction;let fail=true;
 IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);if(fail&&args[1]==='readwrite')queueMicrotask(()=>tx.abort());return tx;};
 t.after(()=>{IDBDatabase.prototype.transaction=original;});
 const before=f.nodes.size;assert.ok((await f.send({kind:'SYNC_CONNECT',token:preview.preview.token})).error);assert.equal(f.nodes.size,before);
 fail=false;await f.connect();assert.equal((await f.read()).sync.issue,'NONE');
});
test('incomplete journals and malformed external-operation fields fail validation',()=>{
 const pending={target:[group()],nativeBefore:[],pinsBefore:[],bookmarkRevision:0,bookmarksCandidate:{version:1,groups:[]}};
 const valid={...emptySync(),pending,mutation:{kind:'create',id:null,parentId:'toolbar_____',title:'Atlas',url:null,index:null,before:null,children:[],result:'root'}};
 assert.ok(readSync(valid));
 for(const altered of [{...valid,pending:{...pending,bookmarksCandidate:{}}},{...valid,pending:undefined},{...valid,mutation:{...valid.mutation,result:'arbitrary'}},{...valid,mutation:{...valid.mutation,kind:'move'}},{...valid,mutation:{...valid.mutation,before:{}}}])assert.equal(readSync(altered),null);
});
test('an overlapping native update during an API call retains both values for explicit reconciliation',async t=>{
 const f=await setup(t);await f.connect();const before=await f.read(),value=structuredClone(before.bookmarks.value);value.groups[0].pages[0].label='Atlas candidate';
 const update=f.api.bookmarks.update;let raced=false;
 f.api.bookmarks.update=async(id,v)=>{if(!raced){raced=true;await update(id,{title:'Other window during write'});}return update(id,v);};
 assert.ok((await f.send({kind:'BOOKMARK_SAVE',revision:before.bookmarks.revision,value})).error);await f.flush();
 assert.equal((await f.read()).sync.issue,'CONFLICT');assert.equal((await f.send({kind:'SYNC_RETRY'})).error,'COMPARE_REQUIRED');
 const {comparison}=await f.send({kind:'SYNC_COMPARE'});
 assert.equal(comparison.local[0].pages[0].label,'Atlas candidate');assert.equal(comparison.remote[0].pages[0].label,'Other window during write');
 assert.equal((await f.send({kind:'SYNC_RESOLVE',side:'FIREFOX',token:comparison.token})).error,undefined);
 assert.equal((await f.read()).bookmarks.value.groups[0].pages[0].label,'Other window during write');
});

const toolbarConnect=async f=>{const r=await f.send({kind:'SYNC_TOOLBAR'});assert.equal(r.error,undefined,JSON.stringify(r));await f.flush();assert.equal((await f.read()).sync.issue,'NONE');return f.read();};
test('toolbar one-click union preserves folders and native exact URLs without preview',async t=>{
 const f=await setup(t);const folder=await f.api.bookmarks.create({parentId:'toolbar_____',title:'Personal'});
 const nested=await f.api.bookmarks.create({parentId:folder.id,title:'Private',url:'https://nested.test/page'});
 const native=await f.api.bookmarks.create({parentId:'toolbar_____',title:'Research',url:'https://unknown.test/path?q=1#x'});
 await toolbarConnect(f);assert.equal(f.nodes.get(nested.id).parentId,folder.id);assert.equal(f.root(),undefined);
 const r=await f.read();assert.equal(r.sync.scope,'toolbar');assert.deepEqual(r.pins,['host:unknown.test','host:example.org']);
 assert.equal(r.bookmarks.value.groups[0].pages[0].url,native.url);const count=f.nodes.size;await f.restart();assert.equal(f.nodes.size,count);assert.equal((await f.read()).sync.issue,'NONE');
});
test('toolbar unpin deletes only synchronized direct bookmarks, repin restores saved pages',async t=>{
 const f=await setup(t);await toolbarConnect(f);const before=await f.read();const p=[...f.nodes.values()].find(n=>n.url);
 const folder=await f.api.bookmarks.create({parentId:'toolbar_____',title:'Keep'});const nested=await f.api.bookmarks.create({parentId:folder.id,title:'Keep',url:p.url});await f.flush();
 await f.send({kind:'PIN_SET',id:'host:example.org',pinned:false,hosts:[]});await f.flush();assert.equal(f.nodes.has(p.id),false);assert.ok(f.nodes.has(nested.id));assert.deepEqual((await f.read()).pins,[]);
 assert.deepEqual((await f.read()).bookmarks.value,before.bookmarks.value);
 await f.send({kind:'PIN_SET',id:'host:example.org',pinned:true,hosts:[]});await f.flush();assert.equal((await f.read()).sync.issue,'NONE');assert.equal([...f.nodes.values()].filter(n=>n.url&&n.parentId==='toolbar_____').length,1);
});
test('toolbar edits, deletion and move into a folder reconcile without resurrecting bookmarks',async t=>{
 const f=await setup(t);await toolbarConnect(f);const p=[...f.nodes.values()].find(n=>n.url);await f.api.bookmarks.update(p.id,{title:'Renamed',url:'https://elsewhere.test/private?q=1#x'});await f.flush();
 let r=await f.read();assert.equal(r.sync.issue,'NONE');assert.equal(r.sync.groups[0].label,'Renamed');assert.equal(r.bookmarks.value.groups[0].pages[0].url,'https://elsewhere.test/private?q=1#x');
 const folder=await f.api.bookmarks.create({parentId:'toolbar_____',title:'Keep'});await f.api.bookmarks.move(p.id,{parentId:folder.id});await f.flush();assert.deepEqual((await f.read()).pins,[]);assert.equal(f.nodes.get(p.id).parentId,folder.id);
 await f.restart();assert.deepEqual((await f.read()).pins,[]);assert.equal(f.nodes.get(p.id).parentId,folder.id);
});
test('toolbar local page edits use CAS and unknown creates reconcile once across restart',async t=>{
 const f=await setup(t);f.failAfterCreate();await f.send({kind:'SYNC_TOOLBAR'});await f.flush();await f.restart();assert.equal((await f.read()).sync.issue,'NONE');assert.equal([...f.nodes.values()].filter(n=>n.url).length,1);
 const before=await f.read(),value=structuredClone(before.bookmarks.value);value.groups[0].pages[0].label='Edited';
 assert.equal((await f.send({kind:'BOOKMARK_SAVE',revision:before.bookmarks.revision,value})).type,'SAVED');await f.flush();assert.equal((await f.read()).sync.issue,'NONE');assert.ok([...f.nodes.values()].some(n=>n.title==='Edited'));
 assert.equal((await f.send({kind:'BOOKMARK_SAVE',revision:before.bookmarks.revision,value:before.bookmarks.value})).type,'CONFLICT');
});
test('toolbar connection from legacy folder keeps the old folder and its contents',async t=>{
 const f=await setup(t);await f.connect();const old=f.folder(),oldNodes=[...f.nodes.values()].filter(n=>n.parentId===old.id);
 await toolbarConnect(f);assert.deepEqual(f.nodes.get(old.id),old);for(const n of oldNodes)assert.deepEqual(f.nodes.get(n.id),n);
 assert.equal((await f.read()).sync.scope,'toolbar');assert.ok([...f.nodes.values()].some(n=>n.url&&n.parentId==='toolbar_____'));
});
test('toolbar permission denial, revocation and disconnect retain both copies without policy writes',async t=>{
 const f=await setup(t,{permission:false});await f.send({kind:'SYNC_TOOLBAR'});assert.equal([...f.nodes.values()].some(n=>n.url),false);await f.setPermission(true);await toolbarConnect(f);
 const before=await f.read();await f.setPermission(false);assert.equal((await f.read()).sync.issue,'PERMISSION');await f.send({kind:'SYNC_DISABLE'});await f.setPermission(true);await f.flush();assert.deepEqual((await f.read()).pins,before.pins);assert.equal(f.storage.getItem('atlas-authority-v1'),null);
});

test('toolbar initial merge deduplicates matched URLs but preserves deliberate native duplicates',async t=>{
 const f=await setup(t);await f.send({kind:'BOOKMARK_SAVE',revision:0,value:{version:1,groups:[{parentId:'host:example.org',pages:[page()]}]}});
 const a=await f.api.bookmarks.create({parentId:'toolbar_____',title:'First name',url:page().url});const b=await f.api.bookmarks.create({parentId:'toolbar_____',title:'Second name',url:page().url});
 await toolbarConnect(f);assert.equal([...f.nodes.values()].filter(n=>n.url).length,2);assert.ok(f.nodes.has(a.id)&&f.nodes.has(b.id));assert.equal((await f.read()).bookmarks.value.groups[0].pages.length,2);
});
test('toolbar ordering reuses native IDs and leaves folder contents intact',async t=>{
 const f=await setup(t,{pins:['host:first.test','host:second.test']});await toolbarConnect(f);const before=await f.read(),ids=[...f.nodes.values()].filter(n=>n.url).map(n=>n.id);
 const folder=await f.api.bookmarks.create({parentId:'toolbar_____',title:'My folder'});await f.flush();
 await f.send({kind:'PIN_ORDER',before:before.pins,pins:[...before.pins].reverse()});await f.flush();assert.equal((await f.read()).sync.issue,'NONE');
 assert.deepEqual((await f.api.bookmarks.getChildren('toolbar_____')).filter(n=>n.url).map(n=>n.id),ids.reverse());assert.ok(f.nodes.has(folder.id));
});
test('toolbar conflict during a native update preserves both versions for explicit review',async t=>{
 const f=await setup(t);await toolbarConnect(f);const before=await f.read(),value=structuredClone(before.bookmarks.value);value.groups[0].pages[0].label='Atlas candidate';
 const update=f.api.bookmarks.update;let raced=false;f.api.bookmarks.update=async(id,v)=>{if(!raced){raced=true;await update(id,{title:'Other window'});}return update(id,v);};
 assert.ok((await f.send({kind:'BOOKMARK_SAVE',revision:before.bookmarks.revision,value})).error);await f.flush();assert.equal((await f.read()).sync.issue,'CONFLICT');
 const {comparison}=await f.send({kind:'SYNC_COMPARE'});assert.equal(comparison.remote[0].pages[0].label,'Other window');assert.equal(comparison.local[0].pages[0].label,'Atlas candidate');
 assert.equal((await f.send({kind:'SYNC_RESOLVE',side:'FIREFOX',token:comparison.token})).error,undefined);assert.equal((await f.read()).bookmarks.value.groups[0].pages[0].label,'Other window');
});
test('toolbar invalid schemes and nested events never create authority or rewrite external folders',async t=>{
 const f=await setup(t);const folder=await f.api.bookmarks.create({parentId:'toolbar_____',title:'Private'});const unsupported=await f.api.bookmarks.create({parentId:'toolbar_____',title:'Internal',url:'about:config'});
 await toolbarConnect(f);const before=await f.read();await f.api.bookmarks.create({parentId:folder.id,title:'Ignore',url:'https://ignored.example/'});await f.flush();assert.equal((await f.read()).sync.revision,before.sync.revision);assert.equal(f.nodes.get(unsupported.id).url,'about:config');
});
test('toolbar journal persistence failure precedes every native change',async t=>{
 const f=await setup(t);const original=IDBDatabase.prototype.transaction;let fail=true;
 IDBDatabase.prototype.transaction=function(names,mode,...rest){if(fail&&mode==='readwrite')throw Error('write unavailable');return original.call(this,names,mode,...rest);};
 try{const before=[...f.nodes.values()].map(n=>({...n}));await f.send({kind:'SYNC_TOOLBAR'});assert.deepEqual([...f.nodes.values()],before);fail=false;await toolbarConnect(f);}finally{IDBDatabase.prototype.transaction=original;}
});

test('renaming a disconnected or permission-revoked toolbar pin never writes Firefox',async t=>{
 const f=await setup(t);await toolbarConnect(f);await f.send({kind:'SYNC_DISABLE'});const before=[...f.nodes.values()].map(n=>({...n})),r=await f.read();
 await f.send({kind:'PIN_LABEL',id:'host:example.org',before:r.sync.labels['host:example.org'],label:'Offline label'});assert.deepEqual([...f.nodes.values()],before);
 await toolbarConnect(f);await f.setPermission(false);const current=await f.read(),nodes=[...f.nodes.values()].map(n=>({...n}));
 await f.send({kind:'PIN_LABEL',id:'host:example.org',before:current.sync.labels['host:example.org'],label:'No permission'});assert.deepEqual([...f.nodes.values()],nodes);
});

test('unnamed and whitespace toolbar titles get readable labels without blocking connection',async t=>{
 const f=await setup(t,{pins:[]});await f.api.bookmarks.create({parentId:'toolbar_____',title:'',url:'https://unnamed.test/path'});await f.api.bookmarks.create({parentId:'toolbar_____',title:'  Research  ',url:'https://research.test/path'});
 await toolbarConnect(f);assert.deepEqual((await f.read()).sync.groups.map(g=>g.label),['unnamed.test','Research']);
});

test('multi-page toolbar group keeps its Atlas label without renaming Firefox pages',async t=>{
 const f=await setup(t);await f.send({kind:'BOOKMARK_SAVE',revision:0,value:{version:1,groups:[{parentId:'host:example.org',pages:[page(),page('two','https://example.org/second','Second')]}]}});await toolbarConnect(f);
 const before=await f.read(),titles=[...f.nodes.values()].filter(n=>n.url).map(n=>n.title);
 const response=await f.send({kind:'PIN_LABEL',id:'host:example.org',before:before.sync.labels['host:example.org'],label:'My reading'});assert.equal(response.error,undefined);await f.flush();assert.equal((await f.read()).sync.issue,'NONE');assert.equal((await f.read()).sync.labels['host:example.org'],'My reading');assert.deepEqual([...f.nodes.values()].filter(n=>n.url).map(n=>n.title),titles);
});


test('required permission connects the toolbar on startup and respects explicit disconnect on restart',async t=>{
  const f=await setup(t,{required:true});
  const first=await f.read();assert.equal(first.sync.enabled,true);assert.equal(first.sync.scope,'toolbar');
  assert.equal([...f.nodes.values()].filter(n=>n.url).length,1);
  await f.restart();assert.equal([...f.nodes.values()].filter(n=>n.url).length,1);
  await f.send({kind:'SYNC_DISABLE'});await f.restart();assert.equal((await f.read()).sync.enabled,false);
});
test('required permission does not synthesize consent when Firefox withholds it',async t=>{
  const f=await setup(t,{required:true,permission:false});assert.equal((await f.read()).sync.enabled,false);
  assert.equal([...f.nodes.values()].filter(n=>n.url).length,0);
  await f.setPermission(true);assert.equal((await f.read()).sync.enabled,true);
});
test('toolbar folders mirror nested exact pages without modifying native folders; icon edits use conflict checks',async t=>{
  const f=await setup(t,{required:true});
  const folder=await f.api.bookmarks.create({parentId:'toolbar_____',title:'Research'});
  const nested=await f.api.bookmarks.create({parentId:folder.id,title:'Notes'});
  const bookmark=await f.api.bookmarks.create({parentId:nested.id,title:'Exact note',url:'https://unlisted.example/path?q=1#part'});
  await f.api.bookmarks.create({parentId:folder.id,title:'Unsupported',url:'javascript:alert(1)'});
  await f.flush();const native=JSON.stringify([...f.nodes]);let r=await f.read();
  assert.deepEqual(r.sync.folders[0].pages.map(p=>[p.label,p.url]),[['Notes / Exact note','https://unlisted.example/path?q=1#part']]);
  assert.ok(!r.pins.includes('host:unlisted.example'));
  assert.equal((await f.send({kind:'FOLDER_ICON',id:folder.id,before:'',icon:'brain'})).sync.folderIcons[folder.id],'brain');
  assert.equal((await f.send({kind:'FOLDER_ICON',id:folder.id,before:'',icon:'brain'})).sync.folderIcons[folder.id],'brain');
  assert.equal((await f.send({kind:'FOLDER_ICON',id:folder.id,before:'',icon:'atom'})).error,'CONFLICT');
  await f.restart();assert.equal((await f.read()).sync.folderIcons[folder.id],'brain');assert.equal(JSON.stringify([...f.nodes]),native);
  await f.api.bookmarks.update(bookmark.id,{title:'Changed'});await f.flush();assert.equal((await f.read()).sync.folders[0].pages[0].label,'Notes / Changed');
  await f.api.bookmarks.move(folder.id,{parentId:'root________'});await f.flush();assert.equal((await f.read()).sync.folders.length,0);
});
test('folder icon state rejects arbitrary markup and remains compatible with legacy records',()=>{
  assert.ok(readSync(emptySync()));assert.deepEqual(readToolbarIcons({native:'brain'}),{native:'brain'});assert.equal(readSync({...emptySync(),folderIcons:{native:'brain'}}),null);
  assert.equal(readToolbarIcons({native:'<script>'}),null);
});


test('failed folder-icon persistence leaves the saved icon and bookmark synchronization intact, then retries',async t=>{
  const f=await setup(t,{required:true});const folder=await f.api.bookmarks.create({parentId:'toolbar_____',title:'Notes'});await f.flush();
  const before=JSON.stringify([...f.nodes]);const transaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(names,mode,...args){if(mode==='readwrite')throw Error('unavailable');return transaction.call(this,names,mode,...args);};
  try {
    const failed=await f.send({kind:'FOLDER_ICON',id:folder.id,before:'',icon:'brain'});assert.equal(failed.error,'FAILED');
    const saved=await f.read();assert.equal(saved.sync.folderIcons[folder.id],undefined);assert.equal(saved.sync.issue,'NONE');
    assert.equal(JSON.stringify([...f.nodes]),before);
  } finally {IDBDatabase.prototype.transaction=transaction;}
  assert.equal((await f.send({kind:'FOLDER_ICON',id:folder.id,before:'',icon:'brain'})).sync.folderIcons[folder.id],'brain');
});
