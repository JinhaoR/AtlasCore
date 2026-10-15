import { curatedWhitelist } from '../presets/curated-whitelist.js';
/** Category identity is presentation only. Stored legacy spellings are not rewritten. */
export const categoryKey = (label) => label.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
export const categoryLabel = (label) => label.trim().replace(/\s+/g, ' ');
export const predefinedCategories = [...curatedWhitelist.map(group => group.label), 'Your destinations'];
export function categorySuggestions(committed, drafted = []) {
    const labels = new Map();
    for (const label of [...predefinedCategories, ...committed, ...drafted]) {
        const normalized = categoryLabel(label);
        if (normalized && normalized.length <= 64 && !labels.has(categoryKey(normalized)))
            labels.set(categoryKey(normalized), normalized);
    }
    return [...labels.values()];
}
export function canonicalCategory(label, existing) {
    return existing.find(value => categoryKey(value) === categoryKey(label)) ?? categoryLabel(label);
}
