import { destinationId } from './home-model.js';
import { validDestinationId } from './destination-metadata.js';
export const usagePreferencesKey = 'atlas-destination-usage-v1';
export const usageHalfLifeMs = 7 * 24 * 60 * 60 * 1000;
export function readDestinationUsage(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 2000)
        return {};
    const usage = Object.create(null);
    for (const [id, record] of Object.entries(value)) {
        if (!validDestinationId(id) || record === null || typeof record !== 'object')
            return {};
        const item = record;
        if (!Number.isSafeInteger(item.count) || item.count < 1 || !Number.isFinite(item.score) || item.score <= 0 || item.score > 1000000
            || !Number.isSafeInteger(item.lastOpenedAt) || item.lastOpenedAt < 0)
            return {};
        usage[id] = { count: item.count, score: item.score, lastOpenedAt: item.lastOpenedAt };
    }
    return usage;
}
export function usageScore(record, now) {
    return record === undefined ? 0 : record.score * 2 ** (-Math.max(0, now - record.lastOpenedAt) / usageHalfLifeMs);
}
export function recordDestinationLaunch(usage, id, now) {
    if (!validDestinationId(id) || !Number.isSafeInteger(now) || now < 0)
        return usage;
    const previous = usage[id];
    return { ...usage, [id]: { count: Math.min(Number.MAX_SAFE_INTEGER, (previous?.count ?? 0) + 1),
            score: Math.min(1000000, usageScore(previous, now) + 1), lastOpenedAt: now } };
}
export function rankDestinations(entries, usage, now) {
    return entries.map((entry, index) => ({ entry, index })).sort((a, b) => usageScore(usage[destinationId(b.entry)], now) - usageScore(usage[destinationId(a.entry)], now) || a.index - b.index).map(item => item.entry);
}
