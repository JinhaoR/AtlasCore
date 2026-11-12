import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { compileManagedBlacklist, createAtlasController, evaluate, planAtlasOperation } from '@atlas/core';
import { openRepository } from '../dist/lib/storage/indexeddb-repository.js';
import { initializeDevelopmentPolicy } from '../dist/lib/background/bootstrap.js';
import { compileCuratedWhitelist, legacyCuratedWhitelist } from '../dist/lib/presets/curated-whitelist.js';
import { curatedUpgradeId, curatedUpgradeKey, curatedUpgradeHosts, initialCuratedReceipt, readCuratedUpgradeReceipt, planCuratedUpgrade } from '../dist/lib/presets/curated-upgrade.js';
import { legacyCuratedUpgradeId, legacyCuratedUpgradeKey, legacyCuratedUpgradeHosts } from '../dist/lib/presets/curated-upgrade-v2.js';
import { destinationIndex } from '../dist/lib/ui/destinations.js';
import { destinationEntryPoints, pinnedDestinations } from '../dist/lib/ui/home-model.js';
import { draftBaseline, newDestinationDraft, stageDestination, readDestinationDraft, assessDraft } from '../dist/lib/ui/destination-draft.js';
import { readDestinationWorkspace } from '../dist/lib/ui/draft-storage.js';
import { configuration } from './support/fixture.mjs';
import { createAdapterHost } from '../dist/lib/background/startup.js';
import { FirefoxAdapter } from '../dist/lib/adapter/firefox-adapter.js';
import { FakeFirefox } from './support/fake-firefox.mjs';

