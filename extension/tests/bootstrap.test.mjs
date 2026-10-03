import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createAtlasController } from '@atlas/core';
import { initializeDevelopmentPolicy } from '../dist/lib/background/bootstrap.js';
import { openRepository } from '../dist/lib/storage/indexeddb-repository.js';
import { compileCuratedWhitelist } from '../dist/lib/presets/curated-whitelist.js';
import { configuration } from './support/fixture.mjs';

async function fresh(t, newVersion) {
  const factory = new IDBFactory();
  let version = 0;
  const repository = await openRepository(factory, newVersion ?? (() => `v${++version}`), 'development', configuration);
  t.after(() => repository.close());
  return { factory, repository };
}

test('fresh friend installations save the approved 51-host policy before Core publishes READY', async t => {
  const { repository } = await fresh(t);
  assert.equal((await repository.load()).type, 'UNINITIALIZED');
  await initializeDevelopmentPolicy(repository);
  const controller = createAtlasController({ repository, clock: { now: () => 1000 }, configuration, ownerId: 'friend' });
  await controller.open();
  const { status, snapshot } = controller.getView();
  assert.equal(status, 'READY');
  assert.deepEqual(snapshot.policy, compileCuratedWhitelist());
  assert.equal(snapshot.policy.whitelist.length, 51);
  assert.deepEqual(snapshot.policy.blacklist, []);
  assert.equal(snapshot.policyRevision, 0, 'a new installation receives its own policy revision');
  assert.deepEqual(snapshot.accessState.grants, []);
  assert.deepEqual(snapshot.accessState.pendingRequests, []);
  assert.deepEqual(snapshot.journeyState.journeys, []);
  assert.equal(snapshot.vaultState.pendingProposal, null);
});

test('reload retains a saved custom policy, including an intentionally empty policy', async t => {
  for (const policy of [{ whitelist: ['personal.example'], blacklist: ['github.com'] }, { whitelist: [], blacklist: [] }]) {
    const { repository } = await fresh(t);
    await repository.initialize(policy);
    const before = await repository.load();
    await initializeDevelopmentPolicy(repository);
    assert.deepEqual(await repository.load(), before);
  }
});

test('concurrent first runs initialize once and subsequent reloads preserve the complete snapshot', async t => {
  const { repository } = await fresh(t);
  await Promise.all([initializeDevelopmentPolicy(repository), initializeDevelopmentPolicy(repository)]);
  const saved = await repository.load();
  assert.equal(saved.type, 'READY');
  await initializeDevelopmentPolicy(repository);
  assert.deepEqual(await repository.load(), saved);
});

test('failed seed persistence cannot publish a default policy or permissions', async t => {
  const { repository } = await fresh(t, () => 'invalid version with spaces');
  await initializeDevelopmentPolicy(repository);
  assert.equal((await repository.load()).type, 'UNINITIALIZED');
  const controller = createAtlasController({ repository, clock: { now: () => 1000 }, configuration, ownerId: 'failed_seed' });
  await controller.open();
  assert.equal(controller.getView().status, 'UNINITIALIZED');
  assert.equal(controller.getView().snapshot, null);
});

test('unavailable or malformed saved authority never calls policy initialization', async () => {
  for (const loaded of [{ type: 'UNAVAILABLE' }, { type: 'READY', envelope: { damaged: true } }]) {
    let initialized = false;
    await initializeDevelopmentPolicy({ load: async () => loaded, initialize: async () => { initialized = true; return true; } });
    assert.equal(initialized, false);
  }
});
