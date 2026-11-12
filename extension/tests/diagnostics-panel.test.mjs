import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeDiagnosticsPanel } from '../dist/lib/ui/diagnostics-panel.js';
import { dom } from './support/ui-fixture.mjs';

test('diagnostic refresh coalesces, fences stale replies, and shows retained evidence even when navigation is unchanged', async t => {
  const f = dom(t), previous = globalThis.browser, responses = [], errors = [];
  globalThis.browser = { runtime: { getManifest: () => ({ version: '0.1.19' }), sendMessage: () => new Promise(resolve => responses.push(resolve)) } };
  t.after(() => { globalThis.browser = previous; });
  f.el('diagnostics').open = true;
  const panel = initializeDiagnosticsPanel({ visible: () => true, selected: () => '1', feedback: m => errors.push(m) });
  const initial = panel.refresh(); assert.equal(panel.refresh(), initial); assert.equal(responses.length, 1);
  responses.shift()({ entries: [], runtime: { retention: 'READY', previousSession: null } }); await initial;
  const updating = panel.refresh();
  responses.shift()({ entries: [], runtime: { retention: 'READY', previousSession: { version: '0.1.18', faults: [{ subsystem: 'CONTROLLER', error: 'TYPE_ERROR', controller: { stage: 'PLAN' } }] } } });
  await updating;
  const label = f.el('diagnostics').children.find(n => n.id === 'runtime-diagnostic');
  assert.match(label.textContent, /0\.1\.18.*PLAN/);
  const stale = panel.refresh(); panel.invalidate(); const fresh = panel.refresh();
  responses.pop()({ entries: [], runtime: { retention: 'UNAVAILABLE' } }); await fresh;
  responses.shift()({ entries: [], runtime: { retention: 'READY', previousSession: null } }); await stale;
  assert.match(label.textContent, /could not be retained/);
  const final = panel.refresh(); panel.dispose(); responses.shift()({ broken: true }); await final;
  assert.deepEqual(errors, []); await panel.refresh(); assert.equal(responses.length, 0);
});
