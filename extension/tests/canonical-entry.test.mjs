import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalDiscoveryOrigin, canonicalEntryCounterpart, createCanonicalEntryDiscovery } from '../dist/lib/adapter/canonical-entry.js';
import { Event } from './support/fake-firefox.mjs';

const origin = 'https://goodreads.com';
const root = `${origin}/`;
const partner = 'www.goodreads.com';

function fixture(request, timeoutMs = 3000) {
  const api = {
    runtime: { getURL: path => `moz-extension://atlas-test/${path}` },
    webRequest: { onBeforeRequest: new Event(), onHeadersReceived: new Event() },
  };
  const discover = createCanonicalEntryDiscovery(api, request, timeoutMs);
  const details = overrides => ({
    tabId: -1, type: 'xmlhttprequest', method: 'HEAD', url: root, requestId: 'head-1',
    originUrl: 'moz-extension://atlas-test/', documentUrl: 'moz-extension://atlas-test/background.js',
    ...overrides,
  });
  return {
    api, discover,
    before: overrides => api.webRequest.onBeforeRequest.emit(details(overrides)),
    headers: overrides => api.webRequest.onHeadersReceived.emit(details({
      statusCode: 301, responseHeaders: [{ name: 'Location', value: `https://${partner}/` }], ...overrides,
    })),
    detached: () => assert.equal(api.webRequest.onBeforeRequest.listeners.length + api.webRequest.onHeadersReceived.listeners.length, 0),
  };
}

test('canonical entry validation accepts only an observed exact public HTTPS www counterpart', () => {
  assert.equal(canonicalEntryCounterpart(origin, 'https://www.goodreads.com/'), partner);
  assert.equal(canonicalEntryCounterpart(`${origin}/`, '//www.goodreads.com/'), partner);
  assert.equal(canonicalEntryCounterpart('https://www.goodreads.com', 'https://goodreads.com/'), 'goodreads.com');
  assert.equal(canonicalEntryCounterpart(origin, 'https://www.goodreads.com/catalog?lang=en#books'), partner,
    'only the hostname is retained from a Location');
  for (const location of ['', '/', '/www.goodreads.com', 'https://goodreads.com/', 'https://shop.goodreads.com/',
    'https://www.goodreads.com.evil.com/', 'https://goodreads.net/', 'http://www.goodreads.com/',
    'https://www.goodreads.com:8443/', 'javascript:alert(1)', '%%%']) {
    assert.equal(canonicalEntryCounterpart(origin, location), null, location);
  }
});

test('invalid, private, reserved and non-homepage origins perform no request', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; });
  for (const invalid of ['bad', 'http://goodreads.com:8080', 'https://goodreads.com:8443',
    'https://goodreads.com/path', 'https://goodreads.com/?lang=en',
    'https://goodreads.com/#fragment', 'https://127.0.0.1', 'https://[::1]', 'https://2130706433',
    'https://localhost', 'https://www.localhost', 'https://fixture.test', 'https://fixture.local',
    'https://fixture.internal', 'https://example.com', 'https://www.example.org', 'https://site.home.arpa',
    'https://goodreads.com.', ' https://goodreads.com']) {
    assert.equal(await f.discover(invalid), null, invalid);
    assert.equal(canonicalEntryCounterpart(invalid, 'https://www.goodreads.com/'), null);
  }
  assert.equal(calls, 0);
  f.detached();
});

test('HTTP and HTTPS entries inspect one HTTPS homepage without changing response evidence rules', async () => {
  assert.equal(canonicalDiscoveryOrigin('http://goodreads.com'), origin);
  assert.equal(canonicalDiscoveryOrigin(`${origin}/`), origin);
  assert.equal(canonicalDiscoveryOrigin('http://goodreads.com/path?lang=en'), null);
  assert.equal(canonicalDiscoveryOrigin('http://goodreads.com:8080'), null);
  assert.equal(canonicalDiscoveryOrigin('http://goodreads.com:443'), null);
  assert.equal(canonicalDiscoveryOrigin('http://localhost'), null);
  // An insecure Location response remains insufficient evidence.
  assert.equal(canonicalEntryCounterpart('http://goodreads.com', `https://${partner}/`), null);
  assert.equal(canonicalEntryCounterpart(origin, `http://${partner}/`), null);
  let calls = 0;
  const f = fixture(async (url, options) => {
    calls++;
    assert.equal(url, root);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'manual');
    return { type: 'opaqueredirect' };
  });
  const http = f.discover('http://goodreads.com');
  const https = f.discover(origin);
  assert.equal(calls, 1);
  f.before(); f.headers();
  assert.equal(await http, partner);
  assert.equal(await https, partner);
  f.detached();
});

test('correlated response supplies one sanitized hostname and the probe omits credentials', async () => {
  let args;
  const f = fixture(async (...values) => { args = values; return { type: 'opaqueredirect' }; });
  const pending = f.discover(origin);
  assert.equal(args[0], root);
  assert.deepEqual({ ...args[1], signal: undefined }, {
    method: 'HEAD', credentials: 'omit', redirect: 'manual', cache: 'no-store',
    referrerPolicy: 'no-referrer', signal: undefined,
  });
  assert.deepEqual(f.api.webRequest.onHeadersReceived.listeners[0].options, [
    { urls: [root], types: ['xmlhttprequest'] }, ['responseHeaders'],
  ]);
  f.before();
  // Fetch has already fulfilled; browser header delivery can follow it.
  await Promise.resolve();
  f.headers({ responseHeaders: [{ name: 'lOcAtIoN', value: `https://${partner}/catalog?lang=en` }] });
  assert.equal(await pending, partner);
  assert.equal(args[1].signal.aborted, true);
  f.detached();
});

