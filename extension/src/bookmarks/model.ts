import { normalizeTarget } from '@atlas/core';
import { readHomeBookmarks, validBookmarkPage, type BookmarkPage, type HomeBookmarks } from '../ui/home-bookmarks.js';
import { validDestinationId } from '../ui/destination-metadata.js';

export interface SyncGroup {
  id: string; hostname: string; label: string; pinned: boolean; pages: BookmarkPage[];
}
export interface NodeBinding { id: string; folder: string; pages: Record<string, string> }
export interface NativeMutation {
  kind: 'create' | 'update' | 'move' | 'remove';
  id: string | null; parentId: string | null; title: string | null; url: string | null; index: number | null;
  before: { parentId: string; title: string; url: string | null; index: number } | null;
  children: string[]; result: { group: string; page: string | null } | 'root' | 'archive' | null;
}
export interface SyncState {
  version: 1; enabled: boolean; root: string | null; archive: string | null;
  scope?: 'toolbar';
  groups: SyncGroup[]; bindings: NodeBinding[]; labels: Record<string, string>; metadataLabels: Record<string, string>;
  pending: null | { target: SyncGroup[]; nativeBefore: SyncGroup[]; pinsBefore: string[]; bookmarkRevision: number; bookmarksCandidate: HomeBookmarks };
  mutation: NativeMutation | null;
  conflictRemote: SyncGroup[] | null;
  issue: 'NONE' | 'CONFLICT' | 'ROOT_MISSING' | 'PERMISSION' | 'STORAGE' | 'UNSUPPORTED' | 'DUPLICATE';
}
export const presentationCommands = ['PRESENTATION_READ','FOLDER_ICON','BOOKMARK_SAVE','PIN_SET','PIN_LABEL','PIN_ORDER','SYNC_SETUP','SYNC_PREVIEW','SYNC_CONNECT','SYNC_TOOLBAR','SYNC_DISABLE','SYNC_RETRY','SYNC_COMPARE','SYNC_RESOLVE'];
export const emptySync = (): SyncState => ({ version: 1, enabled: false, root: null, archive: null, groups: [], bindings: [], labels: {}, metadataLabels: {}, pending: null, mutation: null, conflictRemote:null, issue: 'NONE' });
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left=Object.keys(a), right=Object.keys(b);
  return left.length===right.length && left.every(k=>Object.hasOwn(b,k) && same((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
}
const nodeId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const pageId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9:.-]{1,280}$/.test(v);
const shape = (v: unknown, keys: string) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys;
export function validGroups(value: unknown): value is SyncGroup[] {
  if (!Array.isArray(value) || value.length > 200 || new Set(value.map(g => g?.id)).size !== value.length) return false;
  let pages = 0;
  return value.every(g => g && Object.keys(g).sort().join(',') === 'hostname,id,label,pages,pinned'
    && validDestinationId(g.id) && normalizeTarget({ hostname: g.hostname })?.hostname === g.hostname
    && typeof g.label === 'string' && g.label.trim().length > 0 && g.label.length <= 100 && typeof g.pinned === 'boolean'
    && Array.isArray(g.pages) && g.pages.length <= 100 && (pages += g.pages.length) <= 2000
    && new Set(g.pages.map((p: BookmarkPage) => p?.id)).size === g.pages.length
    && g.pages.every((p: BookmarkPage) => validBookmarkPage(p) && Object.keys(p).sort().join(',') === 'id,label,url'));
}
export function readSync(input: unknown): SyncState | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as SyncState;
  if (Object.keys(v).filter(k=>k!=='scope').sort().join(',') !== 'archive,bindings,conflictRemote,enabled,groups,issue,labels,metadataLabels,mutation,pending,root,version'
    || Object.hasOwn(v,'scope') && (v.scope !== 'toolbar' || v.root !== 'toolbar_____' || v.archive !== null)
    || v.version !== 1 || typeof v.enabled !== 'boolean' || !['NONE','CONFLICT','ROOT_MISSING','PERMISSION','STORAGE','UNSUPPORTED','DUPLICATE'].includes(v.issue)
    || v.root !== null && !nodeId(v.root) || v.archive !== null && !nodeId(v.archive) || !validGroups(v.groups) || v.conflictRemote!==null&&!validGroups(v.conflictRemote)
    || !Array.isArray(v.bindings) || v.bindings.length > 200 || new Set(v.bindings.map(b => b?.id)).size !== v.bindings.length
    || !v.bindings.every(b => shape(b,'folder,id,pages') && validDestinationId(b.id) && nodeId(b.folder) && b.pages && !Array.isArray(b.pages) && typeof b.pages === 'object' && Object.keys(b.pages).length <= 100
      && Object.entries(b.pages).every(([p,n]) => pageId(p) && nodeId(n)))) return null;
  for (const labels of [v.labels,v.metadataLabels]) if (!labels || Array.isArray(labels) || typeof labels !== 'object' || Object.keys(labels).length > 200
    || !Object.entries(labels).every(([id,l]) => validDestinationId(id) && typeof l === 'string' && l.length <= 100)) return null;
  if (v.pending !== null && (!shape(v.pending,'bookmarkRevision,bookmarksCandidate,nativeBefore,pinsBefore,target')
    || !validGroups(v.pending.target) || !validGroups(v.pending.nativeBefore) || !Array.isArray(v.pending.pinsBefore)
    || v.pending.pinsBefore.length > 200 || new Set(v.pending.pinsBefore).size !== v.pending.pinsBefore.length || !v.pending.pinsBefore.every(validDestinationId)
    || !Number.isSafeInteger(v.pending.bookmarkRevision) || v.pending.bookmarkRevision < 0
    || !readHomeBookmarks(v.pending.bookmarksCandidate))) return null;
  const m = v.mutation;
  if (m !== null && (!v.pending || !shape(m,'before,children,id,index,kind,parentId,result,title,url') || !['create','update','move','remove'].includes(m.kind) || m.id !== null && !nodeId(m.id)
    || m.parentId !== null && !nodeId(m.parentId) || m.title !== null && (typeof m.title !== 'string' || m.title.length > 100)
    || m.url !== null && !validBookmarkPage({ id: 'check', label: 'check', url: m.url })
    || m.index !== null && (!Number.isSafeInteger(m.index) || m.index < 0) || !Array.isArray(m.children) || m.children.length > 10000 || !m.children.every(nodeId)
    || m.before !== null && (!shape(m.before,'index,parentId,title,url') || !nodeId(m.before.parentId) || typeof m.before.title !== 'string'
      || m.before.title.length > 100 || !Number.isSafeInteger(m.before.index) || m.before.index < 0
      || m.before.url !== null && !validBookmarkPage({id:'check',label:'check',url:m.before.url}))
    || m.result !== null && m.result !== 'root' && m.result !== 'archive' && (!shape(m.result,'group,page') || !validDestinationId(m.result.group) || m.result.page !== null && !pageId(m.result.page))
    || m.kind === 'create' && (m.id !== null || m.parentId === null || m.title === null || m.before !== null || m.result === null)
    || m.kind !== 'create' && (m.id === null || m.before === null || m.result !== null)
    || m.kind === 'move' && m.parentId === null || m.kind === 'update' && m.title === null)) return null;
  return structuredClone(v);
}