const policy = { whitelist: ['my-added.example', 'github.com'], blacklist: ['drive.google.com', 'my-blocked.example'] };
async function setup(t, input = policy) {
  const factory = new IDBFactory(); let version = 0;
  const next = () => `v${++version}`;
  const open = () => openRepository(factory, next, 'curated-test', configuration);
  const repository = await open(); t.after(() => repository.close());
  await repository.initialize(input);
  const envelope = (await repository.load()).envelope;
  return { factory, repository, open, envelope };
}
async function raw(factory, work) {
  const opened = factory.open('curated-test', 1);
  const db = await new Promise((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('authority', 'readwrite'); let value;
    work(tx.objectStore('authority'), result => { value = result; });
    tx.oncomplete = () => { db.close(); resolve(value); }; tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
const marker = factory => raw(factory, (store, done) => { const q = store.get(curatedUpgradeKey); q.onsuccess = () => done(q.result); });
const commit = (envelope, snapshot, id) => ({ commitId: id, expectedStorageVersion: envelope.storageVersion, next: { schemaVersion: 2, snapshot } });
const wikipedia = ['wikipedia.org', 'www.wikipedia.org', 'en.wikipedia.org', 'sv.wikipedia.org'];
const legacyReceipt = (kind = 'INITIALIZED') => ({ id: legacyCuratedUpgradeId, kind, policyRevisionBefore: 0,
  policyRevisionAfter: kind === 'INITIALIZED' ? 0 : 1, added: [...legacyCuratedUpgradeHosts], alreadyPresent: [], skippedBlacklisted: [], skippedManaged: [] });

test('fresh defaults and current migration omit Wikipedia but preserve existing explicit user permissions', async t => {
  const f = await setup(t, { whitelist: ['wikipedia.org', 'custom.example'], blacklist: ['en.wikipedia.org'] });
  const result = await f.repository.applyCuratedUpgrade();
  assert.equal(result.receipt.id, curatedUpgradeId);
  assert.equal(curatedUpgradeHosts.length, 294);
  for (const host of wikipedia) assert.equal(result.receipt.added.includes(host), false);
  const saved = (await f.repository.load()).envelope.snapshot.policy;
  assert.equal(evaluate('wikipedia.org', saved).outcome, 'ALLOW', 'saved user permission is not silently removed');
  assert.equal(evaluate('en.wikipedia.org', saved).reason, 'BLACKLISTED');
  assert.equal(evaluate('www.wikipedia.org', saved).outcome, 'GREYLIST');
  assert.equal(evaluate('sv.wikipedia.org', saved).outcome, 'GREYLIST');
  assert.ok(saved.whitelist.includes('custom.example'));
});

test('curated initialization cannot silently add an extra broad permission to the fixed preset', async t => {
  const repository = await openRepository(new IDBFactory(), () => 'fresh', 'scope-seed', configuration);
  t.after(() => repository.close());
  assert.equal(await repository.initialize({ ...compileCuratedWhitelist(), whitelistSubdomains: ['su.se'] }, true), false);
  assert.equal((await repository.load()).type, 'UNINITIALIZED');
  assert.equal(repository.getCuratedUpgrade(), null);
});

test('an existing optional scope survives migration without creating new exact-host exceptions', async t => {
  const f = await setup(t, { whitelist: ['my-added.example'], blacklist: [], whitelistSubdomains: ['su.se'] });
  const result = await f.repository.applyCuratedUpgrade(compileManagedBlacklist(['fysik.su.se']));
  const after = (await f.repository.load()).envelope.snapshot.policy;
  assert.deepEqual(after.whitelistSubdomains, ['su.se']);
  for (const host of ['su.se', 'www.su.se', 'fysik.su.se']) {
    assert.equal(after.whitelist.includes(host), false, host);
    assert.ok(result.receipt.alreadyPresent.includes(host), host);
  }
});

test('signed v2 initialization receipts remain valid and retire the expansion without a v3 write', async t => {
  const f = await setup(t, { whitelist: [...legacyCuratedUpgradeHosts, 'custom.example'], blacklist: [] });
  const receipt = legacyReceipt();
  assert.deepEqual(readCuratedUpgradeReceipt(receipt), receipt);
  await raw(f.factory, store => store.put(receipt, legacyCuratedUpgradeKey));
  const before = await f.repository.load(), writes = f.repository.getDiagnostics().writeTransactions;
  const result = await f.repository.applyCuratedUpgrade();
  assert.equal(result.type, 'ALREADY_APPLIED');
  assert.equal(result.receipt.id, legacyCuratedUpgradeId);
  assert.deepEqual(await f.repository.load(), before);
  assert.equal(f.repository.getDiagnostics().writeTransactions, writes);
  assert.equal(await marker(f.factory), undefined, 'no unnecessary second migration marker or revision');
});

test('a signed v2 upgrade never re-adds later removed Wikipedia or other curated hosts', async t => {
  const removed = new Set([...wikipedia, 'zotero.org']);
  const f = await setup(t, { whitelist: [...legacyCuratedUpgradeHosts.filter(host => !removed.has(host)), 'my-extra.example'], blacklist: ['github.com'] });
  const snapshot = structuredClone(f.envelope.snapshot); snapshot.policyRevision = 2;
  assert.equal((await f.repository.commit(commit(f.envelope, snapshot, 'later-removal'))).type, 'COMMITTED');
  await raw(f.factory, store => store.put(legacyReceipt('UPGRADED'), legacyCuratedUpgradeKey));
  const before = await f.repository.load();
  const reopened = await f.open(); t.after(() => reopened.close());
  assert.equal((await reopened.applyCuratedUpgrade()).type, 'ALREADY_APPLIED');
  assert.deepEqual(await reopened.load(), before);
  assert.equal(reopened.getDiagnostics().writeTransactions, 0);
  for (const host of removed) assert.equal(evaluate(host, before.envelope.snapshot.policy).outcome, 'GREYLIST', host);
  assert.equal(evaluate('github.com', before.envelope.snapshot.policy).reason, 'BLACKLISTED');
});

test('malformed legacy receipts and receipt IDs stored under the wrong known key fail closed', async t => {
  for (const [key, receipt] of [
    [legacyCuratedUpgradeKey, { ...legacyReceipt(), added: legacyCuratedUpgradeHosts.slice(1) }],
    [curatedUpgradeKey, legacyReceipt()],
    [legacyCuratedUpgradeKey, initialCuratedReceipt()],
  ]) {
    const f = await setup(t);
    await raw(f.factory, store => store.put(receipt, key));
    const before = await f.repository.load(), writes = f.repository.getDiagnostics().writeTransactions;
    assert.equal((await f.repository.applyCuratedUpgrade()).type, 'UNAVAILABLE');
    assert.deepEqual(await f.repository.load(), before);
    assert.equal(f.repository.getDiagnostics().writeTransactions, writes);
  }
});

test('an orphaned signed v2 marker is never overwritten by new fresh defaults', async t => {
  const f = await setup(t);
  await raw(f.factory, store => { store.put(false, 'initialized'); store.delete('envelope'); store.put(legacyReceipt(), legacyCuratedUpgradeKey); });
  assert.equal(await f.repository.initialize(compileCuratedWhitelist(), true), false);
  assert.equal((await f.repository.applyCuratedUpgrade()).type, 'UNAVAILABLE');
});

test('retired Wikipedia display identity keeps saved pins, entry points and frozen draft receipts readable', async t => {
  const f = await setup(t, { whitelist: [...legacyCuratedUpgradeHosts], blacklist: [] });
  const pins = ['service:wikipedia.org'], preferences = { version: 1, destinations: [], pending: null };
  const entry = destinationIndex(f.envelope.snapshot.policy).find(entry => entry.id === 'service:wikipedia.org');
  assert.ok(entry); assert.equal(entry.label, 'Wikipedia'); assert.deepEqual(entry.hostnames, wikipedia);
  assert.deepEqual(destinationEntryPoints(entry), ['wikipedia.org', 'en.wikipedia.org', 'sv.wikipedia.org']);
  assert.deepEqual(pinnedDestinations([entry], pins), [entry]);
  const baseline = draftBaseline(f.envelope.snapshot, preferences, pins);
  const before = baseline.entries.find(entry => entry.metadata.id === 'service:wikipedia.org');
  assert.deepEqual(before.metadata.hostnames, wikipedia);
  const draft = stageDestination(newDestinationDraft('saved-v2-wikipedia-removal', baseline), 'service:wikipedia.org', null);
  assert.deepEqual(readDestinationDraft(draft), draft);
  const candidatePolicy = assessDraft(draft, baseline).candidatePolicy;
  const workspace = { version: 1, draft: null, receipt: { kind: 'POLICY', draft, candidatePolicy, expectedProposalId: 1,
    proposalId: 1, baseConfigurationRevision: 0, phase: 'DONE', owner: null } };
  assert.deepEqual(readDestinationWorkspace(workspace), workspace);
  assert.deepEqual(f.envelope.snapshot.policy.whitelist, [...legacyCuratedUpgradeHosts], 'display and decoding supply no authority');
});

test('upgrade unions preset with every custom host, keeps Blacklist/configuration and reports exact outcomes', async t => {
  const f = await setup(t);
  const managed = compileManagedBlacklist(['figma.com']);
  const result = await f.repository.applyCuratedUpgrade(managed);
  assert.equal(result.type, 'APPLIED');
  const saved = (await f.repository.load()).envelope;
  assert.deepEqual(saved.snapshot.policy.blacklist, policy.blacklist);
  assert.deepEqual(saved.snapshot.configuration, f.envelope.snapshot.configuration);
  assert.equal(saved.snapshot.configurationRevision, 0);
  assert.ok(saved.snapshot.policy.whitelist.includes('my-added.example'));
  assert.ok(saved.snapshot.policy.whitelist.includes('zotero.org'));
  assert.equal(new Set(saved.snapshot.policy.whitelist).size, saved.snapshot.policy.whitelist.length);
  assert.equal(evaluate('drive.google.com', saved.snapshot.policy).reason, 'BLACKLISTED');
  assert.deepEqual(result.receipt.skippedBlacklisted, ['drive.google.com']);
  assert.deepEqual(result.receipt.skippedManaged, ['figma.com']);
  assert.deepEqual(result.receipt.alreadyPresent, ['github.com']);
  assert.equal(saved.snapshot.policyRevision, 1);
  assert.deepEqual(await marker(f.factory), result.receipt);
  assert.deepEqual(f.repository.getCuratedUpgrade(), result.receipt);
});

test('all legacy 51 entries and arbitrary extra Whitelist entries survive the expansion', async t => {
  const old = compileCuratedWhitelist(legacyCuratedWhitelist);
  const existingUserHosts = ['youtube.com', 'www.youtube.com', 'custom-one.example', 'custom-two.example'];
  const f = await setup(t, { whitelist: [...old.whitelist, ...existingUserHosts], blacklist: [] });
  await f.repository.applyCuratedUpgrade();
  const hosts = (await f.repository.load()).envelope.snapshot.policy.whitelist;
  assert.deepEqual(new Set(hosts), new Set([...curatedUpgradeHosts, ...existingUserHosts]));
});

test('same migration runs once across reopen and later deliberate removals stay removed', async t => {
  const f = await setup(t);
  const first = await f.repository.applyCuratedUpgrade();
  const before = (await f.repository.load()).envelope;
  const snapshot = structuredClone(before.snapshot);
  snapshot.policy.whitelist = snapshot.policy.whitelist.filter(h => h !== 'zotero.org');
  snapshot.policyRevision++;
  assert.equal((await f.repository.commit(commit(before, snapshot, 'later-deliberate-removal'))).type, 'COMMITTED');
  const afterRemoval = await f.repository.load();
  const reopened = await f.open(); t.after(() => reopened.close());
  const again = await reopened.applyCuratedUpgrade();
  assert.equal(again.type, 'ALREADY_APPLIED');
  assert.deepEqual(again.receipt, first.receipt);
  assert.deepEqual(await reopened.load(), afterRemoval);
  assert.equal(evaluate('zotero.org', afterRemoval.envelope.snapshot.policy).outcome, 'GREYLIST');
  assert.equal(reopened.getDiagnostics().writeTransactions, 0, 'subsequent startup checks are readonly');
});

test('accepted one-time expansion reintroduces previously removed defaults unless Blacklisted', async t => {
  const f = await setup(t, { whitelist: [], blacklist: ['zotero.org', 'www.zotero.org', 'github.com'] });
  await f.repository.applyCuratedUpgrade();
  const { policy: saved } = (await f.repository.load()).envelope.snapshot;
  assert.ok(saved.whitelist.includes('arxiv.org'));
  assert.equal(saved.whitelist.includes('youtube.com'), false);
  assert.equal(saved.whitelist.includes('www.youtube.com'), false);
  assert.equal(saved.whitelist.includes('github.com'), false);
  assert.equal(saved.whitelist.includes('zotero.org'), false);
  assert.deepEqual(saved.blacklist, ['zotero.org', 'www.zotero.org', 'github.com']);
});

test('a Blacklisted alias remains denied even when its other exact service hostname is added', async t => {
  const f = await setup(t, { whitelist: [], blacklist: ['www.zotero.org'] });
  await f.repository.applyCuratedUpgrade();
  const saved = (await f.repository.load()).envelope.snapshot.policy;
  assert.equal(evaluate('zotero.org', saved).outcome, 'ALLOW');
  assert.equal(evaluate('www.zotero.org', saved).reason, 'BLACKLISTED');
  assert.equal(evaluate('unlisted.zotero.org', saved).outcome, 'GREYLIST');
});

test('existing explicit Whitelist exceptions to managed data are preserved', async t => {
  const f = await setup(t, { whitelist: ['zotero.org'], blacklist: [] });
  const result = await f.repository.applyCuratedUpgrade(compileManagedBlacklist(['zotero.org', 'www.zotero.org']));
  assert.ok(result.receipt.alreadyPresent.includes('zotero.org'));
  assert.ok(result.receipt.skippedManaged.includes('www.zotero.org'));
  assert.ok((await f.repository.load()).envelope.snapshot.policy.whitelist.includes('zotero.org'));
});

test('receipt write failure rolls back policy/version too, and a later retry applies once', async t => {
  const f = await setup(t); const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (key === curatedUpgradeKey) throw new DOMException('Synthetic private detail', 'QuotaExceededError');
    return original.call(this, value, key);
  };
  try { assert.equal((await f.repository.applyCuratedUpgrade()).type, 'UNAVAILABLE'); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual((await f.repository.load()).envelope, f.envelope);
  assert.equal(await marker(f.factory), undefined);
  assert.equal(f.repository.getCuratedUpgrade(), null);
  assert.equal(f.repository.getDiagnostics().lastFailure.cause, 'QUOTA_EXCEEDED');
  assert.equal((await f.repository.applyCuratedUpgrade()).type, 'APPLIED');
  assert.equal((await f.repository.applyCuratedUpgrade()).type, 'ALREADY_APPLIED');
});

test('fresh preset and receipt initialize in one atomic transaction at revision zero', async t => {
  const f = await setup(t);
  const fresh = await openRepository(new IDBFactory(), () => 'fresh', 'fresh', configuration); t.after(() => fresh.close());
  await initializeDevelopmentPolicy(fresh);
  const initial = (await fresh.load()).envelope;
  assert.equal(initial.snapshot.policyRevision, 0);
  assert.deepEqual(initial.snapshot.policy, compileCuratedWhitelist());
  assert.equal(fresh.getCuratedUpgrade().kind, 'INITIALIZED');
  assert.equal((await fresh.applyCuratedUpgrade()).type, 'ALREADY_APPLIED');
  assert.deepEqual((await fresh.load()).envelope, initial);
});

test('failed fresh receipt save never leaves a partly initialized permissive policy', async t => {
  const factory = new IDBFactory(); const repo = await openRepository(factory, () => 'fresh', 'fresh', configuration); t.after(() => repo.close());
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, key) { if (key === curatedUpgradeKey) throw new Error('Synthetic failure'); return original.call(this, value, key); };
  try { await initializeDevelopmentPolicy(repo); } finally { IDBObjectStore.prototype.put = original; }
  assert.equal((await repo.load()).type, 'UNINITIALIZED');
  assert.equal(repo.getCuratedUpgrade(), null);
  await initializeDevelopmentPolicy(repo);
  assert.equal((await repo.load()).type, 'READY');
});

test('concurrent startup connections apply one union and one revision increment', async t => {
  const f = await setup(t); const other = await f.open(); t.after(() => other.close());
  const results = await Promise.all([f.repository.applyCuratedUpgrade(), other.applyCuratedUpgrade()]);
  assert.deepEqual(results.map(r => r.type).sort(), ['ALREADY_APPLIED', 'APPLIED']);
  assert.deepEqual(await f.repository.load(), await other.load());
  assert.equal((await other.load()).envelope.snapshot.policyRevision, 1);
});

test('migration rereads a concurrently committed custom addition and fences old writers', async t => {
  const f = await setup(t);
  const snapshot = structuredClone(f.envelope.snapshot);
  snapshot.policy.whitelist.push('racing-custom.example'); snapshot.policyRevision++;
  const upgrading = f.repository.applyCuratedUpgrade();
  assert.equal((await f.repository.commit(commit(f.envelope, snapshot, 'racing-addition'))).type, 'COMMITTED');
  assert.equal((await upgrading).type, 'APPLIED');
  const saved = (await f.repository.load()).envelope.snapshot;
  assert.ok(saved.policy.whitelist.includes('racing-custom.example'));
  assert.equal(saved.policyRevision, 2);
  assert.equal((await f.repository.commit(commit(f.envelope, f.envelope.snapshot, 'stale-writer'))).type, 'CONFLICT');
  assert.equal((await f.repository.resolveCommit('racing-addition')).type, 'COMMITTED', 'old reconciliation receipts survive');
});

test('unknown response across restart is settled by the durable marker without repeating additions', async t => {
  const f = await setup(t);
  await f.repository.applyCuratedUpgrade(); // Simulate a lost startup reply after commit.
  const saved = await f.repository.load();
  const other = await f.open(); t.after(() => other.close());
  assert.equal((await other.applyCuratedUpgrade()).type, 'ALREADY_APPLIED');
  assert.deepEqual(await other.load(), saved);
});

test('corrupt/missing initialized authority, malformed marker and exhausted revisions fail closed', async t => {
  for (const damage of ['snapshot', 'missing', 'marker', 'exhausted']) {
    const f = await setup(t);
    await raw(f.factory, store => {
      const value = structuredClone(f.envelope);
      if (damage === 'snapshot') value.snapshot.accessState = {};
      if (damage === 'exhausted') value.snapshot.policyRevision = Number.MAX_SAFE_INTEGER;
      if (damage === 'missing') store.delete('envelope'); else store.put(value, 'envelope');
      if (damage === 'marker') store.put({ id: 'invalid' }, curatedUpgradeKey);
    });
    assert.equal((await f.repository.applyCuratedUpgrade()).type, 'UNAVAILABLE', damage);
    assert.equal(await f.repository.initialize(compileCuratedWhitelist(), true), false);
  }
});

test('an orphaned migration marker cannot be overwritten by fresh defaults', async t => {
  const f = await setup(t);
  await f.repository.applyCuratedUpgrade();
  await raw(f.factory, store => { store.put(false, 'initialized'); store.delete('envelope'); });
  assert.equal(await f.repository.initialize(compileCuratedWhitelist(), true), false);
  assert.equal((await f.repository.applyCuratedUpgrade()).type, 'UNAVAILABLE');
});

test('policy expansion retains workflow terms and protected settings; Core alone invalidates old revisions', async t => {
  const f = await setup(t);
  let snapshot = f.envelope.snapshot;
  const step = (operation, now) => { const p = planAtlasOperation(operation, { snapshot, now, configuration }); snapshot = p.candidateSnapshot ?? p.observationSnapshot; return p; };
  const started = step({ kind: 'START_ACCESS', target: { hostname: 'temporary.example' } }, 1000);
  step({ kind: 'CONFIRM_ACCESS', requestId: started.result.id }, 1010);
  step({ kind: 'START_ACCESS', target: { hostname: 'pending.example' } }, 1011);
  step({ kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: [...policy.whitelist, 'frozen.example'], blacklist: policy.blacklist } }, 1012);
  const before = structuredClone(snapshot);
  assert.equal((await f.repository.commit(commit(f.envelope, snapshot, 'runtime-terms'))).type, 'COMMITTED');
  await f.repository.applyCuratedUpgrade();
  const saved = (await f.repository.load()).envelope.snapshot;
  for (const key of ['accessState', 'vaultState', 'journeyState', 'configuration', 'configurationRevision']) assert.deepEqual(saved[key], before[key], key);
  const controller = createAtlasController({ repository: f.repository, clock: { now: () => 1020 }, configuration, ownerId: 'upgrade' });
  await controller.open();
  assert.equal(controller.getView().status, 'READY');
  assert.equal((await controller.handle({ kind: 'CONFIRM_ACCESS', requestId: before.accessState.pendingRequests[0].id })).reason, 'POLICY_CHANGED');
  assert.equal((await controller.handle({ kind: 'CONFIRM_POLICY', proposalId: before.vaultState.pendingProposal.id })).reason, 'POLICY_CHANGED');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, before.accessState.grants);
});

