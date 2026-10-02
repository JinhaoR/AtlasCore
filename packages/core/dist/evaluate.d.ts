import type { Decision } from "./models.js";
/** Pure evaluation of plain input data. No state, time, storage, or side effects. */
export declare function evaluate(requestedSite: unknown, currentPolicy: unknown): Decision;
