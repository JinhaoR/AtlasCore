import { nonnegativeInteger, readAccessState } from "./access-state.js";
import type {
  AtlasSnapshotComponent, AtlasSnapshotError, AtlasSnapshotValidation,
} from "./atlas-models.js";
import { hasJourneyFields, readJourneyState } from "./journey-state.js";
import { normalizePolicy } from "./policy.js";
import { canonicalPolicy, freezeVaultData, readVaultState, samePolicy } from "./vault-state.js";

/** Validate and copy without observing time, ending Journeys, or initializing missing state. */
export function validateAtlasSnapshot(input: unknown): AtlasSnapshotValidation {
  const invalid = (reason: AtlasSnapshotError, component: AtlasSnapshotComponent): AtlasSnapshotValidation =>
    ({ ok: false, reason, component });
  if (!hasJourneyFields(input, ["policy", "policyRevision", "accessState", "vaultState", "journeyState"])) {
    return invalid("INVALID_SNAPSHOT", "snapshot");
  }
  const policy = normalizePolicy(input.policy);
  if (policy === null) return invalid("INVALID_POLICY", "policy");
  if (!nonnegativeInteger(input.policyRevision)) return invalid("INVALID_POLICY_REVISION", "policyRevision");
  const accessState = readAccessState(input.accessState);
  if (accessState === null) return invalid("INVALID_ACCESS_STATE", "accessState");
  const vaultState = readVaultState(input.vaultState);
  if (vaultState === null) return invalid("INVALID_VAULT_STATE", "vaultState");
  const journeyState = readJourneyState(input.journeyState);
  if (journeyState === null) return invalid("INVALID_JOURNEY_STATE", "journeyState");
  for (const [component, state] of [
    ["accessState", accessState], ["vaultState", vaultState], ["journeyState", journeyState],
  ] as const) {
    if (state.policyRevision > input.policyRevision) return invalid("POLICY_ROLLBACK", component);
  }
  const proposal = vaultState.pendingProposal;
  // Preserve Vault's rejection of a contradictory current proposal without rewriting its contents.
  const canonical = canonicalPolicy(policy)!;
  if (proposal !== null && proposal.basePolicyRevision === input.policyRevision
    && samePolicy(proposal.candidatePolicy, canonical)) {
    return invalid("INVALID_VAULT_STATE", "vaultState");
  }
  return freezeVaultData({
    ok: true,
    snapshot: { policy, policyRevision: input.policyRevision, accessState, vaultState, journeyState },
  });
}
