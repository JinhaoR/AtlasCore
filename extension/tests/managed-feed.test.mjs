import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createManagedBlacklist, sha256, refreshIntervalMs } from '../dist/lib/managed/manager.js';
import { parseHostsFeed, sourceUrl, validateFeed } from '../dist/lib/managed/hosts-feed.js';
import { openManagedCache } from '../dist/lib/storage/managed-cache.js';

const makeFeed = (prefix = 'blocked', count = 50_000) => `# Title: StevenBlack/hosts with test extensions\n# Date: 1 October 2026 (UTC)\n# Extensions added to this file: fakenews, gambling, porn, social\n# Number of unique domains: ${count}\n# Project home page: https://github.com/StevenBlack/hosts\n` + Array.from({ length: count }, (_, i) => `0.0.0.0 ${prefix}${i}.synthetic\n`).join('');
const good = makeFeed();
const next = makeFeed('replacement');
const record = async (text = good) => ({ text, sourceUrl, sha256: await sha256(text), fetchedAt: null, upstreamVersion: 'fixture' });
const memory = () => ({ state: null, async load() { return structuredClone(this.state); }, async save(state) { this.state = structuredClone(state); return true; } });
async function manager(cache, clock, download, changed) {
  return createManagedBlacklist({ cache, now: () => clock.time, digest: sha256, bundle: record, download, changed });
}

test('hosts parser ignores comments, addresses, local mappings, malformed names and deduplicates normalized hosts', () => {
  const parsed = parseHostsFeed('# comment\n127.0.0.1 localhost\n::1 localhost\nfe80::1%lo0 localhost\n0.0.0.0 0.0.0.0\n0.0.0.0 A.EXAMPLE a.example. # same\n0.0.0.0 invalid_host.example valid.example\n<!html> error\n');
  assert.deepEqual(parsed.domains, ['a.example', 'valid.example']);
  assert.equal(parsed.ignoredNames, 1); assert.equal(parsed.malformedLines, 1);
});

test('malformed, truncated, empty and excessive-loss updates keep the last good compiled list and cache', async () => {
  for (const text of ['', good.slice(0, good.length / 2), good + '\n<!html> broken\n', makeFeed('loss', 20_000)]) {
    const cache = memory(); const clock = { time: 1000 };
    const managed = await manager(cache, clock, async () => ({ text, version: null }));
    const prior = managed.getBlacklist();
    await managed.refresh();
    assert.equal(managed.getBlacklist(), prior);
    assert.equal(managed.getView().updateStatus, 'INVALID_FEED');
    assert.equal(cache.state.feed.text, good);
  }
});

test('failed network attempts persist daily throttle across restart and cannot erase offline coverage', async () => {
  const cache = memory(); const clock = { time: 1000 }; let requests = 0;
  const download = async () => { requests++; throw new Error('Synthetic network failure'); };
  let managed = await manager(cache, clock, download);
  const prior = managed.getBlacklist();
  await Promise.all([managed.refresh(), managed.refresh()]);
  assert.equal(requests, 1); assert.equal(managed.getBlacklist(), prior);
  assert.equal(managed.getView().updateStatus, 'NETWORK_UPDATE_FAILED');
  cache.state.lastResult = 'UPDATING'; // A prior background stopped after saving its attempt.
  managed = await manager(cache, clock, download);
  assert.equal(managed.getView().updateStatus, 'INTERRUPTED_UPDATE');
  await managed.refresh(); assert.equal(requests, 1);
  clock.time += refreshIntervalMs;
  await managed.refresh(); assert.equal(requests, 2);
  assert.equal(cache.state.feed.text, good);
});

test('successful updates activate only after atomic cache success and report conflicts without altering the set', async () => {
  const cache = memory(); const clock = { time: 1000 }; let changed = 0;
  const managed = await manager(cache, clock, async () => ({ text: next, version: 'next-etag' }), () => changed++);
  const prior = managed.getBlacklist();
  const save = cache.save.bind(cache); let calls = 0;
  cache.save = async (state) => { calls++; if (calls === 2) { assert.equal(managed.getBlacklist(), prior); return false; } return save(state); };
  await managed.refresh();
  assert.equal(managed.getBlacklist(), prior); assert.equal(cache.state.feed.text, good); assert.equal(changed, 0);
  cache.save = save; clock.time += refreshIntervalMs;
  await managed.refresh();
  assert.notEqual(managed.getBlacklist(), prior); assert.equal(cache.state.feed.text, next); assert.equal(changed, 1);
  const before = managed.getBlacklist();
  assert.deepEqual(managed.getView(['replacement1.synthetic', 'safe.synthetic']).conflicts, ['replacement1.synthetic']);
  assert.equal(managed.getBlacklist(), before); assert.equal(managed.getView().upstreamVersion, 'next-etag');
});

test('corrupt cache falls back to verified bundle; cache failure never starts a network attempt', async () => {
  const cache = memory(); const clock = { time: 1000 };
  cache.state = { schemaVersion: 1, feed: { ...(await record()), text: 'corrupt' }, lastAttemptAt: null, lastResult: 'ACTIVE' };
  let requests = 0;
  cache.save = async () => { throw new Error('Synthetic cache unavailable'); };
  const managed = await manager(cache, clock, async () => { requests++; return { text: next, version: null }; });
  assert.equal(managed.getView().origin, 'BUNDLE'); assert.equal(managed.getBlacklist().size, 50_000);
  await managed.refresh(); assert.equal(requests, 0); assert.equal(managed.getView().updateStatus, 'CACHE_WRITE_FAILED');
});

test('real cache interface atomically retains feed metadata and last-attempt timestamp across connections', async () => {
  const factory = new IDBFactory();
  const a = await openManagedCache(factory); const b = await openManagedCache(factory);
  const state = { schemaVersion: 1, feed: await record(), lastAttemptAt: 1000, lastResult: 'ACTIVE' };
  assert.equal(await a.save(state), true);
  assert.deepEqual(await b.load(), state);
  assert.ok(validateFeed((await b.load()).feed.text));
});

test('host publication fence keeps old authority until commit and notification failure does not undo activation', async () => {
  const cache = memory(); let publish;
  let queued;
  const waiting = new Promise((resolve) => { queued = resolve; });
  const managed = await createManagedBlacklist({ cache, now: () => 1000, digest: sha256, bundle: record,
    download: async () => ({ text: next, version: null }),
    publish: (work) => new Promise((resolve) => { publish = async () => resolve(await work()); queued(); }),
    changed: () => { throw new Error('Synthetic UI notification failure'); },
  });
  const prior = managed.getBlacklist();
  const refresh = managed.refresh();
  await waiting;
  assert.equal(managed.getBlacklist(), prior); assert.equal(cache.state.feed.text, good);
  await publish(); await refresh;
  assert.notEqual(managed.getBlacklist(), prior); assert.equal(cache.state.feed.text, next);
  assert.equal(managed.getView().updateStatus, 'UPDATED');
});
