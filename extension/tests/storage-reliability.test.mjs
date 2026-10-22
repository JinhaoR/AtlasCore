import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBDatabase, IDBObjectStore } from 'fake-indexeddb';
import { fixture, deferred } from './support/fixture.mjs';
import { storageDiagnosticsCopy, storageFailureCopy } from '../dist/lib/ui/presentation.js';

function failReceipt(t, name, count = 1) {
  const original = IDBObjectStore.prototype.add;
  let failures = 0;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'receipts' && failures < count) {
      failures++;
      throw new DOMException('Synthetic confidential detail must never leave storage', name);
    }
    return original.apply(this, args);
  };
  const restore = () => { IDBObjectStore.prototype.add = original; };
  t.after(restore);
  return { restore, failures: () => failures };
}

test('ordinary authority loads and receipt resolution use readonly transactions', async t => {
  const f = await fixture(t);
  const original = IDBDatabase.prototype.transaction;
  const modes = [];
  IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
    modes.push(mode); return original.call(this, stores, mode, ...args);
  };
  try {
    for (let i = 0; i < 5; i++) assert.equal((await f.repository.load()).type, 'READY');
    await f.repository.resolveCommit('absent');
  } finally { IDBDatabase.prototype.transaction = original; }
  assert.deepEqual(modes, Array(6).fill('readonly'));
});

test('one aborted housekeeping write recovers before closing whitelisted documents', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  await f.firefox.visit(2, 'https://root.example/other');
  const policy = f.controller.getView().snapshot.policy;
  const fault = failReceipt(t, 'AbortError');
  f.clock.time++;
  await f.adapter.refresh();
  assert.equal(fault.failures(), 1);
  assert.equal(f.controller.getView().status, 'READY');
  assert.equal(f.firefox.updates.length, 0, 'recovery must precede destructive tab replacement');
  assert.equal(f.adapter.view().contexts.every(c => c.latest.decision?.outcome === 'ALLOW'), true);
  assert.deepEqual(f.controller.getView().snapshot.policy, policy);
  const health = f.adapter.view().storage;
  assert.equal(health.lastFailure.cause, 'ABORTED');
  assert.equal(health.failedCommits, 1);
  assert.equal(JSON.stringify(health).includes('confidential'), false);
});

test('recovery also covers a transient failure in a per-tab retained-page check', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  const original = f.repository.commit.bind(f.repository);
  let writes = 0;
  f.repository.commit = request => {
    if (++writes === 1) f.clock.time++;
    return original(request);
  };
  const add = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'receipts' && writes === 2) throw new DOMException('Synthetic failure', 'UnknownError');
    return add.apply(this, args);
  };
  t.after(() => { IDBObjectStore.prototype.add = add; });
  f.clock.time++;
  await f.adapter.refresh();
  assert.equal(f.controller.getView().status, 'READY');
  assert.equal(f.firefox.updates.length, 0);
  assert.equal(f.adapter.view().storage.lastFailure.cause, 'IO_ERROR');
});

test('persistent abort gets one automatic reconciliation attempt and stays closed', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  const fault = failReceipt(t, 'AbortError', Infinity);
  f.clock.time++;
  await f.adapter.refresh();
  assert.equal(f.controller.getView().reason, 'WRITE_FAILED');
  assert.equal(fault.failures(), 2, 'initial write plus one recovery write');
  for (let i = 0; i < 6; i++) { f.clock.time++; await f.adapter.refresh(); }
  assert.equal(fault.failures(), 2, 'no endless automatic retry loop');
  assert.equal((await f.firefox.request(3, 'https://root.example/')).cancel, true);
  fault.restore();
  await f.firefox.send({ kind: 'RECOVER' });
  assert.equal(f.controller.getView().status, 'READY', 'explicit recovery remains available');
});

test('quota failures expose a safe cause and do not auto-retry or reset saved policy', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  const before = (await f.repository.load()).envelope;
  const fault = failReceipt(t, 'QuotaExceededError', Infinity);
  f.clock.time++;
  await f.adapter.refresh();
  assert.equal(fault.failures(), 1);
  assert.equal(f.controller.getView().reason, 'WRITE_FAILED');
  assert.equal(f.adapter.view().storage.lastFailure.cause, 'QUOTA_EXCEEDED');
  assert.deepEqual((await f.repository.load()).envelope, before);
  const diagnostics = await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null });
  assert.equal(diagnostics.storage.lastFailure.cause, 'QUOTA_EXCEEDED');
  assert.equal(JSON.stringify(diagnostics.storage).includes('confidential'), false);
});

