import { normalizeTarget } from '@atlas/core';
import { validDestinationId } from './destination-metadata.js';
import { destinationEntryPoints } from './home-model.js';
export const emptyBookmarks = () => ({ version: 1, groups: [] });
/** Exact user-chosen URLs are presentation, never policy terms or diagnostics. */
export function validBookmarkPage(page) {
    return !!page && typeof page.id === 'string' && /^[a-zA-Z0-9:.-]{1,280}$/.test(page.id)
        && typeof page.label === 'string' && page.label.trim().length > 0 && page.label.length <= 100
        && typeof page.url === 'string' && page.url.length <= 4096 && page.url.trim() === page.url && /^https?:\/\//i.test(page.url)
        && normalizeTarget(page.url) !== null;
}
export function readHomeBookmarks(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return null;
    const value = input;
    if (Object.keys(value).sort().join(',') !== 'groups,version' || value.version !== 1 || !Array.isArray(value.groups) || value.groups.length > 2000)
        return null;
    let count = 0;
    const parents = new Set();
    for (const group of value.groups) {
        if (!group || Object.keys(group).sort().join(',') !== 'pages,parentId' || !validDestinationId(group.parentId)
            || parents.has(group.parentId) || !Array.isArray(group.pages) || !group.pages.length || group.pages.length > 100)
            return null;
        parents.add(group.parentId);
        count += group.pages.length;
        if (count > 2000 || new Set(group.pages.map((p) => p?.id)).size !== group.pages.length)
            return null;
        for (const p of group.pages)
            if (!p || Object.keys(p).sort().join(',') !== 'id,label,url' || !validBookmarkPage(p))
                return null;
    }
    return structuredClone(value);
}
export function defaultBookmarkPages(entry) {
    return destinationEntryPoints(entry).map((host, i) => ({ id: `entry:${host}`, label: i === 0 ? `${entry.label} home` : host, url: `https://${host}/` }));
}
export function bookmarkPages(value, parentId, entry) {
    return value?.groups.find(g => g.parentId === parentId)?.pages ?? defaultBookmarkPages(entry);
}
export function replaceBookmarkPages(value, parentId, pages) {
    const groups = (value ?? emptyBookmarks()).groups.filter(g => g.parentId !== parentId);
    if (pages.length)
        groups.push({ parentId, pages });
    return validDestinationId(parentId) ? readHomeBookmarks({ version: 1, groups }) : null;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** One concrete editor session. Refresh is called by the existing page owner. */
export class BookmarkSession {
    repository;
    changed;
    saved = null;
    parentId = null;
    draft = [];
    dirty = false;
    busy = false;
    conflict = false;
    failure = null;
    reviewed = null;
    baseRevision = 0;
    defaults = [];
    loading = null;
    constructor(repository, changed = () => { }) {
        this.repository = repository;
        this.changed = changed;
    }
    refresh() {
        if (this.loading || this.busy)
            return this.loading ?? Promise.resolve();
        this.loading = (async () => {
            try {
                const wasConflict = this.conflict;
                const latest = await this.repository.load();
                if (this.dirty && latest.revision !== this.baseRevision) {
                    // Reconcile an uncertain write only if its complete candidate was saved.
                    const expected = this.saved && this.parentId ? replaceBookmarkPages(this.saved.value, this.parentId, this.draft) : null;
                    if (expected && same(expected, latest.value)) {
                        this.dirty = false;
                        this.failure = null;
                        this.conflict = false;
                        this.baseRevision = latest.revision;
                    }
                    else
                        this.conflict = true;
                }
                if (!this.dirty && this.parentId && latest.revision !== this.baseRevision) {
                    this.draft = structuredClone(latest.value?.groups.find(g => g.parentId === this.parentId)?.pages ?? this.defaults);
                    this.baseRevision = latest.revision;
                }
                if (!same(this.saved, latest) || this.failure === 'UNAVAILABLE' || this.conflict !== wasConflict) {
                    this.saved = latest;
                    if (this.failure === 'UNAVAILABLE')
                        this.failure = null;
                    this.changed();
                }
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
    async edit(parentId, defaults) {
        if (this.loading)
            await this.loading;
        if (this.busy || this.dirty || !this.saved || this.failure === 'UNAVAILABLE')
            return false;
        this.parentId = parentId;
        this.baseRevision = this.saved.revision;
        this.defaults = structuredClone(defaults);
        this.draft = structuredClone(this.saved.value?.groups.find(g => g.parentId === parentId)?.pages ?? defaults);
        this.conflict = false;
        this.reviewed = null;
        this.failure = null;
        this.changed();
        return true;
    }
    update(pages) {
        if (this.busy || !this.parentId)
            return;
        this.draft = structuredClone(pages);
        this.dirty = true;
        this.failure = null;
        this.changed();
    }
    discard() {
        if (this.busy)
            return;
        this.parentId = null;
        this.draft = [];
        this.dirty = false;
        this.conflict = false;
        this.failure = null;
        this.reviewed = null;
        this.changed();
    }
    async reviewLatest() {
        if (this.loading)
            await this.loading;
        if (this.busy)
            return;
        try {
            this.reviewed = await this.repository.load();
            this.changed();
        }
        catch {
            this.failure = 'UNAVAILABLE';
            this.changed();
        }
    }
    async save(useReviewed = false) {
        if (this.loading)
            await this.loading;
        if (this.busy || !this.saved || !this.parentId || !this.dirty || this.conflict && !useReviewed)
            return false;
        const baseline = useReviewed ? this.reviewed : this.saved;
        if (!baseline)
            return false;
        const value = replaceBookmarkPages(baseline.value, this.parentId, this.draft);
        if (!value) {
            this.failure = 'INVALID';
            this.changed();
            return false;
        }
        this.busy = true;
        this.changed();
        try {
            const result = await this.repository.save(useReviewed ? baseline.revision : this.baseRevision, value);
            if (result.type === 'SAVED') {
                this.saved = result.envelope;
                this.baseRevision = result.envelope.revision;
                this.dirty = false;
                this.failure = null;
                this.conflict = false;
                this.reviewed = null;
                return true;
            }
            if (result.type === 'CONFLICT') {
                this.conflict = true;
                this.reviewed = null;
            }
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
}
