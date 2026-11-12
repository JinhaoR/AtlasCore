import { createAtlasController } from '@atlas/core';
import { FirefoxAdapter } from '../adapter/firefox-adapter.js';
import { openRepository } from '../storage/indexeddb-repository.js';
import { configuration } from './configuration.js';
import { createAdapterHost } from './startup.js';
import { saveDestinationLaunch } from './destination-usage.js';
import { createCanonicalEntryDiscovery } from '../adapter/canonical-entry.js';
import { RuntimeDiagnostics } from '../adapter/runtime-diagnostics.js';
import { runtimeJournal } from '../storage/runtime-journal.js';
import { openManagedCache } from '../storage/managed-cache.js';
import { createManagedBlacklist, downloadStevenBlack, sha256 } from '../managed/manager.js';
import { BookmarkSyncOwner } from '../bookmarks/owner.js';
const presentation = new BookmarkSyncOwner(browser, localStorage);
void presentation.start();
addEventListener('pagehide', () => presentation.dispose());
addEventListener('storage', event => { if (event.key === 'atlas-destinations-v1')
    void presentation.run(() => presentation.sync()).catch(() => undefined); });
const now = () => Date.now();
const runtimeDiagnostics = new RuntimeDiagnostics(browser.runtime.getURL('background.js'), now, runtimeJournal(() => localStorage), browser.runtime.getManifest().version);
// Observe, do not preventDefault or reinterpret a browser/runtime exception.
addEventListener('error', event => runtimeDiagnostics.record('BACKGROUND_ERROR', event.error));
addEventListener('unhandledrejection', event => runtimeDiagnostics.record('UNHANDLED_REJECTION', event.reason));
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
            ownerId: crypto.randomUUID(), managedBlacklist: blacklist.getBlacklist,
            onInternalFault: (error, fault) => runtimeDiagnostics.record('CONTROLLER', error, fault) }),
    });
    managed = value.managed;
    return value;
};
const adapter = new FirefoxAdapter(browser, host, () => crypto.randomUUID(), now, undefined, undefined, createCanonicalEntryDiscovery(browser), (hostname, at) => {
    const policy = adapter.view().controller?.snapshot?.policy;
    if (policy)
        saveDestinationLaunch(localStorage, policy, hostname, at);
}, runtimeDiagnostics);
void adapter.ready.then(async () => {
    await adapter.refresh();
    void managed?.refresh().catch(() => undefined);
}).catch(() => undefined);
setInterval(() => { void adapter.refresh(); }, 1000);
// Only stale checks here; no dataset download is part of the navigation gate.
setInterval(() => { void managed?.refresh().catch(() => undefined); }, 60 * 60 * 1000);
