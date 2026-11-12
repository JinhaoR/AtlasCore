import { categoryKey } from './categories.js';
import { openRecord, homeLayoutDatabase } from './home-layout-storage.js';
import { destinationId } from './home-model.js';
import { usageScore } from './destination-usage.js';
import { readHomeLayout, reconcileHomeLayout } from './home-layout.js';
export function readCategoryOrder(input) {
    if (!input || typeof input !== 'object')
        return null;
    const v = input;
    if (!['keys,mode,version', 'catalog,keys,mode,version'].includes(Object.keys(v).sort().join(',')) || v.version !== 1
        || !['custom', 'alphabetic', 'usage'].includes(v.mode) || !Array.isArray(v.keys) || v.keys.length > 4096
        || new Set(v.keys).size !== v.keys.length || v.keys.some(k => typeof k !== 'string' || !k || k.length > 64 || categoryKey(k) !== k))
        return null;
    if (v.catalog !== undefined && !readHomeLayout(v.catalog))
        return null;
    return structuredClone(v);
}
/** Same exact-membership rename rule as legacy layout; partial moves do not inherit order. */
export function categoryOrderKeys(saved, current, legacy) {
    const before = saved?.catalog?.categories ?? [], after = reconcileHomeLayout(saved?.catalog ?? legacy, current).categories;
    const renamed = new Map(before.map((c, i) => [c.key, after[i]?.key ?? c.key]));
    return [...new Set([...(saved?.keys ?? legacy.categories.map(c => c.key)).map(key => renamed.get(key) ?? key), ...after.map(c => c.key)])];
}
/** Usage is a presentation score, summed once per stable site identity. */
export function orderCategories(categories, mode, custom, entries = [], usage = {}, now = 0) {
    const scores = new Map(), seen = new Set();
    for (const entry of entries) {
        const id = destinationId(entry);
        if (seen.has(id))
            continue;
        seen.add(id);
        const key = categoryKey(entry.category || 'Uncategorized');
        scores.set(key, (scores.get(key) ?? 0) + usageScore(usage[id], now));
    }
    const rank = (key) => { const i = custom.indexOf(key); return i < 0 ? custom.length : i; };
    return [...categories].sort((a, b) => (mode === 'custom' ? rank(a.key) - rank(b.key)
        : mode === 'usage' ? (scores.get(b.key) ?? 0) - (scores.get(a.key) ?? 0) : 0)
        || a.label.localeCompare(b.label, 'en'));
}
export const openCategoryOrderRepository = (factory = indexedDB, name = homeLayoutDatabase) => openRecord(factory, name, 'category-order-v1', readCategoryOrder);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Separate CAS record leaves the legacy layout readable by older releases. */
export class CategoryOrderSession {
    repository;
    changed;
    saved = null;
    draft = null;
    busy = false;
    conflict = false;
    failure = null;
    loading = null;
    constructor(repository, changed) {
        this.repository = repository;
        this.changed = changed;
    }
    refresh() {
        if (this.loading || this.busy)
            return this.loading ?? Promise.resolve();
        this.loading = (async () => {
            try {
                const latest = await this.repository.load(), before = JSON.stringify([this.saved, this.draft, this.conflict, this.failure]);
                if (this.draft && latest.revision !== this.saved?.revision) {
                    if (same(latest.value, this.draft)) {
                        this.draft = null;
                        this.conflict = false;
                        this.failure = null;
                    }
                    else
                        this.conflict = true;
                }
                if (!this.draft)
                    this.saved = latest;
                if (this.failure === 'UNAVAILABLE')
                    this.failure = null;
                if (before !== JSON.stringify([this.saved, this.draft, this.conflict, this.failure]))
                    this.changed();
            }
            catch {
                if (this.failure !== 'UNAVAILABLE') {
                    this.failure = 'UNAVAILABLE';
                    this.changed();
                }
            }
        })().finally(() => { this.loading = null; });
        return this.loading;
    }
    async change(value) {
        if (this.loading)
            await this.loading;
        if (!this.saved || this.busy || this.conflict || this.failure === 'UNAVAILABLE')
            return false;
        const draft = readCategoryOrder(value);
        if (!draft)
            return false;
        this.draft = draft;
        return this.persist();
    }
    async persist() {
        if (!this.saved || !this.draft || this.busy || this.conflict)
            return false;
        this.busy = true;
        this.changed();
        try {
            const result = await this.repository.save(this.saved.revision, this.draft);
            if (result.type === 'SAVED') {
                this.saved = result.envelope;
                this.draft = null;
                this.failure = null;
                return true;
            }
            if (result.type === 'CONFLICT')
                this.conflict = true;
            else
                this.failure = result.type;
        }
        catch {
            this.failure = 'UNCERTAIN';
        }
        finally {
            this.busy = false;
            this.changed();
        }
        return false;
    }
    async retry() {
        await this.refresh();
        if (this.failure === 'UNAVAILABLE' || this.conflict)
            return false;
        return this.draft ? this.persist() : !this.failure;
    }
    async useSaved() {
        if (this.loading)
            await this.loading;
        if (this.busy)
            return;
        this.busy = true;
        this.changed();
        try {
            this.saved = await this.repository.load();
            this.draft = null;
            this.failure = null;
            this.conflict = false;
        }
        catch {
            this.failure = 'UNAVAILABLE';
        }
        finally {
            this.busy = false;
            this.changed();
        }
    }
}
