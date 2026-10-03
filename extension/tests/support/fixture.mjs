import { IDBFactory } from 'fake-indexeddb';
import { createAtlasController } from '@atlas/core';
import { openRepository } from '../../dist/lib/storage/indexeddb-repository.js';
import { FirefoxAdapter } from '../../dist/lib/adapter/firefox-adapter.js';
import { FakeFirefox } from './fake-firefox.mjs';

export const policy = { whitelist: ['root.example'], blacklist: ['blocked.example'] };
export const configuration = {
  accessTiming: { waitMs: 10, confirmationWindowMs: 50, grantDurationMs: 100 },
  vaultTiming: { waitMs: 30, confirmationWindowMs: 60 },
  journeyLimits: { lifetimeMs: 300, maxHops: 3 },
};
export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

export async function fixture(t, initialize = true, options = {}) {
  const factory = new IDBFactory();
  let version = 0;
  const repository = await openRepository(factory, () => `v${++version}`, 'atlas-authority-v1', configuration);
  if (initialize) await repository.initialize(options.policy ?? policy);
  const clock = { time: 1000, now() { return this.time; } };
  const controller = createAtlasController({ repository, clock, configuration, ownerId: 'owner',
    ...(options.managedBlacklist ? { managedBlacklist: options.managedBlacklist } : {}) });
  const firefox = new FakeFirefox();
  let contextId = 0;
  const adapter = new FirefoxAdapter(firefox, Promise.resolve({ controller, repository }),
    options.newContextId ?? (() => `context_${++contextId}`), () => clock.now(),
    options.schedule ?? firefox.schedule, firefox.unschedule, options.discoverCanonicalEntry);
  await adapter.ready;
  firefox.settle = () => adapter.whenIdle();
  t.after(() => { adapter.stop(); repository.close(); });
  return { factory, repository, controller, clock, firefox, adapter };
}
