import type { AccessEvaluation, AccessTransition } from "./access-models.js";
/** Derive access and advance observation metadata, without creating authorization. */
export declare function evaluateAccess(requestedSite: unknown, input: unknown): AccessEvaluation;
/** Start explicitly, or return the existing unexpired request without changing its terms. */
export declare function startAccess(requestedSite: unknown, input: unknown, timingInput: unknown, scopeInput?: unknown): AccessTransition;
/** Request consumption and grant creation are one complete candidate transition. */
export declare function confirmAccess(requestId: unknown, input: unknown): AccessTransition;
/** Cancelling a pending request never revokes or renews an already issued grant. */
export declare function cancelAccess(requestId: unknown, input: unknown): AccessTransition;
