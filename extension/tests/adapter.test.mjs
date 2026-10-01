import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtlasController, compileManagedBlacklist } from '@atlas/core';
import { fixture, policy, configuration, deferred } from './support/fixture.mjs';

test('Core managed denial applies to Firefox Journey and Greylist; publication uses the navigation queue', async (t) => {
  let managed = compileManagedBlacklist(['root.example', 'blocked.example', 'login.example']);
  const { firefox, controller, adapter } = await fixture(t, true, { managedBlacklist: () => managed });
  const opened = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  assert.deepEqual(await firefox.visit(opened.tabId, 'https://root.example/'), {});
  assert.equal((await firefox.visit(opened.tabId, 'https://login.example/')).cancel, true);
  assert.equal(adapter.view().contexts[0].latest.decision.reason, 'MANAGED_BLACKLISTED');
  assert.equal((await firefox.send({ kind: 'START_ACCESS', tabId: opened.tabId })).result.reason, 'MANAGED_BLACKLISTED');
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].hopCount, 0);
  assert.deepEqual(controller.getView().snapshot.policy, policy);

  // Publication must wait for a navigation awaiting persistence, then subsequent gates use new data.
  const held = deferred(); const started = deferred();
  const commit = controller.getView().snapshot;
  const repository = (await fixture(t, true, { managedBlacklist: () => managed }));
  const original = repository.repository.commit.bind(repository.repository);
  repository.repository.commit = async (...args) => { started.resolve(); await held.promise; return original(...args); };
  repository.clock.time += 1;
  const tab = await repository.firefox.tabs.create({});
  const navigation = repository.firefox.request(tab.id, 'https://root.example/');
  await started.promise;
  let published = false;
  const activation = repository.adapter.publishManagedUpdate(async () => {
    published = true; managed = compileManagedBlacklist(['fresh.example']); return true;
  });
  await Promise.resolve();
  assert.equal(published, false);
  held.resolve();
  assert.deepEqual(await navigation, {});
  assert.equal(await activation, true);
  assert.equal((await repository.firefox.request(tab.id, 'https://fresh.example/')).cancel, true);
  assert.deepEqual(controller.getView().snapshot.policy, commit.policy);
});

test('only top-level HTTP(S) requests enter the gate; Whitelist loads', async (t) => {
  const { firefox, controller } = await fixture(t);
  const tab = await firefox.tabs.create({});
  assert.deepEqual(await firefox.visit(tab.id, 'https://root.example/'), {});
  const before = controller.getView();
  for (const type of ['sub_frame', 'script', 'image', 'xmlhttprequest']) {
    assert.deepEqual(await firefox.request(tab.id, 'https://blocked.example/', { type, frameId: type === 'sub_frame' ? 1 : 0 }), {});
  }
  assert.deepEqual(controller.getView(), before);
  assert.deepEqual(firefox.webRequest.onBeforeRequest.listeners[0].options,
    [{ urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }, ['blocking']]);
});

test('one-time explicit setup validates through Core and cannot replace initialized policy', async (t) => {
  const { firefox, controller } = await fixture(t, false);
  const tab = await firefox.tabs.create({});
  assert.equal((await firefox.request(tab.id, 'https://root.example/')).cancel, true);
  assert.equal(controller.getView().status, 'UNINITIALIZED');
  assert.equal((await firefox.send({ kind: 'SETUP', policy: { whitelist: ['*.example'], blacklist: [] } })).initialized, false);
  assert.equal((await firefox.send({ kind: 'SETUP', policy })).initialized, true);
  assert.equal((await firefox.send({ kind: 'SETUP', policy: { whitelist: ['extra.example'], blacklist: [] } })).initialized, false);
  assert.deepEqual(controller.getView().snapshot.policy, policy);
});

