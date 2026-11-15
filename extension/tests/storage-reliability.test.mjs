import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBDatabase, IDBObjectStore } from 'fake-indexeddb';
import { fixture, deferred } from './support/fixture.mjs';
import { authorityInterruptionCopy, storageDiagnosticsCopy, storageFailureCopy } from '../dist/lib/ui/presentation.js';

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

/** Abort the real queued readonly transaction, after handlers have been installed. */
function failLoad(t, { count = 1, enabled = () => true } = {}) {
  const original = IDBObjectStore.prototype.get;
  let failures = 0;
  IDBObjectStore.prototype.get = function (key) {
    const request = original.call(this, key);
    if (this.name === 'authority' && key === 'envelope' && this.transaction.mode === 'readonly'
      && failures < count && enabled()) {
      failures++;
      const transaction = this.transaction;
      queueMicrotask(() => transaction.abort());
    }
    return request;
  };
  const restore = () => { IDBObjectStore.prototype.get = original; };
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

test('one aborted readonly housekeeping load recovers before replacing Whitelisted pages', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  await f.firefox.visit(2, 'https://root.example/other');
  const before = f.controller.getView().snapshot;
  const fault = failLoad(t);
  f.clock.time++;
  await f.adapter.refresh();
  assert.equal(fault.failures(), 1);
  assert.equal(f.controller.getView().status, 'READY');
  assert.equal(f.firefox.updates.length, 0, 'a fresh verified reload must precede any document replacement');
  assert.equal(f.adapter.view().contexts.every(c => c.latest.decision?.outcome === 'ALLOW'), true);
  assert.deepEqual(f.controller.getView().snapshot.policy, before.policy);
  assert.deepEqual(f.adapter.view().storage.lastFailure,
    { sequence: 1, operation: 'LOAD', stage: 'TRANSACTION_ABORT', cause: 'ABORTED' });
  assert.equal(f.adapter.view().storage.failedCommits, 0);
});

test('an aborted post-commit readonly verification load gets the same bounded recovery', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  const commit = f.repository.commit.bind(f.repository);
  let written = false;
  f.repository.commit = async request => { const result = await commit(request); written = result.type === 'COMMITTED'; return result; };
  // The housekeeping write succeeds, its post-write readonly verification aborts.
  const fault = failLoad(t, { enabled: () => written });
  f.clock.time++;
  await f.adapter.refresh();
  assert.equal(fault.failures(), 1);
  assert.equal(f.controller.getView().status, 'READY');
  assert.equal(f.firefox.updates.length, 0);
  assert.equal(f.adapter.view().contexts[0].latest.decision.outcome, 'ALLOW');
});

test('a readonly abort in the retained-page check recovers after successful housekeeping', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  let loads = 0;
  const fault = failLoad(t, { enabled: () => ++loads === 3 });
  f.clock.time++;
  await f.adapter.refresh();
  assert.equal(fault.failures(), 1, 'abort the retained check after initial load and post-write verification');
  assert.equal(f.controller.getView().status, 'READY');
  assert.equal(f.firefox.updates.length, 0);
  assert.equal(f.adapter.view().contexts[0].latest.decision.outcome, 'ALLOW');
});

test('a damaged initialized marker cannot reuse a stale aborted-load diagnosis for recovery', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  const before = f.controller.getView().snapshot;
  failLoad(t); f.clock.time++; await f.adapter.refresh();
  assert.equal(f.controller.getView().status, 'READY');
  const priorFailure = f.adapter.view().storage.lastFailure;
  const opened = f.factory.open('atlas-authority-v1', 1);
  const db = await new Promise((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('authority', 'readwrite');
    tx.objectStore('authority').put(false, 'initialized');
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
  });
  const load = f.repository.load.bind(f.repository); let loads = 0;
  f.repository.load = () => { loads++; return load(); };
  await f.adapter.refresh();
  assert.equal(f.controller.getView().status, 'UNAVAILABLE');
  assert.equal(loads, 1, 'data damage does not trigger a transient retry');
  assert.equal(f.adapter.view().storage.lastFailure.cause, 'INVALID_DATA');
  assert.equal(f.adapter.view().storage.lastFailure.stage, 'VALIDATION');
  assert.ok(f.adapter.view().storage.lastFailure.sequence > priorFailure.sequence);
  assert.deepEqual(f.controller.getView().snapshot.policy, before.policy);
});

