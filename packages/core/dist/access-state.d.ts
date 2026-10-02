import type { AccessContext, AccessContextError, AccessState, AccessTiming } from "./access-models.js";
export declare function nonnegativeInteger(value: unknown): value is number;
export declare function positiveInteger(value: unknown): value is number;
export declare function readAccessScope(value: unknown, hostname: string): readonly string[] | null;
export declare function accessScope(record: {
    hostname: string;
    scopeHostnames?: readonly string[];
}): readonly string[];
/** Explicit initialization only. Validation never falls back to an empty state. */
export declare function createAccessState(): AccessState;
export declare function readTiming(value: unknown): AccessTiming | null;
export declare function readAccessState(value: unknown): AccessState | null;
type PreparedContext = {
    readonly ok: true;
    readonly value: AccessContext;
} | {
    readonly ok: false;
    readonly reason: AccessContextError;
};
/** Validate all data and copy it before deriving permission or a candidate state. */
export declare function prepareContext(input: unknown): PreparedContext;
export {};
