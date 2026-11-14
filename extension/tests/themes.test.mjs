import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { themeId, themeIds, themeKey, readTheme, saveTheme, initializeTheme } from '../dist/lib/ui/theme.js';

function fixture() {
  let value=null, failure=false, uncertain=false, writes=0;
  const storage={getItem(){if(uncertain)throw Error();return value;},setItem(_k,v){writes++;if(failure)throw Error();value=v;}};
  const events=()=>({listeners:new Map(),addEventListener(k,f){this.listeners.set(k,f);},removeEventListener(k){this.listeners.delete(k);},fire(k,e={}){this.listeners.get(k)?.(e);}});
  const select={id:'atlas-theme',value:'default'},status={textContent:''},retry={hidden:true};
  const doc={...events(),documentElement:{dataset:{}},getElementById(id){return {'atlas-theme':select,'theme-save-status':status,'theme-retry':retry}[id]??null;}};
  const win={...events(),localStorage:storage};
  return {doc,win,select,status,retry,storage,writes:()=>writes,fail(v){failure=v;},uncertain(v){uncertain=v;},set(v){value=v;},choose(v){select.value=v;doc.fire('change',{target:select});}};
}
test('only bundled theme IDs are accepted; invalid or unavailable saved data safely uses default',()=>{
  for(const v of [null,undefined,{},'https://x','url(x)','<style>','unknown'])assert.equal(themeId(v),'default');
  assert.equal(themeId('light-test'),'light-test');
  assert.deepEqual(readTheme(()=>{throw Error();}),{theme:'default',available:false});
  const f=fixture();assert.equal(saveTheme(()=>f.storage,'not-bundled'),'FAILED');assert.equal(f.writes(),0);
});
test('theme changes only the root attribute and its one presentation preference; restart restores it',()=>{
  const f=fixture();const stop=initializeTheme(f.doc,f.win);f.choose('light-test');
  assert.equal(f.doc.documentElement.dataset.theme,'light-test');assert.equal(f.storage.getItem(themeKey),'light-test');
  assert.equal(f.writes(),1);stop();initializeTheme(f.doc,f.win);
  assert.equal(f.select.value,'light-test');assert.equal(f.writes(),1);
});
test('failed and uncertain saves retain the choice without applying it; explicit retry can save',()=>{
  const f=fixture();initializeTheme(f.doc,f.win);f.fail(true);f.choose('light-test');
  assert.equal(f.doc.documentElement.dataset.theme,'default');assert.equal(f.select.value,'light-test');
  assert.match(f.status.textContent,/not saved/);assert.equal(f.retry.hidden,false);
  f.uncertain(true);f.doc.fire('click',{target:{id:'theme-retry'}});assert.match(f.status.textContent,/could not be verified/);
  f.fail(false);f.uncertain(false);f.doc.fire('click',{target:{id:'theme-retry'}});
  assert.equal(f.doc.documentElement.dataset.theme,'light-test');assert.equal(f.retry.hidden,true);assert.equal(f.status.textContent,'');
});
test('external changes reread storage, preserve an unsaved choice and dispose listeners on pagehide',()=>{
  const f=fixture();initializeTheme(f.doc,f.win);f.set('light-test');
  f.win.fire('storage',{key:themeKey,newValue:'default',storageArea:f.storage});
  assert.equal(f.select.value,'light-test');assert.equal(f.writes(),0);
  f.fail(true);f.choose('default');f.win.fire('storage',{key:themeKey,storageArea:f.storage});
  assert.equal(f.select.value,'default');assert.equal(f.doc.documentElement.dataset.theme,'light-test');assert.match(f.status.textContent,/Another window/);
  f.win.fire('pagehide');assert.equal(f.win.listeners.size,0);assert.equal(f.doc.listeners.size,0);
});
test('native storage clear resets the appearance without writing or changing unrelated state',()=>{
  const f=fixture();f.set('light-test');initializeTheme(f.doc,f.win);f.set(null);
  f.win.fire('storage',{key:null,storageArea:f.storage});assert.equal(f.doc.documentElement.dataset.theme,'default');assert.equal(f.writes(),0);
});
test('a write that throws after saving is reconciled; later read failure retains the verified theme',()=>{
  const f=fixture();const original=f.storage.setItem;
  f.storage.setItem=(...args)=>{original(...args);throw Error();};
  initializeTheme(f.doc,f.win);f.choose('light-test');
  assert.equal(f.doc.documentElement.dataset.theme,'light-test');assert.equal(f.retry.hidden,true);
  f.uncertain(true);f.win.fire('storage',{key:themeKey,storageArea:f.storage});
  assert.equal(f.doc.documentElement.dataset.theme,'light-test');assert.match(f.status.textContent,/last verified theme/);
});
test('bundled themes contain only visual variables; application styles contain no literal colors',()=>{
  const base=new URL('../dist/ui/',import.meta.url);
  for(const file of themeIds){
    const css=readFileSync(new URL(`themes/${file}.css`,base),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
    assert.match(css,/^\s*:root(?:\[data-theme="[a-z-]+"\])?\s*\{/);
    const body=css.slice(css.indexOf('{')+1,css.lastIndexOf('}'));
    for(const rule of body.split(';').filter(s=>s.trim()))assert.match(rule,/^\s*--[\w-]+:/);
    assert.doesNotMatch(body,/https?:|javascript:|@import|--(?:pin-x|pin-y|wheel-angle|motion|space-\d):/);
  }
  for(const file of ['style.css','popup.css'])assert.doesNotMatch(readFileSync(new URL(file,base),'utf8'),/#[0-9a-f]{3,8}\b|rgba?\(/i);
  for(const file of ['index.html','popup.html']){
    const html=readFileSync(new URL(file,base),'utf8');
    assert.ok(html.indexOf('src="theme-startup.js"')<html.indexOf('rel="stylesheet"'));
    for (const id of themeIds) assert.ok(html.includes(`href="themes/${id}.css"`), `${file}: ${id}`);
  }
});

test('both design prototypes use the same acknowledged preference and restart path',()=>{
 for(const id of ['celestial','parchment']){
  const f=fixture();const dispose=initializeTheme(f.doc,f.win);f.choose(id);
  assert.equal(f.doc.documentElement.dataset.theme,id);assert.equal(f.storage.getItem(themeKey),id);dispose();
  initializeTheme(f.doc,f.win);assert.equal(f.select.value,id);
 }
});

test('compass artwork is small, static, bundled and resolves from the consuming UI stylesheet',()=>{
  const base=new URL('../dist/ui/',import.meta.url);
  let paintedBytes=0;
  const visited=new Set();
  for(const id of ['celestial','parchment']){
    const css=readFileSync(new URL(`themes/${id}.css`,base),'utf8');
    const paths=[...css.matchAll(/url\("([^"]+)"\)/g)].map(m=>m[1]);
    assert.ok(paths.length>=2);
    assert.deepEqual(readdirSync(new URL(`themes/${id}/`,base)).sort(), paths.map(path=>path.split('/').at(-1)).sort());
    for(const path of paths){
      assert.ok(path.startsWith(`themes/${id}/`) && /\.(svg|jpg|webp)$/.test(path));
      assert.ok(!path.includes('..'));
      if(visited.has(path))continue;
      visited.add(path);
      const data=readFileSync(new URL(path,base));
      assert.deepEqual(data,readFileSync(new URL(`../../themes/${id}/assets/${path.split('/').at(-1)}`,import.meta.url)));
      if(paths.includes(path))paintedBytes+=data.length;
      if(path.endsWith('.webp')){
        assert.equal(data.toString('ascii',0,4),'RIFF');
        assert.equal(data.toString('ascii',8,12),'WEBP');
        assert.ok(data.length<550_000,'Bounded background asset');
        continue;
      }
      const svg=data.toString('utf8');
      assert.match(svg,/<svg\s/);
      assert.doesNotMatch(svg,/<(?:script|foreignObject|animate\w*|set|filter)\b|\bon\w+\s*=|(?:href|src)\s*=|url\((?!#)/i);
    }
    for(const page of ['index.html','popup.html'])assert.ok(readFileSync(new URL(page,base),'utf8').includes(`themes/${id}.css`));
  }
  // Keep the existing bounded budget available for future user-supplied backgrounds.
  assert.ok(paintedBytes<1_500_000,`Painted backgrounds and compass artwork: ${paintedBytes} bytes`);
  const provenance=readFileSync(new URL('themes/ARTWORK.md',base),'utf8');
  assert.match(provenance,/Public Domain Mark/);
  for(const file of ['rose.svg','instrument.svg'])assert.ok(provenance.includes(file));
});