test('already complete policies record the migration without changing policy revision', async t => {
  const f = await setup(t, compileCuratedWhitelist());
  const result = await f.repository.applyCuratedUpgrade();
  assert.equal(result.type, 'APPLIED');
  assert.equal(result.receipt.added.length, 0);
  assert.equal(result.receipt.alreadyPresent.length, curatedUpgradeHosts.length);
  assert.equal((await f.repository.load()).envelope.snapshot.policyRevision, 0);
});

test('pure planning never mutates inputs and malformed receipt/catalog/managed inputs are rejected', async t => {
  const f = await setup(t); const before = structuredClone(f.envelope.snapshot);
  const plan = planCuratedUpgrade(before);
  assert.ok(plan); assert.deepEqual(before, f.envelope.snapshot);
  assert.equal(Object.isFrozen(before), false);
  assert.equal(planCuratedUpgrade(before, {}), null);
  assert.equal(readCuratedUpgradeReceipt({ ...plan.receipt, added: [...plan.receipt.added, 'unapproved.example'] }), null);
  assert.equal(readCuratedUpgradeReceipt({ ...plan.receipt, policyRevisionAfter: 0 }), null);
  const sparse = [...plan.receipt.added]; sparse.length++;
  assert.equal(readCuratedUpgradeReceipt({ ...plan.receipt, added: sparse }), null);
  assert.equal(readCuratedUpgradeReceipt({ ...plan.receipt, kind: 'INITIALIZED', policyRevisionBefore: 0, policyRevisionAfter: 0 }), null);
});

