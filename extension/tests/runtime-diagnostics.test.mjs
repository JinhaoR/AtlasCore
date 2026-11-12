import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeDiagnostics } from '../dist/lib/adapter/runtime-diagnostics.js';
import { fixture, deferred } from './support/fixture.mjs';

const url = 'moz-extension://test-session/background.js';
test('runtime evidence records only exact own-bundle numeric frames and closed classes', () => {
  const log = new RuntimeDiagnostics(url, () => 123);
  log.record('BACKGROUND_ERROR', { name: 'TypeError', message: 'token=private', stack:
    `TypeError: token=private @${url}:99:1\nprivateFunction@${url}:123:4\nsecret@${url}?token=private:12:4\nf@https://private/:4:2\nf@moz-extension://other/background.js:3:2` });
  const report = log.read();
  assert.deepEqual(report.faults[0].frames, [{ asset: 'BACKGROUND', line: 123, column: 4 }]);
  assert.equal(report.faults[0].error, 'TYPE_ERROR');
  assert.doesNotMatch(JSON.stringify(report), /private|token|moz-extension|https|Function/);
  report.faults[0].frames[0].line = 999;
  assert.equal(log.read().faults[0].frames[0].line, 123);
});

test('faults deduplicate and history stays bounded; hostile getters and clocks are harmless', () => {
  const log = new RuntimeDiagnostics(url, () => { throw Error('private clock'); });
  const error = { name: 'Error', stack: `f@${url}:1:1` };
  for (let i = 0; i < 500; i++) log.record('VIEW', error);
  assert.equal(log.read().faults.length, 1); assert.equal(log.read().faults[0].count, 500);
  log.record('VIEW', { get name() { throw Error('private'); }, get stack() { throw Error('private'); } });
  assert.equal(log.read().faults[1].error, 'OTHER');
  for (let i = 2; i < 50; i++) log.record('VIEW', { name: 'Error', stack: `f@${url}:${i}:1` });
  assert.equal(log.read().faults.length, 20); assert.equal(log.read().startedAt, null);
  assert.doesNotMatch(JSON.stringify(log.read()), /private/);
});

test('read-only diagnostics expose a held queue without granting permission or abandoning the write', async t => {
  const f = await fixture(t); f.clock.time++;
  const hold = deferred(), entered = deferred(), load = f.repository.load.bind(f.repository);
  f.repository.load = async () => { entered.resolve(); await hold.promise; return load(); };
  const refreshing = f.adapter.refresh(); await entered.promise;
  const diagnostic = await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null });
  assert.equal(diagnostic.runtime.controller.status, 'LOADING');
  assert.equal(diagnostic.runtime.controller.activity.stage, 'LOAD');
  assert.equal(diagnostic.runtime.controller.activity.active, true);
  assert.equal(diagnostic.runtime.adapter.refreshPending, true);
  const priorCompleted = diagnostic.runtime.controller.activity.completed;
  hold.resolve(); await refreshing;
  const after = await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null });
  assert.equal(after.runtime.controller.status, 'READY');
  assert.ok(after.runtime.controller.activity.completed > priorCompleted);
  assert.equal(after.runtime.adapter.queued, 0);
  assert.equal(after.runtime.faults.length, 0);
});

test('a projection exception is reported separately; it does not relabel healthy authority INTERNAL_ERROR', async t => {
  const f = await fixture(t);
  const view = f.adapter.view.bind(f.adapter);
  f.adapter.view = () => { throw new TypeError('private URL?token=secret'); };
  assert.deepEqual(await f.firefox.send({ kind: 'GET_VIEW' }), { error: 'ADAPTER_FAILURE' });
  const report = await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null });
  assert.equal(report.runtime.faults[0].subsystem, 'VIEW');
  assert.equal(report.runtime.controller.status, 'READY');
  assert.equal(f.controller.getView().reason, null);
  assert.doesNotMatch(JSON.stringify(report), /private|token|secret/);
  f.adapter.view = view;
  assert.equal((await f.firefox.send({ kind: 'GET_VIEW' })).view.controller.status, 'READY');
});
