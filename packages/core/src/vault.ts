import { nonnegativeInteger, positiveInteger } from "./access-state.js";
import { evaluate } from "./evaluate.js";
import type { Policy } from "./models.js";
import type {
  PolicyCancellation, PolicyClassification, PolicyClassificationChange, PolicyListChanges,
  PolicyProposal, PolicyProposalResult, PolicyReviewResult, VaultCommitPreparation,
  VaultContext, VaultError, VaultRejection, VaultState,
} from "./vault-models.js";
import {
  canonicalPolicy, freezeVaultData, prepareVaultContext, readVaultTiming, samePolicy,
} from "./vault-state.js";

function reject(reason: VaultError, nextState: VaultState | null): VaultRejection {
  return freezeVaultData({ ok: false, reason, nextState });
}

/** Freeze one complete proposed policy without changing active policy or access. */
export function createPolicyProposal(
  candidateInput: unknown, input: unknown, timingInput: unknown,
): PolicyProposalResult {
  const prepared = prepareVaultContext(input);
  if (!prepared.ok) return reject(prepared.reason, null);
  const { policy, policyRevision, state, now } = prepared.value;
  if (state.pendingProposal !== null) return reject("PROPOSAL_PENDING", state);
  const candidatePolicy = canonicalPolicy(candidateInput);
  if (candidatePolicy === null) return reject("INVALID_CANDIDATE_POLICY", state);
  if (samePolicy(candidatePolicy, policy)) return reject("NO_POLICY_CHANGE", state);
  const timing = readVaultTiming(timingInput);
  if (timing === null) return reject("INVALID_TIMING", state);
  if (!positiveInteger(state.nextProposalId + 1)) return reject("ID_EXHAUSTED", state);
  const readyAt = now + timing.waitMs;
  const confirmBy = readyAt + timing.confirmationWindowMs;
  if (!nonnegativeInteger(readyAt) || !nonnegativeInteger(confirmBy)) return reject("TIME_OVERFLOW", state);
  const proposal: PolicyProposal = {
    id: state.nextProposalId, basePolicyRevision: policyRevision, candidatePolicy,
    createdAt: now, readyAt, confirmBy,
  };
  return freezeVaultData({
    ok: true, type: "PROPOSED", proposal,
    nextState: { ...state, pendingProposal: proposal, nextProposalId: state.nextProposalId + 1 },
  });
}

function findProposal(proposalId: unknown, context: VaultContext): PolicyProposal | VaultError {
  if (!positiveInteger(proposalId)) return "INVALID_PROPOSAL_ID";
  if (context.state.lastApplied?.proposalId === proposalId) return "ALREADY_COMMITTED";
  const proposal = context.state.pendingProposal;
  if (proposal === null || proposal.id !== proposalId) return "PROPOSAL_NOT_FOUND";
  return proposal;
}

function listChanges(before: readonly string[], after: readonly string[]): PolicyListChanges {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((host) => !beforeSet.has(host)),
    removed: before.filter((host) => !afterSet.has(host)),
  };
}

function classification(hostname: string, policy: Policy): PolicyClassification {
  const decision = evaluate(hostname, policy);
  return decision.outcome === "ALLOW" ? "WHITELIST"
    : decision.outcome === "DENY" ? "BLACKLIST" : "GREYLIST";
}

/** A read-only view of the frozen proposal, including actual Blacklist precedence. */
export function reviewPolicyProposal(proposalId: unknown, input: unknown): PolicyReviewResult {
  const prepared = prepareVaultContext(input);
  if (!prepared.ok) return { ok: false, reason: prepared.reason };
  const { policy, policyRevision, now } = prepared.value;
  const proposal = findProposal(proposalId, prepared.value);
  if (typeof proposal === "string") return { ok: false, reason: proposal };
  if (proposal.basePolicyRevision !== policyRevision) return { ok: false, reason: "POLICY_CHANGED" };
  const candidate = proposal.candidatePolicy;
  const hosts = [...new Set([
    ...policy.whitelist, ...policy.blacklist, ...candidate.whitelist, ...candidate.blacklist,
  ])].sort();
  const classifications: PolicyClassificationChange[] = [];
  for (const hostname of hosts) {
    const before = classification(hostname, policy);
    const after = classification(hostname, candidate);
    if (before !== after) classifications.push({ hostname, before, after });
  }
  return freezeVaultData({
    ok: true,
    review: {
      proposalId: proposal.id, basePolicyRevision: proposal.basePolicyRevision,
      candidatePolicy: candidate, createdAt: proposal.createdAt,
      readyAt: proposal.readyAt, confirmBy: proposal.confirmBy,
      phase: now >= proposal.confirmBy ? "EXPIRED" : now < proposal.readyAt ? "WAITING" : "READY",
      whitelist: listChanges(policy.whitelist, candidate.whitelist),
      blacklist: listChanges(policy.blacklist, candidate.blacklist),
      classifications, invalidatesAccess: true,
    },
  });
}

/** Explicit confirmation computes a complete candidate. It does not publish or save policy. */
export function prepareVaultCommit(proposalId: unknown, input: unknown): VaultCommitPreparation {
  const prepared = prepareVaultContext(input);
  if (!prepared.ok) return reject(prepared.reason, null);
  const { policyRevision, state, accessState, now } = prepared.value;
  const proposal = findProposal(proposalId, prepared.value);
  if (typeof proposal === "string") return reject(proposal, state);
  if (proposal.basePolicyRevision !== policyRevision) return reject("POLICY_CHANGED", state);
  if (now >= proposal.confirmBy) return reject("PROPOSAL_EXPIRED", state);
  if (now < proposal.readyAt) return reject("NOT_READY", state);
  const nextRevision = policyRevision + 1;
  if (!nonnegativeInteger(nextRevision)) return reject("REVISION_EXHAUSTED", state);
  return freezeVaultData({
    ok: true, type: "COMMIT_PREPARED", nextState: state,
    candidate: {
      proposalId: proposal.id, expectedPolicyRevision: policyRevision, preparedAt: now,
      nextSnapshot: {
        policy: proposal.candidatePolicy,
        policyRevision: nextRevision,
        vaultState: {
          ...state, pendingProposal: null, policyRevision: nextRevision,
          lastApplied: { proposalId: proposal.id, policyRevision: nextRevision },
        },
        accessState: { ...accessState, policyRevision: nextRevision },
      },
    },
  });
}

/** Consume a pending proposal, including expired/stale ones, without changing policy. */
export function cancelPolicyProposal(proposalId: unknown, input: unknown): PolicyCancellation {
  const prepared = prepareVaultContext(input);
  if (!prepared.ok) return reject(prepared.reason, null);
  const { state } = prepared.value;
  const proposal = findProposal(proposalId, prepared.value);
  if (typeof proposal === "string") return reject(proposal, state);
  return freezeVaultData({
    ok: true, type: "CANCELLED", proposalId: proposal.id,
    nextState: { ...state, pendingProposal: null },
  });
}