/** Three-way, field-wise merge. Conflicting order/edits are never last-writer-wins. */
export function mergeGroups(base: SyncGroup[], local: SyncGroup[], remote: SyncGroup[]): SyncGroup[] | null {
  let conflict = false;
  function field<T>(b: T, l: T, r: T): T {
    if (same(l,r) || same(b,r)) return l;
    if (same(b,l)) return r;
    conflict = true; return l;
  }
  function order(b: string[], l: string[], r: string[], ids: Set<string>): string[] {
    const common = b.filter(id => ids.has(id) && l.includes(id) && r.includes(id));
    const oldOrder = field(common, l.filter(id => common.includes(id)), r.filter(id => common.includes(id)));
    const chosen = same(l.filter(id => common.includes(id)), oldOrder) ? l : r;
    return [...new Set([...chosen, ...l, ...r])].filter(id => ids.has(id));
  }
  const groups = new Map<string, SyncGroup>();
  for (const id of new Set([...base,...local,...remote].map(g => g.id))) {
    const b=base.find(g=>g.id===id), l=local.find(g=>g.id===id), r=remote.find(g=>g.id===id);
    if (!b || !l || !r) { const g=field(b,l,r); if(g)groups.set(id,g); continue; }
    const pages = new Map<string, BookmarkPage>();
    for (const pid of new Set([...b.pages,...l.pages,...r.pages].map(p=>p.id))) {
      const bp=b.pages.find(p=>p.id===pid),lp=l.pages.find(p=>p.id===pid),rp=r.pages.find(p=>p.id===pid);
      if (!bp || !lp || !rp) { const p=field(bp,lp,rp); if(p)pages.set(pid,p); }
      else pages.set(pid,{id:pid,label:field(bp.label,lp.label,rp.label),url:field(bp.url,lp.url,rp.url)});
    }
    groups.set(id,{id,hostname:b.hostname,label:field(b.label,l.label,r.label),pinned:field(b.pinned,l.pinned,r.pinned),
      pages:order(b.pages.map(p=>p.id),l.pages.map(p=>p.id),r.pages.map(p=>p.id),new Set(pages.keys())).map(p=>pages.get(p)!)});
  }
  const result=order(base.map(g=>g.id),local.map(g=>g.id),remote.map(g=>g.id),new Set(groups.keys())).map(id=>groups.get(id)!);
  return conflict || !validGroups(result) ? null : structuredClone(result);
}