test('persistent readonly abort performs one recovery attempt and cannot create an idle retry loop', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  const fault = failLoad(t, { count: Infinity });
  f.clock.time++;
  await f.adapter.refresh();
  assert.equal(f.controller.getView().reason, 'STORAGE_UNAVAILABLE');
  assert.equal(fault.failures(), 2, 'one interrupted load plus one bounded recovery load');
  for (let i = 0; i < 8; i++) { f.clock.time++; await f.adapter.refresh(); }
  assert.equal(fault.failures(), 2);
  assert.equal((await f.firefox.request(2, 'https://root.example/')).cancel, true);
  fault.restore(); await f.firefox.send({ kind: 'RECOVER' });
  assert.equal(f.controller.getView().status, 'READY');
});

test('a read abort before explicit confirmation cannot be replayed into a grant', async t => {
  const f = await fixture(t);
  const started = await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'grey.example' } });
  f.clock.time += 10;
  const before = f.controller.getView().snapshot;
  failLoad(t);
  const result = await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: started.referenceId });
  assert.equal(result.type, 'BLOCKED');
  assert.equal(result.reason, 'STORAGE_UNAVAILABLE');
  await f.adapter.refresh();
  assert.equal(f.controller.getView().status, 'READY');
  assert.deepEqual(f.controller.getView().snapshot.accessState.pendingRequests, before.accessState.pendingRequests);
  assert.equal(f.controller.getView().snapshot.accessState.grants.length, 0);
  assert.equal((await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: started.referenceId })).type, 'COMMITTED');
});

test('a read abort after a committed confirmation preserves the one grant and never confirms again', async t => {
  const f = await fixture(t);
  const started = await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'grey.example' } });
  f.clock.time += 10;
  const commit = f.repository.commit.bind(f.repository);
  let committed = false;
  f.repository.commit = async request => { const result = await commit(request); committed = result.type === 'COMMITTED'; return result; };
  failLoad(t, { enabled: () => committed });
  const result = await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: started.referenceId });
  assert.equal(result.type, 'BLOCKED');
  assert.equal(result.reason, 'STORAGE_UNAVAILABLE');
  const savedGrant = structuredClone(f.controller.getView().snapshot.accessState.grants[0]);
  assert.ok(savedGrant, 'a COMMITTED receipt already acknowledges exactly one grant');
  assert.equal(f.controller.getView().pendingCommitId, null);
  f.clock.time++;
  await f.adapter.refresh();
  assert.equal(f.controller.getView().status, 'READY');
  assert.deepEqual(f.controller.getView().snapshot.accessState.grants, [savedGrant]);
  assert.equal(f.controller.getView().snapshot.accessState.pendingRequests.length, 0);
  const repeated = await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: started.referenceId });
  assert.equal(repeated.reason, 'REQUEST_NOT_FOUND');
  assert.deepEqual(f.controller.getView().snapshot.accessState.grants, [savedGrant]);
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

test('periodic clock catch-up restores authority, retains diagnostics, and leaves navigation gated', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  const policy = f.controller.getView().snapshot.policy;
  f.clock.time = 999;
  await f.adapter.refresh();
  const issue = f.adapter.view().authorityInterruption;
  assert.equal(issue.reason, 'CLOCK_ROLLBACK');
  const writes = f.adapter.view().storage.committedWrites;
  for (let i = 0; i < 3; i++) await f.adapter.refresh();
  assert.equal(f.controller.getView().reason, 'CLOCK_ROLLBACK');
  assert.equal(f.adapter.view().storage.committedWrites, writes);
  assert.equal((await f.firefox.request(2, 'https://root.example/')).cancel, true);
  const updates = f.firefox.updates.length;
  f.clock.time = 1000;
  await f.adapter.refresh();
  assert.equal(f.controller.getView().status, 'READY');
  assert.deepEqual(f.controller.getView().snapshot.policy, policy);
  assert.deepEqual(f.adapter.view().authorityInterruption, issue);
  assert.equal(f.firefox.updates.length, updates, 'catch-up does not silently reopen removed pages');
  assert.equal((await f.firefox.request(1, 'https://root.example/')).cancel, undefined);
  assert.equal((await f.firefox.request(2, 'https://blocked.example/')).cancel, true);
  assert.equal((await f.firefox.request(3, 'https://unknown.example/')).cancel, true);
});

test('clock recovery cannot reuse Journey authority or renew its deadline', async t => {
  const f = await fixture(t);
  await f.firefox.request(1, 'https://root.example/');
  await f.firefox.redirect(1, 'https://provider.example/');
  const journey = f.adapter.view().contexts[0].journey;
  assert.equal(journey.phase, 'IN_TRANSIT');
  f.clock.time--;
  await f.adapter.refresh();
  f.clock.time = 1001;
  await f.adapter.refresh();
  assert.equal(f.controller.getView().status, 'READY');
  const ended = f.controller.getView().snapshot.journeyState.journeys.find(j => j.id === journey.id);
  assert.equal(ended.phase, 'ENDED');
  assert.equal(ended.expiresAt, journey.expiresAt);
  assert.equal((await f.firefox.request(1, 'https://provider.example/')).cancel, true);
});

