import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, configuration, deferred } from './support/fixture.mjs';
import { journeyRetry } from '../dist/lib/adapter/journey-indicator.js';

async function transit(firefox) {
  const tab = await firefox.tabs.create({});
  await firefox.request(tab.id, 'https://root.example:8443/entry');
  await firefox.redirect(tab.id, 'https://auth.example/');
  return tab.id;
}
const current = (adapter, tabId) => adapter.view().contexts.find(c => c.tabId === tabId);
const pageSender = (firefox, tabId, url = 'https://auth.example/') => ({ id: firefox.runtime.id, tab: { id: tabId }, url, frameId: 0 });

test('committed intermediate displays its root, stays tab-scoped and clears on interruption/history without reviving authority', async t => {
  const { firefox, adapter, controller } = await fixture(t);
  const tabId = await transit(firefox); const other = await firefox.tabs.create({});
  const display = await firefox.send({ kind: 'GET_JOURNEY_DISPLAY' }, pageSender(firefox, tabId));
  assert.equal(display.presentation.destinationLabel, 'root.example');
  assert.equal(display.presentation.journeyId, current(adapter, tabId).journey.id);
  assert.equal((await firefox.send({ kind: 'GET_JOURNEY_DISPLAY' }, pageSender(firefox, other.id))).presentation, null);
  assert.equal((await firefox.send({ kind: 'GET_JOURNEY_DISPLAY' }, pageSender(firefox, tabId, 'https://stale.example/'))).presentation, null);
  assert.equal(await firefox.send({ kind: 'GET_JOURNEY_DISPLAY' }, { ...pageSender(firefox, tabId), frameId: 1 }), false);
  const id = current(adapter, tabId).journey.id;
  assert.equal((await firefox.visit(tabId, 'https://google.com/')).cancel, true);
  assert.equal(current(adapter, tabId).journey.endReason, 'UNRELATED_NAVIGATION');
  assert.equal((await firefox.send({ kind: 'GET_JOURNEY_DISPLAY' }, pageSender(firefox, tabId))).presentation, null);
  assert.equal(firefox.pageMessages.filter(m => m.tabId === tabId).at(-1).message.presentation, null);
  firefox.arrive(tabId, 'https://auth.example/'); await firefox.flush();
  assert.equal(current(adapter, tabId).journey.id, id);
  assert.equal(current(adapter, tabId).latest.decision.outcome, 'GREYLIST');
  assert.equal(current(adapter, tabId).retry.rootHostname, 'root.example');
  assert.equal(controller.getView().snapshot.accessState.grants.length, 0);
});

