import { positiveInteger, readTiming } from './access-state.js';
import { hasJourneyFields, readJourneyLimits } from './journey-state.js';
export function readVaultTiming(input) {
    if (!hasJourneyFields(input, ['waitMs', 'confirmationWindowMs'])
        || !positiveInteger(input.waitMs) || !positiveInteger(input.confirmationWindowMs))
        return null;
    return { waitMs: input.waitMs, confirmationWindowMs: input.confirmationWindowMs };
}
export function readConfiguration(input) {
    if (!hasJourneyFields(input, ['accessTiming', 'vaultTiming', 'journeyLimits']))
        return null;
    const accessTiming = readTiming(input.accessTiming);
    const vaultTiming = readVaultTiming(input.vaultTiming);
    const journeyLimits = readJourneyLimits(input.journeyLimits);
    return accessTiming && vaultTiming && journeyLimits ? { accessTiming, vaultTiming, journeyLimits } : null;
}
/** Readers produce these fields in a fixed order; caller objects need not have that order. */
export function sameConfiguration(left, right) {
    return JSON.stringify(readConfiguration(left)) === JSON.stringify(readConfiguration(right));
}
