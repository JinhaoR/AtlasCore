import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './support/fixture.mjs';
import { accessContextCopy } from '../dist/lib/ui/presentation.js';

const context = (f, tabId) => f.adapter.view().contexts.find(c => c.tabId === tabId);

test('a rejected tab navigation reports the selected-site failure and a gated retry, without changing authority', async t => {
  const f = await fixture(t), before = structuredClone(f.controller.getView().snapshot);
  const update = f.firefox.tabs.update;
  f.firefox.tabs.update = async (id, change) => {
    if (change.url) throw new Error('Private browser detail https://unknown.example/secret?token=private');
    return update(id, change);
  };
  const opened = await f.firefox.send({ kind: 'OPEN_DESTINATION', url: 'https://unknown.example/private?token=private' });
  await f.firefox.flush(); await f.adapter.refresh();
  const c = context(f, opened.tabId), copy = accessContextCopy(c);
  assert.equal(c.navigationId, 0);
  assert.equal(c.latest.reason, 'NAVIGATION_FAILED');
  assert.equal(copy.title, 'The site did not open');
  assert.equal(copy.label, 'Navigation failed');
  assert.equal(copy.retryHome, true);
  assert.equal(f.controller.getView().status, 'READY');
  assert.deepEqual(f.controller.getView().snapshot, before);
  const diagnostics = await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: opened.tabId });
  assert.match(JSON.stringify(diagnostics), /FAILED/);
  assert.match(JSON.stringify(diagnostics), /NAVIGATION_FAILED/);
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret|token=|Private browser detail/);

  f.firefox.tabs.update = update;
  await f.firefox.send({ kind: 'OPEN_HOME', tabId: opened.tabId });
  assert.equal(f.firefox.updates.at(-1).url, 'https://unknown.example/');
  assert.equal((await f.firefox.visit(opened.tabId, 'https://unknown.example/')).cancel, true);
  assert.equal(context(f, opened.tabId).latest.decision.outcome, 'GREYLIST');
  assert.deepEqual(f.controller.getView().snapshot.accessState, before.accessState);
});

test('retry respects exact apex/www rules and Blacklist, and cannot act on a closed tab', async t => {
  const f = await fixture(t, true, { policy: { whitelist: ['www.youtube.com'], blacklist: ['blocked.example'] } });
  for (const [host, expected] of [['youtube.com', 'GREYLIST'], ['www.youtube.com', 'ALLOW'], ['blocked.example', 'DENY']]) {
    f.firefox.failUpdate = true;
    const opened = await f.firefox.send({ kind: 'OPEN_DESTINATION', url: `https://${host}/` });
    await f.firefox.flush();
    assert.equal(accessContextCopy(context(f, opened.tabId)).retryHome, true);
    f.firefox.failUpdate = false;
    await f.firefox.send({ kind: 'OPEN_HOME', tabId: opened.tabId });
    const released = await f.firefox.visit(opened.tabId, `https://${host}/`);
    assert.equal(context(f, opened.tabId).latest.decision.outcome, expected);
    assert.equal(!!released.cancel, expected !== 'ALLOW');
    await f.firefox.tabs.remove(opened.tabId); await f.firefox.flush();
    const effects = f.firefox.updates.length;
    assert.equal((await f.firefox.send({ kind: 'OPEN_HOME', tabId: opened.tabId })).error, 'CONTEXT_UNAVAILABLE');
    assert.equal(f.firefox.updates.length, effects);
  }
});

test('a failed open after explicit confirmation can retry without renewing the saved grant', async t => {
  const f = await fixture(t), tab = await f.firefox.tabs.create({ url: 'about:blank' });
  await f.firefox.visit(tab.id, 'https://unknown.example/');
  await f.firefox.send({ kind: 'START_ACCESS', tabId: tab.id });
  const pending = f.controller.getView().snapshot.accessState.pendingRequests[0];
  f.clock.time = pending.readyAt;
  f.firefox.failUpdate = true;
  assert.equal((await f.firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId: pending.id })).result.type, 'COMMITTED');
  await f.firefox.flush();
  const saved = structuredClone(f.controller.getView().snapshot.accessState);
  assert.equal(saved.pendingRequests.length, 0);
  assert.equal(saved.grants.length, 1);
  assert.equal(context(f, tab.id).latest.reason, 'NAVIGATION_FAILED');
  f.firefox.failUpdate = false;
  await f.firefox.send({ kind: 'OPEN_HOME', tabId: tab.id });
  assert.equal(!!(await f.firefox.visit(tab.id, 'https://unknown.example/')).cancel, false);
  assert.equal(context(f, tab.id).latest.decision.reason, 'ACTIVE_GRANT');
  assert.deepEqual(f.controller.getView().snapshot.accessState, saved);
  f.clock.time = saved.grants[0].expiresAt;
  await f.firefox.send({ kind: 'OPEN_HOME', tabId: tab.id });
  assert.equal((await f.firefox.visit(tab.id, 'https://unknown.example/')).cancel, true);
  assert.equal(context(f, tab.id).latest.decision.outcome, 'GREYLIST');
});

test('late browser rejection cannot replace a newer gate decision', async t => {
  const f = await fixture(t), gate = deferred(), update = f.firefox.tabs.update;
  f.firefox.tabs.update = async (id, change) => {
    if (change.url?.startsWith('https:')) { await gate.promise; throw new Error('late rejection'); }
    return update(id, change);
  };
  const opened = await f.firefox.send({ kind: 'OPEN_DESTINATION', url: 'https://unknown.example/' });
  await f.firefox.visit(opened.tabId, 'https://unknown.example/');
  gate.resolve(); await f.firefox.flush();
  assert.equal(context(f, opened.tabId).latest.decision.outcome, 'GREYLIST');
  assert.equal(accessContextCopy(context(f, opened.tabId)).retryHome, false);
});

test('selected tabs without an assessment never masquerade as no selection or receive permission actions', () => {
  assert.equal(accessContextCopy(undefined).title, 'Choose a tab');
  const c = { hostname: 'unknown.example', effect: 'NONE', latest: null };
  assert.equal(accessContextCopy(c).title, 'Checking site access');
  for (const latest of [{ type: 'BLOCKED', reason: 'INTERNAL_ERROR' }, { type: 'ADAPTER_ERROR', reason: 'ADAPTER_FAILURE' }]) {
    const copy = accessContextCopy({ ...c, latest });
    assert.equal(copy.title, 'Access is unavailable');
    assert.equal(copy.retryHome, false);
  }
  for (const reason of ['NAVIGATION_FAILED', 'NAVIGATION_DID_NOT_START']) {
    const failed = { ...c, latest: { type: 'ADAPTER_ERROR', reason } };
    assert.equal(accessContextCopy(failed).retryHome, true);
    for (const effect of ['FAILED', 'REMOVING']) assert.equal(accessContextCopy({ ...failed, effect }).retryHome, false);
    assert.equal(accessContextCopy({ ...failed, hostname: null }).retryHome, false);
  }
});
