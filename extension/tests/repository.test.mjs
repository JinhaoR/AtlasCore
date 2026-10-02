import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { openRepository } from '../dist/lib/storage/indexeddb-repository.js';
import { policy, configuration } from './support/fixture.mjs';
import { planAtlasOperation } from '@atlas/core';

test('a blocked repository open closes any connection delivered after rejection', async () => {
  const request = {};
  const opening = openRepository({ open: () => request }, () => 'v1');
  const rejected = assert.rejects(opening, /STORAGE_UNAVAILABLE/);
  request.onblocked();
  await rejected;
  let closed = false;
  request.result = { close: () => { closed = true; } };
  request.onsuccess();
  assert.equal(closed, true, 'the rejected caller cannot own or close a later connection');
});

async function setup(t) {
  const factory = new IDBFactory();
  let version = 0;
  const repository = await openRepository(factory, () => `v${++version}`, 'test');
  t.after(() => repository.close());
  await repository.initialize(policy);
  const loaded = await repository.load();
  const envelope = loaded.envelope;
  return { factory, repository, envelope, newVersion: () => `v${++version}` };
}
const request = (envelope, commitId, next = envelope.snapshot) => ({ commitId,
  expectedStorageVersion: envelope.storageVersion, next: { schemaVersion: 2, snapshot: next } });
function raw(factory, action) {
  return new Promise((resolve, reject) => {
    const open = factory.open('test', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(['authority', 'receipts'], 'readwrite');
      action(transaction);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  });
}

test('CAS is atomic across connections and load fences an earlier pending write', async (t) => {
  const { factory, repository, envelope, newVersion } = await setup(t);
  const other = await openRepository(factory, newVersion, 'test');
  t.after(() => other.close());
  const first = repository.commit(request(envelope, 'first'));
  const second = other.commit(request(envelope, 'second'));
  const loaded = other.load();
  assert.equal((await first).type, 'COMMITTED');
  assert.equal((await second).type, 'CONFLICT');
  assert.equal((await loaded).envelope.lastCommitId, 'first');
  assert.deepEqual(await other.resolveCommit('second'), { type: 'NOT_WRITTEN', commitId: 'second' });
});

test('receipts reconcile old successful attempts after later writes and reject attempt reuse', async (t) => {
  const { repository, envelope } = await setup(t);
  const receipt = await repository.commit(request(envelope, 'first'));
  const next = (await repository.load()).envelope;
  assert.equal((await repository.commit(request(next, 'second'))).type, 'COMMITTED');
  assert.deepEqual(await repository.resolveCommit('first'), receipt);
  const before = await repository.load();
  assert.equal((await repository.commit(request(before.envelope, 'first'))).type, 'UNKNOWN');
  assert.deepEqual(await repository.load(), before);
});

test('transaction abort after envelope put leaves both old authority and receipt store intact', async (t) => {
  const { repository, envelope } = await setup(t);
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'receipts') throw new DOMException('Synthetic write failure', 'QuotaExceededError');
    return original.apply(this, args);
  };
  try {
    assert.deepEqual(await repository.commit(request(envelope, 'aborted')),
      { type: 'NOT_WRITTEN', commitId: 'aborted' });
  } finally { IDBObjectStore.prototype.add = original; }
  assert.deepEqual((await repository.load()).envelope, envelope);
  assert.deepEqual(await repository.resolveCommit('aborted'), { type: 'NOT_WRITTEN', commitId: 'aborted' });
});

test('reopening retains complete snapshots and reconciliation receipts', async (t) => {
  const { factory, repository, envelope, newVersion } = await setup(t);
  const receipt = await repository.commit(request(envelope, 'saved'));
  repository.close();
  const reopened = await openRepository(factory, newVersion, 'test');
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.resolveCommit('saved'), receipt);
  assert.equal((await reopened.load()).envelope.lastCommitId, 'saved');
  assert.deepEqual((await reopened.load()).envelope.snapshot, envelope.snapshot);
});

test('missing initialized authority cannot be replaced by setup or permission defaults', async (t) => {
  const { factory, repository } = await setup(t);
  await raw(factory, (transaction) => transaction.objectStore('authority').delete('envelope'));
  assert.deepEqual(await repository.load(), { type: 'UNAVAILABLE' });
  assert.equal(await repository.initialize(policy), false);
});

test('invalid candidates leave the entire previous snapshot untouched', async (t) => {
  const { repository, envelope } = await setup(t);
  assert.equal((await repository.commit(request(envelope, 'invalid', { ...envelope.snapshot, accessState: null }))).type, 'NOT_WRITTEN');
  assert.deepEqual((await repository.load()).envelope, envelope);
});

