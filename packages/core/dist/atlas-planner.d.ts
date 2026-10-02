import type { AtlasPlan } from "./atlas-models.js";
export { readConfiguration } from "./configuration.js";
/** Pure composition only: no storage, clocks, browser events, or mutable owner state. */
export declare function planAtlasOperation(operationInput: unknown, contextInput: unknown): AtlasPlan;
