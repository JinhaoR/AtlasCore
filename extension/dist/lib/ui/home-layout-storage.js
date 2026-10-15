import { readHomeLayout } from './home-layout.js';
export const homeLayoutDatabase = 'atlas-home-layout-v1';
/** Presentation only. IndexedDB's transaction is the cross-window comparison fence. */
export async function openHomeLayoutRepository(factory = indexedDB, name = homeLayoutDatabase) {
    const db = await new Promise((resolve, reject) => {
        const request = factory.open(name, 1);
        let rejected = false;
        request.onupgradeneeded = () => request.result.createObjectStore('layout');
        request.onsuccess = () => { if (rejected)
            request.result.close();
        else
            resolve(request.result); };
        request.onerror = request.onblocked = () => { rejected = true; reject(new Error('HOME_LAYOUT_UNAVAILABLE')); };
    });
    db.onversionchange = () => db.close();
    const decode = (input) => {
        if (input === undefined)
            return { revision: 0, value: null };
        const record = input, value = readHomeLayout(record?.value);
        if (!value || Object.keys(record).sort().join(',') !== 'revision,value' || !Number.isSafeInteger(record.revision) || record.revision < 1)
            throw new Error('HOME_LAYOUT_INVALID');
        return { revision: record.revision, value };
    };
    return {
        load: () => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction('layout', 'readonly'), request = tx.objectStore('layout').get('current');
                let envelope;
                request.onsuccess = () => { try {
                    envelope = decode(request.result);
                }
                catch (error) {
                    reject(error);
                } };
                tx.oncomplete = () => { if (envelope)
                    resolve(envelope); };
                tx.onerror = tx.onabort = () => reject(new Error('HOME_LAYOUT_UNAVAILABLE'));
            }
            catch {
                reject(new Error('HOME_LAYOUT_UNAVAILABLE'));
            }
        }),
        save: (revision, value) => new Promise(resolve => {
            const candidate = readHomeLayout(value);
            if (!candidate || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
                resolve({ type: 'FAILED' });
                return;
            }
            try {
                const tx = db.transaction('layout', 'readwrite'), store = tx.objectStore('layout'), request = store.get('current');
                let result = { type: 'FAILED' };
                request.onsuccess = () => {
                    let current;
                    try {
                        current = decode(request.result);
                    }
                    catch {
                        tx.abort();
                        return;
                    }
                    if (revision !== current.revision) {
                        result = { type: 'CONFLICT', envelope: current };
                        return;
                    }
                    const envelope = { revision: revision + 1, value: candidate };
                    try {
                        store.put(envelope, 'current');
                        result = { type: 'SAVED', envelope };
                    }
                    catch {
                        tx.abort();
                    }
                };
                tx.oncomplete = () => resolve(result);
                tx.onabort = () => resolve({ type: 'FAILED' });
                tx.onerror = () => { };
            }
            catch {
                resolve({ type: 'FAILED' });
            }
        }),
        close: () => db.close(),
    };
}
