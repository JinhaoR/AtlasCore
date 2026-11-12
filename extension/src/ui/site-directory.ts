import { categoryKey, categoryLabel } from './categories.js';
import type { DestinationEntry } from './destinations.js';

export interface DirectoryCategory { key: string; label: string; count: number }
/** Complete directory projection; category presentation never changes access. */
export function directoryCategories(entries: readonly DestinationEntry[], order: readonly string[] = []): DirectoryCategory[] {
  const groups = new Map<string, DirectoryCategory>();
  for (const entry of entries) {
    const label = categoryLabel(entry.category) || 'Uncategorized', key = categoryKey(label);
    const group = groups.get(key) ?? { key, label, count: 0 }; group.count++; groups.set(key, group);
  }
  const rank = (key: string) => { const i = order.indexOf(key); return i < 0 ? order.length : i; };
  return [...groups.values()].sort((a,b) => rank(a.key)-rank(b.key) || a.label.localeCompare(b.label));
}
export function matchesSite(entry: DestinationEntry, query: string): boolean {
  const value = `${entry.label} ${entry.category} ${entry.hostnames.join(' ')}`.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every(word => value.includes(word));
}
export function directoryView(value: unknown): string | null {
  return typeof value === 'string' && (value === 'all' || value.startsWith('category:') && value.length > 9 && value.length <= 265) ? value : null;
}
