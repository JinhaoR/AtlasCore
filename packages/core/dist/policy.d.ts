import type { Policy } from "./models.js";
/** Validate the whole policy and copy its lists before making any decision. */
export declare function normalizePolicy(input: unknown): Policy | null;
