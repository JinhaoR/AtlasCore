import type { CacheState, ManagedCache } from '../managed/manager.js';

/** Separate atomic adapter cache; never part of the Core policy/revision repository. */
export function openManagedCache(factory: IDBFactory, name = 'atlas-managed-blacklist-v1'): Promise<ManagedCache> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, 1);
    let failed = false;
    open.onupgradeneeded = () => { open.result.createObjectStore('cache'); };
    open.onerror = open.onblocked = () => { failed = true; reject(new Error('CACHE_UNAVAILABLE')); };
    open.onsuccess = () => {
      const db = open.result;
      if (failed) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve({
        load: () => new Promise((done) => {
          try {
            const tx = db.transaction('cache', 'readonly');
            const request = tx.objectStore('cache').get('state');
            tx.oncomplete = () => done(request.result ?? null);
            tx.onabort = () => done(null);
          } catch { done(null); }
        }),
        save: (state: CacheState) => new Promise((done) => {
          try {
            const tx = db.transaction('cache', 'readwrite', { durability: 'strict' });
            if (tx.durability !== 'strict') { tx.abort(); done(false); return; }
            tx.objectStore('cache').put(state, 'state');
            tx.oncomplete = () => done(true);
            tx.onabort = () => done(false);
          } catch { done(false); }
        }),
      });
    };
  });
}
