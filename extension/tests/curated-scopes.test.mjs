import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { evaluate, compileManagedBlacklist, createAtlasController, planAtlasOperation } from '@atlas/core';
import { openRepository } from '../dist/lib/storage/indexeddb-repository.js';
import { compileCuratedWhitelist } from '../dist/lib/presets/curated-whitelist.js';
import { curatedScopeHosts, curatedScopeKey, curatedScopeRoots, initialCuratedScopes, initialCuratedScopeReceipt,
  readCuratedScopeReceipt, planCuratedScopes } from '../dist/lib/presets/curated-scopes.js';
import { curatedUpgradeKey, initialCuratedReceipt } from '../dist/lib/presets/curated-upgrade.js';
import { createAdapterHost } from '../dist/lib/background/startup.js';
import { destinationIndex, policyDestinationIndex, searchDestinationTargets } from '../dist/lib/ui/destinations.js';
import { destinationId, pinnedDestinations } from '../dist/lib/ui/home-model.js';
import { draftBaseline, newDestinationDraft, stageDestination, assessDraft, readDestinationDraft } from '../dist/lib/ui/destination-draft.js';
import { configuration } from './support/fixture.mjs';

async function fixture(t, policy = { whitelist: ['kth.se', 'www.physics.kth.se', 'my-custom.example'], blacklist: [] }) {
  const factory = new IDBFactory(); let version = 0;
  const open = () => openRepository(factory, () => `v${++version}`, 'scopes', configuration);
  const repo = await open(); t.after(() => repo.close());
  await repo.initialize(policy);
  const envelope = (await repo.load()).envelope;
  const raw = work => new Promise((resolve, reject) => {
    const q = factory.open('scopes'); q.onsuccess = () => {
      const db = q.result, tx = db.transaction('authority', 'readwrite'); let result;
      work(tx.objectStore('authority'), v => { result = v; });
      tx.oncomplete = () => { db.close(); resolve(result); }; tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
  const marker = () => raw((s, done) => { const q = s.get(curatedScopeKey); q.onsuccess = () => done(q.result); });
  const commit = async snapshot => repo.commit({ commitId: `edit-${++version}`, expectedStorageVersion: (await repo.load()).envelope.storageVersion,
    next: { schemaVersion: 2, snapshot } });
  return { factory, repo, open, envelope, raw, marker, commit };
}

test('fresh defaults include every literal catalog subtree without allowing Google search or sibling services', () => {
  const policy = compileCuratedWhitelist();
  assert.equal(policy.whitelist.length, 294);
  assert.equal(policy.whitelistSubdomains.length, 132);
  for (const host of curatedScopeHosts) assert.equal(evaluate(`test.child.${host}`, policy).outcome, 'ALLOW', host);
  for (const host of ['www.physics.kth.se', 'indico.fysik.su.se', 'child.drive.google.com']) assert.equal(evaluate(host, policy).outcome, 'ALLOW');
  for (const host of ['google.com', 'www.google.com', 'images.google.com', 'notkth.se', 'kth.se.other.example', 'wikipedia.org', 'youtube.com'])
    assert.equal(evaluate(host, policy).outcome, 'GREYLIST', host);
  assert.deepEqual(policy.whitelistSubdomains, initialCuratedScopes);
  for (const host of ['com', 'co.uk', 'github.io', 'google.com', 'www.google.com', '*.kth.se', '127.0.0.1'])
    assert.throws(() => curatedScopeRoots([host]), TypeError, host);
});

test('fresh initialization records both migrations atomically; later startup is readonly', async t => {
  const f = await fixture(t);
  const repo = await openRepository(new IDBFactory(), () => 'fresh', 'fresh', configuration); t.after(() => repo.close());
  assert.equal(await repo.initialize(compileCuratedWhitelist(), true), true);
  const before = await repo.load();
  assert.equal((await repo.applyCuratedUpgrade()).type, 'ALREADY_APPLIED');
  assert.deepEqual((await repo.applyCuratedScopes()).receipt, initialCuratedScopeReceipt());
  assert.deepEqual(await repo.load(), before);
  assert.equal(repo.getDiagnostics().writeTransactions, 1);
  assert.equal(await f.marker(), undefined);
});

test('upgrade adds only approved scopes; custom rules and explicit denials survive', async t => {
  const policy = { whitelist: ['kth.se', 'www.kth.se', 'www.physics.kth.se', 'drive.google.com', 'github.com', 'custom.example'],
    blacklist: ['github.com', 'blocked.kth.se'], whitelistSubdomains: ['custom.example'] };
  const f = await fixture(t, policy), before = structuredClone(f.envelope.snapshot);
  const result = await f.repo.applyCuratedScopes(), saved = (await f.repo.load()).envelope.snapshot;
  assert.equal(result.type, 'APPLIED');
  assert.deepEqual(result.receipt.added, ['drive.google.com', 'kth.se']);
  assert.deepEqual(result.receipt.covered, ['www.kth.se', 'www.physics.kth.se']);
  assert.deepEqual(result.receipt.skippedBlacklisted, ['github.com']);
  assert.ok(result.receipt.skippedNotAllowed.includes('su.se'));
  assert.deepEqual(saved.policy.whitelist, policy.whitelist); assert.deepEqual(saved.policy.blacklist, policy.blacklist);
  assert.deepEqual(saved.policy.whitelistSubdomains, ['custom.example', 'drive.google.com', 'kth.se']);
  assert.equal(saved.policyRevision, 1); assert.deepEqual(before, f.envelope.snapshot);
  assert.equal(evaluate('blocked.kth.se', saved.policy).reason, 'BLACKLISTED');
  const managed = compileManagedBlacklist(['unlisted.kth.se', 'www.physics.kth.se']);
  const check = hostname => planAtlasOperation({ kind: 'CHECK_NAVIGATION', target: { hostname }, context: { contextId: 'test', journeyId: null } },
    { snapshot: saved, now: 1000, configuration, managedBlacklist: managed }).result.decision;
  assert.equal(check('unlisted.kth.se').reason, 'MANAGED_BLACKLISTED');
  assert.equal(check('www.physics.kth.se').outcome, 'ALLOW', 'retain exact managed exception');
  assert.equal(evaluate('www.google.com', saved.policy).outcome, 'GREYLIST');
  assert.deepEqual(await f.marker(), result.receipt);
});

test('removed bundled roots stay removed; remaining explicit children never infer their apex', async t => {
  const f = await fixture(t, { whitelist: ['www.kth.se', 'drive.google.com'], blacklist: [] });
  await f.repo.applyCuratedScopes();
  const policy = (await f.repo.load()).envelope.snapshot.policy;
  assert.deepEqual(policy.whitelistSubdomains, ['drive.google.com', 'www.kth.se']);
  assert.equal(evaluate('physics.kth.se', policy).outcome, 'GREYLIST');
});

test('restart/lost reply/second connection do not reapply scopes removed after upgrade', async t => {
  const f = await fixture(t); const other = await f.open(); t.after(() => other.close());
  const results = await Promise.all([f.repo.applyCuratedScopes(), other.applyCuratedScopes()]);
  assert.deepEqual(results.map(r => r.type).sort(), ['ALREADY_APPLIED', 'APPLIED']);
  const saved = (await f.repo.load()).envelope.snapshot;
  assert.equal((await f.commit({ ...saved, policyRevision: saved.policyRevision + 1,
    policy: { ...saved.policy, whitelistSubdomains: [] } })).type, 'COMMITTED');
  const reopened = await f.open(); t.after(() => reopened.close());
  const before = await reopened.load();
  assert.equal((await reopened.applyCuratedScopes()).type, 'ALREADY_APPLIED');
  assert.deepEqual(await reopened.load(), before); assert.equal(reopened.getDiagnostics().writeTransactions, 0);
});

test('scope receipt write abort rolls back authority; retry remains exactly once', async t => {
  const f = await fixture(t), before = await f.repo.load(), original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, key) { if (key === curatedScopeKey) throw new DOMException('fixture', 'QuotaExceededError'); return original.call(this, value, key); };
  try { assert.equal((await f.repo.applyCuratedScopes()).type, 'UNAVAILABLE'); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await f.repo.load(), before); assert.equal(await f.marker(), undefined);
  assert.equal((await f.repo.applyCuratedScopes()).type, 'APPLIED');
  assert.equal((await f.repo.applyCuratedScopes()).type, 'ALREADY_APPLIED');
});

test('old controller storage versions cannot overwrite the startup migration', async t => {
  const f = await fixture(t); await f.repo.applyCuratedScopes();
  const result = await f.repo.commit({ commitId: 'old-controller', expectedStorageVersion: f.envelope.storageVersion,
    next: { schemaVersion: 2, snapshot: f.envelope.snapshot } });
  assert.equal(result.type, 'CONFLICT');
});

test('damaged state, markers and orphan receipts fail closed without writing defaults', async t => {
  for (const corrupt of [s => s.put({}, curatedScopeKey), s => s.put({ ...initialCuratedScopeReceipt(), policyRevisionAfter: 999 }, curatedScopeKey),
    s => s.put({}, curatedUpgradeKey), s => s.put({ ...frozenEnvelope(), snapshot: {} }, 'envelope'),
    s => { s.put(false, 'initialized'); s.delete('envelope'); s.put(initialCuratedScopeReceipt(), curatedScopeKey); }]) {
    const f = await fixture(t); await f.raw(corrupt);
    const before = await f.repo.load(), writes = f.repo.getDiagnostics().writeTransactions;
    assert.equal((await f.repo.applyCuratedScopes()).type, 'UNAVAILABLE');
    assert.equal(f.repo.getDiagnostics().writeTransactions, writes);
    assert.deepEqual(await f.repo.load(), before);
    assert.equal(await f.repo.initialize(compileCuratedWhitelist(), true), false);
  }
});
function frozenEnvelope() { return { schemaVersion: 2, storageVersion: 'invalid-state', lastCommitId: null }; }

test('startup never publishes authority if scope migration fails', async t => {
  const f = await fixture(t); await f.raw(s => s.put(initialCuratedReceipt(), curatedUpgradeKey));
  let published = false;
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, key) { if (key === curatedScopeKey) throw new DOMException('fixture', 'AbortError'); return put.call(this, value, key); };
  try { await assert.rejects(createAdapterHost({ openRepository: f.open, loadManaged: async () => ({ getBlacklist: () => undefined }),
    createController: () => { published = true; } }), /INITIALIZATION_FAILED/); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.equal(published, false); assert.equal(await f.marker(), undefined);
});

test('pending workflows and timestamps survive unchanged; Core applies existing revision invalidation', async t => {
  const f = await fixture(t); let snapshot = f.envelope.snapshot;
  const step = (operation, now) => { const p = planAtlasOperation(operation, { snapshot, now, configuration }); snapshot = p.candidateSnapshot ?? p.observationSnapshot; return p; };
  const request = step({ kind: 'START_ACCESS', target: { hostname: 'temporary.example' } }, 1000);
  step({ kind: 'CONFIRM_ACCESS', requestId: request.result.id }, 1010);
  step({ kind: 'START_ACCESS', target: { hostname: 'pending.example' } }, 1011);
  step({ kind: 'PROPOSE_POLICY', candidatePolicy: { ...snapshot.policy, whitelist: [...snapshot.policy.whitelist, 'frozen.example'] } }, 1012);
  assert.equal((await f.commit(snapshot)).type, 'COMMITTED');
  await f.repo.applyCuratedScopes(); const saved = (await f.repo.load()).envelope.snapshot;
  for (const key of ['configuration', 'configurationRevision', 'accessState', 'vaultState', 'journeyState']) assert.deepEqual(saved[key], snapshot[key], key);
  const controller = createAtlasController({ repository: f.repo, clock: { now: () => 1020 }, configuration, ownerId: 'upgrade' });
  await controller.open(); assert.equal(controller.getView().status, 'READY');
  assert.equal((await controller.handle({ kind: 'CONFIRM_POLICY', proposalId: snapshot.vaultState.pendingProposal.id })).reason, 'POLICY_CHANGED');
  assert.equal((await controller.handle({ kind: 'CONFIRM_ACCESS', requestId: snapshot.accessState.pendingRequests[0].id })).reason, 'POLICY_CHANGED');
});

test('no-op and existing broad permissions do not advance revision; receipt is bounded and immutable', async t => {
  const f = await fixture(t, { whitelist: ['kth.se'], blacklist: [], whitelistSubdomains: ['kth.se'] });
  const planned = planCuratedScopes(f.envelope.snapshot);
  assert.equal(planned.snapshot.policyRevision, 0); assert.deepEqual(planned.receipt.alreadyPresent, ['kth.se']);
  assert.throws(() => planned.receipt.added.push('google.com'));
  assert.equal(readCuratedScopeReceipt({ ...planned.receipt, extra: true }), null);
  assert.equal(readCuratedScopeReceipt({ ...planned.receipt, added: ['google.com'] }), null);
  assert.equal(readCuratedScopeReceipt({ ...planned.receipt, skippedNotAllowed: [] }), null);
  assert.equal(planCuratedScopes({}), null);
});

const meta = (host, overrides = {}) => ({ id: `host:${host}`, primaryHostname: host, hostnames: [host], label: host, category: 'Your destinations', ...overrides });
test('plain duplicates join their bundled site; names, categories, pins and blocked terms stay separate', () => {
  const policy = { whitelist: ['kth.se', 'www.physics.kth.se', 'plain.kth.se', 'named.kth.se', 'pinned.kth.se', 'category.kth.se'],
    blacklist: ['blocked.kth.se'], whitelistSubdomains: ['kth.se'] };
  const metadata = [meta('plain.kth.se'), meta('named.kth.se', { label: 'My physics page' }), meta('category.kth.se', { category: 'Physics' })];
  const pins = ['host:pinned.kth.se'], before = structuredClone({ policy, metadata, pins });
  const entries = policyDestinationIndex(policy, metadata, pins), parent = entries.find(e => e.hostname === 'kth.se');
  assert.ok(parent.hostnames.includes('www.physics.kth.se')); assert.ok(parent.hostnames.includes('plain.kth.se'));
  assert.ok(!entries.some(e => e.hostname === 'plain.kth.se'));
  for (const host of ['named.kth.se', 'pinned.kth.se', 'category.kth.se', 'blocked.kth.se']) assert.ok(entries.some(e => e.hostname === host), host);
  assert.equal(pinnedDestinations(destinationIndex(policy, metadata, pins), pins)[0].hostname, 'pinned.kth.se');
  assert.equal(searchDestinationTargets(entries, 'www.physics.kth.se')[0].hostname, 'www.physics.kth.se');
  assert.deepEqual({ policy, metadata, pins }, before);
  assert.equal(destinationId(parent), 'service:kth.se');
});

test('merged parent edits preserve literal child rules, scope and customized neighbors', async t => {
  const f = await fixture(t); await f.repo.applyCuratedScopes();
  const state = (await f.repo.load()).envelope.snapshot;
  const prefs = { version: 1, destinations: [], pending: null }, baseline = draftBaseline(state, prefs, []);
  const entry = baseline.entries.find(e => e.metadata.id === 'service:kth.se');
  assert.ok(entry.metadata.hostnames.includes('www.physics.kth.se'));
  const draft = stageDestination(newDestinationDraft('rename', baseline), entry.metadata.id, { ...entry, metadata: { ...entry.metadata, label: 'University' } });
  const assessed = assessDraft(draft, baseline);
  assert.equal(assessed.policyChanged, false); assert.deepEqual(assessed.conflicts, []);
  const removed = assessDraft(stageDestination(newDestinationDraft('remove', baseline), entry.metadata.id, null), baseline);
  assert.deepEqual(removed.candidatePolicy.whitelist, ['my-custom.example']);
  assert.deepEqual(removed.candidatePolicy.whitelistSubdomains, []);
});

test('pre-update broad-scope draft baselines remain readable without accepting fabricated entries', async t => {
  const f = await fixture(t, { whitelist: ['kth.se', 'notes.physics.kth.se'], blacklist: [], whitelistSubdomains: ['kth.se'] });
  const baseline = draftBaseline(f.envelope.snapshot, { version: 1, destinations: [], pending: null }, []);
  baseline.entries = policyDestinationIndex(baseline.policy, [], [], false).map(entry => ({
    metadata: { id: destinationId(entry), label: entry.label, category: entry.category, primaryHostname: entry.hostname, hostnames: entry.hostnames },
    classification: 'PRESERVE', pinned: false, ...(entry.hostname === 'kth.se' ? { includeSubdomains: true } : {}),
  }));
  const draft = newDestinationDraft('old-broad-draft', baseline);
  assert.deepEqual(readDestinationDraft(draft), draft);
  const corrupt = structuredClone(draft); corrupt.baseline.entries[0].metadata.hostnames.push('google.com');
  assert.equal(readDestinationDraft(corrupt), null);
});

test('grouping stays within editor bounds, chooses the closest parent, and leaves nonbundled scopes separate', () => {
  const hosts = Array.from({ length: 110 }, (_, i) => `child${i}.kth.se`);
  const policy = { whitelist: ['kth.se', ...hosts, 'a.custom.example', 'custom.example'], blacklist: [], whitelistSubdomains: ['kth.se', 'custom.example'] };
  const entries = policyDestinationIndex(policy);
  assert.ok(entries.every(e => e.hostnames.length <= 100));
  assert.equal(new Set(entries.flatMap(e => e.hostnames)).size, policy.whitelist.length);
  assert.ok(entries.some(e => e.hostname === 'a.custom.example'));
  const exactOnly = policyDestinationIndex({ ...policy, whitelistSubdomains: [] });
  assert.equal(exactOnly.length, policy.whitelist.length, 'no scope means no absorption');
});
