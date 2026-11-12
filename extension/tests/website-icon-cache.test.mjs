import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebsiteIconCache } from '../dist/lib/ui/website-icon-cache.js';

const png = new Blob([Uint8Array.from([137,80,78,71,13,10,26,10])], { type: 'image/png' });
function fixture() {
  const records = new Map(); let writes = 0, time = 1000000;
  const cache = {
    async match(key) { return records.get(typeof key === 'string' ? key : key.url)?.clone(); },
    async put(key, response) { writes++; records.set(key, response.clone()); },
    async keys() { return [...records.keys()].map(key => new Request(key)); },
    async delete(key) { return records.delete(typeof key === 'string' ? key : key.url); },
  };
  const storage = { async open(name) { assert.equal(name, 'atlas-website-icons-v1'); return cache; } };
  return { storage, records, now: () => time, advance: ms => time += ms, writes: () => writes };
}

test('validated icon bytes survive new page/cache instances without renewing freshness or writing reads', async () => {
  const f = fixture(); await createWebsiteIconCache(f.storage, f.now).write('example.org', png);
  const writes = f.writes(), nextPage = createWebsiteIconCache(f.storage, f.now);
  const icon = await nextPage.read('example.org'); assert.equal(icon.type, png.type);
  assert.deepEqual(await icon.arrayBuffer(), await png.arrayBuffer());
  assert.equal(f.writes(), writes);
  f.advance(7*24*60*60*1000); assert.equal(await nextPage.read('example.org'), null);
  assert.equal(f.records.size, 0); assert.equal(f.writes(), writes);
});

test('corrupt, expired or invalid cached images are discarded and optional storage failures return a miss', async () => {
  const f = fixture(), cache = createWebsiteIconCache(f.storage, f.now);
  await cache.write('bad.example', new Blob(['not an image'], { type: 'image/png' }));
  assert.equal(await cache.read('bad.example'), null); assert.equal(f.records.size, 0);
  const unavailable = createWebsiteIconCache({ async open() { throw new Error('Quota unavailable'); } }, f.now);
  assert.equal(await unavailable.read('example.org'), null); await unavailable.write('example.org', png);
  assert.equal(await createWebsiteIconCache(null).read('example.org'), null);
});

test('asset storage bounds count and image payload without retaining URLs or access history', async () => {
  const f = fixture(), cache = createWebsiteIconCache(f.storage, f.now);
  for (let i=0;i<130;i++) await cache.write(`site${i}.example`, png);
  assert.equal(f.records.size, 128);
  assert.equal(await cache.read('site0.example'), null);
  await cache.write('large.example', new Blob([new Uint8Array(65537)]));
  assert.equal(f.records.size, 128);
  await cache.write('https://user:secret@example.org/private', png);
  assert.equal(f.records.size, 128);
  for (const [key, response] of f.records) {
    assert.match(key, /^https:\/\/atlas-assets\.invalid\/icons\/site\d+\.example$/);
    assert.deepEqual([...response.headers.keys()].sort(), ['content-length','content-type','x-atlas-created']);
  }
});

test('cached asset reads and writes never issue a network request', async t => {
  const f = fixture(), originalFetch = globalThis.fetch;
  globalThis.fetch = () => { assert.fail('Cache keys are not network endpoints'); };
  t.after(() => globalThis.fetch = originalFetch);
  const cache = createWebsiteIconCache(f.storage, f.now); await cache.write('example.org', png);
  assert.ok(await cache.read('example.org'));
});
