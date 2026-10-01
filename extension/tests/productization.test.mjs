import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtlasController } from '@atlas/core';
import { destinationIndex, searchDestinations } from '../dist/lib/ui/destinations.js';
import { journeyIndicator } from '../dist/lib/adapter/journey-indicator.js';
import { fixture, configuration } from './support/fixture.mjs';

test('local search indexes only effective Whitelist hosts, labels and active explicit aliases', () => {
  const policy = { whitelist: ['github.com', 'www.github.com', 'canvas.kth.se', 'mail.google.com', 'webmail.kth.se', 'wiki.example', 'blocked.example'],
    blacklist: ['blocked.example', 'mail.google.com'] };
  const before = structuredClone(policy); const entries = destinationIndex(policy);
  assert.equal(searchDestinations(entries, 'git')[0].label, 'GitHub');
  assert.equal(searchDestinations(entries, 'www.github')[0].hostname, 'github.com');
  assert.equal(searchDestinations(entries, 'canvas')[0].hostname, 'canvas.kth.se');
  assert.equal(searchDestinations(entries, 'mail')[0].label, 'KTH Mail');
  assert.equal(searchDestinations(entries, 'wiki')[0].hostname, 'wiki.example');
  for (const query of ['outlook', 'canvas.instructure.com', 'unlisted.example', 'blocked.example', 'gmail', 'google.com'])
    assert.deepEqual(searchDestinations(entries, query), [], query);
  assert.deepEqual(searchDestinations(entries, ''), []);
  assert.equal(searchDestinations(entries, 'GIT www')[0].label, 'GitHub');
  assert.deepEqual(policy, before);
  assert.deepEqual(destinationIndex({ whitelist: ['www.github.com'], blacklist: [] })[0].hostnames, ['www.github.com']);
});

test('opening a search destination creates no Journey until the ordinary held-request gate', async (t) => {
  const { firefox, controller } = await fixture(t);
  const { tabId, opened } = await firefox.send({ kind: 'OPEN_DESTINATION', url: 'https://root.example/' });
  assert.equal(opened, true);
  assert.deepEqual(controller.getView().snapshot.journeyState.journeys, []);
  assert.deepEqual(await firefox.request(tabId, 'https://root.example/'), {});
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].contextId, `context_1`);
  const unknown = await firefox.send({ kind: 'OPEN_DESTINATION', url: 'https://unknown.example/' });
  assert.equal((await firefox.visit(unknown.tabId, 'https://unknown.example/')).cancel, true);
  assert.equal(controller.getView().snapshot.journeyState.journeys.length, 1);
  assert.equal(controller.getView().snapshot.accessState.grants.length, 0);
});

test('Journey badge belongs to owning tab, has service label and stable countdown, and clears on completion', async (t) => {
  const { firefox, adapter, clock } = await fixture(t, true, { policy: { whitelist: ['canvas.kth.se'], blacklist: [] } });
  const owner = await firefox.tabs.create({}); const other = await firefox.tabs.create({});
  await firefox.request(owner.id, 'https://canvas.kth.se/');
  assert.equal(firefox.badges.get(owner.id), 'J');
  assert.match(firefox.titles.get(owner.id), /Journey → Canvas\n0:01 remaining/);
  assert.notEqual(firefox.badges.get(other.id), 'J');
  const before = firefox.badgeUpdates.length;
  await adapter.refresh(); await adapter.refresh();
  assert.equal(firefox.badgeUpdates.length, before, 'same displayed second causes no badge churn');
  await firefox.redirect(owner.id, 'https://login.example/', false);
  assert.equal(firefox.badges.get(owner.id), 'J');
  await firefox.redirect(owner.id, 'https://canvas.kth.se/');
  assert.equal(firefox.badges.get(owner.id), '');
  assert.doesNotMatch(firefox.titles.get(owner.id), /Journey →/);
  clock.time += 300; await adapter.refresh();
  assert.notEqual(firefox.badges.get(owner.id), 'J');
});

