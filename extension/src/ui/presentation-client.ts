import type { ToolbarFolder } from '../bookmarks/toolbar-folders.js';
import type { BookmarkEnvelope, BookmarkRepository } from './home-bookmarks.js';
import type { SyncGroup, SyncState } from '../bookmarks/model.js';
export interface PresentationView {
  pins: string[]; bookmarks: BookmarkEnvelope;
  sync: { folders?:ToolbarFolder[]; folderIcons?:Record<string,string>; toolbarOrder?:string[]; revision:number; enabled:boolean; scope?:'toolbar'|'folder'; issue:SyncState['issue']; warnings:string[]; groups:Omit<SyncGroup,'pages'>[]; labels:Record<string,string>; pending:boolean };
}
let current:PresentationView|null=null;
export const presentationView = () => current;
export async function presentationCommand(command:object):Promise<any> {
  const r=await browser.runtime.sendMessage(command);
  if(!r||r.error)throw new Error(r?.error ?? 'PRESENTATION_UNAVAILABLE');
  if(r.pins&&r.bookmarks&&r.sync)current=r;
  return r;
}
export const remoteBookmarks:BookmarkRepository = {
  async load(){return (await presentationCommand({kind:'PRESENTATION_READ'})).bookmarks;},
  async save(revision,value){return presentationCommand({kind:'BOOKMARK_SAVE',revision,value});},
  close(){},
};
export async function setPin(id:string,pinned:boolean,hosts:readonly string[]=[]) {
  try{return (await presentationCommand({kind:'PIN_SET',id,pinned,hosts})).type as 'SAVED'|'FAILED'|'UNCERTAIN';}
  catch{return 'UNCERTAIN' as const;}
}
