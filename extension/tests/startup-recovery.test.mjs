import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createAtlasController } from '@atlas/core';
import { createAdapterHost } from '../dist/lib/background/startup.js';
import { FirefoxAdapter } from '../dist/lib/adapter/firefox-adapter.js';
import { StartupError } from '../dist/lib/adapter/startup-status.js';
import { openRepository } from '../dist/lib/storage/indexeddb-repository.js';
import { compileCuratedWhitelist } from '../dist/lib/presets/curated-whitelist.js';
import { startupCopy } from '../dist/lib/ui/presentation.js';
import { FakeFirefox } from './support/fake-firefox.mjs';
import { configuration, deferred } from './support/fixture.mjs';

// Managed verification itself is exercised with the real pinned feed in distribution tests.
const managed = { getBlacklist: () => undefined, getView: () => null };
async function setup(t, options = {}) {
  const factory = new IDBFactory();
  let version = 0, attempts = 0, closed = 0;
  const clock = { time: 1000, now() { return this.time; } };
  const repositories = [];
  const host = async () => {
    attempts++;
    return createAdapterHost({
      openRepository: async () => {
        if (options.openFailure?.()) throw new Error('private exception never exported');
        const repository = await openRepository(factory, () => `v${++version}`, 'startup', configuration);
        const close = repository.close.bind(repository);
        repository.close = () => { closed++; close(); };
        repositories.push(repository);
        return repository;
      },
      loadManaged: options.loadManaged ?? (async () => managed),
      createController: (repository) => createAtlasController({ repository, clock, configuration, ownerId: `owner${attempts}` }),
    });
  };
  const firefox = new FakeFirefox();
  const adapter = new FirefoxAdapter(firefox, host, () => 'context', () => clock.now(), firefox.schedule, firefox.unschedule);
  firefox.settle = () => adapter.whenIdle();
  t.after(() => { adapter.stop(); repositories.forEach(repository => repository.close()); });
  await adapter.ready;
  return { adapter, firefox, host, clock, repositories, attempts: () => attempts, closed: () => closed };
}

test('bundle startup failure stays closed; Recovery retries once and loads the shipped 51 hosts', async t => {
  let damaged = true;
  const f = await setup(t, { loadManaged: async () => {
    if (damaged) throw new Error('BUNDLED_BLACKLIST_INVALID');
    return managed;
  } });
  assert.deepEqual(f.adapter.view().startup, { status: 'FAILED', stage: 'MANAGED_BLACKLIST', reason: 'BUNDLED_BLACKLIST_INVALID' });
  assert.equal(f.adapter.view().controller, null);
  assert.equal(f.adapter.view().temporaryAccess, null);
  assert.equal(f.closed(), 1, 'failed attempt closes its authority connection');
  assert.equal((await f.repositories[0].load()).type, 'UNAVAILABLE');
  assert.deepEqual(await f.firefox.request(1, 'https://github.com/'), { cancel: true });
  assert.equal(f.adapter.view().contexts[0].latest.reason, 'BUNDLED_BLACKLIST_INVALID');
  const failed = await f.firefox.send({ kind: 'RECOVER' });
  assert.equal(failed.error, 'BUNDLED_BLACKLIST_INVALID', 'bundle errors are not mislabeled as storage failure');
  assert.equal(f.attempts(), 2);
  assert.equal(f.closed(), 2);
  damaged = false;
  const recovered = await f.firefox.send({ kind: 'RECOVER' });
  assert.equal(recovered.error, undefined);
  assert.equal(recovered.view.startup.status, 'READY');
  assert.equal(recovered.view.controller.status, 'READY');
  assert.deepEqual(recovered.view.controller.snapshot.policy, compileCuratedWhitelist());
  assert.equal(recovered.view.controller.snapshot.policy.whitelist.length, 51);
  assert.deepEqual(recovered.view.controller.snapshot.accessState.grants, []);
  assert.equal((await f.firefox.request(2, 'https://github.com/')).cancel, undefined);
});

test('storage-open failures report storage and retry without copying local browser policy', async t => {
  let unavailable = true;
  const f = await setup(t, { openFailure: () => unavailable });
  assert.deepEqual(f.adapter.view().startup, { status: 'FAILED', stage: 'STORAGE', reason: 'STORAGE_UNAVAILABLE' });
  unavailable = false;
  await f.firefox.send({ kind: 'RECOVER' });
  assert.equal(f.adapter.view().controller.status, 'READY');
  assert.equal(f.adapter.view().controller.snapshot.policy.whitelist.length, 51);
});

