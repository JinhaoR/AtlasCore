import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeDiagnostics } from '../dist/lib/adapter/runtime-diagnostics.js';
import { runtimeJournal, readRuntimeSession } from '../dist/lib/storage/runtime-journal.js';

const url = 'moz-extension://isolated/background.js';
function storage() {
  let value, writes = 0, failed = false;
  return { getItem: () => value ?? null, setItem: (_key, data) => {
    ++writes; if (failed) throw Error('storage unavailable'); value = data;
  }, writes: () => writes, value: () => value, fail: v => { failed = v; } };
}
test('only sanitized faults persist; healthy restarts retain the prior incident without writes', async () => {
  const local = storage(), journal = runtimeJournal(() => local);
  const first = new RuntimeDiagnostics(url, () => 100, journal, '0.1.19');
  await first.settled(); assert.equal(local.writes(), 0);
  first.record('BACKGROUND_ERROR', { name: 'TypeError', message: 'private secret', stack: `secretFunction@${url}:123:4` });
  await first.settled(); assert.equal(local.writes(), 1);
  assert.doesNotMatch(JSON.stringify(local.value()), /private|secret|moz-extension/);
  for (let i = 0; i < 3; i++) {
    const restarted = new RuntimeDiagnostics(url, () => 200 + i, journal, '0.1.20');
    await restarted.settled(); const state = restarted.read();
    assert.deepEqual(state.faults, []); assert.equal(state.retention, 'READY');
    assert.equal(state.previousSession.version, '0.1.19');
    assert.equal(state.previousSession.faults[0].frames[0].line, 123);
  }
  assert.equal(local.writes(), 1);
});
test('failed retention stays explicit and does not lose in-memory evidence; next incident retries', async () => {
  const local = storage(); local.fail(true);
  const log = new RuntimeDiagnostics(url, () => 100, runtimeJournal(() => local), '0.1.19');
  log.record('VIEW', new TypeError('private')); await log.settled();
  assert.equal(log.read().retention, 'UNAVAILABLE'); assert.equal(log.read().faults.length, 1);
  local.fail(false); log.record('VIEW', new TypeError('private')); await log.settled();
  assert.equal(log.read().retention, 'READY'); assert.equal(log.read().faults[0].count, 2);
});
test('a held diagnostic write coalesces fault bursts without blocking record or publishing stale final counts', async () => {
  let release, writes = 0, saved;
  const gate = new Promise(r => { release = r; });
  const log = new RuntimeDiagnostics(url, () => 100, { load: async () => null, save: async value => {
    ++writes; if (writes === 1) await gate; saved = value; return true;
  } }, '0.1.19');
  log.record('VIEW', new Error('ignored')); await Promise.resolve(); await Promise.resolve();
  for (let i = 0; i < 100; i++) log.record('VIEW', new Error('ignored'));
  assert.equal(log.read().faults[0].count, 101); release(); await log.settled();
  assert.equal(writes, 2); assert.equal(saved.faults[0].count, 101);
});
test('retention validates closed values and bounded data, strips extras, and never restores corrupt data', async () => {
  const local = storage(), log = new RuntimeDiagnostics(url, () => 100, runtimeJournal(() => local), '0.1.19');
  log.record('VIEW', new Error('ignored')); await log.settled();
  const data = JSON.parse(local.value());
  assert.equal(readRuntimeSession({ ...data, token: 'secret' }).token, undefined);
  for (const invalid of [{ ...data, format: 2 }, { ...data, version: 'https://secret' },
    { ...data, faults: Array(21).fill(data.faults[0]) },
    { ...data, faults: [{ ...data.faults[0], subsystem: 'private' }] },
    { ...data, faults: [{ ...data.faults[0], frames: [{ asset: 'https://secret', line: 1, column: 1 }] }] }]) {
    assert.equal(readRuntimeSession(invalid), null);
  }
  const bad = new RuntimeDiagnostics(url, () => 100, runtimeJournal(() => ({ getItem: () => '{"broken":true}', setItem: local.setItem })), '0.1.19');
  await bad.settled(); assert.equal(bad.read().retention, 'UNAVAILABLE'); assert.equal(bad.read().previousSession, null);
});
