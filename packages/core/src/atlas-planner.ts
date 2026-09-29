import { cancelAccess, confirmAccess, evaluateAccess, startAccess } from "./access.js";
import type { AccessTransition } from "./access-models.js";
import { nonnegativeInteger, positiveInteger, readTiming } from "./access-state.js";
import type {
  AtlasConfiguration, AtlasError, AtlasNavigationContext, AtlasOperation, AtlasPlan,
  AtlasPlanResult, AtlasSnapshot,
} from "./atlas-models.js";
import { validateAtlasSnapshot } from "./atlas-state.js";
import {
  cancelJourney, closeJourneyContext, evaluateJourneyNavigation,
  observeJourneys, recordJourneyNavigation, startJourney,
} from "./journey.js";
import type { JourneyTransition } from "./journey-models.js";
import { hasJourneyFields, readJourneyLimits, validContextId } from "./journey-state.js";
import type { SiteTarget } from "./models.js";
import { normalizePolicy } from "./policy.js";
import { normalizeTarget } from "./target.js";
import {
  cancelPolicyProposal, createPolicyProposal, prepareVaultCommit, reviewPolicyProposal,
} from "./vault.js";
import { freezeVaultData, readVaultTiming } from "./vault-state.js";

function makePlan(
  result: AtlasPlanResult, observationSnapshot: AtlasSnapshot | null = null,
  candidateSnapshot: AtlasSnapshot | null = null,
): AtlasPlan {
  // Only copied/validated data or module-owned results reach this helper.
  return freezeVaultData({ result, observationSnapshot, candidateSnapshot });
}

function reject(reason: AtlasError, observation: AtlasSnapshot | null = null): AtlasPlan {
  return makePlan({ type: "REJECTED", reason }, observation);
}

export function readConfiguration(input: unknown): AtlasConfiguration | null {
  if (!hasJourneyFields(input, ["accessTiming", "vaultTiming", "journeyLimits"])) return null;
  const accessTiming = readTiming(input.accessTiming);
  const vaultTiming = readVaultTiming(input.vaultTiming);
  const journeyLimits = readJourneyLimits(input.journeyLimits);
  return accessTiming && vaultTiming && journeyLimits ? { accessTiming, vaultTiming, journeyLimits } : null;
}

function readTarget(input: unknown): SiteTarget | null {
  return hasJourneyFields(input, ["hostname"]) ? normalizeTarget(input) : null;
}

type ParsedOperation =
  | { readonly ok: true; readonly operation: AtlasOperation }
  | { readonly ok: false; readonly reason: AtlasError };

/** Closed command shapes prevent smuggling replacement state/terms into confirmation. */
function readOperation(value: unknown): ParsedOperation {
  const invalid = (reason: AtlasError = "INVALID_OPERATION"): ParsedOperation => ({ ok: false, reason });
  const valid = (operation: AtlasOperation): ParsedOperation => ({ ok: true, operation });
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const input = value as Record<string, unknown>;
  const kind = input.kind;
  switch (kind) {
    case "CHECK_NAVIGATION":
    case "RECORD_JOURNEY_NAVIGATION": {
      if (!hasJourneyFields(input, ["kind", "target", "context"])
        || !hasJourneyFields(input.context, ["contextId", "journeyId"])) return invalid();
      const target = readTarget(input.target);
      if (target === null) return invalid("INVALID_TARGET");
      const { contextId, journeyId } = input.context;
      if (!validContextId(contextId)) return invalid("INVALID_CONTEXT_ID");
      if (journeyId !== null && !positiveInteger(journeyId)) return invalid("INVALID_JOURNEY_ID");
      return valid({ kind, target, context: { contextId, journeyId } });
    }
    case "START_ACCESS": {
      if (!hasJourneyFields(input, ["kind", "target"])) return invalid();
      const target = readTarget(input.target);
      return target === null ? invalid("INVALID_TARGET") : valid({ kind, target });
    }
    case "CONFIRM_ACCESS":
    case "CANCEL_ACCESS":
      if (!hasJourneyFields(input, ["kind", "requestId"])) return invalid();
      return positiveInteger(input.requestId) ? valid({ kind, requestId: input.requestId })
        : invalid("INVALID_REQUEST_ID");
    case "PROPOSE_POLICY": {
      if (!hasJourneyFields(input, ["kind", "candidatePolicy"])) return invalid();
      const candidatePolicy = normalizePolicy(input.candidatePolicy);
      return candidatePolicy === null ? invalid("INVALID_CANDIDATE_POLICY") : valid({ kind, candidatePolicy });
    }
    case "REVIEW_POLICY":
    case "CONFIRM_POLICY":
    case "CANCEL_POLICY":
      if (!hasJourneyFields(input, ["kind", "proposalId"])) return invalid();
      return positiveInteger(input.proposalId) ? valid({ kind, proposalId: input.proposalId })
        : invalid("INVALID_PROPOSAL_ID");
    case "START_JOURNEY": {
      if (!hasJourneyFields(input, ["kind", "root", "contextId"])) return invalid();
      if (!validContextId(input.contextId)) return invalid("INVALID_CONTEXT_ID");
      const root = readTarget(input.root);
      return root === null ? invalid("INVALID_TARGET") : valid({ kind, root, contextId: input.contextId });
    }
    case "CANCEL_JOURNEY":
    case "CLOSE_JOURNEY_CONTEXT":
      if (!hasJourneyFields(input, ["kind", "journeyId", "contextId"])) return invalid();
      if (!validContextId(input.contextId)) return invalid("INVALID_CONTEXT_ID");
      return positiveInteger(input.journeyId)
        ? valid({ kind, journeyId: input.journeyId, contextId: input.contextId })
        : invalid("INVALID_JOURNEY_ID");
    case "OBSERVE_TIME":
      return hasJourneyFields(input, ["kind"]) ? valid({ kind }) : invalid();
    default:
      return invalid();
  }
}

