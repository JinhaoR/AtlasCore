import { nonnegativeInteger, positiveInteger } from "./access-state.js";
import { evaluate } from "./evaluate.js";
import type {
  Journey, JourneyContext, JourneyEndReason, JourneyError, JourneyLimits, JourneyState,
} from "./journey-models.js";
import { normalizePolicy } from "./policy.js";
import { normalizeHostname } from "./target.js";

export function hasJourneyFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}

export function validContextId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** All records must be owned copies before freezing; never freeze caller data. */
export function freezeJourneyState(state: JourneyState): JourneyState {
  state.journeys.forEach(Object.freeze);
  Object.freeze(state.journeys);
  return Object.freeze(state);
}

/** Explicit initialization only. Invalid state never becomes an empty state. */
export function createJourneyState(): JourneyState {
  return freezeJourneyState({ journeys: [], nextJourneyId: 1, lastObservedAt: 0, policyRevision: 0 });
}

export function readJourneyLimits(value: unknown): JourneyLimits | null {
  if (!hasJourneyFields(value, ["lifetimeMs", "maxHops"])
    || !positiveInteger(value.lifetimeMs) || !positiveInteger(value.maxHops)) return null;
  return { lifetimeMs: value.lifetimeMs, maxHops: value.maxHops };
}

function canonicalHostname(value: unknown): value is string {
  return typeof value === "string" && normalizeHostname(value) === value;
}

function isEndReason(value: unknown): value is JourneyEndReason {
  return value === "RETURNED" || value === "EXPIRED" || value === "CANCELLED"
    || value === "CONTEXT_CLOSED" || value === "POLICY_CHANGED" || value === "INVALID_POLICY"
    || value === "ROOT_NOT_WHITELISTED" || value === "HOP_LIMIT";
}

function readJourney(value: unknown): Journey | null {
  if (!hasJourneyFields(value, [
    "id", "contextId", "rootHostname", "currentHostname", "startedAt", "expiresAt",
    "hopCount", "maxHops", "policyRevision", "phase", "endedAt", "endReason",
  ])) return null;
  if (!positiveInteger(value.id) || !validContextId(value.contextId)
    || !canonicalHostname(value.rootHostname) || !canonicalHostname(value.currentHostname)
    || !nonnegativeInteger(value.startedAt) || !nonnegativeInteger(value.expiresAt)
    || value.expiresAt <= value.startedAt || !nonnegativeInteger(value.hopCount)
    || !positiveInteger(value.maxHops) || value.hopCount > value.maxHops
    || !nonnegativeInteger(value.policyRevision)) return null;
  const details = {
    id: value.id, contextId: value.contextId,
    rootHostname: value.rootHostname, currentHostname: value.currentHostname,
    startedAt: value.startedAt, expiresAt: value.expiresAt,
    hopCount: value.hopCount, maxHops: value.maxHops, policyRevision: value.policyRevision,
  };
  const atRoot = value.currentHostname === value.rootHostname;
  if (value.phase === "STARTED" || value.phase === "IN_TRANSIT") {
    if (value.endedAt !== null || value.endReason !== null) return null;
    if (value.phase === "STARTED" ? !atRoot || value.hopCount !== 0 : atRoot || value.hopCount === 0) {
      return null;
    }
    return { ...details, phase: value.phase, endedAt: null, endReason: null };
  }
  if (value.phase !== "ENDED" || !nonnegativeInteger(value.endedAt)
    || value.endedAt < value.startedAt || !isEndReason(value.endReason)) return null;
  if (value.endReason === "RETURNED") {
    if (!atRoot || value.hopCount === 0 || value.endedAt >= value.expiresAt) return null;
  } else if (atRoot ? value.hopCount !== 0 : value.hopCount === 0) return null;
  if (value.endReason === "EXPIRED" && value.endedAt < value.expiresAt) return null;
  if (value.endReason === "HOP_LIMIT" && value.hopCount !== value.maxHops) return null;
  return { ...details, phase: "ENDED", endedAt: value.endedAt, endReason: value.endReason };
}

export function readJourneyState(value: unknown): JourneyState | null {
  if (!hasJourneyFields(value, ["journeys", "nextJourneyId", "lastObservedAt", "policyRevision"])
    || !Array.isArray(value.journeys) || !positiveInteger(value.nextJourneyId)
    || !nonnegativeInteger(value.lastObservedAt) || !nonnegativeInteger(value.policyRevision)) return null;
  const journeys: Journey[] = [];
  const ids = new Set<number>();
  const contexts = new Set<string>();
  for (const entry of value.journeys) {
    const journey = readJourney(entry);
    if (journey === null || ids.has(journey.id) || contexts.has(journey.contextId)
      || journey.id >= value.nextJourneyId || journey.startedAt > value.lastObservedAt
      || journey.policyRevision > value.policyRevision) return null;
    if (journey.phase === "ENDED") {
      if (journey.endedAt > value.lastObservedAt) return null;
    } else if (journey.expiresAt <= value.lastObservedAt || journey.policyRevision !== value.policyRevision) {
      return null;
    }
    ids.add(journey.id);
    contexts.add(journey.contextId);
    journeys.push(journey);
  }
  return { journeys, nextJourneyId: value.nextJourneyId,
    lastObservedAt: value.lastObservedAt, policyRevision: value.policyRevision };
}

export function finishJourney(journey: Journey, endReason: JourneyEndReason, now: number): Journey {
  return journey.phase === "ENDED" ? journey : { ...journey, phase: "ENDED", endedAt: now, endReason };
}

export function replaceJourney(state: JourneyState, journey: Journey): JourneyState {
  return freezeJourneyState({
    ...state, journeys: state.journeys.map((entry) => entry.id === journey.id ? journey : entry),
  });
}

type PreparedJourneyContext =
  | { readonly ok: true; readonly value: JourneyContext }
  | { readonly ok: false; readonly reason: JourneyError; readonly nextState: JourneyState | null };

export function prepareJourneyContext(input: unknown): PreparedJourneyContext {
  const invalid = (reason: JourneyError): PreparedJourneyContext => ({ ok: false, reason, nextState: null });
  if (!hasJourneyFields(input, ["policy", "policyRevision", "state", "now"])) return invalid("INVALID_STATE");
  const state = readJourneyState(input.state);
  if (state === null) return invalid("INVALID_STATE");
  if (!nonnegativeInteger(input.now)) return invalid("INVALID_TIME");
  if (!nonnegativeInteger(input.policyRevision)) return invalid("INVALID_POLICY_REVISION");
  if (input.now < state.lastObservedAt) return invalid("CLOCK_ROLLBACK");
  if (input.policyRevision < state.policyRevision) return invalid("POLICY_ROLLBACK");
  const now = input.now;
  const policyRevision = input.policyRevision;
  const policy = normalizePolicy(input.policy);
  const nextState = freezeJourneyState({
    ...state, lastObservedAt: now, policyRevision,
    journeys: state.journeys.map((journey) => {
      if (journey.phase === "ENDED") return journey;
      if (policy === null) return finishJourney(journey, "INVALID_POLICY", now);
      if (journey.policyRevision !== policyRevision) return finishJourney(journey, "POLICY_CHANGED", now);
      if (evaluate(journey.rootHostname, policy).outcome !== "ALLOW") {
        return finishJourney(journey, "ROOT_NOT_WHITELISTED", now);
      }
      return now >= journey.expiresAt ? finishJourney(journey, "EXPIRED", now) : journey;
    }),
  });
  if (policy === null) return { ok: false, reason: "INVALID_POLICY", nextState };
  return { ok: true, value: { policy, policyRevision, state: nextState, now } };
}
