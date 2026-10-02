import { createAtlasController } from '@atlas/core';
import { FirefoxAdapter } from '../adapter/firefox-adapter.js';
import { openRepository } from '../storage/indexeddb-repository.js';
import { configuration } from './configuration.js';
import { openManagedCache } from '../storage/managed-cache.js';
import { createManagedBlacklist, downloadStevenBlack, sha256 } from '../managed/manager.js';
const now = () => Date.now();
const managedPromise = openManagedCache(indexedDB).catch(() => ({
    load: async () => null, save: async () => false,
})).then((cache) => createManagedBlacklist({ cache, now, digest: sha256, download: downloadStevenBlack,
    bundle: async () => {
        const base = browser.runtime.getURL('data/stevenblack/');
        const [data, metadata] = await Promise.all([fetch(`${base}hosts`), fetch(`${base}metadata.json`)]);
        if (!data.ok || !metadata.ok)
            throw new Error('BUNDLE_UNAVAILABLE');
        const record = await metadata.json();
        return { text: await data.text(), sourceUrl: record.sourceUrl, sha256: record.sha256,
            fetchedAt: null, upstreamVersion: record.revision };
    }, publish: (work) => adapter.publishManagedUpdate(work),
    changed: () => { void adapter.refresh(); }, }));
const host = Promise.all([openRepository(indexedDB, () => crypto.randomUUID()), managedPromise])
    .then(([repository, managed]) => ({ repository, managed,
    controller: createAtlasController({ repository, clock: { now }, configuration,
        ownerId: crypto.randomUUID(), managedBlacklist: managed.getBlacklist }),
}));
const adapter = new FirefoxAdapter(browser, host, () => crypto.randomUUID(), now);
void adapter.ready.then(async () => {
    await adapter.refresh();
    const managed = await managedPromise;
    void managed.refresh().catch(() => undefined);
}).catch(() => undefined);
setInterval(() => { void adapter.refresh(); }, 1000);
// Only stale checks here; no dataset download is part of the navigation gate.
setInterval(() => { void managedPromise.then((managed) => managed.refresh()).catch(() => undefined); }, 60 * 60 * 1000);
