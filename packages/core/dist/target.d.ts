import type { SiteTarget } from "./models.js";
/** Shared by requests and policy entries; unsupported forms return null. */
export declare function normalizeHostname(input: unknown): string | null;
/** Accept a bare hostname, an HTTP(S) URL, or a SiteTarget data object. */
export declare function normalizeTarget(input: unknown): SiteTarget | null;
