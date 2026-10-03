import test from 'node:test';
import assert from 'node:assert/strict';
import { compileManagedBlacklist, createAtlasController, evaluate, normalizeTarget } from '@atlas/core';
import { fixture, configuration } from './support/fixture.mjs';
import { FirefoxAdapter } from '../dist/lib/adapter/firefox-adapter.js';
import { compileCuratedWhitelist, curatedWhitelist } from '../dist/lib/presets/curated-whitelist.js';
import { equivalentServiceHostnames, greylistAliases } from '../dist/lib/presets/access-aliases.js';

const amazonHosts = ['amazon.se', 'www.amazon.se'];

test('one Amazon request, wait and confirmation authorizes the apex-to-www redirect', async (t) => {
  const { firefox, clock, controller } = await fixture(t);
  const tab = await firefox.tabs.create({});
  const before = structuredClone(controller.getView().snapshot.policy);
  assert.equal((await firefox.visit(tab.id, 'https://amazon.se/')).cancel, true);
  const started = await firefox.send({ kind: 'START_ACCESS', tabId: tab.id });
  const requestId = started.result.referenceId;
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests[0].scopeHostnames, amazonHosts);
  clock.time += 10;
  const confirmed = await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
  assert.equal(confirmed.result.type, 'COMMITTED');
  assert.equal(confirmed.opened, true);
  assert.deepEqual(await firefox.request(tab.id, 'https://amazon.se/'), {});
  assert.deepEqual(await firefox.redirect(tab.id, 'https://www.amazon.se/'), {});
  assert.equal(controller.getView().snapshot.accessState.pendingRequests.length, 0);
  assert.equal(controller.getView().snapshot.accessState.grants.length, 1);
  assert.deepEqual(controller.getView().snapshot.accessState.grants[0].scopeHostnames, amazonHosts);
  assert.deepEqual(controller.getView().snapshot.policy, before);
  assert.deepEqual(controller.getView().snapshot.journeyState.journeys, []);
});

test('explicit access aliases remain Greylist and never infer other hosts or service destinations', () => {
  const policy = compileCuratedWhitelist();
  const seen = new Set();
  for (const service of [...curatedWhitelist.flatMap(group => group.services), ...greylistAliases]) {
    for (const host of [service.hostname, ...(service.aliases ?? [])]) {
      assert.equal(normalizeTarget({ hostname: host })?.hostname, host);
      assert.equal(seen.has(host), false, `overlapping alias declaration: ${host}`);
      seen.add(host);
    }
  }
  for (const host of amazonHosts) {
    assert.equal(evaluate(host, policy).outcome, 'GREYLIST');
    assert.deepEqual(equivalentServiceHostnames(host), amazonHosts);
  }
  for (const host of ['amazon.com', 'www.amazon.com', 'shop.amazon.se', 'amazon.se.example', 'example.com',
    'www.example.com', 'outlook.live.com', 'www.arxiv.org']) {
    assert.deepEqual(equivalentServiceHostnames(host), [host]);
  }
  const scope = equivalentServiceHostnames('amazon.se');
  scope.push('unrelated.example');
  assert.deepEqual(equivalentServiceHostnames('www.amazon.se'), amazonHosts, 'callers cannot alter alias metadata');
});

test('starting from www shares one frozen request across both aliases without bypassing the wait', async (t) => {
  const { firefox, clock, controller } = await fixture(t);
  const www = await firefox.tabs.create({});
  const apex = await firefox.tabs.create({});
  await firefox.visit(www.id, 'https://www.amazon.se/');
  const requestId = (await firefox.send({ kind: 'START_ACCESS', tabId: www.id })).result.referenceId;
  const frozen = structuredClone(controller.getView().snapshot.accessState.pendingRequests[0]);
  assert.equal(frozen.hostname, 'www.amazon.se');
  assert.deepEqual(frozen.scopeHostnames, amazonHosts);
  await firefox.visit(apex.id, 'https://amazon.se/');
  const repeated = await firefox.send({ kind: 'START_ACCESS', tabId: apex.id });
  assert.equal(repeated.result.referenceId, requestId);
  const premature = await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: apex.id, requestId });
  assert.equal(premature.result.reason, 'NOT_READY');
  assert.equal(premature.opened, false);
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, [frozen]);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  clock.time = frozen.readyAt;
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: apex.id, requestId })).opened, true);
  const grant = structuredClone(controller.getView().snapshot.accessState.grants[0]);
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS', requestId })).result.reason, 'REQUEST_NOT_FOUND');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, [grant]);
  assert.deepEqual(await firefox.visit(www.id, 'https://www.amazon.se/'), {});
  for (const host of ['shop.amazon.se', 'amazon.com', 'amazon.se.example']) {
    assert.equal((await firefox.request(www.id, `https://${host}/`)).cancel, true, host);
  }
  clock.time = grant.expiresAt;
  for (const host of amazonHosts) assert.equal((await firefox.request(www.id, `https://${host}/`)).cancel, true, host);
});