test('failed startup migration publishes no authority; explicit Recovery retries without resetting custom policy', async t => {
  const f = await setup(t); const original = IDBObjectStore.prototype.put;
  let fail = true;
  IDBObjectStore.prototype.put = function(value, key) { if (key === curatedUpgradeKey && fail) throw new DOMException('Synthetic private failure', 'QuotaExceededError'); return original.call(this, value, key); };
  t.after(() => { IDBObjectStore.prototype.put = original; });
  const connections = [];
  const host = () => createAdapterHost({ openRepository: async () => { const repo = await f.open(); connections.push(repo); return repo; },
    loadManaged: async () => ({ getBlacklist: () => undefined, getView: () => null }),
    createController: repository => createAtlasController({ repository, clock: { now: () => 1000 }, configuration, ownerId: 'startup' }) });
  const firefox = new FakeFirefox();
  const adapter = new FirefoxAdapter(firefox, host, () => 'context', () => 1000, firefox.schedule, firefox.unschedule);
  t.after(() => { adapter.stop(); connections.forEach(repo => repo.close()); });
  await adapter.ready;
  assert.equal(adapter.view().startup.status, 'FAILED');
  assert.equal(adapter.view().controller, null);
  assert.deepEqual((await f.repository.load()).envelope, f.envelope);
  assert.equal(await firefox.send({ kind: 'RECOVER' }, { id: firefox.runtime.id, url: 'https://untrusted.example/', frameId: 0 }), false);
  fail = false;
  const recovered = await firefox.send({ kind: 'RECOVER' });
  assert.equal(recovered.view.controller.status, 'READY');
  assert.ok(recovered.view.controller.snapshot.policy.whitelist.includes('my-added.example'));
  assert.deepEqual(recovered.view.controller.snapshot.policy.blacklist, policy.blacklist);
  assert.equal(recovered.view.curatedUpgrade.kind, 'UPGRADED');
  assert.equal((await firefox.send({ kind: 'APPLY_CURATED_UPGRADE' })).error, 'INVALID_COMMAND');
});
