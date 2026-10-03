import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/fixture.mjs';
import { equivalentServiceHostnames } from '../dist/lib/presets/access-aliases.js';

test('alias request scope excludes separate service destinations and never infers www', () => {
  assert.deepEqual(equivalentServiceHostnames('www.overleaf.com'), ['overleaf.com', 'www.overleaf.com']);
  assert.deepEqual(equivalentServiceHostnames('outlook.live.com'), ['outlook.live.com']);
  assert.deepEqual(equivalentServiceHostnames('arxiv.org'), ['arxiv.org']);
  assert.deepEqual(equivalentServiceHostnames('www.arxiv.org'), ['www.arxiv.org']);
});

test('Atlas, ordinary, typed, link and new-tab Whitelist requests enter the same redirect path', async (t) => {
  const { firefox, controller } = await fixture(t);
  for (const origin of ['Atlas', 'ordinary', 'typed', 'link', 'new-tab']) {
    const tabId = origin === 'Atlas' ? (await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' })).tabId
      : (await firefox.tabs.create({})).id;
    assert.deepEqual(await firefox.request(tabId, 'https://root.example/', origin === 'link' ? { originUrl: 'https://other.example/' } : {}), {});
    assert.deepEqual(await firefox.redirect(tabId, 'https://login.example/'), {});
    const contextId = (await firefox.send({ kind: 'GET_VIEW' })).view.contexts.find((c) => c.tabId === tabId).contextId;
    const journey = controller.getView().snapshot.journeyState.journeys.find((j) => j.contextId === contextId);
    assert.equal(journey.rootHostname, 'root.example');
    assert.equal(journey.phase, 'IN_TRANSIT');
    assert.equal(journey.hopCount, 1);
    const before = controller.getView().snapshot.policy;
    assert.equal((await firefox.request(tabId, 'https://www.google.com/')).cancel, true);
    assert.equal(controller.getView().snapshot.journeyState.journeys.find((j) => j.id === journey.id).endReason, 'UNRELATED_NAVIGATION');
    assert.deepEqual(controller.getView().snapshot.policy, before);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  }
});

test('reused request ID, unexpected redirect target and cross-host page link cannot borrow Journey', async (t) => {
  for (const spoof of ['id', 'target', 'link']) {
    const { firefox } = await fixture(t);
    const tab = await firefox.tabs.create({});
    await firefox.request(tab.id, 'https://root.example/', { requestId: 'chain' });
    if (spoof === 'target') firefox.webRequest.onBeforeRedirect.emit({ tabId: tab.id, frameId: 0, type: 'main_frame',
      requestId: 'chain', url: 'https://root.example/', redirectUrl: 'https://expected.example/', timeStamp: firefox.eventTime++ });
    assert.equal((await firefox.request(tab.id, 'https://unrelated.example/', { requestId: 'chain',
      ...(spoof === 'link' ? { originUrl: 'https://root.example/' } : {}) })).cancel, true);
  }
});

test('one Overleaf request covers declared apex and www aliases, persists once and rejects replay', async (t) => {
  const { firefox, clock, controller } = await fixture(t);
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://overleaf.com/');
  const start = await firefox.send({ kind: 'START_ACCESS', tabId: tab.id });
  const requestId = start.result.referenceId;
  const second = await firefox.send({ kind: 'START_ACCESS', tabId: tab.id });
  assert.equal(second.result.referenceId, requestId);
  assert.equal(controller.getView().snapshot.accessState.pendingRequests.length, 1);
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests[0].scopeHostnames, ['overleaf.com', 'www.overleaf.com']);
  clock.time += 10;
  const confirmed = await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
  assert.equal(confirmed.result.type, 'COMMITTED');
  assert.equal(confirmed.opened, true);
  assert.deepEqual(await firefox.request(tab.id, 'https://overleaf.com/'), {});
  assert.deepEqual(await firefox.redirect(tab.id, 'https://www.overleaf.com/'), {});
  assert.equal(controller.getView().snapshot.accessState.grants.length, 1);
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS', requestId })).result.reason, 'REQUEST_NOT_FOUND');
  assert.equal((await firefox.request(tab.id, 'https://api.overleaf.com/')).cancel, true);
});

test('failed alias grant persistence cannot open either hostname', async (t) => {
  const { firefox, clock, controller, repository } = await fixture(t);
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://overleaf.com/');
  const requestId = (await firefox.send({ kind: 'START_ACCESS', tabId: tab.id })).result.referenceId;
  clock.time += 10;
  repository.commit = async ({ commitId }) => ({ type: 'NOT_WRITTEN', commitId });
  const confirmed = await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
  assert.equal(confirmed.opened, false);
  assert.equal(controller.getView().snapshot.accessState.grants.length, 0);
  assert.equal((await firefox.request(tab.id, 'https://www.overleaf.com/')).cancel, true);
});
