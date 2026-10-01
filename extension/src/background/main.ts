import { createAtlasController } from '@atlas/core';
import { FirefoxAdapter } from '../adapter/firefox-adapter.js';
import { openRepository } from '../storage/indexeddb-repository.js';
import { configuration } from './configuration.js';

const now = () => Date.now();
const host = openRepository(indexedDB, () => crypto.randomUUID()).then((repository) => ({
  repository,
  controller: createAtlasController({ repository, clock: { now }, configuration, ownerId: crypto.randomUUID() }),
}));
const adapter = new FirefoxAdapter(browser, host, () => crypto.randomUUID(), now);
void adapter.ready.then(() => adapter.refresh());
setInterval(() => { void adapter.refresh(); }, 1000);
