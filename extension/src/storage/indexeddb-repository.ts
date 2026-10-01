import {
  createAccessState, createJourneyState, createVaultState, validateAtlasSnapshot, migrateAtlasSnapshotV1, readConfiguration,
  type AtlasConfiguration,
  type AtlasCommitRequest, type AtlasCommitResolution, type AtlasCommitResult,
  type AtlasEnvelope, type AtlasLoadResult, type AtlasRepository,
} from '@atlas/core';

import { configuration as defaultConfiguration } from "../background/configuration.js";

export interface InitializableRepository extends AtlasRepository {
  initialize(policy: unknown): Promise<boolean>;
  close(): void;
}

const stores = ['authority', 'receipts'];
type Receipt = Extract<AtlasCommitResolution, { type: 'COMMITTED' }>;

/** Opening completes before this port is exposed, so each operation enqueues its transaction immediately. */
export function openRepository(
  factory: IDBFactory, newVersion: () => string, name = 'atlas-authority-v1', bootstrapInput: AtlasConfiguration = defaultConfiguration,
): Promise<InitializableRepository> {
  const bootstrap = readConfiguration(bootstrapInput);
  if (bootstrap === null) return Promise.reject(new TypeError('INVALID_CONFIGURATION'));
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('authority').put(false, 'initialized');
      database.createObjectStore('receipts');
    };
    request.onerror = () => reject(new Error('STORAGE_UNAVAILABLE'));
    request.onblocked = () => reject(new Error('STORAGE_UNAVAILABLE'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(new IndexedDBRepository(database, newVersion, bootstrap));
    };
  });
}

class IndexedDBRepository implements InitializableRepository {
  constructor(private readonly database: IDBDatabase, private readonly newVersion: () => string, private readonly bootstrap: AtlasConfiguration) {}

  close(): void { this.database.close(); }

  private transaction(mode: IDBTransactionMode): IDBTransaction {
    const transaction = this.database.transaction(stores, mode, { durability: 'strict' });
    if (mode === 'readwrite' && transaction.durability !== 'strict') {
      transaction.abort();
      throw new Error('STRICT_DURABILITY_UNAVAILABLE');
    }
    return transaction;
  }

  load(): Promise<AtlasLoadResult> {
    return new Promise((resolve) => {
      try {
        const transaction = this.transaction('readwrite');
        const authority = transaction.objectStore('authority');
        const initialized = authority.get('initialized');
        const envelope = authority.get('envelope');
        let loaded: unknown;
        envelope.onsuccess = () => {
          loaded = envelope.result;
          if (initialized.result !== true || loaded === null || typeof loaded !== 'object'
            || !('schemaVersion' in loaded) || loaded.schemaVersion !== 1) return;
          // One fenced atomic migration; damaged legacy authority is never replaced by defaults.
          try {
            const old = loaded as Record<string, unknown>;
            if (Object.keys(old).length !== 4 || !Object.hasOwn(old, 'snapshot')
              || typeof old.storageVersion !== 'string' || !/^[a-z0-9_.:-]{1,256}$/i.test(old.storageVersion)
              || (old.lastCommitId !== null && (typeof old.lastCommitId !== 'string' || !/^[a-z0-9_.:-]{1,256}$/i.test(old.lastCommitId)))) { transaction.abort(); return; }
            const migrated = migrateAtlasSnapshotV1(old.snapshot, this.bootstrap);
            if (!migrated.ok) { transaction.abort(); return; }
            const storageVersion = this.version();
            if (storageVersion === old.storageVersion) { transaction.abort(); return; }
            loaded = { schemaVersion: 2, storageVersion, lastCommitId: old.lastCommitId, snapshot: migrated.snapshot };
            authority.put(loaded, 'envelope');
          } catch { transaction.abort(); }
        };
        transaction.oncomplete = () => {
          if (initialized.result === false && envelope.result === undefined) {
            resolve({ type: 'UNINITIALIZED' });
          } else if (initialized.result === true && envelope.result !== undefined) {
            // Core validates every byte of the envelope/snapshot before publishing authority.
            resolve({ type: 'READY', envelope: loaded });
          } else resolve({ type: 'UNAVAILABLE' });
        };
        transaction.onabort = () => resolve({ type: 'UNAVAILABLE' });
      } catch { resolve({ type: 'UNAVAILABLE' }); }
    });
  }

