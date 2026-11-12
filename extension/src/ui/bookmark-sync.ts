import { presentationCommand, presentationView } from './presentation-client.js';
import { setProperty } from './dom.js';
import type { SyncGroup } from '../bookmarks/model.js';
const el = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
export function initializeBookmarkSync(changed:()=>void) {
  const dialog=el<HTMLDialogElement>('bookmark-sync-dialog');
  let busy=false, comparisonToken:string|null=null, trigger:HTMLElement|null=null;
  const labels={NONE:'Bookmarks are connected.',CONFLICT:'Changes overlap. Compare both copies before continuing.',ROOT_MISSING:'Bookmark connection needs to be reconnected.',PERMISSION:'Firefox bookmark permission is off. Reconnect to resume.',STORAGE:'Bookmark sync could not finish. Your saved access rules are unchanged.',UNSUPPORTED:'Some bookmarks exceed supported limits. Review the folder before retrying.',DUPLICATE:'Two folders identify the same site. Combine them in Firefox, then retry.'};
  function render(){
    const state=presentationView()?.sync;
    const message=state?.enabled?labels[state.issue]: 'Connect your Firefox toolbar and Atlas pins.';
    setProperty(el('bookmark-sync-status'),'textContent',message);
    setProperty(el('bookmark-sync-warning'),'hidden',true);
    for(const id of ['settings-connect-bookmarks']) {
      const connected=state?.enabled&&state.scope==='toolbar';
      setProperty(el(id),'textContent',connected&&state.issue!=='NONE'?'Bookmarks need attention':connected?'Firefox bookmarks':'Connect Firefox bookmarks');
      setProperty(el(id),'title',connected?'Manage bookmark connection':'Sync toolbar bookmarks and Atlas pins. Unpinning deletes the synchronized toolbar bookmarks; folders are untouched.');
    }
    setProperty(el('grant-bookmark-permission'),'hidden',!!state?.enabled&&state.scope==='toolbar'&&state.issue!=='PERMISSION'&&state.issue!=='ROOT_MISSING');
    setProperty(el('sync-ongoing-warnings'),'textContent',state?.warnings.join(' ')??'');
    setProperty(el('bookmark-sync-warning-text'),'textContent',state?.issue==='NONE'&&state.warnings.length?'Some Firefox entries are not included in Atlas shortcuts.':message);
    setProperty(el('disconnect-bookmark-sync'),'hidden',!state?.enabled);
    setProperty(el('compare-bookmark-sync'),'hidden',state?.issue!=='CONFLICT');
    setProperty(el('retry-bookmark-sync'),'hidden',!state?.enabled||state.issue==='NONE'||state.issue==='CONFLICT'||state.issue==='ROOT_MISSING');
    for(const b of dialog.querySelectorAll<HTMLButtonElement>('button'))setProperty(b,'disabled',busy);
    for(const b of dialog.querySelectorAll<HTMLButtonElement>('[data-sync-side]'))setProperty(b,'disabled',busy||!comparisonToken);
  }
  function showGroups(container:HTMLElement, groups:SyncGroup[]) {
    container.replaceChildren(...groups.map(g=>{
      const li=document.createElement('li'),title=document.createElement('strong'),list=document.createElement('ul');title.textContent=`${g.label}${g.pinned?'':' · unpinned'}`;
      for(const p of g.pages){const item=document.createElement('li');item.textContent=`${p.label} — ${p.url}`;list.append(item);}li.append(title,list);return li;
    }));
  }
  async function action(work:()=>Promise<void>){if(busy)return;busy=true;render();el('bookmark-sync-feedback').textContent='';try{await work();changed();}catch{open();el('bookmark-sync-feedback').textContent='Could not complete bookmark sync. Your edits and access rules are preserved. Retry, or reconnect if the folder changed.';}finally{busy=false;render();}}
  function open(){trigger=document.activeElement as HTMLElement;dialog.hidden=false;dialog.showModal();el('bookmark-sync-heading').focus();render();}
  function close(){if(busy)return;dialog.close();dialog.hidden=true;comparisonToken=null;el('sync-comparison').hidden=true;trigger?.focus({preventScroll:true});}
  function connect(){
    // Firefox requires this request to remain directly inside the click gesture.
    const permission=browser.permissions.request({permissions:['bookmarks']});
    void action(async()=>{
      if(!await permission){open();el('bookmark-sync-feedback').textContent='Bookmark permission was not granted. Your Atlas pins are unchanged.';return;}
      await presentationCommand({kind:'SYNC_TOOLBAR'});
      if(presentationView()?.sync.issue!=='NONE')open();
    });
  }
  for(const id of ['settings-connect-bookmarks','open-bookmark-sync'])el(id).addEventListener('click',()=>{
    const state=presentationView()?.sync;
    if(state?.enabled&&state.scope==='toolbar')open();else connect();
  });
  el('close-bookmark-sync').addEventListener('click',close);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  el('grant-bookmark-permission').addEventListener('click',connect);
  el('disconnect-bookmark-sync').addEventListener('click',()=>void action(async()=>{await presentationCommand({kind:'SYNC_DISABLE'});el('bookmark-sync-feedback').textContent='Disconnected. Both copies remain saved.';}));
  el('retry-bookmark-sync').addEventListener('click',()=>void action(async()=>{await presentationCommand({kind:'SYNC_RETRY'});}));
  el('compare-bookmark-sync').addEventListener('click',()=>void action(async()=>{
    const r=await presentationCommand({kind:'SYNC_COMPARE'});comparisonToken=r.comparison.token;
    showGroups(el('sync-local-groups'),r.comparison.local);showGroups(el('sync-remote-groups'),r.comparison.remote);el('sync-comparison').hidden=false;
  }));
  for(const b of dialog.querySelectorAll<HTMLButtonElement>('[data-sync-side]'))b.addEventListener('click',()=>void action(async()=>{
    await presentationCommand({kind:'SYNC_RESOLVE',side:b.dataset.syncSide,token:comparisonToken});comparisonToken=null;el('sync-comparison').hidden=true;
  }));
  return {render};
}
