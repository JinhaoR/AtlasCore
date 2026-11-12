// Test copies only. Never rewrite development or release assets in place.
import ts from 'typescript';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [input, output] = process.argv.slice(2);
if (!input || !output || resolve(input) === resolve(output)) throw Error('Use distinct input/output test directories');
await mkdir(output, { recursive: true });
await cp(input, output, { recursive: true });
const bootstrap = `
globalThis.__atlasPerf={active:false,functions:{},messages:{},transactions:{},mutations:0,creates:0,replacements:{},timers:new Set(),maxTimers:0,listeners:new Map(),tabsListeners:0,
 record(n,t){const x=this.functions[n]??={calls:0,ms:0,maxMs:0};x.calls++;x.ms+=t;x.maxMs=Math.max(x.maxMs,t)},
 reset(){this.functions={};this.messages={};this.transactions={};this.mutations=0;this.creates=0;this.replacements={};this.maxTimers=this.timers.size;this.active=true},
 snapshot(){return {functions:structuredClone(this.functions),messages:{...this.messages},transactions:{...this.transactions},mutations:this.mutations,creates:this.creates,replacements:{...this.replacements},activeTimers:this.timers.size,maxTimers:this.maxTimers,activeGlobalListeners:[...this.listeners.values()].reduce((n,s)=>n+s.size,0),tabsListeners:this.tabsListeners}},
 stop(){this.active=false;return this.snapshot()}};
(()=>{const p=globalThis.__atlasPerf,inc=(o,k)=>o[k]=(o[k]??0)+1;
 const wrap=(o,k,f)=>{const old=o[k];o[k]=f(old)};
 if(typeof document!=='undefined'){
 wrap(Document.prototype,'createElement',old=>function(...a){if(p.active)p.creates++;return old.apply(this,a)});
 wrap(Element.prototype,'replaceChildren',old=>function(...a){if(p.active)inc(p.replacements,this.id||this.className||this.tagName);return old.apply(this,a)});
 const mo=new MutationObserver(records=>{if(p.active)p.mutations+=records.length});mo.observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true});
 wrap(EventTarget.prototype,'addEventListener',old=>function(t,f,...a){if(this===window||this===document){const k=(this===window?'window:':'document:')+t,s=p.listeners.get(k)??new Set();s.add(f);p.listeners.set(k,s)}return old.call(this,t,f,...a)});
 wrap(EventTarget.prototype,'removeEventListener',old=>function(t,f,...a){if(this===window||this===document)p.listeners.get((this===window?'window:':'document:')+t)?.delete(f);return old.call(this,t,f,...a)});
 }
 wrap(globalThis,'setTimeout',old=>function(fn,ms,...a){let id;id=old.call(this,()=>{p.timers.delete(id);fn(...a)},ms);p.timers.add(id);p.maxTimers=Math.max(p.maxTimers,p.timers.size);return id});
 wrap(globalThis,'clearTimeout',old=>function(id){p.timers.delete(id);return old.call(this,id)});
 wrap(IDBDatabase.prototype,'transaction',old=>function(stores,mode,...a){if(p.active)inc(p.transactions,this.name+':'+mode);return old.call(this,stores,mode,...a)});
 wrap(browser.runtime,'sendMessage',old=>function(c,...a){if(p.active)inc(p.messages,c?.kind??'other');return old.call(this,c,...a)});
 if(browser.tabs?.onUpdated){wrap(browser.tabs.onUpdated,'addListener',old=>function(f,...a){p.tabsListeners++;return old.call(this,f,...a)});wrap(browser.tabs.onUpdated,'removeListener',old=>function(f,...a){p.tabsListeners--;return old.call(this,f,...a)})}
})();
`;
const selected = new Set(['render','renderBatch','renderHome','renderSettings','renderFrozenReview','draftBaseline','assessDraft','validateDraftCandidate','readDestinationDraft','readDestinationWorkspace','receiptOutcome','destinationIndex','policyDestinationIndex','evaluate','refreshView','recheck','checkRetained','accessOverview','temporaryAccessView','pendingAccessView']);
for (const name of ['ui/main.js', 'background.js']) {
  const path = resolve(output, name), source = await readFile(path, 'utf8');
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), edits = [];
  const visit = node => {
    // Expose only pure projections inside this disposable test copy, so a
    // synthetic history benchmark never edits the browser's saved authority.
    if (ts.isFunctionDeclaration(node) && node.name && ['accessOverview','temporaryAccessView','pendingAccessView'].includes(node.name.text))
      edits.push([node.end, `;(globalThis.__atlasAccessProjection??={})[${JSON.stringify(node.name.text)}]=${node.name.text};`]);
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.body && node.name && selected.has(node.name.getText(ast))) {
      let label = node.name.getText(ast);
      if (label === 'render') { let parent=node.parent; while(parent){if(ts.isFunctionDeclaration(parent)&&parent.name?.text==='initializeSites'){label='sites.render';break}parent=parent.parent} }
      edits.push([node.body.getStart(ast)+1, `const __p=globalThis.__atlasPerf,__t=__p?.active?performance.now():null;try{`]);
      edits.push([node.body.end-1, `}finally{if(__t!==null)__p.record(${JSON.stringify(label)},performance.now()-__t)}`]);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  let rewritten=source;
  for(const [at,text] of edits.sort((a,b)=>b[0]-a[0]))rewritten=rewritten.slice(0,at)+text+rewritten.slice(at);
  await writeFile(path, bootstrap+rewritten);
}
console.log('Instrumented numeric counters in disposable runtime:', output);
