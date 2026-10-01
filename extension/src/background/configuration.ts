import type { AtlasConfiguration } from '@atlas/core';

/** Development durations, supplied by the trusted host, never by websites or UI commands. */
export const configuration: AtlasConfiguration = {
  accessTiming: { waitMs: 10_000, confirmationWindowMs: 60_000, grantDurationMs: 60_000 },
  vaultTiming: { waitMs: 30_000, confirmationWindowMs: 60_000 },
  journeyLimits: { lifetimeMs: 300_000, maxHops: 12 },
};