test('either alias being manually or managed blacklisted prevents the whole scoped request', async (t) => {
  for (const kind of ['manual', 'managed']) for (const blocked of amazonHosts) {
    const managed = compileManagedBlacklist([blocked]);
    const { firefox, controller } = await fixture(t, true, {
      policy: { whitelist: [], blacklist: kind === 'manual' ? [blocked] : [] },
      ...(kind === 'managed' ? { managedBlacklist: () => managed } : {}),
    });
    const tab = await firefox.tabs.create({});
    const other = amazonHosts.find(host => host !== blocked);
    await firefox.visit(tab.id, `https://${other}/`);
    assert.equal((await firefox.send({ kind: 'START_ACCESS', tabId: tab.id })).result.type, 'REJECTED');
    assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, []);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
    assert.equal((await firefox.request(tab.id, `https://${blocked}/`)).cancel, true);
  }
});

test('failed, conflicting and uncertain confirmation saves cannot release either alias', async (t) => {
  for (const outcome of ['NOT_WRITTEN', 'CONFLICT', 'UNKNOWN']) {
    const { firefox, clock, controller, repository } = await fixture(t);
    const tab = await firefox.tabs.create({});
    await firefox.visit(tab.id, 'https://amazon.se/');
    const requestId = (await firefox.send({ kind: 'START_ACCESS', tabId: tab.id })).result.referenceId;
    clock.time += 10;
    const commit = repository.commit.bind(repository);
    repository.commit = async request => {
      if (outcome === 'UNKNOWN') await commit(request);
      return { type: outcome, commitId: request.commitId };
    };
    const updates = firefox.updates.length;
    const confirmed = await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
    assert.equal(confirmed.opened, false, outcome);
    assert.equal(firefox.updates.length, updates, 'failed confirmation must not navigate');
    for (const host of amazonHosts) assert.equal((await firefox.request(tab.id, `https://${host}/`)).cancel, true, outcome);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  }
});

test('saved singleton requests and grants keep their consented scope after alias metadata changes', async (t) => {
  const { firefox, clock, controller } = await fixture(t);
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://amazon.se/');
  // Model an older build's persisted request, without alias scope.
  const requestId = (await controller.handle({ kind: 'START_ACCESS', target: { hostname: 'amazon.se' } })).referenceId;
  const old = structuredClone(controller.getView().snapshot.accessState.pendingRequests[0]);
  assert.equal((await firefox.send({ kind: 'START_ACCESS', tabId: tab.id })).result.referenceId, requestId);
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, [old]);
  clock.time = old.readyAt;
  await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
  const grant = structuredClone(controller.getView().snapshot.accessState.grants[0]);
  assert.equal(grant.scopeHostnames, undefined);
  assert.deepEqual(await firefox.request(tab.id, 'https://amazon.se/'), {});
  assert.equal((await firefox.redirect(tab.id, 'https://www.amazon.se/')).cancel, true);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, [grant]);
  clock.time = grant.expiresAt;
  await firefox.send({ kind: 'START_ACCESS', tabId: tab.id });
  const fresh = controller.getView().snapshot.accessState.pendingRequests[0];
  assert.deepEqual(fresh.scopeHostnames, amazonHosts);
  assert.equal(fresh.readyAt, clock.time + 10, 'changed scope requires a fresh full wait');
});

test('restart preserves both declared hosts and the original grant deadline', async (t) => {
  const { firefox, clock, controller, adapter, repository } = await fixture(t);
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://amazon.se/');
  const requestId = (await firefox.send({ kind: 'START_ACCESS', tabId: tab.id })).result.referenceId;
  clock.time += 10;
  await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
  const grant = structuredClone(controller.getView().snapshot.accessState.grants[0]);
  adapter.stop();
  const restored = createAtlasController({ repository, clock, configuration, ownerId: 'alias_restart' });
  const restarted = new FirefoxAdapter(firefox, Promise.resolve({ repository, controller: restored }),
    () => 'restored_context', () => clock.now(), firefox.schedule, firefox.unschedule);
  t.after(() => restarted.stop());
  await restarted.ready;
  firefox.settle = () => restarted.whenIdle();
  assert.deepEqual(restored.getView().snapshot.accessState.grants, [grant]);
  assert.deepEqual(await firefox.visit(tab.id, 'https://www.amazon.se/'), {});
  clock.time = grant.expiresAt;
  assert.equal((await firefox.request(tab.id, 'https://www.amazon.se/')).cancel, true);
  assert.equal((await firefox.request(tab.id, 'https://amazon.se/')).cancel, true);
});