test('unknown sites wait for explicit confirmation; saved grant expires without changing policy', async (t) => {
  const { firefox, controller, clock, adapter } = await fixture(t);
  const tab = await firefox.tabs.create({});
  assert.equal((await firefox.visit(tab.id, 'https://unknown.example/form', { method: 'POST' })).cancel, true);
  const start = await firefox.send({ kind: 'START_ACCESS', tabId: tab.id });
  const requestId = start.result.referenceId;
  assert.equal(start.result.type, 'COMMITTED');
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS', requestId })).result.reason, 'NOT_READY');
  clock.time += 10;
  await adapter.refresh();
  assert.equal(adapter.view().contexts[0].latest.decision.outcome, 'REQUIRE_CONFIRMATION');
  assert.equal((await firefox.request(tab.id, 'https://unknown.example/')).cancel, true);
  assert.equal(controller.getView().snapshot.accessState.grants.length, 0);
  const updates = firefox.updates.length;
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS', requestId })).result.type, 'COMMITTED');
  assert.equal(firefox.updates.length, updates, 'confirm must not execute or replay a request');
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS', requestId })).result.reason, 'REQUEST_NOT_FOUND');
  await firefox.send({ kind: 'OPEN_HOME', tabId: tab.id });
  assert.equal(firefox.updates.at(-1).url, 'https://unknown.example/');
  assert.deepEqual(await firefox.visit(tab.id, 'https://unknown.example/'), {});
  clock.time += 100;
  await adapter.refresh();
  await firefox.flush();
  assert.equal(adapter.view().contexts[0].latest.decision.outcome, 'GREYLIST');
  assert.equal(adapter.view().contexts[0].effect, 'REMOVED');
  assert.deepEqual(controller.getView().snapshot.policy, policy);
});

test('Journey path shares one deadline; initial root and a redirect through root do not finish it', async (t) => {
  const { firefox, controller, clock } = await fixture(t);
  const opened = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  const id = opened.tabId;
  assert.equal(opened.result.type, 'COMMITTED');
  const initial = controller.getView().snapshot.journeyState.journeys[0];
  await firefox.visit(id, 'https://root.example/');
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].phase, 'STARTED');
  clock.time += 50;
  assert.deepEqual(await firefox.visit(id, 'https://login.example/'), {});
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].hopCount, 1);
  // A server redirect through root has a held request, but never commits a document there.
  assert.deepEqual(await firefox.request(id, 'https://root.example/redirect', { requestId: 'chain' }), {});
  clock.time += 50;
  assert.deepEqual(await firefox.visit(id, 'https://identity.example/', { requestId: 'chain' }), {});
  const transit = controller.getView().snapshot.journeyState.journeys[0];
  assert.equal(transit.phase, 'IN_TRANSIT');
  assert.equal(transit.hopCount, 2);
  assert.equal(transit.expiresAt, initial.expiresAt);
  assert.deepEqual(await firefox.visit(id, 'https://root.example/complete'), {});
  const snapshot = controller.getView().snapshot;
  assert.equal(snapshot.journeyState.journeys[0].endReason, 'RETURNED');
  assert.equal(snapshot.journeyState.journeys[0].expiresAt, initial.expiresAt);
  assert.deepEqual(snapshot.policy, policy);
  assert.deepEqual(snapshot.accessState.grants, []);
  assert.equal((await firefox.visit(id, 'https://identity.example/')).cancel, true);
});

test('separate tabs and reused native tab IDs do not inherit a Journey; Blacklist still wins', async (t) => {
  const { firefox, controller } = await fixture(t);
  const { tabId } = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  await firefox.visit(tabId, 'https://root.example/');
  const popup = await firefox.tabs.create({});
  assert.equal((await firefox.visit(popup.id, 'https://login.example/')).cancel, true);
  assert.equal((await firefox.visit(tabId, 'https://blocked.example/')).cancel, true);
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].hopCount, 0);
  await firefox.tabs.remove(tabId);
  await firefox.flush();
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].endReason, 'CONTEXT_CLOSED');
  firefox.documents.set(tabId, { id: tabId, url: 'about:blank' });
  assert.equal((await firefox.visit(tabId, 'https://login.example/')).cancel, true);
});

test('Journey cancellation removes its intermediate; expiry and hop exhaustion deny subsequent navigation', async (t) => {
  const { firefox, clock, controller } = await fixture(t);
  const first = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  await firefox.visit(first.tabId, 'https://login.example/');
  await firefox.send({ kind: 'CANCEL_JOURNEY', tabId: first.tabId });
  await firefox.flush();
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].endReason, 'CANCELLED');
  assert.ok(firefox.documents.get(first.tabId).url.startsWith('moz-extension:'));
  const second = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  for (const host of ['one', 'two', 'three']) assert.deepEqual(await firefox.visit(second.tabId, `https://${host}.example/`), {});
  assert.equal((await firefox.visit(second.tabId, 'https://four.example/')).cancel, true);
  assert.equal(controller.getView().snapshot.journeyState.journeys[1].endReason, 'HOP_LIMIT');
  const third = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  clock.time += 300;
  assert.equal((await firefox.visit(third.tabId, 'https://login.example/')).cancel, true);
  assert.equal(controller.getView().snapshot.journeyState.journeys[2].endReason, 'EXPIRED');
});