function accessContext(snapshot: AtlasSnapshot, now: number) {
  return { policy: snapshot.policy, policyRevision: snapshot.policyRevision, state: snapshot.accessState, now };
}

function journeyContext(snapshot: AtlasSnapshot, now: number) {
  return { policy: snapshot.policy, policyRevision: snapshot.policyRevision, state: snapshot.journeyState, now };
}

function vaultContext(snapshot: AtlasSnapshot, now: number) {
  return { policy: snapshot.policy, policyRevision: snapshot.policyRevision,
    state: snapshot.vaultState, accessState: snapshot.accessState, now };
}

function accessPlan(operation: AtlasOperation["kind"], transition: AccessTransition, snapshot: AtlasSnapshot): AtlasPlan {
  if (!transition.ok) return reject(transition.reason, snapshot);
  const id = "request" in transition ? transition.request.id
    : "grant" in transition ? transition.grant.requestId : transition.requestId;
  return makePlan({ type: "TRANSITION_PREPARED", operation, id }, snapshot,
    { ...snapshot, accessState: transition.nextState });
}

function journeyPlan(operation: AtlasOperation["kind"], transition: JourneyTransition, snapshot: AtlasSnapshot): AtlasPlan {
  if (!transition.ok) return reject(transition.reason, snapshot);
  if (transition.type === "OBSERVED") return makePlan({ type: "OBSERVED" }, snapshot);
  return makePlan({ type: "TRANSITION_PREPARED", operation, id: transition.journey.id }, snapshot,
    { ...snapshot, journeyState: transition.nextState });
}

function checkBinding(context: AtlasNavigationContext, snapshot: AtlasSnapshot): AtlasError | null {
  if (context.journeyId === null) {
    return snapshot.journeyState.journeys.some((j) => j.contextId === context.contextId && j.phase !== "ENDED")
      ? "CONTEXT_MISMATCH" : null;
  }
  const journey = snapshot.journeyState.journeys.find((j) => j.id === context.journeyId);
  if (journey === undefined) return "JOURNEY_NOT_FOUND";
  return journey.contextId === context.contextId ? null : "CONTEXT_MISMATCH";
}

function navigationPlan(
  operation: Extract<AtlasOperation, { kind: "CHECK_NAVIGATION" | "RECORD_JOURNEY_NAVIGATION" }>,
  snapshot: AtlasSnapshot, now: number,
): AtlasPlan {
  const bindingError = checkBinding(operation.context, snapshot);
  if (bindingError !== null) return reject(bindingError, snapshot);
  const access = evaluateAccess(operation.target, accessContext(snapshot, now));
  if (access.nextState === null) return reject("INVALID_ACCESS_STATE");
  let observation = { ...snapshot, accessState: access.nextState };
  const decision = access.decision;
  const navigation = { ...operation.context, target: operation.target };
  if (operation.context.journeyId !== null) {
    const journey = evaluateJourneyNavigation(navigation, journeyContext(observation, now));
    if (journey.nextState === null) return reject("INVALID_JOURNEY_STATE");
    observation = { ...observation, journeyState: journey.nextState };
    // Invalid Journey operations must never disappear behind another module's ALLOW.
    if (journey.decision.outcome === "DENY" && journey.decision.reason !== "BLACKLISTED") {
      return reject(journey.decision.reason, observation);
    }
    const combined = access.decision.outcome === "DENY" || access.decision.outcome === "ALLOW"
      ? access.decision : journey.decision.outcome === "ALLOW" ? journey.decision : access.decision;
    if (operation.kind === "RECORD_JOURNEY_NAVIGATION" && combined.outcome === "ALLOW") {
      const recorded = recordJourneyNavigation(navigation, journeyContext(observation, now));
      if (recorded.nextState === null) return reject("INVALID_JOURNEY_STATE");
      if (recorded.decision.outcome === "DENY") {
        return makePlan({ type: "ASSESSMENT", decision: recorded.decision }, observation);
      }
      // A spent Journey may coexist with an independently valid grant/Whitelist ALLOW.
      return makePlan({ type: "ASSESSMENT", decision: combined }, observation,
        { ...observation, journeyState: recorded.nextState });
    }
    return makePlan({ type: "ASSESSMENT", decision: combined }, observation);
  }
  // Recording requires a Journey; ordinary navigation needs only an assessment.
  if (operation.kind === "RECORD_JOURNEY_NAVIGATION") return reject("INVALID_JOURNEY_ID", observation);
  return makePlan({ type: "ASSESSMENT", decision }, observation);
}

