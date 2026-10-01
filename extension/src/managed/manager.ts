import { managedBlacklistContains, type ManagedBlacklist } from '@atlas/core';
import { categories, maxFeedBytes, sourceUrl, validateFeed } from './hosts-feed.js';

export const refreshIntervalMs = 24 * 60 * 60 * 1000;
export interface FeedRecord {
  readonly text: string; readonly sourceUrl: string; readonly sha256: string;
  readonly fetchedAt: number | null; readonly upstreamVersion: string | null;
}
export interface CacheState {
  readonly schemaVersion: 1; readonly feed: FeedRecord;
  readonly lastAttemptAt: number | null; readonly lastResult: string;
}
export interface ManagedCache { load(): Promise<unknown>; save(state: CacheState): Promise<boolean> }
export interface ManagedView {
  readonly active: boolean; readonly count: number; readonly categories: readonly string[];
  readonly ignoredNames: number;
  readonly sourceUrl: string; readonly origin: 'BUNDLE' | 'CACHE' | 'UPDATE';
  readonly upstreamDate: string | null; readonly upstreamVersion: string | null;
  readonly lastUpdatedAt: number | null; readonly lastAttemptAt: number | null;
  readonly updateStatus: string; readonly conflicts: readonly string[];
}
interface Options {
  readonly cache: ManagedCache; readonly bundle: () => Promise<FeedRecord>;
  readonly digest: (text: string) => Promise<string>; readonly now: () => number;
  readonly download: () => Promise<{ text: string; version: string | null }>;
  /** Host serializes cache publication with held navigation effects. Download stays outside. */
  readonly publish?: (work: () => Promise<boolean>) => Promise<boolean>;
  readonly changed?: () => void;
}
const time = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const validSource = (value: unknown) => value === sourceUrl || typeof value === 'string'
  && /^https:\/\/raw\.githubusercontent\.com\/StevenBlack\/hosts\/[a-f0-9]{40}\/alternates\/fakenews-gambling-porn-social\/hosts$/.test(value);

/** Dataset lifecycle only. All denial semantics are in Core. */
export async function createManagedBlacklist(options: Options) {
  const save = async (state: CacheState) => { try { return await options.cache.save(state); } catch { return false; } };
  async function readFeed(input: unknown) {
    if (input === null || typeof input !== 'object') return null;
    const record = input as FeedRecord;
    if (typeof record.text !== 'string' || !validSource(record.sourceUrl) || !/^[a-f0-9]{64}$/.test(record.sha256)
      || (record.fetchedAt !== null && !time(record.fetchedAt))
      || (record.upstreamVersion !== null && (typeof record.upstreamVersion !== 'string' || record.upstreamVersion.length > 200))) return null;
    const validated = validateFeed(record.text);
    if (validated === null || await options.digest(record.text) !== record.sha256) return null;
    return { record, ...validated };
  }
  let loaded: unknown;
  try { loaded = await options.cache.load(); } catch { loaded = null; }
  const saved = loaded !== null && typeof loaded === 'object' ? loaded as CacheState : null;
  let lastAttemptAt = saved?.schemaVersion === 1 && time(saved.lastAttemptAt) ? saved.lastAttemptAt : null;
  let active = saved?.schemaVersion === 1 ? await readFeed(saved.feed) : null;
  let origin: ManagedView['origin'] = 'CACHE';
  let status = saved?.lastResult && typeof saved.lastResult === 'string' && /^[A-Z_]{1,50}$/.test(saved.lastResult)
    ? saved.lastResult : 'ACTIVE';
  if (status === 'UPDATING') status = 'INTERRUPTED_UPDATE';
  if (active === null) {
    active = await readFeed(await options.bundle());
    if (active === null) throw new Error('BUNDLED_BLACKLIST_INVALID');
    origin = 'BUNDLE';
    status = loaded === null ? 'ACTIVE' : 'CACHE_INVALID_USING_BUNDLE';
    if (!await save({ schemaVersion: 1, feed: active.record, lastAttemptAt, lastResult: status })) status = 'CACHE_UNAVAILABLE_USING_BUNDLE';
  }
  let current = active;
  let inFlight: Promise<void> | null = null;
  const checkpoint = (record = current.record, result = status): CacheState => ({ schemaVersion: 1,
    feed: record, lastAttemptAt, lastResult: result });

  async function update(): Promise<void> {
    const now = options.now();
    if (!time(now)) { status = 'INVALID_TIME'; return; }
    if (lastAttemptAt !== null && now - lastAttemptAt < refreshIntervalMs) return;
    lastAttemptAt = now;
    status = 'UPDATING';
    // Retain the old good feed and persist the attempt before network I/O, even on failure.
    if (!await save(checkpoint())) { status = 'CACHE_WRITE_FAILED'; return; }
    try {
      const downloaded = await options.download();
      const next = downloaded.version === null || typeof downloaded.version === 'string' && downloaded.version.length <= 200
        ? validateFeed(downloaded.text, current.compiled.size) : null;
      if (next === null) { status = 'INVALID_FEED'; }
      else {
        const record: FeedRecord = { text: downloaded.text, sourceUrl,
          sha256: await options.digest(downloaded.text), fetchedAt: now, upstreamVersion: downloaded.version };
        const publish = async () => {
          if (!await save(checkpoint(record, 'UPDATED'))) return false;
          current = { ...next, record }; origin = 'UPDATE'; status = 'UPDATED';
          return true;
        };
        if (!await (options.publish ? options.publish(publish) : publish())) { status = 'CACHE_WRITE_FAILED'; return; }
        // A failed UI notification cannot undo or misreport a committed dataset.
        try { options.changed?.(); } catch { /* Next periodic refresh reads current authority. */ }
        return;
      }
    } catch { status = 'NETWORK_UPDATE_FAILED'; }
    await save(checkpoint());
  }

  return {
    getBlacklist: (): ManagedBlacklist => current.compiled,
    getView: (whitelist: readonly string[] = []): ManagedView => ({ active: true, count: current.compiled.size,
      ignoredNames: current.parsed.ignoredNames,
      categories, sourceUrl: current.record.sourceUrl, origin, upstreamDate: current.parsed.upstreamDate,
      upstreamVersion: current.record.upstreamVersion, lastUpdatedAt: current.record.fetchedAt,
      lastAttemptAt, updateStatus: status,
      conflicts: whitelist.filter((hostname) => managedBlacklistContains(current.compiled, hostname) === true) }),
    refresh: (): Promise<void> => {
      if (inFlight !== null) return inFlight;
      inFlight = update().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
export type ManagedBlacklistManager = Awaited<ReturnType<typeof createManagedBlacklist>>;

export async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function downloadStevenBlack(): Promise<{ text: string; version: string | null }> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 30_000);
  try {
    const response = await fetch(sourceUrl, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: abort.signal });
    if (!response.ok || response.body === null || Number(response.headers.get('content-length') ?? 0) > maxFeedBytes) throw new Error('DOWNLOAD_FAILED');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0; let text = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > maxFeedBytes) throw new Error('FEED_TOO_LARGE');
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { await reader.cancel(); }
    return { text, version: response.headers.get('etag')?.slice(0, 200) ?? null };
  } finally { clearTimeout(timeout); }
}
