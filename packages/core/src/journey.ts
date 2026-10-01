import { nonnegativeInteger, positiveInteger } from "./access-state.js";
import { evaluate } from "./evaluate.js";
import type {
  Journey, JourneyError, JourneyEvaluation, JourneyState, JourneyTransition,
} from "./journey-models.js";
import {
  continuesJourney, finishJourney, freezeJourneyState, hasJourneyFields, prepareJourneyContext,
  readJourneyContinuation, readJourneyLimits, replaceJourney, validContextId,
} from "./journey-state.js";
import { normalizeTarget } from "./target.js";

function reject(reason: JourneyError, nextState: JourneyState | null): JourneyTransition {
  return { ok: false, reason, nextState };
}

function deny(reason: JourneyError, nextState: JourneyState | null): JourneyEvaluation {
  return { decision: { outcome: "DENY", reason }, nextState };
}

function findJourney(id: unknown, contextId: unknown, state: JourneyState): Journey | JourneyError {
  if (!positiveInteger(id)) return "INVALID_JOURNEY_ID";
  if (!validContextId(contextId)) return "INVALID_CONTEXT_ID";
  const journey = state.journeys.find((entry) => entry.id === id);
  if (journey === undefined) return "JOURNEY_NOT_FOUND";
  return journey.contextId === contextId ? journey : "CONTEXT_MISMATCH";
}

/** Only a trusted explicit start may create an attempt; no arrival or redirect calls this automatically. */
export function startJourney(
  requestedRoot: unknown, contextId: unknown, input: unknown, limitsInput: unknown,
): JourneyTransition {
  const prepared = prepareJourneyContext(input);
  if (!prepared.ok) return reject(prepared.reason, prepared.nextState);
  const { policy, policyRevision, state, now } = prepared.value;
  if (!validContextId(contextId)) return reject("INVALID_CONTEXT_ID", state);
  const target = normalizeTarget(requestedRoot);
  if (target === null) return reject("INVALID_TARGET", state);
  if (evaluate(target, policy).outcome !== "ALLOW") return reject("NOT_WHITELISTED", state);
  const limits = readJourneyLimits(limitsInput);
  if (limits === null) return reject("INVALID_LIMITS", state);
  if (state.journeys.some((entry) => entry.contextId === contextId && entry.phase !== "ENDED")) {
    return reject("JOURNEY_ACTIVE", state);
  }
  if (!positiveInteger(state.nextJourneyId + 1)) return reject("ID_EXHAUSTED", state);
  const expiresAt = now + limits.lifetimeMs;
  if (!nonnegativeInteger(expiresAt)) return reject("TIME_OVERFLOW", state);
  const journey: Journey = {
    id: state.nextJourneyId, contextId, rootHostname: target.hostname, currentHostname: target.hostname,
    phase: "STARTED", startedAt: now, expiresAt, hopCount: 0, maxHops: limits.maxHops,
    policyRevision, endedAt: null, endReason: null,
  };
  const nextState = freezeJourneyState({
    ...state, nextJourneyId: state.nextJourneyId + 1,
    journeys: [...state.journeys.filter((entry) => entry.contextId !== contextId), journey],
  });
  return { ok: true, type: "STARTED", journey, nextState };
}