test('closed storage is unavailable and cannot claim an unresolved attempt failed', async (t) => {
  const { repository } = await setup(t);
  repository.close();
  assert.deepEqual(await repository.load(), { type: 'UNAVAILABLE' });
  assert.deepEqual(await repository.resolveCommit('maybe'), { type: 'UNKNOWN', commitId: 'maybe' });
});

function legacy(envelope) {
  const result = structuredClone(envelope); result.schemaVersion = 1;
  delete result.snapshot.configuration; delete result.snapshot.configurationRevision;
  if (result.snapshot.vaultState.pendingProposal) {
    delete result.snapshot.vaultState.pendingProposal.candidateConfiguration;
    delete result.snapshot.vaultState.pendingProposal.baseConfigurationRevision;
  }
  if (result.snapshot.vaultState.lastApplied) delete result.snapshot.vaultState.lastApplied.configurationRevision;
  return result;
}

test('schema-1 migration is atomic, preserves runtime terms and pending policy wait, and retains receipts', async (t) => {
  const { factory, repository, envelope, newVersion } = await setup(t);
  const proposed = planAtlasOperation({ kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: [...policy.whitelist, 'new.example'], blacklist: policy.blacklist } },
    { snapshot: envelope.snapshot, now: 1000, configuration });
  const receipt = await repository.commit(request(envelope, 'policy-pending', proposed.candidateSnapshot));
  const old = legacy((await repository.load()).envelope);
  await raw(factory, (tx) => tx.objectStore('authority').put(old, 'envelope'));
  const other = await openRepository(factory, newVersion, 'test'); t.after(() => other.close());
  const [first, second] = await Promise.all([repository.load(), other.load()]);
  assert.equal(first.envelope.schemaVersion, 2);
  assert.deepEqual(first, second);
  assert.notEqual(first.envelope.storageVersion, old.storageVersion);
  assert.equal(first.envelope.lastCommitId, old.lastCommitId);
  assert.deepEqual(first.envelope.snapshot.policy, old.snapshot.policy);
  assert.deepEqual(first.envelope.snapshot.accessState, old.snapshot.accessState);
  assert.equal(first.envelope.snapshot.vaultState.pendingProposal.readyAt, old.snapshot.vaultState.pendingProposal.readyAt);
  assert.equal(first.envelope.snapshot.vaultState.pendingProposal.confirmBy, old.snapshot.vaultState.pendingProposal.confirmBy);
  assert.deepEqual(await repository.resolveCommit('policy-pending'), receipt);
  assert.equal((await repository.commit(request(old, 'stale-before-migration', first.envelope.snapshot))).type, 'CONFLICT');
});

test('aborted migration leaves old bytes intact and never reports READY before durable save', async (t) => {
  const { factory, repository, envelope } = await setup(t); const old = legacy(envelope);
  await raw(factory, (tx) => tx.objectStore('authority').put(old, 'envelope'));
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (this.name === 'authority' && key === 'envelope' && value.schemaVersion === 2) throw new DOMException('Synthetic migration failure', 'QuotaExceededError');
    return original.call(this, value, key);
  };
  try { assert.deepEqual(await repository.load(), { type: 'UNAVAILABLE' }); }
  finally { IDBObjectStore.prototype.put = original; }
  let stored; await raw(factory, (tx) => { const r = tx.objectStore('authority').get('envelope'); r.onsuccess = () => { stored = r.result; }; });
  assert.deepEqual(stored, old);
  assert.equal((await repository.load()).envelope.schemaVersion, 2);
});

test('corrupt legacy and incomplete schema-2 cannot be initialized or silently migrated', async (t) => {
  const { factory, repository, envelope } = await setup(t);
  const corrupt = legacy(envelope); corrupt.snapshot.accessState = {};
  await raw(factory, (tx) => tx.objectStore('authority').put(corrupt, 'envelope'));
  assert.deepEqual(await repository.load(), { type: 'UNAVAILABLE' });
  assert.equal(await repository.initialize(policy), false);
  const missing = structuredClone(envelope); delete missing.snapshot.configuration;
  await raw(factory, (tx) => tx.objectStore('authority').put(missing, 'envelope'));
  const loaded = await repository.load();
  assert.deepEqual(loaded.envelope, missing, 'schema-2 is passed to strict Core validation without bootstrap repair');
  assert.equal(await repository.initialize(policy), false);
});
