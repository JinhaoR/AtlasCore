import { curatedWhitelist } from '../presets/curated-whitelist.js';

/** Category identity is presentation only. Stored legacy spellings are not rewritten. */
export const categoryKey = (label: string): string => label.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
export const categoryLabel = (label: string): string => label.trim().replace(/\s+/g, ' ');
export const predefinedCategories = [...curatedWhitelist.map(group => group.label), 'Your destinations'];

export function categorySuggestions(committed: readonly string[], drafted: readonly string[] = []): readonly string[] {
  const labels = new Map<string, string>();
  for (const label of [...predefinedCategories, ...committed, ...drafted]) {
    const normalized = categoryLabel(label);
    if (normalized && normalized.length <= 64 && !labels.has(categoryKey(normalized))) labels.set(categoryKey(normalized), normalized);
  }
  return [...labels.values()];
}

export function canonicalCategory(label: string, existing: readonly string[]): string {
  return existing.find(value => categoryKey(value) === categoryKey(label)) ?? categoryLabel(label);
}
