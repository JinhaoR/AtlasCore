import test from 'node:test';
import assert from 'node:assert/strict';
import { compileManagedBlacklist, planAtlasOperation } from '@atlas/core';
import { accessOverview } from '../dist/lib/adapter/temporary-access.js';
const temporaryAccessView = (...args) => accessOverview(...args).temporaryAccess;
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

test('history-heavy overview agrees with individual Core decisions without changing records or deadlines', async t => {
  const { controller, clock } = await fixture(t);
  await confirm(controller, clock, 'active.example', ['active.example', 'denied.example']);
  await controller.handle({ kind: 'START_ACCESS', target: { hostname: 'waiting.example' } });
  const view = structuredClone(controller.getView()), snapshot = view.snapshot;
  for (let i = 0; i < 100; i++) snapshot.accessState.grants.push({
    requestId: snapshot.accessState.nextRequestId++, hostname: `expired-${i}.example`,
    issuedAt: 1, expiresAt: 2, policyRevision: 0,
  });
  const before = structuredClone(view), managed = compileManagedBlacklist(['denied.example']);
  for (const now of [clock.time, clock.time + 10, clock.time + 60, clock.time + 100]) {
    const input = { snapshot, now, configuration: snapshot.configuration, managedBlacklist: managed };
    const decide = hostname => planAtlasOperation({ kind: 'CHECK_NAVIGATION', target: { hostname },
      context: { contextId: 'reference', journeyId: null } }, input).result;
    const temporaryAccess = snapshot.accessState.grants.flatMap(g => {
      const hostnames = (g.scopeHostnames ?? [g.hostname]).filter(h => {
        const r = decide(h); return r.type === 'ASSESSMENT' && r.decision.reason === 'ACTIVE_GRANT' && r.decision.requestId === g.requestId;
      });
      return hostnames.length ? [{ requestId: g.requestId, hostnames, expiresAt: g.expiresAt }] : [];
    }).sort((a,b) => a.expiresAt-b.expiresAt || a.requestId-b.requestId);
    const pendingAccess = snapshot.accessState.pendingRequests.flatMap(p => {
      const r = decide(p.hostname);
      return r.type === 'ASSESSMENT' && ['WAIT', 'REQUIRE_CONFIRMATION'].includes(r.decision.outcome)
        ? [{ requestId: p.id, hostnames: p.scopeHostnames ?? [p.hostname], readyAt: p.readyAt, confirmBy: p.confirmBy, outcome: r.decision.outcome }] : [];
    }).sort((a,b) => a.readyAt-b.readyAt || a.requestId-b.requestId);
    assert.deepEqual(accessOverview(view, now, managed), { temporaryAccess, pendingAccess });
  }
  assert.deepEqual(view, before);
});

test('expired and stale records are still fully validated before history is omitted', async t => {
  const { controller, clock } = await fixture(t);
  await confirm(controller, clock, 'expired.example');
  const now = clock.time + 101, view = structuredClone(controller.getView());
  view.snapshot.accessState.grants[0].expiresAt = -1;
  assert.deepEqual(accessOverview(view, now), { pendingAccess: null, temporaryAccess: null });
  const stale = structuredClone(controller.getView());
  stale.snapshot.policyRevision++;
  assert.deepEqual(accessOverview(stale, clock.time), { pendingAccess: [], temporaryAccess: [] });
  assert.deepEqual(accessOverview(stale, clock.time - 1), { pendingAccess: null, temporaryAccess: null });
  assert.deepEqual(accessOverview(controller.getView(), now, {}), { pendingAccess: null, temporaryAccess: null });
});
