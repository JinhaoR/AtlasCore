import test from 'node:test';
import assert from 'node:assert/strict';
import { compileManagedBlacklist } from '@atlas/core';
import { temporaryAccessView } from '../dist/lib/adapter/temporary-access.js';
import { fixture, deferred } from './support/fixture.mjs';

async function confirm(controller, clock, hostname, scopeHostnames = [hostname]) {
  const start = await controller.handle({ kind: 'START_ACCESS', target: { hostname }, scopeHostnames });
  clock.time += 10;
  assert.equal((await controller.handle({ kind: 'CONFIRM_ACCESS', requestId: start.referenceId })).type, 'COMMITTED');
  return start.referenceId;
}

test('overview lists saved grants across contexts, groups aliases once and preserves deadlines/state', async t => {
  const { controller, clock, adapter, firefox } = await fixture(t);
  const amazon = await confirm(controller, clock, 'amazon.se', ['amazon.se', 'www.amazon.se']);
  const other = await confirm(controller, clock, 'another.example');
  await firefox.tabs.create({}); await firefox.tabs.create({});
  const before = structuredClone(controller.getView().snapshot);
  assert.deepEqual(adapter.view().temporaryAccess, [
    { requestId: amazon, hostnames: ['amazon.se', 'www.amazon.se'], expiresAt: 1110 },
    { requestId: other, hostnames: ['another.example'], expiresAt: 1120 },
  ]);
  clock.time += 5;
  assert.equal(adapter.view().temporaryAccess[0].expiresAt, 1110);
  assert.deepEqual(controller.getView().snapshot, before);
});

test('waiting requests, confirmation readiness and Journeys never appear as temporary grants', async t => {
  const { controller, adapter, clock } = await fixture(t);
  await controller.handle({ kind: 'START_ACCESS', target: { hostname: 'unknown.example' } });
  await controller.handle({ kind: 'START_JOURNEY', root: { hostname: 'root.example' }, contextId: 'test_context' });
  assert.deepEqual(adapter.view().temporaryAccess, []);
  clock.time += 10;
  assert.deepEqual(adapter.view().temporaryAccess, []);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('expiry removes grants at their original deadline without creating or renewing access', async t => {
  const { controller, clock, adapter } = await fixture(t);
  await confirm(controller, clock, 'amazon.se', ['amazon.se', 'www.amazon.se']);
  const before = structuredClone(controller.getView().snapshot);
  clock.time = 1109;
  assert.equal(adapter.view().temporaryAccess.length, 1);
  clock.time = 1110;
  assert.deepEqual(adapter.view().temporaryAccess, []);
  assert.deepEqual(controller.getView().snapshot, before);
});

test('current Core managed decisions omit denied hosts while retaining the frozen saved scope', async t => {
  const { controller, clock } = await fixture(t);
  await confirm(controller, clock, 'amazon.se', ['amazon.se', 'www.amazon.se']);
  const before = structuredClone(controller.getView().snapshot);
  const oneBlocked = compileManagedBlacklist(['www.amazon.se']);
  assert.deepEqual(temporaryAccessView(controller.getView(), clock.time, oneBlocked)[0].hostnames, ['amazon.se']);
  assert.deepEqual(temporaryAccessView(controller.getView(), clock.time, compileManagedBlacklist(['amazon.se', 'www.amazon.se'])), []);
  assert.deepEqual(controller.getView().snapshot, before);
});

test('stale policy revisions, current Whitelist and manual Blacklist do not appear as Greylist grants', async t => {
  const { controller, clock } = await fixture(t);
  await confirm(controller, clock, 'unknown.example');
  for (const change of ['revision', 'white', 'black']) {
    const view = structuredClone(controller.getView());
    if (change === 'revision') view.snapshot.policyRevision++;
    if (change === 'white') view.snapshot.policy.whitelist.push('unknown.example');
    if (change === 'black') view.snapshot.policy.blacklist.push('unknown.example');
    assert.deepEqual(temporaryAccessView(view, clock.time), [], change);
  }
});

test('unavailable or invalid complete authority cannot present saved records as active permission', async t => {
  const { controller, clock } = await fixture(t);
  await confirm(controller, clock, 'unknown.example');
  for (const status of ['UNAVAILABLE', 'RECONCILING', 'UNINITIALIZED']) {
    assert.equal(temporaryAccessView({ ...controller.getView(), status }, clock.time), null);
  }
  assert.equal(temporaryAccessView(null, clock.time), null);
  assert.equal(temporaryAccessView({ ...controller.getView(), snapshot: null }, clock.time), null);
  const corrupt = structuredClone(controller.getView());
  corrupt.snapshot.vaultState = null;
  assert.equal(temporaryAccessView(corrupt, clock.time), null);
  assert.equal(temporaryAccessView(controller.getView(), clock.time - 1), null, 'clock rollback');
});

test('a confirmation awaiting or failing persistence never appears in the overview', async t => {
  const { controller, clock, repository, adapter } = await fixture(t);
  const requestId = (await controller.handle({ kind: 'START_ACCESS', target: { hostname: 'unknown.example' } })).referenceId;
  clock.time += 10;
  const entered = deferred(); const release = deferred();
  repository.commit = async ({ commitId }) => {
    entered.resolve(); await release.promise; return { type: 'NOT_WRITTEN', commitId };
  };
  const confirmation = controller.handle({ kind: 'CONFIRM_ACCESS', requestId });
  await entered.promise;
  assert.deepEqual(adapter.view().temporaryAccess, []);
  release.resolve(); await confirmation;
  assert.equal(adapter.view().temporaryAccess, null);
});

test('verified saved grants remain visible during housekeeping without exposing new candidates', async t => {
  const { controller, clock } = await fixture(t);
  await confirm(controller, clock, 'unknown.example');
  const verified = temporaryAccessView(controller.getView(), clock.time);
  for (const status of ['LOADING', 'COMMITTING']) {
    assert.deepEqual(temporaryAccessView({ ...controller.getView(), status }, clock.time), verified);
  }
});
