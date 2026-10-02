import test from 'node:test';
import assert from 'node:assert/strict';
import { declaredIconUrls, loadWebsiteIcon } from '../dist/lib/ui/website-icons.js';

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const image = () => new Response(png, { headers: { 'content-type': 'image/png' } });

test('site icon metadata supports custom hosts, relative/CDN paths and rejects active/private schemes', () => {
  const links = declaredIconUrls(`<head>
    <link rel="shortcut icon" href="/favicon.ico">
    <link sizes="180x180" rel='apple-touch-icon' href='../touch.png'>
    <link rel=icon href="https://cdn.example/icon.svg?v=1&amp;theme=light">
    <link rel="icon" href="javascript:bad()"><link rel="icon" href="file:///private/icon.png">
    <link rel="icon" href="https://user:password@example.invalid/icon.png">
    </head><body><link rel="icon" href="ignored.png"></body>`, 'https://custom.example/path/index');
  assert.deepEqual(links, ['https://custom.example/touch.png', 'https://custom.example/favicon.ico', 'https://cdn.example/icon.svg?v=1&theme=light']);
});

test('observed Firefox icons and declared website icons load without cookies, referrers or a curated database', async () => {
  const observedCalls = [];
  const observed = await loadWebsiteIcon('custom.example', 'https://cdn.example/browser.png', async (url, options) => {
    observedCalls.push(url); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.ok(options.signal); return image();
  });
  assert.equal(observed.type, 'image/png'); assert.deepEqual(observedCalls, ['https://cdn.example/browser.png']);
  const calls = [];
  const declared = await loadWebsiteIcon('another.example', undefined, async (url, options) => {
    calls.push(url); assert.equal(options.credentials, 'omit');
    return url === 'https://another.example/' ? new Response('<head><link rel="icon" href="/brand.png"></head>') : image();
  });
  assert.equal(declared.type, 'image/png'); assert.deepEqual(calls, ['https://another.example/', 'https://another.example/brand.png']);
});

test('unavailable or non-image metadata uses conventional favicon and safely falls back when absent', async () => {
  const calls = [];
  const result = await loadWebsiteIcon('custom.example', 'file:///private/icon.png', async (url) => {
    calls.push(url);
    return url.endsWith('/favicon.ico') ? image() : new Response('<html>not an image</html>');
  });
  assert.equal(result.type, 'image/png'); assert.deepEqual(calls, ['https://custom.example/', 'https://custom.example/favicon.ico']);
  assert.equal(await loadWebsiteIcon('custom.example', undefined, async () => { throw new Error('Unavailable'); }), null);
  assert.equal(await loadWebsiteIcon('custom.example', undefined, async () => new Response('x', { headers: { 'content-length': '1048577' } })), null);
  assert.equal(await loadWebsiteIcon('https://not-a-host/', undefined, async () => { throw new Error('Must not fetch'); }), null);
});

test('unavailable public-site metadata has an online cache fallback; internal names stay local', async () => {
  const calls = [];
  const cached = await loadWebsiteIcon('public-site.com', undefined, async (url, options) => {
    calls.push(url); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    if (url.startsWith('https://www.google.com/s2/favicons?')) return image();
    throw new Error('Site unavailable before login');
  });
  assert.equal(cached.type, 'image/png');
  assert.equal(calls.at(-1), 'https://www.google.com/s2/favicons?domain=public-site.com&sz=64');
  for (const hostname of ['intranet', 'root.localhost', 'department.internal', '127.0.0.1', '192.168.1.10']) {
    const requested = [];
    assert.equal(await loadWebsiteIcon(hostname, undefined, async (url) => { requested.push(url); throw new Error('Unavailable'); }), null);
    assert.ok(requested.every((url) => !url.includes('google.com')));
  }
});