test('expired, cancelled and uncertain Journeys never retain an active badge', async (t) => {
  for (const condition of ['expired', 'cancelled', 'unavailable']) {
    const { firefox, adapter, clock, repository } = await fixture(t);
    const tab = await firefox.tabs.create({});
    await firefox.request(tab.id, 'https://root.example/');
    await firefox.redirect(tab.id, 'https://login.example/', false);
    assert.equal(firefox.badges.get(tab.id), 'J');
    if (condition === 'expired') { clock.time += 300; await adapter.refresh(); }
    if (condition === 'cancelled') await firefox.send({ kind: 'CANCEL_JOURNEY', tabId: tab.id });
    if (condition === 'unavailable') { repository.close(); await adapter.refresh(); }
    assert.notEqual(firefox.badges.get(tab.id), 'J', condition);
  }
});

test('restart closes unproven bindings; stale display cannot invent Journey authority', async (t) => {
  const { firefox, controller, repository, clock } = await fixture(t);
  const tab = await firefox.tabs.create({}); await firefox.request(tab.id, 'https://root.example/');
  const journey = controller.getView().snapshot.journeyState.journeys[0];
  const next = createAtlasController({ repository, clock, configuration, ownerId: 'restarted' });
  assert.equal((await next.open()).status, 'READY');
  assert.equal(next.getView().snapshot.journeyState.journeys[0].phase, 'ENDED');
  assert.equal(journeyIndicator({ ...next.getView(), status: 'RECONCILING' }, journey, clock.time), null);
  assert.equal(journeyIndicator(next.getView(), next.getView().snapshot.journeyState.journeys[0], clock.time), null);
  assert.equal(journeyIndicator(next.getView(), journey, clock.time), null, 'an old display object cannot resurrect ended authority');
});

test('protected settings commands stay in private UI boundary and publish only saved Core state', async (t) => {
  const { firefox, clock, controller, adapter } = await fixture(t);
  const candidateConfiguration = structuredClone(configuration); candidateConfiguration.vaultTiming.waitMs = 1;
  assert.equal(await firefox.send({ kind: 'PROPOSE_SETTINGS', candidateConfiguration }, { id: 'atlas-test', url: 'https://website.example/', frameId: 0 }), false);
  assert.equal((await firefox.send({ kind: 'PROPOSE_SETTINGS', candidateConfiguration })).result.type, 'COMMITTED');
  assert.equal(controller.getView().snapshot.vaultState.pendingProposal.readyAt, 1030);
  assert.equal((await firefox.send({ kind: 'CONFIRM_POLICY', proposalId: 1 })).result.reason, 'NOT_READY');
  clock.time += 30;
  assert.equal((await firefox.send({ kind: 'CONFIRM_POLICY', proposalId: 1 })).result.type, 'COMMITTED');
  assert.equal(controller.getView().snapshot.configuration.vaultTiming.waitMs, 1);
  await adapter.refresh();
  assert.equal(controller.getView().snapshot.policyRevision, 0);
});

test('a failed protected command clears other tab Journey badges before returning', async (t) => {
  const { firefox, repository } = await fixture(t);
  const tab = await firefox.tabs.create({}); await firefox.request(tab.id, 'https://root.example/');
  assert.equal(firefox.badges.get(tab.id), 'J');
  const candidateConfiguration = structuredClone(configuration); candidateConfiguration.vaultTiming.waitMs = 1;
  repository.commit = async (request) => ({ type: 'UNKNOWN', commitId: request.commitId });
  assert.equal((await firefox.send({ kind: 'PROPOSE_SETTINGS', candidateConfiguration })).result.type, 'BLOCKED');
  assert.notEqual(firefox.badges.get(tab.id), 'J');
  assert.match(firefox.titles.get(tab.id), /Access unavailable/);
});
