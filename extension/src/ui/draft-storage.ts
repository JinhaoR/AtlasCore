import { assessDraft, readDestinationDraft, samePolicy, type DestinationDraft } from './destination-draft.js';
import type { Policy } from '@atlas/core';

/** Separate from authority and from active presentation. An intent is saved before contacting Core. */
export interface DestinationReceipt {
  readonly kind: 'POLICY' | 'DISPLAY'; readonly draft: DestinationDraft; readonly candidatePolicy: Policy;
  readonly expectedProposalId: number; readonly proposalId: number | null;
  readonly baseConfigurationRevision: number;
  readonly phase: 'PREPARED' | 'PROPOSED' | 'APPLYING' | 'DONE' | 'KEPT' | 'RESOLVED';
  readonly owner: string | null;
}
export interface DestinationWorkspace { readonly version: 1; readonly draft: DestinationDraft | null; readonly receipt: DestinationReceipt | null }
export interface WorkspaceEnvelope { readonly revision: number; readonly value: DestinationWorkspace }
export type DraftWrite = { readonly type: 'SAVED'; readonly envelope: WorkspaceEnvelope }
  | { readonly type: 'CONFLICT'; readonly envelope: WorkspaceEnvelope | null } | { readonly type: 'FAILED' | 'UNCERTAIN' };
export interface DraftRepository {
  load(): Promise<WorkspaceEnvelope>;
  save(expectedRevision: number, value: DestinationWorkspace): Promise<DraftWrite>;
  close(): void;
  discardInvalid?(): Promise<boolean>;
}
export const emptyDestinationWorkspace = (): DestinationWorkspace => ({ version: 1, draft: null, receipt: null });
export const draftDatabaseName = 'atlas-destination-drafts-v1';

export function readDestinationWorkspace(input: unknown): DestinationWorkspace | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as DestinationWorkspace;
  if (value.version !== 1 || value.draft !== null && !readDestinationDraft(value.draft)) return null;
  if (value.receipt !== null) {
    const r = value.receipt;
    if (!r || typeof r !== 'object') return null;
    const d = readDestinationDraft(r.draft);
    if (!d || d.editor !== null || !d.changes.length || !['POLICY', 'DISPLAY'].includes(r.kind)
      || !['PREPARED', 'PROPOSED', 'APPLYING', 'DONE', 'KEPT', 'RESOLVED'].includes(r.phase)
      || !Number.isSafeInteger(r.expectedProposalId) || r.expectedProposalId < 1
      || r.proposalId !== null && (!Number.isSafeInteger(r.proposalId) || r.proposalId < 1)
      || !Number.isSafeInteger(r.baseConfigurationRevision) || r.baseConfigurationRevision < 0
      || r.owner !== null && (typeof r.owner !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(r.owner))
      || !r.candidatePolicy || !Array.isArray(r.candidatePolicy.whitelist) || !Array.isArray(r.candidatePolicy.blacklist)) return null;
    const candidate = assessDraft(d, d.baseline).candidatePolicy;
    if (!candidate || !samePolicy(candidate, r.candidatePolicy)) return null;
    if (r.kind === 'DISPLAY' && !samePolicy(d.baseline.policy, r.candidatePolicy)) return null;
  }
  return structuredClone(value);
}

/** IndexedDB serializes read/check/write in one transaction across every Atlas window. */
export async function openDraftRepository(factory: IDBFactory = indexedDB, name = draftDatabaseName): Promise<DraftRepository> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('DRAFT_STORAGE_UNAVAILABLE'));
    request.onblocked = () => reject(new Error('DRAFT_STORAGE_BLOCKED'));
  });
  db.onversionchange = () => db.close();
  const decode = (value: unknown): WorkspaceEnvelope => {
    if (value === undefined) return { revision: 0, value: emptyDestinationWorkspace() };
    const envelope = value as WorkspaceEnvelope;
    const workspace = readDestinationWorkspace(envelope?.value);
    if (!workspace || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1) throw new Error('DRAFT_STORAGE_INVALID');
    return { revision: envelope.revision, value: workspace };
  };
  return {
    load: () => new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction('workspace', 'readonly');
        const request = transaction.objectStore('workspace').get('current');
        let envelope: WorkspaceEnvelope;
        request.onsuccess = () => { try { envelope = decode(request.result); } catch { reject(new Error('DRAFT_STORAGE_INVALID')); } };
        transaction.oncomplete = () => { if (envelope) resolve(envelope); };
        transaction.onabort = transaction.onerror = () => reject(new Error('DRAFT_STORAGE_UNAVAILABLE'));
      } catch { reject(new Error('DRAFT_STORAGE_UNAVAILABLE')); }
    }),
    save: (expectedRevision, value) => new Promise(resolve => {
      if (!readDestinationWorkspace(value) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
        resolve({ type: 'FAILED' }); return;
      }
      try {
        const transaction = db.transaction('workspace', 'readwrite');
        const store = transaction.objectStore('workspace');
        const request = store.get('current');
        let result: DraftWrite = { type: 'FAILED' };
        request.onsuccess = () => {
          let current: WorkspaceEnvelope;
          try { current = decode(request.result); } catch { result = { type: 'CONFLICT', envelope: null }; return; }
          if (current.revision !== expectedRevision) { result = { type: 'CONFLICT', envelope: current }; return; }
          const envelope = { revision: current.revision + 1, value: structuredClone(value) };
          store.put(envelope, 'current'); result = { type: 'SAVED', envelope };
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => resolve({ type: 'FAILED' }); // IDB abort means the complete transaction was not committed.
        transaction.onerror = () => { /* onabort settles the write. */ };
      } catch { resolve({ type: 'FAILED' }); }
    }),
    discardInvalid: () => new Promise(resolve => {
      // Explicit recovery of this presentation-only document, never an authority reset.
      try {
        const transaction = db.transaction('workspace', 'readwrite');
        const store = transaction.objectStore('workspace');
        const request = store.get('current'); let discarded = false;
        request.onsuccess = () => { try { decode(request.result); } catch { store.delete('current'); discarded = true; } };
        transaction.oncomplete = () => resolve(discarded);
        transaction.onabort = () => resolve(false);
      } catch { resolve(false); }
    }),
    close: () => db.close(),
  };
}
