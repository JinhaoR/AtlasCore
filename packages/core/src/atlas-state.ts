import { nonnegativeInteger, readAccessState } from "./access-state.js";
import type {
  AtlasSnapshotComponent, AtlasSnapshotError, AtlasSnapshotValidation,
} from "./atlas-models.js";
import { hasJourneyFields, readJourneyState } from "./journey-state.js";
import { normalizePolicy } from "./policy.js";
import { canonicalPolicy, freezeVaultData, readVaultState, samePolicy } from "./vault-state.js";

import { readConfiguration, sameConfiguration } from "./configuration.js";

/** Validate and copy without observing time, ending Journeys, or initializing missing state. */
export function validateAtlasSnapshot(input: unknown): AtlasSnapshotValidation {
  const invalid = (reason: AtlasSnapshotError, component: AtlasSnapshotComponent): AtlasSnapshotValidation =>
    ({ ok: false, reason, component });
  if (!hasJourneyFields(input, ["policy", "policyRevision", "configuration", "configurationRevision", "accessState", "vaultState", "journeyState"])) {
    return invalid("INVALID_SNAPSHOT", "snapshot");
  }
  const policy = normalizePolicy(input.policy);
  if (policy === null) return invalid("INVALID_POLICY", "policy");
  if (!nonnegativeInteger(input.policyRevision)) return invalid("INVALID_POLICY_REVISION", "policyRevision");
  const configuration = readConfiguration(input.configuration);
  if (configuration === null || !nonnegativeInteger(input.configurationRevision)) return invalid('INVALID_CONFIGURATION', 'configuration');
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
  if ((proposal !== null && proposal.candidateConfiguration === undefined)
    || (vaultState.lastApplied !== null && vaultState.lastApplied.configurationRevision === undefined)) return invalid('INVALID_VAULT_STATE', 'vaultState');
  if ((proposal?.baseConfigurationRevision ?? 0) > input.configurationRevision
    || (vaultState.lastApplied?.configurationRevision ?? 0) > input.configurationRevision) return invalid('CONFIGURATION_ROLLBACK', 'configurationRevision');
  // Preserve Vault's rejection of a contradictory current proposal without rewriting its contents.
  const canonical = canonicalPolicy(policy)!;
  if (proposal !== null && proposal.basePolicyRevision === input.policyRevision
    && proposal.baseConfigurationRevision === input.configurationRevision
    && samePolicy(proposal.candidatePolicy, canonical)
    && sameConfiguration(proposal.candidateConfiguration!, configuration)) {
    return invalid("INVALID_VAULT_STATE", "vaultState");
  }
  return freezeVaultData({
    ok: true,
    snapshot: { policy, policyRevision: input.policyRevision, configuration, configurationRevision: input.configurationRevision, accessState, vaultState, journeyState },
  });
}

/** Explicit v1 migration only. Validate legacy shape before freezing the existing deployment settings. */
export function migrateAtlasSnapshotV1(input: unknown, configurationInput: unknown): AtlasSnapshotValidation {
  const invalid = (): AtlasSnapshotValidation => ({ ok: false, reason: 'INVALID_SNAPSHOT', component: 'snapshot' });
  const configuration = readConfiguration(configurationInput);
  if (configuration === null || !hasJourneyFields(input, ['policy', 'policyRevision', 'accessState', 'vaultState', 'journeyState'])) return invalid();
  const vault = readVaultState(input.vaultState);
  if (vault === null || vault.pendingProposal?.candidateConfiguration !== undefined
    || vault.lastApplied?.configurationRevision !== undefined) return invalid();
  const policy = canonicalPolicy(input.policy);
  if (policy === null || (vault.pendingProposal !== null && vault.pendingProposal.basePolicyRevision === input.policyRevision
    && samePolicy(vault.pendingProposal.candidatePolicy, policy))) return invalid();
  return validateAtlasSnapshot({ ...input, configuration, configurationRevision: 0, vaultState: {
    ...vault, pendingProposal: vault.pendingProposal === null ? null : { ...vault.pendingProposal,
      candidateConfiguration: configuration, baseConfigurationRevision: 0 },
    lastApplied: vault.lastApplied === null ? null : { ...vault.lastApplied, configurationRevision: 0 },
  } });
}
