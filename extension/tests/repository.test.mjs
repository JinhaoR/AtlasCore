import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { openRepository } from '../dist/lib/storage/indexeddb-repository.js';
import { policy } from './support/fixture.mjs';

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
  expectedStorageVersion: envelope.storageVersion, next: { schemaVersion: 1, snapshot: next } });
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
