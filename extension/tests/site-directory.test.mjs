import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryCategories, directoryView, matchesSite } from '../dist/lib/ui/site-directory.js';
import { sitesFixture, original } from './support/ui-fixture.mjs';
const entry = (category, label = 'Example', hostname = 'example.org') => ({id:`host:${hostname}`,category,label,hostname,hostnames:[hostname]});

test('directory groups canonical category identities and follows explicit saved order', () => {
 const entries=[entry(' Research '),entry('RESEARCH'),entry('Tools'),entry('')];
 const categories=directoryCategories(entries,['tools','research']);
 assert.deepEqual(categories.map(c=>[c.key,c.count]),[['tools',1],['research',2],['uncategorized',1]]);
 assert.equal(entries[0].category,' Research ');
});
test('complete directory includes legacy hidden categories and appends new categories predictably',()=>{
 assert.deepEqual(directoryCategories([entry('Zoology'),entry('Hidden'),entry('Astronomy')],['hidden']).map(c=>c.key),['hidden','astronomy','zoology']);
});
test('empty definitions create no empty directory tiles; large names and collections retain counts',()=>{
 assert.deepEqual(directoryCategories([],['empty']),[]);
 const entries=Array.from({length:900},(_,i)=>entry(`Category ${i%30} ${'long '.repeat(8)}`));
 assert.equal(directoryCategories(entries).length,30);
 assert.ok(directoryCategories(entries).every(c=>c.count===30));
});
test('search retains name category and exact host matching without inventing authority',()=>{
 const site=entry('Research','Lecture notes','physics.example.org');
 assert.ok(matchesSite(site,' notes physics.'));assert.ok(matchesSite(site,'RESEARCH'));
 assert.equal(matchesSite(site,'unrelated'),false);assert.ok(matchesSite(site,''));
});
test('history admits only closed directory views',()=>{
 for(const value of [null,{},'other','category:','category:'+ 'a'.repeat(300)])assert.equal(directoryView(value),null);
 assert.equal(directoryView('all'),'all');assert.equal(directoryView('category:research'),'category:research');
});
test('category landing and complete listing are contextual and do not change authority',async t=>{
 const f=await sitesFixture(t), before=structuredClone(f.controller.getView().snapshot);
 f.sites.restoreDirectory(null);f.sites.render(true);
 assert.equal(f.el('sites-list').hidden,true);assert.equal(f.el('sites-categories').hidden,false);
 f.sites.chooseCategory('your destinations');f.sites.render(true);
 assert.equal(f.el('sites-list').hidden,false);assert.ok(f.el('sites-list').children.some(row=>row.dataset.destinationId===original.id));
 f.el('sites-show-all').click();f.sites.render(true);assert.equal(f.sites.directory(),'all');
 assert.deepEqual(f.controller.getView().snapshot,before);
});
test('Escape dismissal retains dirty work and opening Add cannot replace it',async t=>{
 const f=await sitesFixture(t);f.edit();f.el('site-name').value='Retained';f.el('site-name').fire('input');await f.flush();
 f.el('sites-editor').fire('cancel');f.sites.render(true);assert.equal(f.sites.view(),'browse');
 f.el('add-site').click();await f.flush();assert.equal(f.sites.session().value.draft.editor.name,'Retained');
 assert.equal(f.el('site-name').value,'Retained');assert.equal(f.proposals(),0);
});
test('dismissed dialogs do not affect query or directory selection',async t=>{
 const f=await sitesFixture(t);f.sites.chooseCategory('your destinations');f.el('sites-search').value='Original';f.edit();await f.flush();
 f.el('sites-back').click();await f.flush();
 assert.equal(f.sites.directory(),'category:your destinations');assert.equal(f.sites.navigation().search,'Original');
 assert.equal(f.sites.navigation().selection,original.id);
 assert.equal(document.activeElement.dataset.destinationId,original.id);
});
test('contextual search honors unavailable authority and failed draft saves retain editor work',async t=>{
 const f=await sitesFixture(t);f.draftMode('FAIL');f.edit();f.el('site-name').value='Unsaved';f.el('site-name').fire('input');await f.flush();
 f.sites.render(false);assert.equal(f.el('site-name').value,'Unsaved');assert.ok(f.sites.session().unsaved);
 assert.equal(f.proposals(),0);
});
