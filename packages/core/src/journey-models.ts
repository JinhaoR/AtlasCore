import type { Decision, Policy, SiteTarget } from "./models.js";

export interface JourneyLimits {
  readonly lifetimeMs: number;
  readonly maxHops: number;
}

export type JourneyEndReason =
  | "RETURNED" | "EXPIRED" | "CANCELLED" | "CONTEXT_CLOSED"
  | "POLICY_CHANGED" | "INVALID_POLICY" | "ROOT_NOT_WHITELISTED" | "HOP_LIMIT"
  | "REACHED" | "UNRELATED_NAVIGATION" | "DESTINATION_CHANGED";

interface JourneyDetails {
  readonly id: number;
  readonly contextId: string;
  readonly rootHostname: string;
  readonly currentHostname: string;
  readonly startedAt: number;
  readonly expiresAt: number;
  readonly hopCount: number;
  readonly maxHops: number;
  readonly policyRevision: number;
}

export type Journey = JourneyDetails & (
  | { readonly phase: "STARTED" | "IN_TRANSIT"; readonly endedAt: null; readonly endReason: null }
  | { readonly phase: "ENDED"; readonly endedAt: number; readonly endReason: JourneyEndReason }
);

/** One latest record per context. No policy entries, credentials, or access grants. */
export interface JourneyState {
  readonly journeys: readonly Journey[];
  readonly nextJourneyId: number;
  readonly lastObservedAt: number;
  readonly policyRevision: number;
}

export interface JourneyContext {
  readonly policy: Policy;
  readonly policyRevision: number;
  readonly state: JourneyState;
  readonly now: number;
}

/** The trusted owner supplies identity and serializes top-level navigation steps. */
export interface JourneyNavigation {
  readonly journeyId: number;
  readonly contextId: string;
  readonly target: string | SiteTarget;
  readonly continuation?: JourneyContinuation;
}

/** Trusted host facts, never claims supplied by a website. */
export interface JourneyContinuation {
  readonly kind: "HTTP_REDIRECT" | "SAME_HOST" | "RETAINED" | "ARRIVAL";
  readonly sourceHostname: string;
}

export type JourneyError =
  | "INVALID_POLICY" | "INVALID_STATE" | "INVALID_TIME" | "INVALID_POLICY_REVISION"
  | "CLOCK_ROLLBACK" | "POLICY_ROLLBACK" | "INVALID_TARGET" | "INVALID_LIMITS"
  | "INVALID_CONTEXT_ID" | "INVALID_JOURNEY_ID" | "INVALID_NAVIGATION"
  | "NOT_WHITELISTED" | "JOURNEY_ACTIVE" | "JOURNEY_NOT_FOUND" | "JOURNEY_ENDED"
  | "CONTEXT_MISMATCH" | "ID_EXHAUSTED" | "TIME_OVERFLOW";

export type JourneyDecision = Decision
  | { readonly outcome: "DENY"; readonly reason: JourneyError }
  | {
    readonly outcome: "ALLOW";
    readonly reason: "ACTIVE_JOURNEY";
    readonly target: SiteTarget;
    readonly journeyId: number;
    readonly expiresAt: number;
  }
  | {
    readonly outcome: "GREYLIST";
    readonly reason: "JOURNEY_ENDED";
    readonly target: SiteTarget;
    readonly journeyId: number;
    readonly endReason: JourneyEndReason;
  };

export interface JourneyEvaluation {
  readonly decision: JourneyDecision;
  /** Retain housekeeping observations even when navigation is denied. */
  readonly nextState: JourneyState | null;
}

export type JourneyTransition =
  | { readonly ok: true; readonly type: "STARTED" | "ENDED";
    readonly journey: Journey; readonly nextState: JourneyState }
  | { readonly ok: true; readonly type: "OBSERVED"; readonly nextState: JourneyState }
  | { readonly ok: false; readonly reason: JourneyError; readonly nextState: JourneyState | null };
