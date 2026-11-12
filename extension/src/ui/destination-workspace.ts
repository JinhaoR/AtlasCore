import { isWhitelistRemoval, type AtlasSnapshot } from '@atlas/core';
import { assessDraft, samePolicy, type DestinationDraft } from './destination-draft.js';
import { emptyDestinationWorkspace, type DestinationReceipt, type DestinationWorkspace, type DraftRepository } from './draft-storage.js';

/** A single extension-local document, with in-memory failed edits separate from acknowledged storage. */
export class DestinationWorkspaceSession {
  value: DestinationWorkspace = emptyDestinationWorkspace();
  revision = 0;
  loaded = false;
  unsaved = false;
  conflict = false;
  failure: 'FAILED' | 'UNCERTAIN' | null = null;
  loadReason: 'INVALID' | 'UNAVAILABLE' | null = null;
  private queue: Promise<void> = Promise.resolve();
  private editorWrite: { value: DestinationWorkspace } | null = null;
  constructor(readonly repository: DraftRepository, readonly changed: () => void) {}

  async load(): Promise<boolean> {
    try {
      const envelope = await this.repository.load();
      this.value = envelope.value; this.revision = envelope.revision;
      this.loaded = true; this.unsaved = this.conflict = false; this.failure = this.loadReason = null; this.changed(); return true;
    } catch (error) { this.failure = 'FAILED'; this.loadReason = error instanceof Error && error.message === 'DRAFT_STORAGE_INVALID' ? 'INVALID' : 'UNAVAILABLE'; this.changed(); return false; }
  }
  set(value: DestinationWorkspace, explicitRetry = false): Promise<boolean> {
    const next = structuredClone(value);
    // A stage, close, receipt or explicit retry seals any earlier editor slot.
    // Later typing cannot replace a write on the other side of this barrier.
    this.editorWrite = null;
    this.value = next; this.unsaved = true; this.changed();
    if (!this.loaded || this.conflict || this.failure && !explicitRetry) return Promise.resolve(false);
    let saved = false;
    const captured = structuredClone(value);
    this.queue = this.queue.then(async () => {
      saved = await this.write(captured, explicitRetry);
    }).catch(() => { this.failure = 'UNCERTAIN'; this.changed(); });
    return this.queue.then(() => saved);
  }
  setDraft(draft: DestinationDraft | null): Promise<boolean> { return this.set({ ...this.value, draft }); }

  /** Raw inputs only. Persist the newest queued editor, never coalesce a stage or receipt. */
  setEditor(editor: DestinationDraft['editor']): void {
    const draft = this.value.draft;
    // Stale input events cannot reopen a closed editor or change its destination.
    if (!draft?.editor || editor && editor.id !== draft.editor.id) return;
    if (editor === null) { void this.setDraft({ ...draft, editor: null }); return; }
    const value = { ...this.value, draft: { ...draft, editor: structuredClone(editor) } };
    this.value = value; this.unsaved = true; this.changed();
    if (!this.loaded || this.conflict || this.failure) return;
    if (this.editorWrite) { this.editorWrite.value = value; return; }
    const slot = { value }; this.editorWrite = slot;
    this.queue = this.queue.then(async () => {
      // Once started, this snapshot is immutable. New input gets one later slot.
      if (this.editorWrite === slot) this.editorWrite = null;
      await this.write(structuredClone(slot.value), false);
    }).catch(() => { this.failure = 'UNCERTAIN'; this.changed(); });
  }

  private async write(captured: DestinationWorkspace, explicitRetry: boolean): Promise<boolean> {
    if (this.conflict || this.failure && !explicitRetry) return false;
    const result = await this.repository.save(this.revision, captured);
    if (result.type === 'SAVED') {
      this.revision = result.envelope.revision; this.failure = null;
      this.unsaved = JSON.stringify(this.value) !== JSON.stringify(captured);
    } else if (result.type === 'CONFLICT') this.conflict = true;
    else this.failure = result.type;
    this.changed(); return result.type === 'SAVED';
  }
  idle(): Promise<void> { return this.queue; }
  async refresh(): Promise<void> {
    if (!this.loaded || this.unsaved || this.failure || this.conflict) return;
    await this.idle();
    if (this.unsaved || this.failure || this.conflict) return;
    const revision = this.revision, value = this.value;
    try {
      const envelope = await this.repository.load();
      // This read may finish after a local edit or discard. It cannot replace or
      // flag work that was saved while the read was in flight.
      if (this.revision !== revision || this.value !== value || this.unsaved || this.failure || this.conflict) return;
      if (envelope.revision === this.revision) return;
      // A viewing page can adopt remote state. An editor retains its inputs until explicit reload.
      if (this.value.draft !== null) { this.conflict = true; this.changed(); return; }
      this.value = envelope.value; this.revision = envelope.revision; this.changed();
    } catch {
      if (this.revision === revision && this.value === value) { this.failure = 'FAILED'; this.changed(); }
    }
  }
  async retry(): Promise<boolean> {
    await this.idle();
    if (!this.loaded || this.conflict) return false;
    return this.set(this.value, true);
  }
}

export type ReceiptOutcome = 'WAITING' | 'COMMITTED' | 'RESOLVED' | 'UNKNOWN' | 'INVALID';
/** Match a receipt against verified Core data. No writes, confirmation or permission. */
export function receiptOutcome(receipt: DestinationReceipt, snapshot: AtlasSnapshot): ReceiptOutcome {
  const assessment = assessDraft(receipt.draft, receipt.draft.baseline);
  if (!assessment.candidatePolicy || !samePolicy(assessment.candidatePolicy, receipt.candidatePolicy)) return 'INVALID';
  if (receipt.kind === 'DISPLAY') return snapshot.policyRevision === receipt.draft.baseline.policyRevision
    && samePolicy(snapshot.policy, receipt.candidatePolicy) ? 'COMMITTED' : 'INVALID';
  if (receipt.kind === 'REMOVAL') {
    if (!isWhitelistRemoval(receipt.draft.baseline.policy, receipt.candidatePolicy)) return 'INVALID';
    // Desired complete terms at exactly the next revision prove they are active,
    // not which writer applied them. No synthetic Vault marker is required.
    return snapshot.policyRevision === receipt.draft.baseline.policyRevision + 1
      && snapshot.configurationRevision === receipt.baseConfigurationRevision
      && samePolicy(snapshot.policy, receipt.candidatePolicy) ? 'COMMITTED' : 'RESOLVED';
  }
  const id = receipt.proposalId ?? receipt.expectedProposalId;
  const proposal = snapshot.vaultState.pendingProposal;
  if (proposal?.id === id && proposal.basePolicyRevision === receipt.draft.baseline.policyRevision
    && proposal.baseConfigurationRevision === receipt.baseConfigurationRevision && samePolicy(proposal.candidatePolicy, receipt.candidatePolicy)) return 'WAITING';
  if (snapshot.vaultState.lastApplied?.proposalId === id && snapshot.policyRevision === receipt.draft.baseline.policyRevision + 1
    && samePolicy(snapshot.policy, receipt.candidatePolicy)) return 'COMMITTED';
  return receipt.proposalId === null ? 'UNKNOWN' : 'RESOLVED';
}