  initialize(policy: unknown): Promise<boolean> {
    const validated = validateAtlasSnapshot({
      policy, policyRevision: 0, configuration: this.bootstrap, configurationRevision: 0, accessState: createAccessState(),
      vaultState: createVaultState(), journeyState: createJourneyState(),
    });
    if (!validated.ok) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        const transaction = this.transaction('readwrite');
        let applied = false;
        const authority = transaction.objectStore('authority');
        const initialized = authority.get('initialized');
        const envelope = authority.get('envelope');
        envelope.onsuccess = () => {
          if (initialized.result !== false || envelope.result !== undefined) return;
          try {
            const storageVersion = this.version();
            authority.put({ schemaVersion: 2, storageVersion, lastCommitId: null,
              snapshot: validated.snapshot } satisfies AtlasEnvelope, 'envelope');
            authority.put(true, 'initialized');
            applied = true;
          } catch { transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(applied);
        transaction.onabort = () => resolve(false);
      } catch { resolve(false); }
    });
  }

  private version(): string {
    const version = this.newVersion();
    if (typeof version !== 'string' || !/^[a-z0-9_.:-]{1,256}$/i.test(version)) throw new Error('INVALID_VERSION');
    return version;
  }

  commit(request: AtlasCommitRequest): Promise<AtlasCommitResult> {
    // No await before transaction creation. A subsequent load/resolve queues behind this write,
    // including on another connection. No pending JavaScript work can apply it after that barrier.
    return new Promise((resolve) => {
      let transaction: IDBTransaction;
      try { transaction = this.transaction('readwrite'); }
      catch { resolve({ type: 'NOT_WRITTEN', commitId: request.commitId }); return; }
      let result: AtlasCommitResult = { type: 'NOT_WRITTEN', commitId: request.commitId };
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
          const envelope = current.result as AtlasEnvelope | undefined;
          if (initialized.result !== true || envelope === undefined) return;
          if (envelope.storageVersion !== request.expectedStorageVersion) {
            result = { type: 'CONFLICT', commitId: request.commitId };
            return;
          }
          const validated = validateAtlasSnapshot(request.next.snapshot);
          if (request.next.schemaVersion !== 2 || !validated.ok) return;
          const storageVersion = this.version();
          if (storageVersion === envelope.storageVersion) { transaction.abort(); return; }
          const receipt: Receipt = { type: 'COMMITTED', commitId: request.commitId, storageVersion };
          authority.put({ schemaVersion: 2, storageVersion, lastCommitId: request.commitId,
            snapshot: validated.snapshot } satisfies AtlasEnvelope, 'envelope');
          receipts.add(receipt, request.commitId);
          result = receipt;
        } catch { transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(result);
      // IndexedDB abort rolls back the whole transaction and cannot apply it later.
      transaction.onabort = () => resolve({ type: 'NOT_WRITTEN', commitId: request.commitId });
    });
  }

  resolveCommit(commitId: string): Promise<AtlasCommitResolution> {
    return new Promise((resolve) => {
      try {
        const transaction = this.transaction('readonly');
        const receipt = transaction.objectStore('receipts').get(commitId);
        const initialized = transaction.objectStore('authority').get('initialized');
        transaction.oncomplete = () => {
          if (initialized.result !== true) { resolve({ type: 'UNKNOWN', commitId }); return; }
          const stored: unknown = receipt.result;
          if (stored === undefined) {
            resolve({ type: 'NOT_WRITTEN', commitId });
          } else if (stored !== null && typeof stored === 'object' && 'type' in stored
            && stored.type === 'COMMITTED' && 'commitId' in stored && stored.commitId === commitId
            && 'storageVersion' in stored && typeof stored.storageVersion === 'string'
            && /^[a-z0-9_.:-]{1,256}$/i.test(stored.storageVersion)) {
            resolve({ type: 'COMMITTED', commitId, storageVersion: stored.storageVersion });
          } else resolve({ type: 'UNKNOWN', commitId });
        };
        transaction.onabort = () => resolve({ type: 'UNKNOWN', commitId });
      } catch { resolve({ type: 'UNKNOWN', commitId }); }
    });
  }
}