test('concurrent Recovery commands serialize one successful construction and preserve saved authority', async t => {
  let broken = true;
  const gate = deferred();
  const f = await setup(t, { loadManaged: async () => {
    if (broken) throw new Error('BUNDLE_UNAVAILABLE');
    await gate.promise;
    return managed;
  } });
  broken = false;
  const first = f.firefox.send({ kind: 'RECOVER' });
  const second = f.firefox.send({ kind: 'RECOVER' });
  gate.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(f.attempts(), 2);
  assert.deepEqual(results[0].view.controller.snapshot, results[1].view.controller.snapshot);
  assert.equal(results[1].view.controller.snapshot.policyRevision, 0);
});

test('Recovery with an existing controller retains its clock rollback fence', async t => {
  const f = await setup(t);
  f.clock.time = 1100;
  await f.firefox.send({ kind: 'RECOVER' });
  f.clock.time = 1050;
  await f.firefox.send({ kind: 'RECOVER' });
  assert.equal(f.attempts(), 1, 'an existing controller is reconciled, never reconstructed');
  assert.notEqual(f.adapter.view().controller.status, 'READY');
  assert.equal((await f.firefox.request(1, 'https://github.com/')).cancel, true);
});

test('startup factory preserves custom, intentionally empty and damaged initialized policy', async t => {
  for (const policy of [{ whitelist: ['custom.example'], blacklist: [] }, { whitelist: [], blacklist: [] }]) {
    const factory = new IDBFactory();
    let version = 0;
    const repository = await openRepository(factory, () => `v${++version}`, 'saved', configuration);
    t.after(() => repository.close());
    await repository.initialize(policy);
    const before = await repository.load();
    const host = await createAdapterHost({ openRepository: async () => repository, loadManaged: async () => managed,
      createController: repo => createAtlasController({ repository: repo, clock: { now: () => 1000 }, configuration, ownerId: 'saved' }) });
    assert.deepEqual(await repository.load(), before, 'construction never overwrites saved policy');
    await host.controller.open();
    assert.deepEqual(host.controller.getView().snapshot.policy, policy);
    assert.equal(host.controller.getView().snapshot.policyRevision, before.envelope.snapshot.policyRevision);
  }
  for (const loaded of [{ type: 'UNAVAILABLE' }, { type: 'READY', envelope: { damaged: true } }]) {
    let initialized = 0;
    const repository = { load: async () => loaded, initialize: async () => { initialized++; }, close() {},
      commit: async () => ({ type: 'FAILED' }), resolveCommit: async () => ({ type: 'UNAVAILABLE' }) };
    const host = await createAdapterHost({ openRepository: async () => repository, loadManaged: async () => managed,
      createController: repo => createAtlasController({ repository: repo, clock: { now: () => 1000 }, configuration, ownerId: 'damaged' }) });
    await host.controller.open();
    assert.equal(host.controller.getView().status, 'UNAVAILABLE');
    assert.equal(host.controller.getView().snapshot, null);
    assert.equal(initialized, 0);
  }
});

test('initialization and controller construction failures close the repository and expose only safe codes', async () => {
  for (const stage of ['INITIALIZATION', 'CONTROLLER']) {
    let closed = false;
    const repository = { close: () => { closed = true; }, load: async () => {
      if (stage === 'INITIALIZATION') throw new Error('private exception');
      return { type: 'UNAVAILABLE' };
    } };
    await assert.rejects(createAdapterHost({ openRepository: async () => repository, loadManaged: async () => managed,
      createController: () => { throw new Error('private exception'); } }), error => error instanceof StartupError
        && error.stage === stage && !error.message.includes('private'));
    assert.equal(closed, true);
  }
});

test('unexpected startup errors are sanitized; website messages cannot retry privileged startup', async t => {
  const firefox = new FakeFirefox();
  let attempts = 0;
  const adapter = new FirefoxAdapter(firefox, async () => { attempts++; throw new Error('private exception'); },
    () => 'context', () => 1000, firefox.schedule, firefox.unschedule);
  t.after(() => adapter.stop());
  await adapter.ready;
  assert.deepEqual(adapter.view().startup, { status: 'FAILED', stage: 'STARTUP', reason: 'STARTUP_FAILED' });
  assert.equal(await firefox.send({ kind: 'RECOVER' }, { id: firefox.runtime.id, url: 'https://website.example/', frameId: 0 }), false);
  assert.equal(attempts, 1);
  assert.match(startupCopy(adapter.view().startup), /retry startup/i);
  assert.equal(startupCopy({ status: 'READY' }), '');
  assert.equal(startupCopy({ status: 'LOADING' }), '');
  assert.match(startupCopy({ status: 'FAILED', stage: 'MANAGED_BLACKLIST', reason: 'BUNDLED_BLACKLIST_INVALID' }), /bundled safety list/);
});
