import type { Decision } from "./models.js";
/** Pure evaluation of plain input data. No state, time, storage, or side effects. */
export declare function evaluate(requestedSite: unknown, currentPolicy: unknown): Decision;
/** Evaluate a collection against one fully validated policy. No retained authority or cache. */
export declare function evaluateMany(requestedSites: readonly unknown[], currentPolicy: unknown): readonly Decision[];
