import type { Journey, JourneyContext, JourneyContinuation, JourneyEndReason, JourneyError, JourneyLimits, JourneyState } from "./journey-models.js";
export declare function hasJourneyFields(value: unknown, fields: readonly string[]): value is Record<string, unknown>;
export declare function validContextId(value: unknown): value is string;
/** All records must be owned copies before freezing; never freeze caller data. */
export declare function freezeJourneyState(state: JourneyState): JourneyState;
/** Explicit initialization only. Invalid state never becomes an empty state. */
export declare function createJourneyState(): JourneyState;
export declare function readJourneyLimits(value: unknown): JourneyLimits | null;
export declare function readJourneyContinuation(value: unknown): JourneyContinuation | null;
export declare function continuesJourney(journey: Journey, target: string, evidence?: JourneyContinuation): boolean;
export declare function readJourneyState(value: unknown): JourneyState | null;
export declare function finishJourney(journey: Journey, endReason: JourneyEndReason, now: number): Journey;
export declare function replaceJourney(state: JourneyState, journey: Journey): JourneyState;
type PreparedJourneyContext = {
    readonly ok: true;
    readonly value: JourneyContext;
} | {
    readonly ok: false;
    readonly reason: JourneyError;
    readonly nextState: JourneyState | null;
};
export declare function prepareJourneyContext(input: unknown): PreparedJourneyContext;
export {};
