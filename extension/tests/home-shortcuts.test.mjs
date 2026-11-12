import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeHomeShortcuts } from '../dist/lib/ui/home-shortcuts.js';
import { Node } from './support/ui-fixture.mjs';

class Element extends Node {
  constructor(tag='div') { super(); this.tag=tag; this.classList={add(){}};this.style={removeProperty(k){delete this[k];}};this.offsetWidth=80;this.offsetHeight=80;this.offsetLeft=0;this.offsetTop=0;this.scrollLeft=this.scrollTop=0; }
  getBoundingClientRect() { return {top:0,left:0,right:500,bottom:500,width:80,height:80}; }
  cloneNode(){return new Element(this.tag);}
  contains(node) { return this.children.includes(node); }
  setPointerCapture() {}
  removeAttribute(key) { delete this.attrs[key]; }
  querySelector(tag) { for (const child of this.children) { if (child.tag===tag) return child; const found=child.querySelector(tag); if(found)return found; } return null; }
}
function fixture(t,count,save) {
  const previous=globalThis.document;
  globalThis.document={body:new Element(),createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag)};
  t.after(()=>{globalThis.document=previous;});
  const primary=new Element(),selected=[],moves=[];
  const groups=Array.from({length:count},(_,i)=>{
    const g=new Element();g.dataset={categoryKey:`category-${i}`,category:`Category ${i}`,collapsed:'true'};return g;
  });
  return {primary,groups,selected,moves,render:initializeHomeShortcuts(primary,key=>selected.push(key),(from,to)=>{moves.push([from,to]);return save?.();})};
}
test('all thirty category shortcuts follow saved category order without changing category preferences',t=>{
  const f=fixture(t,30),before=f.groups.map(g=>({...g.dataset}));f.render(f.groups);
  assert.equal(f.primary.children.length,30);
  assert.deepEqual(f.primary.children.map(n=>n.querySelector('span').textContent),f.groups.map(g=>g.dataset.category));
  assert.deepEqual(f.groups.map(g=>g.dataset),before);
});

test('drop retains preview through an asynchronous save and removes transforms with the acknowledged order',async t=>{
  let acknowledge;const f=fixture(t,3,()=>new Promise(resolve=>acknowledge=resolve));f.render(f.groups);
  const [first,second]=f.primary.children;f.primary.children.forEach((n,i)=>{n.offsetTop=i*90;});
  fire(first,'pointerdown',{pointerId:1,button:0,isPrimary:true,clientX:40,clientY:40});
  fire(f.primary,'pointermove',{pointerId:1,clientX:40,clientY:130});
  const preview=second.style.transform;fire(f.primary,'pointerup',{pointerId:1});
  assert.equal(second.style.transform,preview);assert.deepEqual(f.primary.children.slice(0,2),[first,second]);
  const saved=[f.groups[1],f.groups[0],f.groups[2]];f.render(saved,null,true);
  assert.equal(second.style.transform,preview);
  acknowledge();await Promise.resolve();await Promise.resolve();
  assert.deepEqual(f.primary.children.slice(0,2),[second,first]);assert.equal(second.style.transform,undefined);
});
test('routine rendering preserves buttons and one activation selects a view without expanding a category',t=>{
  const f=fixture(t,5);f.render(f.groups);const nodes=[...f.primary.children];
  for(let i=0;i<30;i++)f.render(f.groups);
  assert.deepEqual(f.primary.children,nodes);assert.equal(nodes[0].listeners.click.length,1);
  nodes[0].fire('click');assert.deepEqual(f.selected,['category-0']);
  assert.equal(f.groups[0].dataset.collapsed,'true');
  f.render(f.groups,'category-0');assert.equal(nodes[0].getAttribute('aria-pressed'),'true');
});
test('custom category reorder, rename and hiding retain correct shortcut identities and targets',t=>{
  const f=fixture(t,15);f.render(f.groups);const button=f.primary.children[3],target=f.groups[3];
  target.dataset.category='Long custom research category';
  const reordered=[target,...f.groups.filter(g=>g!==target).slice(0,7)];f.render(reordered);
  assert.equal(f.primary.children[0],button);assert.equal(button.querySelector('span').textContent,target.dataset.category);
  button.fire('click');assert.deepEqual(f.selected,['category-3']);
  f.render([]);assert.equal(f.primary.children.length,0);
});

const fire=(node,type,event={})=>{for(const listener of node.listeners[type]??[])listener({preventDefault(){},...event});};
test('drag needs local pointer evidence, persists one move, suppresses launch, and cancels safely',t=>{
  const f=fixture(t,12);f.render(f.groups);const [source,target]=f.primary.children;
  f.primary.children.forEach((n,i)=>{n.offsetTop=i*90;});
  target.closest=()=>target;document.elementFromPoint=()=>target;
  const down=()=>fire(source,'pointerdown',{pointerId:1,button:0,isPrimary:true,clientX:10,clientY:10});
  const move=()=>fire(f.primary,'pointermove',{pointerId:1,clientX:40,clientY:130});
  const up=()=>fire(f.primary,'pointerup',{pointerId:1});
  up();assert.deepEqual(f.moves,[]);down();move();up();
  assert.deepEqual(f.moves,[['category-0','category-1']]);source.click();assert.deepEqual(f.selected,[]);
  fire(source,'pointerdown');source.click();assert.deepEqual(f.selected,['category-0']);
  down();move();fire(f.primary,'pointercancel');up();assert.equal(f.moves.length,1);
  down();move();f.render(f.groups,null,false);up();assert.equal(f.moves.length,1);
});
test('keyboard reordering and saved icons retain category targets without activation',t=>{
  const f=fixture(t,8);f.groups[2].dataset.icon='feather';f.render(f.groups);
  const button=f.primary.children[2];assert.equal(button.querySelector('use').getAttribute('href'),'#icon-feather');
  fire(button,'keydown',{altKey:true,key:'ArrowRight'});assert.deepEqual(f.moves,[['category-2','category-3']]);assert.deepEqual(f.selected,[]);
  f.render(f.groups,null,false);fire(button,'keydown',{altKey:true,key:'ArrowLeft'});assert.equal(f.moves.length,1);
});
