import { createAccessState, createJourneyState, createVaultState, validateAtlasSnapshot, migrateAtlasSnapshotV1, readConfiguration, } from '@atlas/core';
import { configuration as defaultConfiguration } from "../background/configuration.js";
import { curatedUpgradeId, curatedUpgradeKey, curatedUpgradeHosts, initialCuratedReceipt, planCuratedUpgrade, readCuratedUpgradeReceipt } from '../presets/curated-upgrade.js';
import { legacyCuratedUpgradeId, legacyCuratedUpgradeKey } from '../presets/curated-upgrade-v2.js';
import { curatedScopeKey, initialCuratedScopes, initialCuratedScopeReceipt, planCuratedScopes, readCuratedScopeReceipt } from '../presets/curated-scopes.js';
// Never expose exception messages, browser event objects, URLs or stored data.
function failureCause(error, fallback = 'OTHER') {
    try {
        switch (error?.name) {
            case 'AbortError': return 'ABORTED';
            case 'UnknownError': return 'IO_ERROR';
            case 'QuotaExceededError': return 'QUOTA_EXCEEDED';
            case 'InvalidStateError': return 'CONNECTION_CLOSED';
            case 'NotSupportedError': return 'DURABILITY_UNAVAILABLE';
            case 'DataError':
            case 'DataCloneError':
            case 'ConstraintError': return 'INVALID_DATA';
            default: return fallback;
        }
    }
    catch {
        return 'OTHER';
    }
}
const stores = ['authority', 'receipts'];
/** Opening completes before this port is exposed, so each operation enqueues its transaction immediately. */
export function openRepository(factory, newVersion, name = 'atlas-authority-v1', bootstrapInput = defaultConfiguration) {
    const bootstrap = readConfiguration(bootstrapInput);
    if (bootstrap === null)
        return Promise.reject(new TypeError('INVALID_CONFIGURATION'));
    return new Promise((resolve, reject) => {
        const request = factory.open(name, 1);
        let failed = false;
        request.onupgradeneeded = () => {
            const database = request.result;
            database.createObjectStore('authority').put(false, 'initialized');
            database.createObjectStore('receipts');
        };
        request.onerror = request.onblocked = () => {
            failed = true;
            reject(new Error('STORAGE_UNAVAILABLE'));
        };
        request.onsuccess = () => {
            const database = request.result;
            // A blocked open remains pending and can succeed after its caller has failed.
            if (failed) {
                database.close();
                return;
            }
            database.onversionchange = () => database.close();
            resolve(new IndexedDBRepository(database, newVersion, bootstrap));
        };
    });
}
class IndexedDBRepository {
    database;
    newVersion;
    bootstrap;
    reads = 0;
    writes = 0;
    committed = 0;
    failedCommits = 0;
    failureSequence = 0;
    lastFailure = null;
    curatedReceipt = null;
    constructor(database, newVersion, bootstrap) {
        this.database = database;
        this.newVersion = newVersion;
        this.bootstrap = bootstrap;
    }
    close() { this.database.close(); }
    getDiagnostics() {
        return Object.freeze({ readTransactions: this.reads, writeTransactions: this.writes,
            committedWrites: this.committed, failedCommits: this.failedCommits, lastFailure: this.lastFailure });
    }
    failed(operation, stage, cause) {
        if (operation === 'COMMIT')
            this.failedCommits++;
        this.lastFailure = Object.freeze({ sequence: ++this.failureSequence, operation, stage, cause });
    }
    transaction(mode) {
        const transaction = this.database.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
        if (mode === 'readonly')
            this.reads++;
        else
            this.writes++;
        if (mode === 'readwrite' && transaction.durability !== 'strict') {
            transaction.abort();
            throw new DOMException('STRICT_DURABILITY_UNAVAILABLE', 'NotSupportedError');
        }
        return transaction;
    }
    load() {
        return this.read('readonly');
    }
    read(mode) {
        return new Promise((resolve) => {
            try {
                const transaction = this.transaction(mode);
                const authority = transaction.objectStore('authority');
                const initialized = authority.get('initialized');
                const envelope = authority.get('envelope');
                let loaded;
                let needsMigration = false;
                let invalidMigration = false;
                envelope.onsuccess = () => {
                    loaded = envelope.result;
                    if (initialized.result !== true || loaded === null || typeof loaded !== 'object'
                        || !('schemaVersion' in loaded) || loaded.schemaVersion !== 1)
                        return;
                    if (mode === 'readonly') {
                        needsMigration = true;
                        return;
                    }
                    // One fenced atomic migration; damaged legacy authority is never replaced by defaults.
                    try {
                        const old = loaded;
                        if (Object.keys(old).length !== 4 || !Object.hasOwn(old, 'snapshot')
                            || typeof old.storageVersion !== 'string' || !/^[a-z0-9_.:-]{1,256}$/i.test(old.storageVersion)
                            || (old.lastCommitId !== null && (typeof old.lastCommitId !== 'string' || !/^[a-z0-9_.:-]{1,256}$/i.test(old.lastCommitId)))) {
                            invalidMigration = true;
                            transaction.abort();
                            return;
                        }
                        const migrated = migrateAtlasSnapshotV1(old.snapshot, this.bootstrap);
                        if (!migrated.ok) {
                            invalidMigration = true;
                            transaction.abort();
                            return;
                        }
                        const storageVersion = this.version();
                        if (storageVersion === old.storageVersion) {
                            invalidMigration = true;
                            transaction.abort();
                            return;
                        }
                        loaded = { schemaVersion: 2, storageVersion, lastCommitId: old.lastCommitId, snapshot: migrated.snapshot };
                        authority.put(loaded, 'envelope');
                    }
                    catch {
                        transaction.abort();
                    }
                };
                transaction.oncomplete = () => {
                    // Only legacy data needs a write. Reread it inside the fenced write
                    // transaction so another connection cannot migrate or commit underneath it.
                    if (needsMigration) {
                        resolve(this.read('readwrite'));
                        return;
                    }
                    if (initialized.result === false && envelope.result === undefined) {
                        resolve({ type: 'UNINITIALIZED' });
                    }
                    else if (initialized.result === true && envelope.result !== undefined) {
                        // Core validates every byte of the envelope/snapshot before publishing authority.
                        resolve({ type: 'READY', envelope: loaded });
                    }
                    else {
                        // Record this validation failure rather than leaving an older abort
                        // diagnostic that could misclassify damaged authority as transient.
                        this.failed('LOAD', 'VALIDATION', 'INVALID_DATA');
                        resolve({ type: 'UNAVAILABLE' });
                    }
                };
                transaction.onabort = () => {
                    this.failed('LOAD', 'TRANSACTION_ABORT', invalidMigration ? 'INVALID_DATA' : failureCause(transaction.error, 'ABORTED'));
                    resolve({ type: 'UNAVAILABLE' });
                };
            }
            catch (error) {
                this.failed('LOAD', 'TRANSACTION_OPEN', failureCause(error));
                resolve({ type: 'UNAVAILABLE' });
            }
        });
    }
    getCuratedUpgrade() { return this.curatedReceipt; }
    initialize(policy, fromCuratedPreset = false) {
        const validated = validateAtlasSnapshot({
            policy, policyRevision: 0, configuration: this.bootstrap, configurationRevision: 0, accessState: createAccessState(),
            vaultState: createVaultState(), journeyState: createJourneyState(),
        });
        if (!validated.ok)
            return Promise.resolve(false);
        if (fromCuratedPreset && (validated.snapshot.policy.blacklist.length
            || JSON.stringify([...(validated.snapshot.policy.whitelistSubdomains ?? [])].sort()) !== JSON.stringify(initialCuratedScopes)
            || JSON.stringify([...validated.snapshot.policy.whitelist].sort()) !== JSON.stringify(curatedUpgradeHosts)))
            return Promise.resolve(false);
        return new Promise((resolve) => {
            try {
                const transaction = this.transaction('readwrite');
                let applied = false;
                const authority = transaction.objectStore('authority');
                const initialized = authority.get('initialized');
                const envelope = authority.get('envelope');
                const curatedMarker = authority.get(curatedUpgradeKey);
                const legacyMarker = authority.get(legacyCuratedUpgradeKey);
                const scopeMarker = authority.get(curatedScopeKey);
                scopeMarker.onsuccess = () => {
                    if (initialized.result !== false || envelope.result !== undefined || curatedMarker.result !== undefined
                        || legacyMarker.result !== undefined || scopeMarker.result !== undefined)
                        return;
                    try {
                        const storageVersion = this.version();
                        authority.put({ schemaVersion: 2, storageVersion, lastCommitId: null,
                            snapshot: validated.snapshot }, 'envelope');
                        authority.put(true, 'initialized');
                        if (fromCuratedPreset) {
                            authority.put(initialCuratedReceipt(), curatedUpgradeKey);
                            authority.put(initialCuratedScopeReceipt(), curatedScopeKey);
                        }
                        applied = true;
                    }
                    catch {
                        transaction.abort();
                    }
                };
                transaction.oncomplete = () => {
                    if (applied && fromCuratedPreset)
                        this.curatedReceipt = initialCuratedReceipt();
                    resolve(applied);
                };
                transaction.onabort = () => { this.failed('INITIALIZE', 'TRANSACTION_ABORT', failureCause(transaction.error, 'ABORTED')); resolve(false); };
            }
            catch (error) {
                this.failed('INITIALIZE', 'TRANSACTION_OPEN', failureCause(error));
                resolve(false);
            }
        });
    }
    /** Startup only, before a controller owns this connection. Policy and receipt
     * commit together; any older controller is fenced by the new storage version. */
    applyCuratedUpgrade(managed) {
        this.curatedReceipt = null;
        return this.curatedUpgrade(managed, 'readonly');
    }
    curatedUpgrade(managed, mode) {
        return new Promise(resolve => {
            let transaction;
            try {
                transaction = this.transaction(mode);
            }
            catch (error) {
                this.failed('CURATED_UPGRADE', 'TRANSACTION_OPEN', failureCause(error));
                resolve({ type: 'UNAVAILABLE' });
                return;
            }
            const store = transaction.objectStore('authority');
            const initialized = store.get('initialized'), current = store.get('envelope'), marker = store.get(curatedUpgradeKey);
            const legacyMarker = store.get(legacyCuratedUpgradeKey);
            const scopeMarker = store.get(curatedScopeKey);
            let result = { type: 'UNAVAILABLE' };
            let needsWrite = false;
            let caughtFailure = null;
            scopeMarker.onsuccess = () => {
                try {
                    if (initialized.result === false && current.result === undefined && marker.result === undefined && legacyMarker.result === undefined && scopeMarker.result === undefined) {
                        result = { type: 'UNINITIALIZED' };
                        return;
                    }
                    const envelope = current.result;
                    if (initialized.result !== true || !envelope || typeof envelope !== 'object')
                        return;
                    const value = envelope;
                    if (Object.keys(value).length !== 4 || value.schemaVersion !== 2
                        || typeof value.storageVersion !== 'string' || !/^[a-z0-9_.:-]{1,256}$/i.test(value.storageVersion)
                        || (value.lastCommitId !== null && (typeof value.lastCommitId !== 'string' || !/^[a-z0-9_.:-]{1,256}$/i.test(value.lastCommitId)))
                        || !validateAtlasSnapshot(value.snapshot).ok)
                        return;
                    // Validate every known marker before trusting it. A valid legacy v2
                    // receipt retires this expansion: never re-add a user's later removals.
                    let applied = null;
                    if (scopeMarker.result !== undefined) {
                        const scope = readCuratedScopeReceipt(scopeMarker.result);
                        if (!scope || scope.policyRevisionAfter > value.snapshot.policyRevision
                            || marker.result === undefined && legacyMarker.result === undefined)
                            return;
                    }
                    for (const [request, id] of [[legacyMarker, legacyCuratedUpgradeId], [marker, curatedUpgradeId]]) {
                        if (request.result === undefined)
                            continue;
                        const receipt = readCuratedUpgradeReceipt(request.result);
                        if (!receipt || receipt.id !== id || receipt.policyRevisionAfter > value.snapshot.policyRevision)
                            return;
                        applied = receipt;
                    }
                    if (applied) {
                        result = { type: 'ALREADY_APPLIED', receipt: applied };
                        return;
                    }
                    // The write path rereads everything under its own transaction fence.
                    if (mode === 'readonly') {
                        needsWrite = true;
                        return;
                    }
                    const planned = planCuratedUpgrade(value.snapshot, managed);
                    if (!planned)
                        return;
                    const storageVersion = this.version();
                    if (storageVersion === value.storageVersion) {
                        transaction.abort();
                        return;
                    }
                    store.put({ ...value, storageVersion, snapshot: planned.snapshot }, 'envelope');
                    store.put(planned.receipt, curatedUpgradeKey);
                    result = { type: 'APPLIED', receipt: planned.receipt };
                }
                catch (error) {
                    caughtFailure = failureCause(error);
                    transaction.abort();
                }
            };
            transaction.oncomplete = () => {
                if (needsWrite) {
                    resolve(this.curatedUpgrade(managed, 'readwrite'));
                    return;
                }
                if ('receipt' in result)
                    this.curatedReceipt = result.receipt;
                else if (result.type === 'UNAVAILABLE')
                    this.failed('CURATED_UPGRADE', 'VALIDATION', 'INVALID_DATA');
                resolve(result);
            };
            transaction.onabort = () => { this.failed('CURATED_UPGRADE', 'TRANSACTION_ABORT', caughtFailure ?? failureCause(transaction.error, 'ABORTED')); resolve({ type: 'UNAVAILABLE' }); };
        });
    }
    /** Independent fixed scope migration; never replay a removed scope on later startup. */
    applyCuratedScopes() { return this.curatedScopes('readonly'); }
    curatedScopes(mode) {
        return new Promise(resolve => {
            let transaction;
            try {
                transaction = this.transaction(mode);
            }
            catch (error) {
                this.failed('CURATED_UPGRADE', 'TRANSACTION_OPEN', failureCause(error));
                resolve({ type: 'UNAVAILABLE' });
                return;
            }
            const store = transaction.objectStore('authority');
            const initialized = store.get('initialized'), current = store.get('envelope');
            const old = store.get(curatedUpgradeKey), legacy = store.get(legacyCuratedUpgradeKey), marker = store.get(curatedScopeKey);
            let result = { type: 'UNAVAILABLE' }, needsWrite = false;
            let caughtFailure = null;
            marker.onsuccess = () => {
                try {
                    if (initialized.result === false && current.result === undefined && marker.result === undefined
                        && old.result === undefined && legacy.result === undefined) {
                        result = { type: 'UNINITIALIZED' };
                        return;
                    }
                    const value = current.result;
                    if (initialized.result !== true || !value || typeof value !== 'object'
                        || Object.keys(value).length !== 4 || value.schemaVersion !== 2
                        || typeof value.storageVersion !== 'string' || !/^[a-z0-9_.:-]{1,256}$/i.test(value.storageVersion)
                        || (value.lastCommitId !== null && (typeof value.lastCommitId !== 'string' || !/^[a-z0-9_.:-]{1,256}$/i.test(value.lastCommitId)))
                        || !validateAtlasSnapshot(value.snapshot).ok)
                        return;
                    for (const [request, id] of [[old, curatedUpgradeId], [legacy, legacyCuratedUpgradeId]]) {
                        if (request.result === undefined)
                            continue;
                        const receipt = readCuratedUpgradeReceipt(request.result);
                        if (!receipt || receipt.id !== id || receipt.policyRevisionAfter > value.snapshot.policyRevision)
                            return;
                    }
                    if (marker.result !== undefined) {
                        const receipt = readCuratedScopeReceipt(marker.result);
                        if (receipt && receipt.policyRevisionAfter <= value.snapshot.policyRevision)
                            result = { type: 'ALREADY_APPLIED', receipt };
                        return;
                    }
                    if (mode === 'readonly') {
                        needsWrite = true;
                        return;
                    }
                    const planned = planCuratedScopes(value.snapshot);
                    if (!planned)
                        return;
                    const storageVersion = this.version();
                    if (storageVersion === value.storageVersion) {
                        transaction.abort();
                        return;
                    }
                    store.put({ ...value, storageVersion, snapshot: planned.snapshot }, 'envelope');
                    store.put(planned.receipt, curatedScopeKey);
                    result = { type: 'APPLIED', receipt: planned.receipt };
                }
                catch (error) {
                    caughtFailure = failureCause(error);
                    transaction.abort();
                }
            };
            transaction.oncomplete = () => {
                if (needsWrite) {
                    resolve(this.curatedScopes('readwrite'));
                    return;
                }
                if (result.type === 'UNAVAILABLE')
                    this.failed('CURATED_UPGRADE', 'VALIDATION', 'INVALID_DATA');
                resolve(result);
            };
            transaction.onabort = () => { this.failed('CURATED_UPGRADE', 'TRANSACTION_ABORT', caughtFailure ?? failureCause(transaction.error, 'ABORTED')); resolve({ type: 'UNAVAILABLE' }); };
        });
    }
    version() {
        const version = this.newVersion();
        if (typeof version !== 'string' || !/^[a-z0-9_.:-]{1,256}$/i.test(version))
            throw new Error('INVALID_VERSION');
        return version;
    }
    commit(request) {
        // No await before transaction creation. A subsequent load/resolve queues behind this write,
        // including on another connection. No pending JavaScript work can apply it after that barrier.
        return new Promise((resolve) => {
            let transaction;
            try {
                transaction = this.transaction('readwrite');
            }
            catch (error) {
                this.failed('COMMIT', 'TRANSACTION_OPEN', failureCause(error));
                resolve({ type: 'NOT_WRITTEN', commitId: request.commitId });
                return;
            }
            let result = { type: 'NOT_WRITTEN', commitId: request.commitId };
            let caughtFailure = null;
            const authority = transaction.objectStore('authority');
            const receipts = transaction.objectStore('receipts');
            const initialized = authority.get('initialized');
            const existing = receipts.get(request.commitId);
            const current = authority.get('envelope');
            current.onsuccess = () => {
                try {
                    if (existing.result !== undefined) {
                        // Attempt IDs cannot be reused, even for a superficially identical payload.
                        result = { type: 'UNKNOWN', commitId: request.commitId };
                        return;
                    }
                    const envelope = current.result;
                    if (initialized.result !== true || envelope === undefined)
                        return;
                    if (envelope.storageVersion !== request.expectedStorageVersion) {
                        result = { type: 'CONFLICT', commitId: request.commitId };
                        return;
                    }
                    const validated = validateAtlasSnapshot(request.next.snapshot);
                    if (request.next.schemaVersion !== 2 || !validated.ok)
                        return;
                    const storageVersion = this.version();
                    if (storageVersion === envelope.storageVersion) {
                        caughtFailure = 'INVALID_DATA';
                        transaction.abort();
                        return;
                    }
                    const receipt = { type: 'COMMITTED', commitId: request.commitId, storageVersion };
                    authority.put({ schemaVersion: 2, storageVersion, lastCommitId: request.commitId,
                        snapshot: validated.snapshot }, 'envelope');
                    receipts.add(receipt, request.commitId);
                    result = receipt;
                }
                catch (error) {
                    caughtFailure = failureCause(error);
                    transaction.abort();
                }
            };
            transaction.oncomplete = () => {
                if (result.type === 'COMMITTED')
                    this.committed++;
                else if (result.type === 'NOT_WRITTEN')
                    this.failed('COMMIT', 'VALIDATION', 'INVALID_DATA');
                resolve(result);
            };
            // IndexedDB abort rolls back the whole transaction and cannot apply it later.
            transaction.onabort = () => {
                this.failed('COMMIT', 'TRANSACTION_ABORT', caughtFailure ?? failureCause(transaction.error, 'ABORTED'));
                resolve({ type: 'NOT_WRITTEN', commitId: request.commitId });
            };
        });
    }
    resolveCommit(commitId) {
        return new Promise((resolve) => {
            try {
                const transaction = this.transaction('readonly');
                const receipt = transaction.objectStore('receipts').get(commitId);
                const initialized = transaction.objectStore('authority').get('initialized');
                transaction.oncomplete = () => {
                    if (initialized.result !== true) {
                        resolve({ type: 'UNKNOWN', commitId });
                        return;
                    }
                    const stored = receipt.result;
                    if (stored === undefined) {
                        resolve({ type: 'NOT_WRITTEN', commitId });
                    }
                    else if (stored !== null && typeof stored === 'object' && 'type' in stored
                        && stored.type === 'COMMITTED' && 'commitId' in stored && stored.commitId === commitId
                        && 'storageVersion' in stored && typeof stored.storageVersion === 'string'
                        && /^[a-z0-9_.:-]{1,256}$/i.test(stored.storageVersion)) {
                        resolve({ type: 'COMMITTED', commitId, storageVersion: stored.storageVersion });
                    }
                    else
                        resolve({ type: 'UNKNOWN', commitId });
                };
                transaction.onabort = () => { this.failed('RESOLVE', 'TRANSACTION_ABORT', failureCause(transaction.error, 'ABORTED')); resolve({ type: 'UNKNOWN', commitId }); };
            }
            catch (error) {
                this.failed('RESOLVE', 'TRANSACTION_OPEN', failureCause(error));
                resolve({ type: 'UNKNOWN', commitId });
            }
        });
    }
}
