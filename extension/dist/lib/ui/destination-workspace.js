import { assessDraft, samePolicy } from './destination-draft.js';
import { emptyDestinationWorkspace } from './draft-storage.js';
/** A single extension-local document, with in-memory failed edits separate from acknowledged storage. */
export class DestinationWorkspaceSession {
    repository;
    changed;
    value = emptyDestinationWorkspace();
    revision = 0;
    loaded = false;
    unsaved = false;
    conflict = false;
    failure = null;
    loadReason = null;
    queue = Promise.resolve();
    constructor(repository, changed) {
        this.repository = repository;
        this.changed = changed;
    }
    async load() {
        try {
            const envelope = await this.repository.load();
            this.value = envelope.value;
            this.revision = envelope.revision;
            this.loaded = true;
            this.unsaved = this.conflict = false;
            this.failure = this.loadReason = null;
            this.changed();
            return true;
        }
        catch (error) {
            this.failure = 'FAILED';
            this.loadReason = error instanceof Error && error.message === 'DRAFT_STORAGE_INVALID' ? 'INVALID' : 'UNAVAILABLE';
            this.changed();
            return false;
        }
    }
    set(value, explicitRetry = false) {
        this.value = structuredClone(value);
        this.unsaved = true;
        this.changed();
        if (!this.loaded || this.conflict || this.failure && !explicitRetry)
            return Promise.resolve(false);
        let saved = false;
        const captured = structuredClone(value);
        this.queue = this.queue.then(async () => {
            if (this.conflict || this.failure && !explicitRetry)
                return;
            const result = await this.repository.save(this.revision, captured);
            if (result.type === 'SAVED') {
                this.revision = result.envelope.revision;
                this.failure = null;
                this.unsaved = JSON.stringify(this.value) !== JSON.stringify(captured);
                saved = true;
            }
            else if (result.type === 'CONFLICT')
                this.conflict = true;
            else
                this.failure = result.type;
            this.changed();
        }).catch(() => { this.failure = 'UNCERTAIN'; this.changed(); });
        return this.queue.then(() => saved);
    }
    setDraft(draft) { return this.set({ ...this.value, draft }); }
    idle() { return this.queue; }
    async refresh() {
        if (!this.loaded || this.unsaved || this.failure || this.conflict)
            return;
        await this.idle();
        if (this.unsaved || this.failure || this.conflict)
            return;
        const revision = this.revision, value = this.value;
        try {
            const envelope = await this.repository.load();
            // This read may finish after a local edit or discard. It cannot replace or
            // flag work that was saved while the read was in flight.
            if (this.revision !== revision || this.value !== value || this.unsaved || this.failure || this.conflict)
                return;
            if (envelope.revision === this.revision)
                return;
            // A viewing page can adopt remote state. An editor retains its inputs until explicit reload.
            if (this.value.draft !== null) {
                this.conflict = true;
                this.changed();
                return;
            }
            this.value = envelope.value;
            this.revision = envelope.revision;
            this.changed();
        }
        catch {
            if (this.revision === revision && this.value === value) {
                this.failure = 'FAILED';
                this.changed();
            }
        }
    }
    async retry() {
        await this.idle();
        if (!this.loaded || this.conflict)
            return false;
        return this.set(this.value, true);
    }
}
/** Match a receipt against verified Core data. No writes, confirmation or permission. */
export function receiptOutcome(receipt, snapshot) {
    const assessment = assessDraft(receipt.draft, receipt.draft.baseline);
    if (!assessment.candidatePolicy || !samePolicy(assessment.candidatePolicy, receipt.candidatePolicy))
        return 'INVALID';
    if (receipt.kind === 'DISPLAY')
        return snapshot.policyRevision === receipt.draft.baseline.policyRevision
            && samePolicy(snapshot.policy, receipt.candidatePolicy) ? 'COMMITTED' : 'INVALID';
    const id = receipt.proposalId ?? receipt.expectedProposalId;
    const proposal = snapshot.vaultState.pendingProposal;
    if (proposal?.id === id && proposal.basePolicyRevision === receipt.draft.baseline.policyRevision
        && proposal.baseConfigurationRevision === receipt.baseConfigurationRevision && samePolicy(proposal.candidatePolicy, receipt.candidatePolicy))
        return 'WAITING';
    if (snapshot.vaultState.lastApplied?.proposalId === id && snapshot.policyRevision === receipt.draft.baseline.policyRevision + 1
        && samePolicy(snapshot.policy, receipt.candidatePolicy))
        return 'COMMITTED';
    return receipt.proposalId === null ? 'UNKNOWN' : 'RESOLVED';
}