test('clock catch-up does not confirm waiting access and preserves an existing grant expiry', async t => {
  const f = await fixture(t);
  await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'grant.example' } });
  f.clock.time = 1010;
  await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: 1 });
  await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'waiting.example' } });
  const before = f.controller.getView().snapshot.accessState;
  f.clock.time--;
  await f.adapter.refresh();
  f.clock.time = 1020;
  await f.adapter.refresh();
  const after = f.controller.getView().snapshot.accessState;
  assert.deepEqual(after.grants, before.grants);
  assert.deepEqual(after.pendingRequests, before.pendingRequests);
  assert.equal((await f.firefox.request(1, 'https://grant.example/')).cancel, undefined);
  assert.equal((await f.firefox.request(2, 'https://waiting.example/')).cancel, true);
  f.clock.time = 1110;
  await f.adapter.refresh();
  assert.equal((await f.firefox.request(1, 'https://grant.example/')).cancel, true);
});

test('an unknown write during clock recovery stays latched without replay or receipt polling', async t => {
  const f = await fixture(t);
  f.clock.time--;
  await f.adapter.refresh();
  const commit = f.repository.commit.bind(f.repository);
  f.repository.commit = async request => { await commit(request); return { type: 'UNKNOWN', commitId: request.commitId }; };
  f.clock.time = 1001;
  await f.adapter.refresh();
  assert.equal(f.controller.getView().reason, 'COMMIT_UNKNOWN');
  const before = f.adapter.view().storage;
  for (let i = 0; i < 3; i++) { f.clock.time++; await f.adapter.refresh(); }
  assert.deepEqual(f.adapter.view().storage, before);
  assert.equal(f.controller.getView().reason, 'COMMIT_UNKNOWN');
  assert.equal((await f.firefox.request(1, 'https://root.example/')).cancel, true);
});

test('clock interruption without a storage failure is retained after explicit successful recovery', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  const policy = structuredClone(f.controller.getView().snapshot.policy);
  f.clock.time--;
  await f.adapter.refresh();
  const issue = f.adapter.view().authorityInterruption;
  assert.equal(f.controller.getView().reason, 'CLOCK_ROLLBACK');
  assert.deepEqual(issue, { status: 'UNAVAILABLE', reason: 'CLOCK_ROLLBACK', observedAt: f.clock.time,
    checkpointAt: 1000, latestStorageFailure: null });
  assert.equal(f.adapter.view().storage.failedCommits, 0);
  assert.equal(f.adapter.view().storage.lastFailure, null);
  assert.deepEqual((await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null })).authorityInterruption, issue);
  f.clock.time = 1002;
  await f.firefox.send({ kind: 'RECOVER' });
  assert.equal(f.controller.getView().status, 'READY');
  assert.deepEqual(f.adapter.view().authorityInterruption, issue, 'recovery retains the explanation, not permission');
  assert.deepEqual((await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null })).authorityInterruption, issue);
  assert.deepEqual(f.controller.getView().snapshot.policy, policy);
});

test('successful automatic read recovery preserves its interruption while current authority is READY', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  failLoad(t); f.clock.time++;
  await f.adapter.refresh();
  const view = f.adapter.view(), issue = view.authorityInterruption;
  assert.equal(view.controller.status, 'READY');
  assert.equal(issue.status, 'UNAVAILABLE');
  assert.equal(issue.reason, 'STORAGE_UNAVAILABLE');
  assert.deepEqual(issue.latestStorageFailure, { sequence: 1, operation: 'LOAD', stage: 'TRANSACTION_ABORT', cause: 'ABORTED' });
  assert.equal(f.firefox.updates.length, 0);
  for (let i = 0; i < 3; i++) { f.clock.time++; await f.adapter.refresh(); }
  assert.deepEqual(f.adapter.view().authorityInterruption, issue);
  assert.deepEqual((await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null })).authorityInterruption, issue);
});

