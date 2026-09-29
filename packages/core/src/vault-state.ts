import { nonnegativeInteger, positiveInteger, prepareContext } from "./access-state.js";
import type { Policy } from "./models.js";
import { normalizePolicy } from "./policy.js";
import type {
  AppliedPolicyProposal, PolicyProposal, VaultContext, VaultError, VaultState, VaultTiming,
} from "./vault-models.js";

function hasFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}

/** Only use on newly owned, acyclic domain data; never freeze caller-owned inputs. */
export function freezeVaultData<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeVaultData(child);
    Object.freeze(value);
  }
  return value;
}

export function canonicalPolicy(value: unknown): Policy | null {
  const policy = normalizePolicy(value);
  if (policy === null) return null;
  return {
    whitelist: [...new Set(policy.whitelist)].sort(),
    blacklist: [...new Set(policy.blacklist)].sort(),
  };
}

function sameEntries(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((host, index) => host === right[index]);
}

/** Both arguments have already been canonicalized. */
export function samePolicy(left: Policy, right: Policy): boolean {
  return sameEntries(left.whitelist, right.whitelist) && sameEntries(left.blacklist, right.blacklist);
}

/** Explicit initialization only; never a fallback for damaged existing state. */
export function createVaultState(): VaultState {
  return freezeVaultData({
    pendingProposal: null, nextProposalId: 1, lastObservedAt: 0,
    policyRevision: 0, lastApplied: null,
  });
}

export function readVaultTiming(value: unknown): VaultTiming | null {
  if (!hasFields(value, ["waitMs", "confirmationWindowMs"])
    || !positiveInteger(value.waitMs) || !positiveInteger(value.confirmationWindowMs)) return null;
  return { waitMs: value.waitMs, confirmationWindowMs: value.confirmationWindowMs };
}

function readProposal(value: unknown): PolicyProposal | null {
  if (!hasFields(value, [
    "id", "basePolicyRevision", "candidatePolicy", "createdAt", "readyAt", "confirmBy",
  ])) return null;
  if (!positiveInteger(value.id) || !nonnegativeInteger(value.basePolicyRevision)
    || !nonnegativeInteger(value.createdAt) || !nonnegativeInteger(value.readyAt)
    || !nonnegativeInteger(value.confirmBy)
    || value.readyAt <= value.createdAt || value.confirmBy <= value.readyAt) return null;
  const candidatePolicy = canonicalPolicy(value.candidatePolicy);
  // Stored proposals must already be canonical; validation must not repair reviewed contents.
  if (candidatePolicy === null || !hasFields(value.candidatePolicy, ["whitelist", "blacklist"])
    || !Array.isArray(value.candidatePolicy.whitelist) || !Array.isArray(value.candidatePolicy.blacklist)
    || !sameEntries(value.candidatePolicy.whitelist, candidatePolicy.whitelist)
    || !sameEntries(value.candidatePolicy.blacklist, candidatePolicy.blacklist)) return null;
  return {
    id: value.id, basePolicyRevision: value.basePolicyRevision, candidatePolicy,
    createdAt: value.createdAt, readyAt: value.readyAt, confirmBy: value.confirmBy,
  };
}

function readApplied(value: unknown): AppliedPolicyProposal | null {
  if (!hasFields(value, ["proposalId", "policyRevision"])
    || !positiveInteger(value.proposalId) || !positiveInteger(value.policyRevision)) return null;
  return { proposalId: value.proposalId, policyRevision: value.policyRevision };
}

export function readVaultState(value: unknown): VaultState | null {
  if (!hasFields(value, [
    "pendingProposal", "nextProposalId", "lastObservedAt", "policyRevision", "lastApplied",
  ]) || !positiveInteger(value.nextProposalId) || !nonnegativeInteger(value.lastObservedAt)
    || !nonnegativeInteger(value.policyRevision)) return null;
  const pendingProposal = value.pendingProposal === null ? null : readProposal(value.pendingProposal);
  const lastApplied = value.lastApplied === null ? null : readApplied(value.lastApplied);
  if ((value.pendingProposal !== null && pendingProposal === null)
    || (value.lastApplied !== null && lastApplied === null)) return null;
  if (pendingProposal !== null && (pendingProposal.id >= value.nextProposalId
    || pendingProposal.createdAt > value.lastObservedAt
    || pendingProposal.basePolicyRevision > value.policyRevision)) return null;
  if (lastApplied !== null && (lastApplied.proposalId >= value.nextProposalId
    || lastApplied.policyRevision > value.policyRevision)) return null;
  if (pendingProposal !== null && lastApplied !== null
    && (pendingProposal.id <= lastApplied.proposalId
      || pendingProposal.basePolicyRevision < lastApplied.policyRevision)) return null;
  return {
    pendingProposal, nextProposalId: value.nextProposalId, lastObservedAt: value.lastObservedAt,
    policyRevision: value.policyRevision, lastApplied,
  };
}

type PreparedVaultContext =
  | { readonly ok: true; readonly value: VaultContext }
  | { readonly ok: false; readonly reason: VaultError };

/** Validate and copy the complete latest snapshot before computing any change. */
export function prepareVaultContext(input: unknown): PreparedVaultContext {
  if (!hasFields(input, ["policy", "policyRevision", "state", "accessState", "now"])) {
    return { ok: false, reason: "INVALID_STATE" };
  }
  const policy = canonicalPolicy(input.policy);
  if (policy === null) return { ok: false, reason: "INVALID_POLICY" };
  if (!nonnegativeInteger(input.policyRevision)) return { ok: false, reason: "INVALID_POLICY_REVISION" };
  const state = readVaultState(input.state);
  if (state === null) return { ok: false, reason: "INVALID_STATE" };
  if (!nonnegativeInteger(input.now)) return { ok: false, reason: "INVALID_TIME" };
  if (input.now < state.lastObservedAt) return { ok: false, reason: "CLOCK_ROLLBACK" };
  if (input.policyRevision < state.policyRevision) return { ok: false, reason: "POLICY_ROLLBACK" };
  const access = prepareContext({
    policy, policyRevision: input.policyRevision, state: input.accessState, now: input.now,
  });
  if (!access.ok) {
    return { ok: false, reason: access.reason === "INVALID_STATE" ? "INVALID_ACCESS_STATE" : access.reason };
  }
  if (state.pendingProposal !== null && state.pendingProposal.basePolicyRevision === input.policyRevision
    && samePolicy(state.pendingProposal.candidatePolicy, policy)) {
    return { ok: false, reason: "INVALID_STATE" };
  }
  return {
    ok: true,
    value: {
      policy, policyRevision: input.policyRevision, now: input.now, accessState: access.value.state,
      state: { ...state, lastObservedAt: input.now, policyRevision: input.policyRevision },
    },
  };
}