/** Pure composition only: no storage, clocks, browser events, or mutable owner state. */
export function planAtlasOperation(operationInput: unknown, contextInput: unknown): AtlasPlan {
  if (!hasJourneyFields(contextInput, ["snapshot", "now", "configuration"])) return reject("INVALID_CONTEXT");
  const validated = validateAtlasSnapshot(contextInput.snapshot);
  if (!validated.ok) return reject(validated.reason);
  const snapshot = validated.snapshot;
  const now = contextInput.now;
  if (!nonnegativeInteger(now)) return reject("INVALID_TIME");
  if ([snapshot.accessState, snapshot.vaultState, snapshot.journeyState].some((s) => now < s.lastObservedAt)) {
    return reject("CLOCK_ROLLBACK");
  }
  const configuration = readConfiguration(contextInput.configuration);
  if (configuration === null) return reject("INVALID_CONFIGURATION");
  const parsed = readOperation(operationInput);
  const journeys = observeJourneys(journeyContext(snapshot, now));
  if (!journeys.ok) return reject(journeys.reason);
  const observation: AtlasSnapshot = {
    ...snapshot,
    accessState: { ...snapshot.accessState, lastObservedAt: now, policyRevision: snapshot.policyRevision },
    vaultState: { ...snapshot.vaultState, lastObservedAt: now, policyRevision: snapshot.policyRevision },
    journeyState: journeys.nextState,
  };
  if (!parsed.ok) return reject(parsed.reason, observation);
  const operation = parsed.operation;
  switch (operation.kind) {
    case "CHECK_NAVIGATION":
    case "RECORD_JOURNEY_NAVIGATION":
      return navigationPlan(operation, observation, now);
    case "OBSERVE_TIME":
      return makePlan({ type: "OBSERVED" }, observation);
    case "START_ACCESS":
      return accessPlan(operation.kind,
        startAccess(operation.target, accessContext(observation, now), configuration.accessTiming), observation);
    case "CONFIRM_ACCESS":
      return accessPlan(operation.kind, confirmAccess(operation.requestId, accessContext(observation, now)), observation);
    case "CANCEL_ACCESS":
      return accessPlan(operation.kind, cancelAccess(operation.requestId, accessContext(observation, now)), observation);
    case "START_JOURNEY":
      return journeyPlan(operation.kind, startJourney(operation.root, operation.contextId,
        journeyContext(observation, now), configuration.journeyLimits), observation);
    case "CANCEL_JOURNEY":
    case "CLOSE_JOURNEY_CONTEXT": {
      const end = operation.kind === "CANCEL_JOURNEY" ? cancelJourney : closeJourneyContext;
      return journeyPlan(operation.kind,
        end(operation.journeyId, operation.contextId, journeyContext(observation, now)), observation);
    }
    case "PROPOSE_POLICY": {
      const proposed = createPolicyProposal(operation.candidatePolicy, vaultContext(observation, now), configuration.vaultTiming);
      return proposed.ok ? makePlan({ type: "TRANSITION_PREPARED", operation: operation.kind, id: proposed.proposal.id },
        observation, { ...observation, vaultState: proposed.nextState }) : reject(proposed.reason, observation);
    }
    case "CANCEL_POLICY": {
      const cancelled = cancelPolicyProposal(operation.proposalId, vaultContext(observation, now));
      return cancelled.ok ? makePlan({ type: "TRANSITION_PREPARED", operation: operation.kind, id: cancelled.proposalId },
        observation, { ...observation, vaultState: cancelled.nextState }) : reject(cancelled.reason, observation);
    }
    case "CONFIRM_POLICY": {
      const prepared = prepareVaultCommit(operation.proposalId, vaultContext(observation, now));
      if (!prepared.ok) return reject(prepared.reason, observation);
      const next = { ...observation, ...prepared.candidate.nextSnapshot };
      const invalidated = observeJourneys(journeyContext(next, now));
      if (!invalidated.ok) return reject(invalidated.reason, observation);
      return makePlan({ type: "POLICY_COMMIT_PREPARED", proposalId: operation.proposalId,
        expectedPolicyRevision: prepared.candidate.expectedPolicyRevision }, observation,
      { ...next, journeyState: invalidated.nextState });
    }
    case "REVIEW_POLICY": {
      // Review uses original validated state and publishes no observation checkpoint.
      const reviewed = reviewPolicyProposal(operation.proposalId, vaultContext(snapshot, now));
      return reviewed.ok ? makePlan({ type: "REVIEW", review: reviewed.review }) : reject(reviewed.reason);
    }
  }
}
