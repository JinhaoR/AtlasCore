import { createAtlasController } from '@atlas/core';
import { FirefoxAdapter } from '../adapter/firefox-adapter.js';
import { openRepository } from '../storage/indexeddb-repository.js';
import { configuration } from './configuration.js';
import { createAdapterHost } from './startup.js';
import { createCanonicalEntryDiscovery } from '../adapter/canonical-entry.js';
import { openManagedCache } from '../storage/managed-cache.js';
import { createManagedBlacklist, downloadStevenBlack, sha256 } from '../managed/manager.js';
const now = () => Date.now();
let managed = null;
// The cache connection belongs to this background lifetime, including retries.
let cachePromise = null;
const host = async () => {
    const value = await createAdapterHost({
        openRepository: () => openRepository(indexedDB, () => crypto.randomUUID()),
        loadManaged: async () => {
            cachePromise ??= openManagedCache(indexedDB).catch(() => ({ load: async () => null, save: async () => false }));
            const cache = await cachePromise;
            return createManagedBlacklist({ cache, now, digest: sha256, download: downloadStevenBlack,
                bundle: async () => {
                    const base = browser.runtime.getURL('data/stevenblack/');
                    const [data, metadata] = await Promise.all([
                        fetch(`${base}hosts`, { cache: 'no-store' }), fetch(`${base}metadata.json`, { cache: 'no-store' }),
                    ]);
                    if (!data.ok || !metadata.ok)
                        throw new Error('BUNDLE_UNAVAILABLE');
                    const record = await metadata.json();
                    return { text: await data.text(), sourceUrl: record.sourceUrl, sha256: record.sha256,
                        fetchedAt: null, upstreamVersion: record.revision };
                },
                publish: (work) => adapter.publishManagedUpdate(work),
                changed: () => { void adapter.refresh(); }, });
        },
        createController: (repository, blacklist) => createAtlasController({ repository, clock: { now }, configuration,
            ownerId: crypto.randomUUID(), managedBlacklist: blacklist.getBlacklist }),
    });
    managed = value.managed;
    return value;
};
const adapter = new FirefoxAdapter(browser, host, () => crypto.randomUUID(), now, undefined, undefined, createCanonicalEntryDiscovery(browser));
void adapter.ready.then(async () => {
    await adapter.refresh();
    void managed?.refresh().catch(() => undefined);
}).catch(() => undefined);
setInterval(() => { void adapter.refresh(); }, 1000);
// Only stale checks here; no dataset download is part of the navigation gate.
setInterval(() => { void managed?.refresh().catch(() => undefined); }, 60 * 60 * 1000);