test('an aborted explicit access confirmation is never replayed by recovery', async t => {
  const f = await fixture(t);
  const started = await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'grey.example' } });
  f.clock.time += 10;
  const fault = failReceipt(t, 'AbortError');
  const confirmed = await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: started.referenceId });
  assert.equal(confirmed.type, 'BLOCKED');
  await f.adapter.refresh();
  assert.equal(fault.failures(), 1);
  assert.equal(f.controller.getView().status, 'READY');
  assert.equal(f.controller.getView().snapshot.accessState.grants.length, 0);
  assert.equal(f.controller.getView().snapshot.accessState.pendingRequests.length, 1);
  const fresh = await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: started.referenceId });
  assert.equal(fresh.type, 'COMMITTED', 'a fresh explicit confirmation is still required');
});

test('recovery preserves grant and proposal deadlines and cannot override Blacklist', async t => {
  const f = await fixture(t);
  const start = await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'grey.example' } });
  f.clock.time += 10;
  await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: start.referenceId });
  await f.controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: ['root.example', 'new.example'], blacklist: ['blocked.example'] } });
  const before = f.controller.getView().snapshot;
  failReceipt(t, 'AbortError'); f.clock.time++;
  await f.adapter.refresh();
  const after = f.controller.getView().snapshot;
  assert.deepEqual(after.accessState.grants, before.accessState.grants);
  assert.deepEqual(after.vaultState.pendingProposal, before.vaultState.pendingProposal);
  assert.deepEqual(after.policy, before.policy);
  assert.equal((await f.firefox.request(5, 'https://blocked.example/')).cancel, true);
  f.clock.time = before.accessState.grants[0].expiresAt;
  assert.equal((await f.firefox.request(6, 'https://grey.example/')).cancel, true);
});

test('unknown writes remain blocked without automatic recovery', async t => {
  const f = await fixture(t);
  const commit = f.repository.commit.bind(f.repository);
  let calls = 0;
  f.repository.commit = async request => { calls++; await commit(request); return { type: 'UNKNOWN', commitId: request.commitId }; };
  f.clock.time++;
  await f.adapter.refresh();
  assert.equal(f.controller.getView().status, 'RECONCILING');
  await f.adapter.refresh();
  assert.equal(calls, 1);
  assert.equal((await f.firefox.request(1, 'https://root.example/')).cancel, true);
});

test('recovery does not release documents or report ready before its save acknowledgement', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  const gate = deferred(), reached = deferred();
  const commit = f.repository.commit.bind(f.repository);
  let attempts = 0;
  f.repository.commit = async request => {
    if (++attempts === 2) { reached.resolve(); await gate.promise; }
    return commit(request);
  };
  failReceipt(t, 'AbortError'); f.clock.time++;
  const refresh = f.adapter.refresh();
  await reached.promise;
  assert.equal(f.controller.getView().status, 'COMMITTING');
  assert.equal(f.firefox.updates.length, 0);
  assert.deepEqual(f.adapter.view().temporaryAccess, [], 'only the previous acknowledged snapshot is visible');
  gate.resolve(); await refresh;
  assert.equal(f.controller.getView().status, 'READY');
  assert.equal(f.firefox.updates.length, 0);
});

test('an aborted policy confirmation is not replayed and recovery preserves frozen terms', async t => {
  const f = await fixture(t);
  const proposed = await f.controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: ['new.example'], blacklist: [] } });
  const before = f.controller.getView().snapshot;
  f.clock.time += 30;
  failReceipt(t, 'AbortError');
  const result = await f.controller.handle({ kind: 'CONFIRM_POLICY', proposalId: proposed.referenceId });
  assert.equal(result.type, 'BLOCKED');
  await f.adapter.refresh();
  assert.equal(f.controller.getView().status, 'READY');
  assert.deepEqual(f.controller.getView().snapshot.policy, before.policy);
  assert.deepEqual(f.controller.getView().snapshot.vaultState.pendingProposal, before.vaultState.pendingProposal);
});

test('a clock rollback during recovery remains blocked under the same owner floor', async t => {
  const f = await fixture(t);
  const commit = f.repository.commit.bind(f.repository);
  f.repository.commit = async request => { const result = await commit(request); if (result.type === 'NOT_WRITTEN') f.clock.time--; return result; };
  failReceipt(t, 'AbortError'); f.clock.time++;
  await f.adapter.refresh();
  assert.equal(f.controller.getView().reason, 'CLOCK_ROLLBACK');
  assert.equal((await f.firefox.request(1, 'https://root.example/')).cancel, true);
});

