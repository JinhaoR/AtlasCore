import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './support/fixture.mjs';

test('a tab read rejected after browser-attested closure retires the arrival without a runtime fault', async t => {
  const f = await fixture(t), tab = await f.firefox.tabs.create({ url: 'about:blank' });
  await f.firefox.request(tab.id, 'https://root.example/');
  const entered = deferred(), gate = deferred(), get = f.firefox.tabs.get;
  f.firefox.tabs.get = async id => { entered.resolve(); await gate.promise; return get(id); };
  f.firefox.arrive(tab.id, 'https://root.example/'); await entered.promise;
  await f.firefox.tabs.remove(tab.id); gate.resolve(); await f.firefox.flush();
  const diagnostics = await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null });
  assert.deepEqual(diagnostics.runtime.faults, []);
  assert.equal(f.adapter.view().contexts.some(c => c.tabId === tab.id), false);
  assert.equal(f.controller.getView().status, 'READY');
});

test('a tab read failure while its context is live remains observable and removes unverified content', async t => {
  const f = await fixture(t), tab = await f.firefox.tabs.create({ url: 'about:blank' });
  await f.firefox.request(tab.id, 'https://root.example/');
  const get = f.firefox.tabs.get;
  f.firefox.tabs.get = async () => { f.firefox.tabs.get = get; throw new Error('native read failed'); };
  f.firefox.arrive(tab.id, 'https://root.example/'); await f.firefox.flush();
  const diagnostics = await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null });
  assert.equal(diagnostics.runtime.faults[0].subsystem, 'ADAPTER_QUEUE');
  assert.equal(f.adapter.view().contexts.find(c => c.tabId === tab.id).effect, 'REMOVED');
  assert.equal(f.controller.getView().status, 'READY');
});
