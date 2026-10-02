import type { Decision, Policy, SiteTarget } from "./models.js";
export interface AccessTiming {
    readonly waitMs: number;
    readonly confirmationWindowMs: number;
    readonly grantDurationMs: number;
}
export interface PendingAccessRequest {
    readonly id: number;
    readonly hostname: string;
    /** Frozen exact-host scope; absent in legacy records means hostname only. */
    readonly scopeHostnames?: readonly string[];
    readonly startedAt: number;
    readonly readyAt: number;
    readonly confirmBy: number;
    readonly grantDurationMs: number;
    readonly policyRevision: number;
}
export interface AccessGrant {
    readonly requestId: number;
    readonly hostname: string;
    readonly scopeHostnames?: readonly string[];
    readonly issuedAt: number;
    readonly expiresAt: number;
    readonly policyRevision: number;
}
/** Plain serializable domain state, not a storage format or a committed snapshot. */
export interface AccessState {
    readonly pendingRequests: readonly PendingAccessRequest[];
    readonly grants: readonly AccessGrant[];
    readonly nextRequestId: number;
    readonly lastObservedAt: number;
    readonly policyRevision: number;
}
/** All times are explicit nonnegative safe integer milliseconds. */
export interface AccessContext {
    readonly policy: Policy;
    readonly policyRevision: number;
    readonly state: AccessState;
    readonly now: number;
}
export type AccessContextError = "INVALID_POLICY" | "INVALID_STATE" | "INVALID_TIME" | "INVALID_POLICY_REVISION" | "CLOCK_ROLLBACK" | "POLICY_ROLLBACK";
export type AccessError = AccessContextError | "INVALID_TARGET" | "INVALID_SCOPE" | "SCOPE_CONFLICT" | "INVALID_TIMING" | "INVALID_REQUEST_ID" | "REQUEST_NOT_FOUND" | "NOT_READY" | "REQUEST_EXPIRED" | "POLICY_CHANGED" | "NOT_GREYLIST" | "GRANT_ACTIVE" | "TIME_OVERFLOW" | "ID_EXHAUSTED";
export type AccessDecision = Decision | {
    readonly outcome: "DENY";
    readonly reason: AccessContextError;
} | (({
    readonly outcome: "WAIT";
    readonly reason: "COOLDOWN";
} | {
    readonly outcome: "REQUIRE_CONFIRMATION";
    readonly reason: "CONFIRMATION_REQUIRED";
}) & {
    readonly target: SiteTarget;
    readonly requestId: number;
    readonly readyAt: number;
    readonly confirmBy: number;
}) | {
    readonly outcome: "ALLOW";
    readonly reason: "ACTIVE_GRANT";
    readonly target: SiteTarget;
    readonly requestId: number;
    readonly expiresAt: number;
} | {
    readonly outcome: "GREYLIST";
    readonly reason: "REQUEST_EXPIRED" | "GRANT_EXPIRED" | "POLICY_CHANGED";
    readonly target: SiteTarget;
};
export interface AccessEvaluation {
    readonly decision: AccessDecision;
    /** Thread this observation onward; null means the context failed validation. */
    readonly nextState: AccessState | null;
}
/** A candidate next state; success here makes no persistence or concurrency claim. */
export type AccessTransition = {
    readonly ok: true;
    readonly type: "STARTED" | "EXISTING_REQUEST";
    readonly request: PendingAccessRequest;
    readonly nextState: AccessState;
} | {
    readonly ok: true;
    readonly type: "CONFIRMED";
    readonly grant: AccessGrant;
    readonly nextState: AccessState;
} | {
    readonly ok: true;
    readonly type: "CANCELLED";
    readonly requestId: number;
    readonly nextState: AccessState;
} | {
    readonly ok: false;
    readonly reason: AccessError;
    /** A valid observation advances metadata only, even on a rejected command. */
    readonly nextState: AccessState | null;
};
