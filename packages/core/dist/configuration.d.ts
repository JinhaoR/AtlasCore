import type { AtlasConfiguration } from './atlas-models.js';
import type { VaultTiming } from './vault-models.js';
export declare function readVaultTiming(input: unknown): VaultTiming | null;
export declare function readConfiguration(input: unknown): AtlasConfiguration | null;
/** Readers produce these fields in a fixed order; caller objects need not have that order. */
export declare function sameConfiguration(left: AtlasConfiguration, right: AtlasConfiguration): boolean;