test('unrelated browser requests, sources and request IDs cannot supply discovery', async () => {
  const f = fixture(async () => ({ type: 'opaqueredirect' }));
  const pending = f.discover(origin);
  for (const overrides of [
    { tabId: 1 }, { type: 'main_frame' }, { method: 'GET' }, { url: `${root}path` },
    { originUrl: 'https://goodreads.com/' }, { originUrl: 'moz-extension://other/' },
    { documentUrl: 'https://goodreads.com/' }, { originUrl: undefined, documentUrl: undefined },
  ]) {
    f.before({ requestId: 'other', ...overrides });
    f.headers({ requestId: 'other', ...overrides });
  }
  f.headers(); // A response without a corresponding captured request is ignored.
  f.before();
  f.headers({ requestId: 'other' });
  f.headers({ tabId: 1 });
  f.headers({ originUrl: 'moz-extension://other/' });
  f.headers({ documentUrl: 'https://goodreads.com/' });
  assert.equal(f.api.webRequest.onHeadersReceived.listeners.length, 1);
  f.headers();
  assert.equal(await pending, partner);
  f.detached();
});

test('nonredirect, missing, duplicate, malformed and unrelated Locations produce no candidate', async () => {
  for (const overrides of [
    { statusCode: 200 }, { statusCode: 304 }, { responseHeaders: undefined }, { responseHeaders: [] },
    { responseHeaders: [{ name: 'Location', binaryValue: [1, 2] }] },
    { responseHeaders: [{ name: 'Location', value: `https://${partner}/` }, { name: 'location', value: '/other' }] },
    { responseHeaders: [{ name: 'Location', value: 'https://unrelated.com/' }] },
    { responseHeaders: [{ name: 'Location', value: 'http://www.goodreads.com/' }] },
    { responseHeaders: [{ name: 'Location', value: 'https://user@www.goodreads.com/' }] },
  ]) {
    const f = fixture(async () => ({ type: 'opaqueredirect' }));
    const pending = f.discover(origin);
    f.before(); f.headers(overrides);
    assert.equal(await pending, null);
    f.detached();
  }
  for (const statusCode of [301, 302, 303, 307, 308]) {
    const f = fixture(async () => ({ type: 'opaqueredirect' }));
    const pending = f.discover(origin);
    f.before(); f.headers({ statusCode });
    assert.equal(await pending, partner);
    f.detached();
  }
});

test('timeout aborts a pending transport and detaches observers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const f = fixture((_, options) => { signal = options.signal; return new Promise(() => {}); });
  const pending = f.discover(origin);
  f.before();
  t.mock.timers.tick(3000);
  assert.equal(await pending, null);
  assert.equal(signal.aborted, true);
  f.detached();
});

test('fulfilled fetch without a matching response remains bounded by the overall timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(async () => ({ type: 'opaqueredirect' }));
  const pending = f.discover(origin);
  await Promise.resolve();
  assert.equal(f.api.webRequest.onHeadersReceived.listeners.length, 1);
  t.mock.timers.tick(3000);
  assert.equal(await pending, null);
  f.detached();
});

test('concurrent same-origin probes share one transport and completed discovery is never cached', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { type: 'opaqueredirect' }; });
  const first = f.discover(origin);
  const duplicate = f.discover(root);
  assert.equal(first, duplicate);
  assert.equal(calls, 1);
  f.before(); f.headers();
  assert.equal(await first, partner);
  assert.equal(await duplicate, partner);
  f.detached();
  const next = f.discover(origin);
  assert.equal(calls, 2);
  f.before({ requestId: 'next' }); f.headers({ requestId: 'next', statusCode: 200 });
  assert.equal(await next, null);
  f.detached();
});

test('parallel different-origin probes retain independent response correlation', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { type: 'opaqueredirect' }; });
  const goodreads = f.discover(origin);
  const amazon = f.discover('https://amazon.se');
  assert.equal(calls, 2);
  f.before();
  f.before({ url: 'https://amazon.se/', requestId: 'amazon' });
  f.headers({ url: 'https://amazon.se/', requestId: 'amazon', responseHeaders: [{ name: 'Location', value: 'https://www.amazon.se/' }] });
  assert.equal(await amazon, 'www.amazon.se');
  f.headers();
  assert.equal(await goodreads, partner);
  f.detached();
});

test('transport and observer setup failures return no candidate and clean up', async () => {
  for (const request of [() => { throw new Error('unavailable'); }, async () => { throw new Error('unavailable'); }]) {
    const f = fixture(request);
    assert.equal(await f.discover(origin), null);
    f.detached();
  }
  const f = fixture(async () => { assert.fail('failed listener setup must not fetch'); });
  f.api.webRequest.onHeadersReceived.addListener = () => { throw new Error('unavailable'); };
  assert.equal(await f.discover(origin), null);
  f.detached();
});
