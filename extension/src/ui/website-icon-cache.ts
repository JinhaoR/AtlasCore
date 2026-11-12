import { validatedWebsiteIcon } from './website-icons.js';

const namespace = 'atlas-website-icons-v1';
const lifetime = 7 * 24 * 60 * 60 * 1000;
const maximumEntries = 128, maximumBytes = 64 * 1024; // At most 8 MiB of image payloads.
const key = (hostname: string) => hostname.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)
  ? `https://atlas-assets.invalid/icons/${hostname}` : null;

/** Optional display assets only: exact hostname + validated image, no visited URL,
 * tab metadata, access history or authority. Synthetic keys are never fetched.
 * Reads never renew freshness or write usage. Cache failures cannot affect Core. */
export function createWebsiteIconCache(storage: CacheStorage | null | undefined = globalThis.caches, now = () => Date.now()) {
  let opening: Promise<Cache | null> | undefined, writes = Promise.resolve();
  const open = () => opening ??= storage ? storage.open(namespace).catch(() => null) : Promise.resolve(null);
  return {
    async read(hostname: string): Promise<Blob | null> {
      const url = key(hostname); if (!url) return null;
      try {
        const cache = await open(), response = await cache?.match(url);
        if (!response) return null;
        const created = Number(response.headers.get('x-atlas-created')), size = Number(response.headers.get('content-length'));
        if (created > 0 && created <= now() && now() - created < lifetime && size > 0 && size <= maximumBytes) {
          const blob = await validatedWebsiteIcon(response);
          if (blob && blob.size <= maximumBytes) return blob;
        }
        await cache?.delete(url);
      } catch { /* Optional asset storage is unavailable; normal lookup/fallback remains. */ }
      return null;
    },
    write(hostname: string, blob: Blob): Promise<void> {
      const url = key(hostname); if (!url || !blob.size || blob.size > maximumBytes) return Promise.resolve();
      writes = writes.then(async () => {
        const cache = await open(); if (!cache) return;
        await cache.put(url, new Response(blob, { headers: {
          'content-type': blob.type, 'content-length': String(blob.size), 'x-atlas-created': String(now()),
        } }));
        const keys = await cache.keys();
        for (const oldest of keys.slice(0, Math.max(0, keys.length - maximumEntries))) await cache.delete(oldest);
      }).catch(() => { /* Quota/asset failure never changes permission or blocks display. */ });
      return writes;
    },
  };
}