test('explicit retry starts at the recorded root origin with fresh Core ID/terms and no old redirect correlation', async t => {
  const { firefox, adapter, controller, clock } = await fixture(t);
  const policy = structuredClone(controller.getView().snapshot.policy);
  const tabId = await transit(firefox); const old = current(adapter, tabId).journey;
  const oldRequest = firefox.requests.get(tabId);
  await firefox.visit(tabId, 'https://google.com/');
  clock.time += 30;
  const result = await firefox.send({ kind: 'RESTART_JOURNEY', tabId, journeyId: old.id });
  assert.equal(result.opened, true);
  assert.equal(firefox.updates.at(-1).url, 'https://root.example:8443/');
  assert.equal((await firefox.send({ kind: 'RESTART_JOURNEY', tabId, journeyId: old.id })).error, 'NAVIGATION_IN_PROGRESS');
  assert.equal(current(adapter, tabId).journey.phase, 'ENDED', 'effect alone does not create a Journey');
  await firefox.request(tabId, 'https://root.example:8443/');
  const fresh = current(adapter, tabId).journey;
  assert.notEqual(fresh.id, old.id); assert.equal(fresh.hopCount, 0);
  assert.equal(fresh.startedAt, clock.time); assert.equal(fresh.expiresAt, clock.time + configuration.journeyLimits.lifetimeMs);
  assert.equal(fresh.maxHops, configuration.journeyLimits.maxHops);
  assert.equal((await firefox.send({ kind: 'RESTART_JOURNEY', tabId, journeyId: old.id })).error, 'JOURNEY_RETRY_UNAVAILABLE');
  firefox.webRequest.onBeforeRedirect.emit({ ...oldRequest, timeStamp: firefox.eventTime++, redirectUrl: 'https://stale.example/' });
  assert.equal((await firefox.request(tabId, 'https://stale.example/', { requestId: oldRequest.requestId })).cancel, true);
  await firefox.flush();
  assert.equal(current(adapter, tabId).journey.endReason, 'UNRELATED_NAVIGATION');
  assert.equal((await firefox.send({ kind: 'RESTART_JOURNEY', tabId, journeyId: fresh.id })).opened, true);
  await firefox.request(tabId, 'https://root.example:8443/');
  assert.deepEqual(await firefox.redirect(tabId, 'https://auth.example/'), {});
  assert.equal(firefox.badges.get(tabId), 'J');
  assert.deepEqual(controller.getView().snapshot.policy, policy);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('retry uses current committed settings while retaining the old ended record terms', async t => {
  const { firefox, controller, adapter, clock } = await fixture(t);
  const tabId = await transit(firefox); const old = current(adapter, tabId).journey;
  await firefox.visit(tabId, 'https://google.com/');
  const candidateConfiguration = structuredClone(configuration); candidateConfiguration.journeyLimits = { lifetimeMs: 100, maxHops: 1 };
  await controller.handle({ kind: 'PROPOSE_SETTINGS', candidateConfiguration }); clock.time += 30;
  await controller.handle({ kind: 'CONFIRM_POLICY', proposalId: 1 });
  assert.equal(current(adapter, tabId).journey.expiresAt, old.expiresAt);
  assert.equal((await firefox.send({ kind: 'RESTART_JOURNEY', tabId, journeyId: old.id })).opened, true);
  await firefox.request(tabId, 'https://root.example:8443/');
  const fresh = current(adapter, tabId).journey;
  assert.equal(fresh.expiresAt - fresh.startedAt, 100); assert.equal(fresh.maxHops, 1);
});

test('known saved display stays stable during a checkpoint; unknown outcomes clear it without exposing candidates', async t => {
  const { firefox, adapter, controller, repository, clock } = await fixture(t);
  const tabId = await transit(firefox); const started = deferred(), finish = deferred();
  clock.time++;
  repository.commit = async ({ commitId }) => { started.resolve(); await finish.promise; return { type: 'UNKNOWN', commitId }; };
  const operation = adapter.refresh(); await started.promise;
  assert.equal(controller.getView().status, 'COMMITTING');
  assert.equal((await firefox.send({ kind: 'GET_JOURNEY_DISPLAY' }, pageSender(firefox, tabId))).presentation.journeyId, current(adapter, tabId).journey.id);
  finish.resolve(); await operation;
  assert.equal((await firefox.send({ kind: 'GET_JOURNEY_DISPLAY' }, pageSender(firefox, tabId))).presentation, null);
  assert.equal(firefox.pageMessages.filter(m => m.tabId === tabId).at(-1).message.presentation, null);
});

test('ordinary Home opening after interruption creates an independent context and a fresh successful path', async t => {
  const { firefox, adapter } = await fixture(t);
  const tabId = await transit(firefox); const old = current(adapter, tabId).journey;
  await firefox.visit(tabId, 'https://google.com/');
  const next = await firefox.send({ kind: 'OPEN_DESTINATION', url: 'https://root.example/' });
  assert.notEqual(next.tabId, tabId);
  await firefox.request(next.tabId, 'https://root.example/'); await firefox.redirect(next.tabId, 'https://auth.example/');
  const fresh = current(adapter, next.tabId).journey;
  assert.notEqual(fresh.id, old.id); assert.notEqual(fresh.contextId, old.contextId);
  assert.equal(current(adapter, tabId).journey.phase, 'ENDED');
  assert.equal(current(adapter, tabId).hostname, 'google.com');
});

test('retry is unavailable for forged IDs, website commands, removed/blacklisted roots, unknown saves and closed contexts', async t => {
  for (const condition of ['forged', 'website', 'removed', 'blacklisted', 'unknown', 'failed', 'closed']) {
    const { firefox, adapter, controller, repository, clock } = await fixture(t);
    const tabId = await transit(firefox); const old = current(adapter, tabId).journey;
    await firefox.visit(tabId, 'https://google.com/');
    const before = firefox.updates.length;
    if (condition === 'removed' || condition === 'blacklisted') {
      await controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: condition === 'removed'
        ? { whitelist: [], blacklist: [] } : { whitelist: ['root.example'], blacklist: ['root.example'] } });
      clock.time += 30;
      await controller.handle({ kind: 'CONFIRM_POLICY', proposalId: 1 });
      assert.equal(journeyRetry(controller.getView(), old), null);
    }
    if (condition === 'unknown') { clock.time++; repository.commit = async ({ commitId }) => ({ type: 'UNKNOWN', commitId }); }
    if (condition === 'failed') { clock.time++; repository.commit = async ({ commitId }) => ({ type: 'NOT_WRITTEN', commitId }); }
    if (condition === 'closed') await firefox.tabs.remove(tabId);
    const result = await firefox.send({ kind: 'RESTART_JOURNEY', tabId, journeyId: condition === 'forged' ? old.id + 1 : old.id },
      condition === 'website' ? pageSender(firefox, tabId) : undefined);
    assert.notEqual(result?.opened, true, condition);
    assert.equal(firefox.updates.length, before, condition);
    assert.equal(controller.getView().snapshot.accessState.grants.length, 0);
  }
});

test('read-only display never creates transitions and clears on expiry, cancellation, completion or uncertain authority', async t => {
  for (const condition of ['expired', 'cancelled', 'completed', 'uncertain']) {
    const { firefox, adapter, clock, controller, repository } = await fixture(t);
    const tabId = await transit(firefox);
    const version = controller.getView().storageVersion;
    await firefox.send({ kind: 'GET_JOURNEY_DISPLAY' }, pageSender(firefox, tabId));
    assert.equal(controller.getView().storageVersion, version);
    if (condition === 'expired') clock.time += 300;
    if (condition === 'cancelled') await firefox.send({ kind: 'CANCEL_JOURNEY', tabId });
    if (condition === 'completed') { await firefox.request(tabId, 'https://auth.example/return', { originUrl: 'https://auth.example/' }); await firefox.redirect(tabId, 'https://root.example/'); }
    if (condition === 'uncertain') { clock.time++; repository.commit = async ({ commitId }) => ({ type: 'UNKNOWN', commitId }); await adapter.refresh(); }
    assert.equal((await firefox.send({ kind: 'GET_JOURNEY_DISPLAY' }, pageSender(firefox, tabId))).presentation, null, condition);
  }
});
