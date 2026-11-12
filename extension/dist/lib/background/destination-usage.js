import { evaluate } from '@atlas/core';
import { destinationIndex } from '../ui/destinations.js';
import { destinationId } from '../ui/home-model.js';
import { destinationPreferencesKey, readDestinationPreferences } from '../ui/destination-metadata.js';
import { readDestinationUsage, recordDestinationLaunch, usagePreferencesKey } from '../ui/destination-usage.js';
/** One background writer; failure loses only presentation statistics. */
export function saveDestinationLaunch(storage, policy, hostname, at) {
    try {
        const metadata = readDestinationPreferences(JSON.parse(storage.getItem(destinationPreferencesKey) ?? 'null'));
        const decision = evaluate({ hostname }, policy);
        if (decision.outcome !== 'ALLOW')
            return;
        const base = decision.reason === 'WHITELISTED_SCOPE' ? decision.scopeRoot : hostname;
        const entries = destinationIndex(policy, metadata.destinations);
        const destination = entries.find(entry => entry.hostnames.includes(hostname)) ?? entries.find(entry => entry.hostnames.includes(base));
        if (destination === undefined)
            return;
        const usage = readDestinationUsage(JSON.parse(storage.getItem(usagePreferencesKey) ?? 'null'));
        storage.setItem(usagePreferencesKey, JSON.stringify(recordDestinationLaunch(usage, destinationId(destination), at)));
    }
    catch { /* Storage or malformed preferences create no access fallback. */ }
}
