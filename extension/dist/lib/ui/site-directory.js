import { categoryKey, categoryLabel } from './categories.js';
/** Complete directory projection; category presentation never changes access. */
export function directoryCategories(entries, order = []) {
    const groups = new Map();
    for (const entry of entries) {
        const label = categoryLabel(entry.category) || 'Uncategorized', key = categoryKey(label);
        const group = groups.get(key) ?? { key, label, count: 0 };
        group.count++;
        groups.set(key, group);
    }
    const rank = (key) => { const i = order.indexOf(key); return i < 0 ? order.length : i; };
    return [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
}
export function matchesSite(entry, query) {
    const value = `${entry.label} ${entry.category} ${entry.hostnames.join(' ')}`.toLowerCase();
    return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every(word => value.includes(word));
}
export function directoryView(value) {
    return typeof value === 'string' && (value === 'all' || value.startsWith('category:') && value.length > 9 && value.length <= 265) ? value : null;
}