function navigate(navigation: unknown, input: unknown, record: boolean): JourneyEvaluation {
  const prepared = prepareJourneyContext(input);
  if (!prepared.ok) return deny(prepared.reason, prepared.nextState);
  const { policy, now } = prepared.value;
  let state = prepared.value.state;
  const fields = ["journeyId", "contextId", "target"];
  if (navigation !== null && typeof navigation === "object" && Object.hasOwn(navigation, "continuation")) fields.push("continuation");
  if (!hasJourneyFields(navigation, fields)) {
    return deny("INVALID_NAVIGATION", state);
  }
  const continuation = Object.hasOwn(navigation, "continuation") ? readJourneyContinuation(navigation.continuation) : undefined;
  if (continuation === null) return deny("INVALID_NAVIGATION", state);
  let journey = findJourney(navigation.journeyId, navigation.contextId, state);
  if (typeof journey === "string") return deny(journey, state);
  const target = normalizeTarget(navigation.target);
  if (target === null) return deny("INVALID_TARGET", state);
  const base = evaluate(target, policy);
  if (base.outcome === "DENY") return { decision: base, nextState: state };
  const returning = target.hostname === journey.rootHostname;
  if (journey.phase !== "ENDED" && !returning && !continuesJourney(journey, target.hostname, continuation)) {
    journey = finishJourney(journey, "UNRELATED_NAVIGATION", now);
    state = replaceJourney(state, journey);
  }
  const hop = !returning && target.hostname !== journey.currentHostname;
  if (journey.phase !== "ENDED" && hop && journey.hopCount >= journey.maxHops) {
    journey = finishJourney(journey, "HOP_LIMIT", now);
    state = replaceJourney(state, journey);
  }
  if (journey.phase === "ENDED") {
    return {
      decision: base.outcome === "ALLOW" ? base : {
        outcome: "GREYLIST", reason: "JOURNEY_ENDED", target,
        journeyId: journey.id, endReason: journey.endReason,
      },
      nextState: state,
    };
  }
  const decision = base.outcome === "ALLOW" ? base : {
    outcome: "ALLOW" as const, reason: "ACTIVE_JOURNEY" as const,
    target, journeyId: journey.id, expiresAt: journey.expiresAt,
  };
  if (record) {
    if (returning) {
      journey = finishJourney({ ...journey, currentHostname: target.hostname }, journey.phase === "STARTED" ? "REACHED" : "RETURNED", now);
    } else if (hop) {
      journey = { ...journey, currentHostname: target.hostname,
        phase: "IN_TRANSIT", hopCount: journey.hopCount + 1 };
    }
    if (journey.phase !== "ENDED" && continuation?.kind === "ARRIVAL" && base.outcome === "ALLOW") {
      journey = finishJourney(journey, "DESTINATION_CHANGED", now);
    }
    state = replaceJourney(state, journey);
  }
  return { decision, nextState: state };
}

/** Evaluate a proposed step. It cannot move the current location or complete a return. */
export function evaluateJourneyNavigation(navigation: unknown, input: unknown): JourneyEvaluation {
  return navigate(navigation, input, false);
}

/** Trusted owner records an adopted step, or an actual root arrival, against latest state. */
export function recordJourneyNavigation(navigation: unknown, input: unknown): JourneyEvaluation {
  return navigate(navigation, input, true);
}

/** Explicit housekeeping permits expiry handling even when no navigation occurs. */
export function observeJourneys(input: unknown): JourneyTransition {
  const prepared = prepareJourneyContext(input);
  return prepared.ok ? { ok: true, type: "OBSERVED", nextState: prepared.value.state }
    : reject(prepared.reason, prepared.nextState);
}

function endJourney(
  id: unknown, contextId: unknown, input: unknown, reason: "CANCELLED" | "CONTEXT_CLOSED",
): JourneyTransition {
  const prepared = prepareJourneyContext(input);
  if (!prepared.ok) return reject(prepared.reason, prepared.nextState);
  const { state, now } = prepared.value;
  const existing = findJourney(id, contextId, state);
  if (typeof existing === "string") return reject(existing, state);
  if (existing.phase === "ENDED") return reject("JOURNEY_ENDED", state);
  const journey = finishJourney(existing, reason, now);
  return { ok: true, type: "ENDED", journey, nextState: replaceJourney(state, journey) };
}

export function cancelJourney(id: unknown, contextId: unknown, input: unknown): JourneyTransition {
  return endJourney(id, contextId, input, "CANCELLED");
}

export function closeJourneyContext(id: unknown, contextId: unknown, input: unknown): JourneyTransition {
  return endJourney(id, contextId, input, "CONTEXT_CLOSED");
}
