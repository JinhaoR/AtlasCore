import { changeHomeLayout, reconcileHomeLayout } from './home-layout.js';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** A failed local draft never replaces acknowledged layout or retries a conflict automatically. */
export class HomeLayoutSession {
    repository;
    changed;
    saved = null;
    draft = null;
    busy = false;
    conflict = false;
    failure = null;
    catalog = [];
    refreshing = null;
    constructor(repository, changed = () => { }) {
        this.repository = repository;
        this.changed = changed;
    }
    current() { return reconcileHomeLayout(this.saved?.value ?? null, this.catalog); }
    requested() { return reconcileHomeLayout(this.draft ?? this.saved?.value ?? null, this.catalog); }
    refresh(catalog) {
        this.catalog = catalog;
        if (this.refreshing)
            return this.refreshing;
        if (this.busy)
            return this.refreshing ?? Promise.resolve();
        const pending = this.loadLatest(catalog);
        this.refreshing = pending;
        return pending.finally(() => { if (this.refreshing === pending)
            this.refreshing = null; });
    }
    async loadLatest(catalog) {
        // A read of already acknowledged presentation is not a save/loading transition.
        // It stays clickable; change() waits for the read and the write still uses CAS.
        const initial = this.saved === null;
        if (initial) {
            this.busy = true;
            this.changed();
        }
        try {
            const latest = await this.repository.load();
            if (this.draft && this.saved && latest.revision !== this.saved.revision) {
                if (same(latest.value, this.draft)) {
                    this.saved = latest;
                    this.draft = null;
                    this.failure = null;
                    this.conflict = false;
                    this.changed();
                }
                else if (!this.conflict) {
                    this.conflict = true;
                    this.changed();
                }
                return;
            }
            if (this.draft)
                return;
            if (!same(this.saved, latest)) {
                this.saved = latest;
                this.failure = null;
                this.changed();
            }
            const reconciled = reconcileHomeLayout(latest.value, catalog);
            if (!same(reconciled, latest.value)) {
                this.draft = reconciled;
                this.busy = true;
                this.changed();
                await this.persist();
            }
            else if (this.failure === 'UNAVAILABLE') {
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
        finally {
            if (this.busy) {
                this.busy = false;
                this.changed();
            }
        }
    }
    async change(key, action) {
        // A background read may start between rendering an enabled control and its
        // click. Wait for that read; never silently drop the user's layout action.
        if (this.refreshing)
            await this.refreshing;
        if (this.busy || !this.saved || this.conflict || this.failure === 'UNAVAILABLE')
            return false;
        this.draft = changeHomeLayout(this.requested(), key, action, this.catalog.map(c => c.key));
        this.busy = true;
        this.changed();
        try {
            return await this.persist();
        }
        finally {
            this.busy = false;
            this.changed();
        }
    }
    async persist() {
        if (!this.saved || !this.draft || this.conflict)
            return false;
        try {
            const result = await this.repository.save(this.saved.revision, this.draft);
            if (result.type === 'SAVED') {
                this.saved = result.envelope;
                this.draft = null;
                this.failure = null;
                this.conflict = false;
                this.changed();
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
        this.changed();
        return false;
    }
    async retry(catalog) {
        if (this.refreshing)
            await this.refreshing;
        if (this.busy || this.conflict)
            return false;
        const draft = this.draft;
        this.failure = null;
        await this.refresh(catalog);
        if (!draft || this.draft === null)
            return this.failure === null && !this.conflict;
        if (this.conflict || !this.saved || this.failure)
            return false;
        this.busy = true;
        this.changed();
        try {
            return await this.persist();
        }
        finally {
            this.busy = false;
            this.changed();
        }
    }
    async useSaved(catalog) {
        if (this.refreshing)
            await this.refreshing;
        if (this.busy)
            return false;
        this.busy = true;
        try {
            const value = await this.repository.load();
            this.saved = value;
            this.draft = null;
            this.failure = null;
            this.conflict = false;
            this.catalog = catalog;
            this.changed();
            return true;
        }
        catch {
            this.failure = 'UNAVAILABLE';
            this.changed();
            return false;
        }
        finally {
            this.busy = false;
            this.changed();
        }
    }
}