test('diagnostic provider getter exceptions cannot prevent interruption recording or healthy recovery', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  Object.defineProperty(f.repository, 'getDiagnostics', { configurable: true,
    get() { throw Error('Synthetic confidential diagnostic provider failure'); } });
  assert.equal(f.adapter.view().storage, null);
  await f.adapter.refresh();
  assert.equal(f.controller.getView().status, 'READY');
  assert.equal(f.firefox.updates.length, 0);
  f.clock.time--;
  await f.adapter.refresh();
  const issue = f.adapter.view().authorityInterruption;
  assert.equal(issue.reason, 'CLOCK_ROLLBACK');
  assert.equal(issue.latestStorageFailure, null);
  assert.equal(JSON.stringify(issue).includes('confidential'), false);
  f.clock.time = 1002;
  await f.firefox.send({ kind: 'RECOVER' });
  assert.equal(f.controller.getView().status, 'READY');
  assert.deepEqual(f.adapter.view().authorityInterruption, issue);
});

test('throwing returned diagnostic getters cannot disrupt authorization or leak their exception', async t => {
  const f = await fixture(t);
  await f.firefox.visit(1, 'https://root.example/');
  for (const nested of [false, true]) {
    f.repository.getDiagnostics = () => {
      const value = { readTransactions: 0, writeTransactions: 0, committedWrites: 0, failedCommits: 0,
        lastFailure: { sequence: 1, operation: 'LOAD', stage: 'TRANSACTION_ABORT', cause: 'ABORTED' } };
      Object.defineProperty(nested ? value.lastFailure : value, nested ? 'cause' : 'lastFailure', {
        get() { throw Error('Synthetic confidential returned diagnostic getter'); },
      });
      return value;
    };
    assert.equal(f.adapter.view().storage, null);
    f.clock.time++;
    await f.adapter.refresh();
    assert.equal(f.controller.getView().status, 'READY');
    assert.equal(f.firefox.updates.length, 0);
  }
  f.clock.time--;
  await f.adapter.refresh();
  const diagnostics = await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null });
  assert.equal(diagnostics.storage, null);
  assert.equal(diagnostics.authorityInterruption.reason, 'CLOCK_ROLLBACK');
  assert.equal(diagnostics.authorityInterruption.latestStorageFailure, null);
  assert.equal(JSON.stringify(diagnostics.authorityInterruption).includes('confidential'), false);
});

test('unknown commit interruption is recorded as RECONCILING and cannot auto-restore authority', async t => {
  const f = await fixture(t), commit = f.repository.commit.bind(f.repository);
  let calls = 0;
  f.repository.commit = async request => { calls++; await commit(request); return { type: 'UNKNOWN', commitId: request.commitId }; };
  f.clock.time++;
  await f.adapter.refresh();
  const issue = f.adapter.view().authorityInterruption;
  assert.equal(issue.status, 'RECONCILING');
  assert.equal(issue.reason, 'COMMIT_UNKNOWN');
  assert.equal(issue.latestStorageFailure, null);
  assert.ok(f.controller.getView().pendingCommitId);
  for (let i = 0; i < 4; i++) { f.clock.time++; await f.adapter.refresh(); }
  assert.equal(calls, 1);
  assert.equal(f.controller.getView().status, 'RECONCILING');
  assert.deepEqual(f.adapter.view().authorityInterruption, issue);
  assert.deepEqual((await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null })).authorityInterruption, issue);
});

test('a later independent incident replaces the retained explanation after a healthy cycle', async t => {
  const f = await fixture(t);
  let armed = true;
  const fault = failLoad(t, { count: 2, enabled: () => {
    if (!armed) return false;
    armed = false; return true; // Each new incident fails once; its recovery read is healthy.
  } });
  f.clock.time++;
  await f.adapter.refresh();
  const first = f.adapter.view().authorityInterruption;
  assert.equal(f.controller.getView().status, 'READY');
  assert.equal(first.latestStorageFailure.sequence, 1);
  f.clock.time++; armed = true;
  await f.adapter.refresh();
  const second = f.adapter.view().authorityInterruption;
  assert.equal(fault.failures(), 2);
  assert.equal(f.controller.getView().status, 'READY');
  assert.equal(second.reason, 'STORAGE_UNAVAILABLE');
  assert.equal(second.latestStorageFailure.sequence, 2);
  assert.ok(second.observedAt > first.observedAt);
  assert.notDeepEqual(second, first);
});

test('retained interruption copy names its reason and status without claiming current failure or permission', () => {
  assert.equal(authorityInterruptionCopy(null), '');
  assert.equal(authorityInterruptionCopy(undefined), '');
  const issue = { reason: 'CLOCK_ROLLBACK', status: 'UNAVAILABLE', observedAt: 999, checkpointAt: 1000, latestStorageFailure: null };
  const before = structuredClone(issue), copy = authorityInterruptionCopy(issue);
  assert.match(copy, /CLOCK_ROLLBACK/);
  assert.match(copy, /UNAVAILABLE/);
  assert.match(copy, /retained across recovery/);
  assert.deepEqual(issue, before);
});
