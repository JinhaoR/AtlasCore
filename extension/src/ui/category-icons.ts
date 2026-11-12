import { categoryKey } from './categories.js';
import { openRecord, homeLayoutDatabase } from './home-layout-storage.js';

/** Closed local SVG palette; no uploaded markup, remote assets or authority. */
export const categoryIcons = ['category', 'folder', 'book', 'university', 'feather', 'code', 'mail', 'network', 'home', 'sites', 'vault', 'search', 'pin', 'brain', 'atom', 'calculator', 'flask', 'globe', 'cloud', 'tools', 'music', 'camera', 'heart', 'calendar', 'chart', 'leaf', 'coffee', 'game', 'film'] as const;
export type CategoryIcon = typeof categoryIcons[number];
export const categoryIconNames: Record<CategoryIcon, string> = { category: 'Grid', folder: 'Folder', book: 'Book', university: 'University', feather: 'Writing', code: 'Code', mail: 'Mail', network: 'Connections', home: 'Home', sites: 'Browser', vault: 'Archive', search: 'Search', pin: 'Pin', brain: 'Brain', atom: 'Atom', calculator: 'Calculator', flask: 'Science', globe: 'World', cloud: 'Cloud', tools: 'Tools', music: 'Music', camera: 'Photography', heart: 'Health', calendar: 'Calendar', chart: 'Chart', leaf: 'Nature', coffee: 'Coffee', game: 'Games', film: 'Film' };
export interface CategoryIcons { readonly version: 1; readonly entries: readonly { readonly key: string; readonly icon: CategoryIcon }[] }
export function defaultCategoryIcon(label: string): CategoryIcon {
  return /research|scholar|learning/i.test(label) ? 'book' : /university|institute/i.test(label) ? 'university'
    : /writing/i.test(label) ? 'feather' : /development/i.test(label) ? 'code' : /mail|communication/i.test(label) ? 'mail'
      : /^ai$/i.test(label) ? 'network' : 'category';
}
export function readCategoryIcons(input: unknown): CategoryIcons | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as CategoryIcons, keys = new Set<string>();
  if (Object.keys(value).sort().join(',') !== 'entries,version' || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 4096) return null;
  for (const entry of value.entries) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'icon,key' || typeof entry.key !== 'string' || !entry.key || entry.key.length > 64
      || categoryKey(entry.key) !== entry.key || keys.has(entry.key) || !categoryIcons.includes(entry.icon)) return null;
    keys.add(entry.key);
  }
  return structuredClone(value);
}
export const openCategoryIconRepository = (factory: IDBFactory = indexedDB, name = homeLayoutDatabase) =>
  openRecord(factory, name, 'category-icons-v1', readCategoryIcons);
type Repository = Awaited<ReturnType<typeof openCategoryIconRepository>>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Independently revisioned so older builds can still read the unchanged layout. */
export class CategoryIconSession {
  saved: Awaited<ReturnType<Repository['load']>> | null = null;
  draft: CategoryIcons | null = null;
  busy = false;
  conflict = false;
  failure: 'FAILED' | 'UNCERTAIN' | 'UNAVAILABLE' | null = null;
  private loading: Promise<void> | null = null;
  constructor(readonly repository: Repository, private readonly changed: () => void) {}
  icon(key: string, label: string): CategoryIcon { return this.saved?.value?.entries.find(e => e.key === key)?.icon ?? defaultCategoryIcon(label); }
  refresh(): Promise<void> {
    if (this.loading || this.busy) return this.loading ?? Promise.resolve();
    this.loading = (async () => {
      try {
        const latest = await this.repository.load(), before = JSON.stringify([this.saved, this.draft, this.conflict, this.failure]);
        if (this.draft && latest.revision !== this.saved?.revision) {
          if (same(latest.value, this.draft)) { this.draft = null; this.conflict = false; this.failure = null; }
          else this.conflict = true;
        }
        // A conflicting draft retains its original comparison revision until an explicit discard.
        if (!this.draft) this.saved = latest;
        if (this.failure === 'UNAVAILABLE') this.failure = null;
        if (before !== JSON.stringify([this.saved, this.draft, this.conflict, this.failure])) this.changed();
      } catch { if (this.failure !== 'UNAVAILABLE') { this.failure = 'UNAVAILABLE'; this.changed(); } }
    })().finally(() => { this.loading = null; });
    return this.loading;
  }
  async change(key: string, icon: string): Promise<boolean> {
    if (this.loading) await this.loading;
    if (!this.saved || this.busy || this.conflict || this.failure === 'UNAVAILABLE') return false;
    const entries = [...(this.draft ?? this.saved.value)?.entries ?? []].filter(e => e.key !== key);
    if (icon !== '') entries.push({ key, icon: icon as CategoryIcon });
    const draft = readCategoryIcons({ version: 1, entries });
    if (!draft) return false;
    this.draft = draft; return this.persist();
  }
  private async persist(): Promise<boolean> {
    if (!this.saved || !this.draft || this.busy || this.conflict) return false;
    this.busy = true; this.changed();
    try {
      const result = await this.repository.save(this.saved.revision, this.draft);
      if (result.type === 'SAVED') { this.saved = result.envelope; this.draft = null; this.failure = null; return true; }
      if (result.type === 'CONFLICT') this.conflict = true;
      else this.failure = result.type;
    } catch { this.failure = 'UNCERTAIN'; }
    finally { this.busy = false; this.changed(); }
    return false;
  }
  async retry(): Promise<boolean> {
    await this.refresh();
    if (this.failure === 'UNAVAILABLE' || this.conflict) return false;
    return this.draft ? this.persist() : !this.failure;
  }
  async useSaved(): Promise<void> {
    if (this.loading) await this.loading;
    if (this.busy) return;
    this.busy = true; this.changed();
    try { this.saved = await this.repository.load(); this.draft = null; this.failure = null; this.conflict = false; }
    catch { this.failure = 'UNAVAILABLE'; }
    finally { this.busy = false; this.changed(); }
  }
}
