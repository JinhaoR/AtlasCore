import type { AccessState } from "./access-models.js";
import type { Policy } from "./models.js";

export interface VaultTiming {
  readonly waitMs: number;
  readonly confirmationWindowMs: number;
}

export interface PolicyProposal {
  readonly id: number;
  readonly basePolicyRevision: number;
  readonly candidatePolicy: Policy;
  readonly createdAt: number;
  readonly readyAt: number;
  readonly confirmBy: number;
}

export interface AppliedPolicyProposal {
  readonly proposalId: number;
  readonly policyRevision: number;
}

/** Plain domain state. Waiting/readiness/expiry are derived from explicit time. */
export interface VaultState {
  readonly pendingProposal: PolicyProposal | null;
  readonly nextProposalId: number;
  readonly lastObservedAt: number;
  readonly policyRevision: number;
  readonly lastApplied: AppliedPolicyProposal | null;
}

/** Supplied by the trusted owner; website data is not an authoritative context. */
export interface VaultContext {
  readonly policy: Policy;
  readonly policyRevision: number;
  readonly state: VaultState;
  readonly accessState: AccessState;
  readonly now: number;
}

export type VaultError =
  | "INVALID_POLICY" | "INVALID_STATE" | "INVALID_ACCESS_STATE"
  | "INVALID_POLICY_REVISION" | "INVALID_TIME" | "CLOCK_ROLLBACK" | "POLICY_ROLLBACK"
  | "INVALID_CANDIDATE_POLICY" | "INVALID_TIMING" | "INVALID_PROPOSAL_ID"
  | "PROPOSAL_NOT_FOUND" | "ALREADY_COMMITTED" | "PROPOSAL_PENDING" | "NO_POLICY_CHANGE"
  | "NOT_READY" | "PROPOSAL_EXPIRED" | "POLICY_CHANGED"
  | "TIME_OVERFLOW" | "ID_EXHAUSTED" | "REVISION_EXHAUSTED";

export interface PolicyListChanges {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export type PolicyClassification = "WHITELIST" | "BLACKLIST" | "GREYLIST";

export interface PolicyClassificationChange {
  readonly hostname: string;
  readonly before: PolicyClassification;
  readonly after: PolicyClassification;
}

export interface PolicyReview {
  readonly proposalId: number;
  readonly basePolicyRevision: number;
  readonly candidatePolicy: Policy;
  readonly createdAt: number;
  readonly readyAt: number;
  readonly confirmBy: number;
  readonly phase: "WAITING" | "READY" | "EXPIRED";
  readonly whitelist: PolicyListChanges;
  readonly blacklist: PolicyListChanges;
  readonly classifications: readonly PolicyClassificationChange[];
  readonly invalidatesAccess: true;
}

export type PolicyReviewResult =
  | { readonly ok: true; readonly review: PolicyReview }
  | { readonly ok: false; readonly reason: VaultError };

export interface VaultSnapshot {
  readonly policy: Policy;
  readonly policyRevision: number;
  readonly vaultState: VaultState;
  readonly accessState: AccessState;
}

/** Prepared by explicit confirmation; not an active policy or a save acknowledgement. */
export interface VaultCommitCandidate {
  readonly proposalId: number;
  readonly expectedPolicyRevision: number;
  readonly preparedAt: number;
  readonly nextSnapshot: VaultSnapshot;
}

export interface VaultRejection {
  readonly ok: false;
  readonly reason: VaultError;
  /** Retain valid observations even on rejection. Null means invalid context. */
  readonly nextState: VaultState | null;
}

export type PolicyProposalResult = VaultRejection | {
  readonly ok: true;
  readonly type: "PROPOSED";
  readonly proposal: PolicyProposal;
  readonly nextState: VaultState;
};

export type VaultCommitPreparation = VaultRejection | {
  readonly ok: true;
  readonly type: "COMMIT_PREPARED";
  readonly candidate: VaultCommitCandidate;
  /** Observation only: the pending proposal is consumed only in the candidate. */
  readonly nextState: VaultState;
};

export type PolicyCancellation = VaultRejection | {
  readonly ok: true;
  readonly type: "CANCELLED";
  readonly proposalId: number;
  readonly nextState: VaultState;
};
