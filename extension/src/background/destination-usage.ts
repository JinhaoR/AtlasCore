import type { Policy } from '@atlas/core';
import { destinationIndex } from '../ui/destinations.js';
import { destinationId } from '../ui/home-model.js';
import { destinationPreferencesKey, readDestinationPreferences } from '../ui/destination-metadata.js';
import { readDestinationUsage, recordDestinationLaunch, usagePreferencesKey } from '../ui/destination-usage.js';

/** One background writer; failure loses only presentation statistics. */
export function saveDestinationLaunch(storage: Pick<Storage, 'getItem' | 'setItem'>, policy: Policy, hostname: string, at: number): void {
  try {
    const metadata = readDestinationPreferences(JSON.parse(storage.getItem(destinationPreferencesKey) ?? 'null'));
    const destination = destinationIndex(policy, metadata.destinations).find(entry => entry.hostnames.includes(hostname));
    if (destination === undefined) return;
    const usage = readDestinationUsage(JSON.parse(storage.getItem(usagePreferencesKey) ?? 'null'));
    storage.setItem(usagePreferencesKey, JSON.stringify(recordDestinationLaunch(usage, destinationId(destination), at)));
  } catch { /* Storage or malformed preferences create no access fallback. */ }
}
