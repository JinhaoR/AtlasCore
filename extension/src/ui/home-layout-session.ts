import { changeHomeLayout, reconcileHomeLayout, type HomeCategory, type HomeLayout, type HomeLayoutAction } from './home-layout.js';
import type { HomeLayoutEnvelope, HomeLayoutRepository } from './home-layout-storage.js';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** A failed local draft never replaces acknowledged layout or retries a conflict automatically. */
export class HomeLayoutSession {
  saved: HomeLayoutEnvelope | null = null;
  draft: HomeLayout | null = null;
  busy = false;
  conflict = false;
  failure: 'FAILED' | 'UNCERTAIN' | 'UNAVAILABLE' | null = null;
  private catalog: readonly HomeCategory[] = [];
  private refreshing: Promise<void> | null = null;
  constructor(readonly repository: HomeLayoutRepository, private readonly changed: () => void = () => {}) {}
  current(): HomeLayout { return reconcileHomeLayout(this.saved?.value ?? null, this.catalog); }
  requested(): HomeLayout { return reconcileHomeLayout(this.draft ?? this.saved?.value ?? null, this.catalog); }

  refresh(catalog: readonly HomeCategory[]): Promise<void> {
    this.catalog = catalog;
    if (this.refreshing) return this.refreshing;
    if (this.busy) return this.refreshing ?? Promise.resolve();
    const pending = this.loadLatest(catalog); this.refreshing = pending;
    return pending.finally(() => { if (this.refreshing === pending) this.refreshing = null; });
  }
  private async loadLatest(catalog: readonly HomeCategory[]): Promise<void> {
    // A read of already acknowledged presentation is not a save/loading transition.
    // It stays clickable; change() waits for the read and the write still uses CAS.
    const initial = this.saved === null;
    if (initial) { this.busy = true; this.changed(); }
    try {
      const latest = await this.repository.load();
      if (this.draft && this.saved && latest.revision !== this.saved.revision) {
        if (same(latest.value, this.draft)) { this.saved = latest; this.draft = null; this.failure = null; this.conflict = false; this.changed(); }
        else if (!this.conflict) { this.conflict = true; this.changed(); }
        return;
      }
      if (this.draft) return;
      if (!same(this.saved, latest)) { this.saved = latest; this.failure = null; this.changed(); }
      const reconciled = reconcileHomeLayout(latest.value, catalog);
      if (!same(reconciled, latest.value)) {
        this.draft = reconciled; this.busy = true; this.changed();
        await this.persist();
      }
      else if (this.failure === 'UNAVAILABLE') { this.failure = null; this.changed(); }
    } catch { if (this.failure !== 'UNAVAILABLE') { this.failure = 'UNAVAILABLE'; this.changed(); } }
    finally { if (this.busy) { this.busy = false; this.changed(); } }
  }
  async change(key: string, action: HomeLayoutAction): Promise<boolean> {
    // A background read may start between rendering an enabled control and its
    // click. Wait for that read; never silently drop the user's layout action.
    if (this.refreshing) await this.refreshing;
    if (this.busy || !this.saved || this.conflict || this.failure === 'UNAVAILABLE') return false;
    this.draft = changeHomeLayout(this.requested(), key, action, this.catalog.map(c => c.key));
    this.busy = true; this.changed();
    try { return await this.persist(); } finally { this.busy = false; this.changed(); }
  }
  private async persist(): Promise<boolean> {
    if (!this.saved || !this.draft || this.conflict) return false;
    try {
      const result = await this.repository.save(this.saved.revision, this.draft);
      if (result.type === 'SAVED') { this.saved = result.envelope; this.draft = null; this.failure = null; this.conflict = false; this.changed(); return true; }
      if (result.type === 'CONFLICT') this.conflict = true;
      else this.failure = result.type;
    } catch { this.failure = 'UNCERTAIN'; }
    this.changed(); return false;
  }
  async retry(catalog: readonly HomeCategory[]): Promise<boolean> {
    if (this.refreshing) await this.refreshing;
    if (this.busy || this.conflict) return false;
    const draft = this.draft;
    this.failure = null;
    await this.refresh(catalog);
    if (!draft || this.draft === null) return this.failure === null && !this.conflict;
    if (this.conflict || !this.saved || this.failure) return false;
    this.busy = true; this.changed();
    try { return await this.persist(); } finally { this.busy = false; this.changed(); }
  }
  async useSaved(catalog: readonly HomeCategory[]): Promise<boolean> {
    if (this.refreshing) await this.refreshing;
    if (this.busy) return false;
    this.busy = true;
    try {
      const value = await this.repository.load();
      this.saved = value; this.draft = null; this.failure = null; this.conflict = false; this.catalog = catalog; this.changed(); return true;
    } catch { this.failure = 'UNAVAILABLE'; this.changed(); return false; }
    finally { this.busy = false; this.changed(); }
  }
}
