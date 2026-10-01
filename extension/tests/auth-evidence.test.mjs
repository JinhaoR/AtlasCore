import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Event } from './support/fake-firefox.mjs';

const source = await readFile(new URL('../scripts/auth-evidence-observer.js', import.meta.url), 'utf8');
function fixture() {
  const events = (names) => Object.fromEntries(names.map((name) => [name, new Event()]));
  const browser = {
    runtime: { id: 'atlas', getURL: (path) => `moz-extension://atlas/${path}`, onConnect: new Event() },
    webRequest: events(['onBeforeRequest', 'onBeforeRedirect', 'onResponseStarted', 'onCompleted', 'onErrorOccurred']),
    webNavigation: events(['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onErrorOccurred',
      'onCreatedNavigationTarget', 'onHistoryStateUpdated', 'onReferenceFragmentUpdated']),
    tabs: events(['onCreated', 'onRemoved']),
  };
  vm.runInNewContext(source, { browser, URL });
  const port = { name: 'auth-evidence', sender: { id: 'atlas', url: 'moz-extension://atlas/ui/index.html', frameId: 0 },
    onMessage: new Event(), messages: [], disconnected: false,
    postMessage(value) { this.messages.push(JSON.parse(JSON.stringify(value))); },
    disconnect() { this.disconnected = true; } };
  browser.runtime.onConnect.emit(port);
  const read = () => { port.onMessage.emit({ kind: 'READ' }); return port.messages.at(-1); };
  return { browser, port, read };
}

test('auth evidence strips credential-bearing URLs, bodies, headers and raw errors before buffering', () => {
  const { browser, read } = fixture();
  browser.webRequest.onBeforeRequest.emit({ tabId: 5, frameId: 0, parentFrameId: -1, requestId: 'private-request-id',
    url: 'https://name:private-password@app.example/private-path?token=private-token#private-fragment',
    originUrl: 'https://origin.example/private-origin?state=private-state',
    documentUrl: 'https://doc.example/private-document', method: 'POST', type: 'main_frame',
    requestBody: { formData: { password: ['private-body'] } }, requestHeaders: [{ value: 'private-header' }],
    frameAncestors: [{ frameId: 0, url: 'https://ancestor.example/private-ancestor' }],
    documentId: 'private-document-id', error: 'private-error-url' });
  const output = read();
  assert.equal(output.entries[0].hostname, 'app.example');
  assert.equal(output.entries[0].originHostname, 'origin.example');
  assert.equal(output.entries[0].request, 1);
  assert.equal(output.entries[0].method, 'POST');
  assert.equal(JSON.stringify(output).includes('private-'), false);
  assert.equal(JSON.stringify(output).includes('https:'), false);
});

test('redirect evidence retains only stable opaque correlation and the observed status', () => {
  const { browser, read } = fixture();
  browser.webRequest.onBeforeRequest.emit({ requestId: 'one', url: 'https://app.example/', frameId: 0 });
  browser.webRequest.onBeforeRedirect.emit({ requestId: 'one', url: 'https://app.example/', redirectUrl: 'https://auth.example/?state=omitted', statusCode: 303 });
  browser.webRequest.onBeforeRequest.emit({ requestId: 'one', url: 'https://auth.example/', frameId: 0 });
  const entries = read().entries;
  assert.deepEqual(entries.map((entry) => entry.request), [1, 1, 1]);
  assert.equal(entries[1].redirectHostname, 'auth.example');
  assert.equal(entries[1].statusCode, 303);
  assert.equal(entries[0].transitionType, null);
  assert.equal(browser.webRequest.onBeforeRequest.listeners[0].options.length, 1, 'observer is never blocking');
});

test('evidence channel rejects websites, nested frames and malformed commands', () => {
  const { browser, port } = fixture();
  for (const sender of [{ id: 'website', url: 'https://app.example/' },
    { id: 'atlas', url: 'moz-extension://atlas/ui/index.html', frameId: 1 }]) {
    const untrusted = { ...port, sender, disconnected: false, onMessage: new Event() };
    browser.runtime.onConnect.emit(untrusted);
    assert.equal(untrusted.disconnected, true);
    assert.equal(untrusted.onMessage.listeners.length, 0);
  }
  port.onMessage.emit({ kind: 'READ', target: 'forged' });
  assert.deepEqual(port.messages.at(-1), { error: 'INVALID_COMMAND' });
});

test('investigation logs are bounded and reset discards correlation rather than restoring authority', () => {
  const { browser, port, read } = fixture();
  for (let i = 0; i < 4010; i++) browser.webNavigation.onCommitted.emit({ url: 'https://app.example/', frameId: 0 });
  assert.equal(read().entries.length, 4000);
  assert.equal(read().dropped, 10);
  port.onMessage.emit({ kind: 'RESET' });
  assert.deepEqual(read(), { entries: [], dropped: 0 });
});
