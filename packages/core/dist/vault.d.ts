import type { PolicyCancellation, PolicyProposalResult, PolicyReviewResult, VaultCommitPreparation } from "./vault-models.js";
export declare function createPolicyProposal(candidateInput: unknown, input: unknown, timingInput: unknown): PolicyProposalResult;
/** Settings share the same pending slot, freeze, review, confirmation and consumption. */
export declare function createSettingsProposal(candidateInput: unknown, input: unknown): PolicyProposalResult;
/** A read-only view of the frozen proposal, including actual Blacklist precedence. */
export declare function reviewPolicyProposal(proposalId: unknown, input: unknown): PolicyReviewResult;
/** Explicit confirmation computes a complete candidate. It does not publish or save policy. */
export declare function prepareVaultCommit(proposalId: unknown, input: unknown): VaultCommitPreparation;
/** Consume a pending proposal, including expired/stale ones, without changing policy. */
export declare function cancelPolicyProposal(proposalId: unknown, input: unknown): PolicyCancellation;