test('recovery cannot reuse Journey authority; ended attempts keep their original deadline', async t => {
  const f = await fixture(t);
  await f.firefox.request(1, 'https://root.example/');
  await f.firefox.redirect(1, 'https://provider.example/');
  const journey = f.adapter.view().contexts[0].journey;
  assert.equal(journey.phase, 'IN_TRANSIT');
  failReceipt(t, 'AbortError'); f.clock.time++;
  await f.adapter.refresh();
  const ended = f.adapter.view().contexts[0].journey;
  assert.equal(ended.phase, 'ENDED');
  assert.equal(ended.endReason, 'CONTEXT_CLOSED');
  assert.equal(ended.expiresAt, journey.expiresAt);
  assert.equal(f.adapter.view().contexts[0].latest.decision.outcome, 'GREYLIST');
});

test('a diagnostic failure cannot turn ready authority into a browsing outage', async t => {
  const f = await fixture(t);
  f.repository.getDiagnostics = () => { throw Error('Synthetic private detail'); };
  assert.equal(f.adapter.view().storage, null);
  await f.adapter.refresh();
  assert.equal((await f.firefox.request(1, 'https://root.example/')).cancel, undefined);
});

test('storage copy distinguishes quota and never advises deleting authority', () => {
  const storage = { readTransactions: 9, writeTransactions: 3, committedWrites: 2, failedCommits: 1,
    lastFailure: { sequence: 1, operation: 'COMMIT', stage: 'TRANSACTION_ABORT', cause: 'QUOTA_EXCEEDED' } };
  assert.match(storageFailureCopy(storage), /QUOTA_EXCEEDED.*Free disk space/);
  assert.match(storageFailureCopy(storage), /Do not clear Atlas data/);
  assert.match(storageDiagnosticsCopy(storage), /9 read transactions, 3 write transactions/);
  assert.equal(storageFailureCopy(null), '');
});

test('many retained tabs and repeated advancing-time ticks tolerate isolated aborted writes', async t => {
  const f = await fixture(t);
  for (let tab = 1; tab <= 25; tab++) f.firefox.documents.set(tab, { id: tab, url: 'https://root.example/', incognito: false });
  f.clock.now = () => ++f.clock.time;
  const original = IDBObjectStore.prototype.add;
  let attempts = 0, aborted = 0;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'receipts' && ++attempts % 90 === 0) {
      aborted++;
      throw new DOMException('Synthetic intermittent interruption', 'AbortError');
    }
    return original.apply(this, args);
  };
  t.after(() => { IDBObjectStore.prototype.add = original; });
  for (let tick = 0; tick < 20; tick++) {
    await f.adapter.refresh();
    assert.equal(f.controller.getView().status, 'READY');
  }
  assert.ok(aborted >= 5, 'exercise multiple incidents, not one permanently consumed recovery budget');
  assert.equal(f.firefox.updates.length, 0);
  assert.equal(f.adapter.view().contexts.length, 25);
  assert.deepEqual(f.controller.getView().snapshot.accessState.grants, []);
});

test('an unknown recovery commit stays uncertain instead of auto-opening again', async t => {
  const f = await fixture(t);
  const commit = f.repository.commit.bind(f.repository);
  let calls = 0;
  f.repository.commit = async request => {
    const result = await commit(request);
    return ++calls === 2 ? { type: 'UNKNOWN', commitId: request.commitId } : result;
  };
  failReceipt(t, 'AbortError'); f.clock.time++;
  await f.adapter.refresh();
  assert.equal(f.controller.getView().status, 'RECONCILING');
  for (let i = 0; i < 4; i++) await f.adapter.refresh();
  assert.equal(calls, 2);
  assert.equal((await f.firefox.request(1, 'https://root.example/')).cancel, true);
});

test('a superseding request during recovery cannot receive the old retained-page result', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  const gate = deferred(), reached = deferred();
  const commit = f.repository.commit.bind(f.repository);
  let attempts = 0;
  f.repository.commit = async request => {
    if (++attempts === 2) { reached.resolve(); await gate.promise; }
    return commit(request);
  };
  failReceipt(t, 'AbortError'); f.clock.time++;
  const refresh = f.adapter.refresh();
  await reached.promise;
  const navigation = f.firefox.request(1, 'https://blocked.example/');
  gate.resolve(); await refresh;
  assert.equal((await navigation).cancel, true);
  assert.equal(f.adapter.view().contexts[0].latest.decision.reason, 'BLACKLISTED');
});
