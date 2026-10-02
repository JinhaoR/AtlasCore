import type { JourneyEvaluation, JourneyTransition } from "./journey-models.js";
/** Only a trusted explicit start may create an attempt; no arrival or redirect calls this automatically. */
export declare function startJourney(requestedRoot: unknown, contextId: unknown, input: unknown, limitsInput: unknown): JourneyTransition;
/** Evaluate a proposed step. It cannot move the current location or complete a return. */
export declare function evaluateJourneyNavigation(navigation: unknown, input: unknown): JourneyEvaluation;
/** Trusted owner records an adopted step, or an actual root arrival, against latest state. */
export declare function recordJourneyNavigation(navigation: unknown, input: unknown): JourneyEvaluation;
/** Explicit housekeeping permits expiry handling even when no navigation occurs. */
export declare function observeJourneys(input: unknown): JourneyTransition;
export declare function cancelJourney(id: unknown, contextId: unknown, input: unknown): JourneyTransition;
export declare function closeJourneyContext(id: unknown, contextId: unknown, input: unknown): JourneyTransition;