test('a failed observation save cancels even a Whitelist request', async (t) => {
  const { firefox, repository, controller, clock } = await fixture(t);
  repository.commit = async ({ commitId }) => ({ type: 'NOT_WRITTEN', commitId });
  clock.time++;
  const tab = await firefox.tabs.create({});
  assert.equal((await firefox.visit(tab.id, 'https://root.example/')).cancel, true);
  assert.equal(controller.getView().status, 'UNAVAILABLE');
  assert.equal(controller.getView().reason, 'WRITE_FAILED');
});

test('superseded requests cannot publish delayed ALLOW or consume an unadopted hop', async (t) => {
  const { firefox, repository, controller, clock } = await fixture(t);
  const { tabId } = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  await firefox.visit(tabId, 'https://root.example/');
  const commit = repository.commit.bind(repository);
  const entered = deferred(); const release = deferred();
  repository.commit = async (request) => {
    entered.resolve(); await release.promise;
    return commit(request);
  };
  clock.time++;
  const old = firefox.request(tabId, 'https://login.example/');
  await entered.promise;
  const current = firefox.request(tabId, 'https://root.example/new');
  release.resolve();
  assert.equal((await old).cancel, true);
  assert.deepEqual(await current, {});
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].hopCount, 0);
  firefox.arrive(tabId, 'https://root.example/new');
  await firefox.flush();
});

test('untrusted senders and malformed command envelopes cannot request state changes', async (t) => {
  const { firefox, controller } = await fixture(t);
  const before = controller.getView();
  for (const sender of [
    { id: 'website', url: 'https://root.example/', frameId: 0 },
    { id: firefox.runtime.id, url: 'https://root.example/', frameId: 0 },
    { id: firefox.runtime.id, url: firefox.runtime.getURL('ui/index.html'), frameId: 1 },
  ]) assert.equal(await firefox.send({ kind: 'SETUP', policy }, sender), false);
  assert.equal((await firefox.send({ kind: 'START_JOURNEY', tabId: 1, contextId: 'forged' })).error, 'INVALID_COMMAND');
  assert.equal((await firefox.send({ kind: 'PROPOSE_POLICY', candidatePolicy: policy })).error, 'INVALID_COMMAND');
  assert.deepEqual(controller.getView(), before);
});

test('unmatched cache/history arrival loses the Journey before reevaluation', async (t) => {
  const { firefox, controller } = await fixture(t);
  const { tabId } = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  await firefox.visit(tabId, 'https://root.example/');
  firefox.arrive(tabId, 'https://unobserved.example/');
  await firefox.flush();
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].endReason, 'CONTEXT_CLOSED');
  assert.ok(firefox.documents.get(tabId).url.startsWith('moz-extension:'));
});

test('UI removal is not reported before arrival; update failure closes the affected tab', async (t) => {
  const { firefox, adapter } = await fixture(t);
  const tab = await firefox.tabs.create({});
  firefox.autoArriveUI = false;
  await firefox.visit(tab.id, 'https://unknown.example/');
  assert.equal(adapter.view().contexts[0].effect, 'REMOVING');
  firefox.arrive(tab.id, firefox.updates.at(-1).url);
  await firefox.flush();
  assert.equal(adapter.view().contexts[0].effect, 'REMOVED');
  firefox.failUpdate = true;
  await firefox.visit(tab.id, 'https://blocked.example/');
  assert.equal(firefox.documents.has(tab.id), false);
});

test('unknown commit outcomes hold navigation until explicit reconciliation', async (t) => {
  const { firefox, repository, controller, clock } = await fixture(t);
  const commit = repository.commit.bind(repository);
  repository.commit = async (request) => {
    await commit(request);
    return { type: 'UNKNOWN', commitId: request.commitId };
  };
  clock.time++;
  const tab = await firefox.tabs.create({});
  assert.equal((await firefox.visit(tab.id, 'https://root.example/')).cancel, true);
  assert.equal(controller.getView().status, 'RECONCILING');
  repository.commit = commit;
  await firefox.send({ kind: 'RECOVER' });
  assert.equal(controller.getView().status, 'READY');
  assert.deepEqual(await firefox.visit(tab.id, 'https://root.example/'), {});
});

test('new owner ends old Journey bindings while preserving pending Access timestamps', async (t) => {
  const { firefox, adapter, repository, clock, controller } = await fixture(t);
  const { tabId } = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  await firefox.visit(tabId, 'https://login.example/');
  const grey = await firefox.tabs.create({});
  await firefox.visit(grey.id, 'https://unknown.example/');
  await firefox.send({ kind: 'START_ACCESS', tabId: grey.id });
  const pending = controller.getView().snapshot.accessState.pendingRequests[0];
  adapter.stop();
  clock.time += 5;
  const restarted = createAtlasController({ repository, clock, configuration, ownerId: 'restart' });
  await restarted.open();
  assert.deepEqual(restarted.getView().snapshot.accessState.pendingRequests[0], pending);
  assert.equal(restarted.getView().snapshot.journeyState.journeys[0].endReason, 'CONTEXT_CLOSED');
});

