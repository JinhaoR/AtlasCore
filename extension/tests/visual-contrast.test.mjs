import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base=new URL('../dist/ui/themes/',import.meta.url);
const read=name=>Object.fromEntries([...readFileSync(new URL(name+'.css',base),'utf8').matchAll(/(--[\w-]+):\s*(#[\da-f]{6})\b/gi)].map(m=>[m[1],m[2]]));
const palettes=Object.fromEntries(['default','light-test','celestial','parchment'].map(name=>[name,{...read('default'),...read(name)}]));
function luminance(hex) {
  const rgb=hex.slice(1).match(/../g).map(h=>parseInt(h,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
for(const [name,tokens] of Object.entries(palettes)) {
 test(`${name}: body, controls, muted copy and access states retain text contrast`,()=>{
  for(const [fg,bg] of [['--ink','--page'],['--muted','--surface'],['--muted','--page'],['--accent','--page'],['--on-accent','--accent'],['--pin-ink','--pin-surface'],
    ['--success','--success-surface'],['--warning','--warning-surface'],['--error','--error-surface'],['--unavailable','--unavailable-surface'],
    ['--access-wait-ink','--access-wait-surface'],['--access-active-ink','--access-active-surface'],['--cancel-ink','--cancel-surface'],['--cancel-ink','--cancel-hover']])
    assert.ok(contrast(tokens[fg],tokens[bg])>=4.5,`${fg} on ${bg}`);
 });
 test(`${name}: focus indicator remains distinguishable on page and control surfaces`,()=>{
  for(const bg of ['--page','--surface'])assert.ok(contrast(tokens['--focus'],tokens[bg])>=3);
  assert.ok(contrast(tokens['--control-border'],tokens['--surface'])>=3);
 });
}