test('late initial about:blank arrival cannot end a newly launched Journey', async (t) => {
  const { firefox, controller, adapter } = await fixture(t);
  const create = firefox.tabs.create;
  firefox.tabs.create = async (options) => {
    const tab = await create(options);
    firefox.arrive(tab.id, 'about:blank'); // Queued before tabs.create returns to OPEN_JOURNEY.
    return tab;
  };
  const { tabId } = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  await firefox.flush();
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].phase, 'STARTED');
  // Firefox may show the requested URL before delivering onBeforeRequest.
  firefox.documents.get(tabId).url = 'https://root.example/';
  await adapter.refresh();
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].phase, 'STARTED');
  assert.deepEqual(await firefox.request(tabId, 'https://root.example/'), {});
  firefox.arrive(tabId, 'about:blank'); // Native Firefox also delivers this after the HTTP gate.
  await firefox.flush();
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].phase, 'STARTED');
  firefox.arrive(tabId, 'https://root.example/');
  await firefox.flush();
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].phase, 'STARTED');
  await firefox.visit(tabId, 'https://root.example/');
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].phase, 'STARTED');
});

test('failed or hung document removal remains conservative and reports failure truthfully', async (t) => {
  const { firefox, adapter } = await fixture(t);
  const tab = await firefox.tabs.create({});
  firefox.autoArriveUI = false;
  firefox.failRemove = true;
  await firefox.visit(tab.id, 'https://unknown.example/');
  firefox.runTimers(3000);
  await firefox.flush();
  assert.equal(adapter.view().contexts[0].effect, 'FAILED');
  assert.equal(adapter.view().contexts[0].latest.reason, 'CONTENT_REMOVAL_FAILED');
});

test('retained-content expiry during a pending navigation does not invent a return hop', async (t) => {
  const { firefox, controller, clock, adapter } = await fixture(t);
  const { tabId } = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  await firefox.visit(tabId, 'https://login.example/');
  assert.deepEqual(await firefox.request(tabId, 'https://identity.example/'), {});
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].hopCount, 2);
  clock.time += 300;
  await adapter.refresh();
  await firefox.flush();
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].hopCount, 2);
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].endReason, 'EXPIRED');
  assert.equal(adapter.view().contexts[0].effect, 'REMOVED');
});

test('unsupported HTTP targets discovered after restoration fail closed', async (t) => {
  const { firefox, adapter } = await fixture(t);
  const tab = await firefox.tabs.create({ url: 'http://127.0.0.1/' });
  await adapter.refresh();
  await firefox.flush();
  assert.ok(firefox.documents.get(tab.id).url.startsWith('moz-extension:'));
  assert.equal(adapter.view().contexts[0].latest.reason, 'INVALID_TARGET');
});

test('a failed browser-state query does not silently retain governed content', async (t) => {
  const { firefox, adapter } = await fixture(t);
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://root.example/');
  firefox.tabs.query = async () => { throw new Error('Synthetic browser failure'); };
  await adapter.refresh();
  await firefox.flush();
  assert.equal(adapter.view().contexts[0].effect, 'REMOVED');
  assert.equal(adapter.view().contexts[0].latest.reason, 'BROWSER_STATE_UNAVAILABLE');
});

test('unexpected adapter exceptions resolve to cancellation, never a rejected blocking listener', async (t) => {
  for (const dependency of ['newContextId', 'schedule']) {
    const { firefox } = await fixture(t, true, { [dependency]: () => { throw new Error('Synthetic host failure'); } });
    const tab = await firefox.tabs.create({});
    assert.equal((await firefox.request(tab.id, 'https://unknown.example/')).cancel, true);
  }
});

test('a missing arrival callback cannot retain a released intermediate past its Core deadline', async (t) => {
  const { firefox, clock, adapter, controller } = await fixture(t);
  const { tabId } = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  await firefox.visit(tabId, 'https://root.example/');
  assert.deepEqual(await firefox.request(tabId, 'https://login.example/'), {});
  firefox.documents.get(tabId).url = 'https://login.example/'; // Deliberately omit onCommitted.
  clock.time += 300;
  await adapter.refresh();
  await firefox.flush();
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].endReason, 'EXPIRED');
  assert.ok(firefox.documents.get(tabId).url.startsWith('moz-extension:'));
  assert.equal(adapter.view().contexts[0].effect, 'REMOVED');
});
