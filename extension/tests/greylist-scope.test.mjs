import test from 'node:test';
import assert from 'node:assert/strict';
import { compileManagedBlacklist, createAtlasController } from '@atlas/core';
import { FirefoxAdapter } from '../dist/lib/adapter/firefox-adapter.js';
import { equivalentServiceHostnames } from '../dist/lib/presets/access-aliases.js';
import { configuration, deferred, fixture } from './support/fixture.mjs';

const hosts = ['goodreads.com', 'www.goodreads.com'];
const viewContext = (adapter, tabId) => adapter.view().contexts.find(context => context.tabId === tabId);

async function prepare(firefox, adapter, tabId) {
  const result = await firefox.send({ kind: 'PREPARE_ACCESS', tabId });
  assert.equal(result.error, undefined);
  const scope = viewContext(adapter, tabId).accessScope;
  assert.equal(scope.status, 'READY');
  return scope;
}

async function start(firefox, tabId, scope) {
  const result = await firefox.send({ kind: 'START_ACCESS', tabId, scopeId: scope.id });
  assert.equal(result.result.type, 'COMMITTED');
  return result.result.referenceId;
}

test('Goodreads discovers and discloses one exact scope before a single saved wait and confirmation', async t => {
  const probes = [];
  const { firefox, adapter, clock, controller } = await fixture(t, true, {
    discoverCanonicalEntry: async origin => { probes.push(origin); return 'www.goodreads.com'; },
  });
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://goodreads.com/list?sort=title#books');
  const policy = structuredClone(controller.getView().snapshot.policy);
  const scope = await prepare(firefox, adapter, tab.id);
  assert.deepEqual(probes, ['https://goodreads.com'], 'only the origin enters discovery');
  assert.deepEqual(scope.hostnames, hosts);
  assert.equal(scope.source, 'CANONICAL_REDIRECT');
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, []);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  assert.equal((await prepare(firefox, adapter, tab.id)).id, scope.id);
  assert.equal(probes.length, 1, 'reopening the review reuses its preparation');
  const requestId = await start(firefox, tab.id, scope);
  const request = structuredClone(controller.getView().snapshot.accessState.pendingRequests[0]);
  assert.deepEqual(request.scopeHostnames, hosts);
  assert.equal(viewContext(adapter, tab.id).accessScope, null, 'Start consumes the reviewed draft');
  assert.equal(await start(firefox, tab.id, scope), requestId, 'repeated Start keeps the existing request');
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, [request]);
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId })).result.reason, 'NOT_READY');
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, [request]);
  clock.time = request.readyAt;
  const confirmed = await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
  assert.equal(confirmed.result.type, 'COMMITTED');
  assert.equal(confirmed.opened, true);
  assert.deepEqual(await firefox.request(tab.id, 'https://goodreads.com/'), {});
  assert.deepEqual(await firefox.redirect(tab.id, 'https://www.goodreads.com/'), {});
  assert.equal(viewContext(adapter, tab.id).latest.decision.reason, 'ACTIVE_GRANT');
  const grant = structuredClone(controller.getView().snapshot.accessState.grants[0]);
  assert.deepEqual(grant.scopeHostnames, hosts);
  assert.equal(grant.expiresAt, request.readyAt + request.grantDurationMs);
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, []);
  assert.deepEqual(controller.getView().snapshot.policy, policy);
  assert.deepEqual(controller.getView().snapshot.journeyState.journeys, []);
  assert.deepEqual(equivalentServiceHostnames('goodreads.com'), ['goodreads.com'], 'discovery adds no global alias');
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS', requestId })).result.reason, 'REQUEST_NOT_FOUND');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, [grant]);
  assert.equal((await firefox.request(tab.id, 'https://api.goodreads.com/')).cancel, true);
  clock.time = grant.expiresAt;
  for (const hostname of hosts) assert.equal((await firefox.request(tab.id, `https://${hostname}/`)).cancel, true);
});

test('www entry discovery can propose only its observed apex partner', async t => {
  const { firefox, adapter, clock, controller } = await fixture(t, true, {
    discoverCanonicalEntry: async () => 'goodreads.com',
  });
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://www.goodreads.com/');
  const scope = await prepare(firefox, adapter, tab.id);
  assert.deepEqual([...scope.hostnames].sort(), hosts);
  const requestId = await start(firefox, tab.id, scope);
  const request = controller.getView().snapshot.accessState.pendingRequests[0];
  assert.equal(request.hostname, 'www.goodreads.com');
  assert.deepEqual(request.scopeHostnames, hosts);
  clock.time = request.readyAt;
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId })).opened, true);
  assert.deepEqual(await firefox.request(tab.id, 'https://www.goodreads.com/'), {});
  assert.deepEqual(await firefox.redirect(tab.id, 'https://goodreads.com/'), {});
});

test('three sequential requests prepare an HTTP Goodreads entry through HTTPS and use one frozen grant', async t => {
  const probes = [];
  const { firefox, adapter, clock, controller } = await fixture(t, true, {
    discoverCanonicalEntry: async origin => {
      assert.equal(new URL(origin).protocol, 'https:', 'preparation never probes an HTTP entry directly');
      probes.push(origin);
      return origin === 'https://goodreads.com' ? 'www.goodreads.com' : null;
    },
  });
  const tab = await firefox.tabs.create({});
  let contextId;
  const policy = structuredClone(controller.getView().snapshot.policy);
  const scenarios = [
    { entry: 'https://amazon.se/', scope: ['amazon.se', 'www.amazon.se'], destination: 'https://www.amazon.se/' },
    { entry: 'https://drive.google.com/', scope: ['drive.google.com'] },
    { entry: 'http://goodreads.com/', scope: hosts, destination: 'https://www.goodreads.com/' },
  ];
  const savedGrants = [];
  let lastRequest;
  for (const scenario of scenarios) {
    assert.equal((await firefox.visit(tab.id, scenario.entry)).cancel, true);
    contextId ??= viewContext(adapter, tab.id).contextId;
    assert.equal(viewContext(adapter, tab.id).contextId, contextId, 'all three requests use the same browsing context');
    const scope = await prepare(firefox, adapter, tab.id);
    assert.deepEqual(scope.hostnames, scenario.scope);
    if (scenario.entry.startsWith('http:')) assert.equal(scope.source, 'CANONICAL_REDIRECT');
    const requestId = await start(firefox, tab.id, scope);
    const request = structuredClone(controller.getView().snapshot.accessState.pendingRequests[0]);
    assert.equal(request.hostname, new URL(scenario.entry).hostname, 'the requested hostname stays unchanged');
    assert.deepEqual(request.scopeHostnames, scenario.scope);
    assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId })).result.reason, 'NOT_READY');
    clock.time = request.readyAt;
    const confirmed = await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
    assert.equal(confirmed.result.type, 'COMMITTED');
    assert.equal(confirmed.opened, true);
    assert.equal(firefox.updates.at(-1).url, scenario.entry, 'confirmation preserves the original browsing origin');
    assert.deepEqual(await firefox.request(tab.id, scenario.entry), {});
    if (scenario.entry.startsWith('http:')) {
      assert.deepEqual(await firefox.redirect(tab.id, 'https://goodreads.com/', false), {});
    }
    if (scenario.destination) assert.deepEqual(await firefox.redirect(tab.id, scenario.destination), {});
    else { firefox.arrive(tab.id, scenario.entry); await firefox.flush(); }
    assert.equal(viewContext(adapter, tab.id).latest.decision.reason, 'ACTIVE_GRANT');
    const grant = structuredClone(controller.getView().snapshot.accessState.grants.find(value => value.requestId === requestId));
    assert.deepEqual(grant.scopeHostnames, scenario.scope);
    assert.equal(grant.expiresAt, request.readyAt + request.grantDurationMs);
    savedGrants.push(grant);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, savedGrants, 'later requests do not renew previous grants');
    assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, []);
    lastRequest = request;
  }
  assert.deepEqual(probes, ['https://drive.google.com', 'https://goodreads.com']);
  assert.deepEqual(controller.getView().snapshot.policy, policy);
  assert.deepEqual(controller.getView().snapshot.journeyState.journeys, []);
  assert.deepEqual(equivalentServiceHostnames('goodreads.com'), ['goodreads.com']);
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS', requestId: lastRequest.id })).result.reason, 'REQUEST_NOT_FOUND');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, savedGrants);
  clock.time = savedGrants.at(-1).expiresAt;
  for (const url of ['http://goodreads.com/', 'https://goodreads.com/', 'https://www.goodreads.com/']) {
    assert.equal((await firefox.request(tab.id, url)).cancel, true);
    assert.equal(viewContext(adapter, tab.id).latest.decision.outcome, 'GREYLIST');
  }
  assert.equal(viewContext(adapter, tab.id).contextId, contextId);
});

test('HTTPS preparation for an HTTP entry still rejects a manually or managed denied counterpart', async t => {
  for (const kind of ['manual', 'managed']) {
    const managed = compileManagedBlacklist(['www.goodreads.com']);
    const { firefox, adapter, controller } = await fixture(t, true, {
      policy: { whitelist: [], blacklist: kind === 'manual' ? ['www.goodreads.com'] : [] },
      ...(kind === 'managed' ? { managedBlacklist: () => managed } : {}),
      discoverCanonicalEntry: async origin => {
        assert.equal(origin, 'https://goodreads.com');
        return 'www.goodreads.com';
      },
    });
    const tab = await firefox.tabs.create({});
    await firefox.visit(tab.id, 'http://goodreads.com/');
    const scope = await prepare(firefox, adapter, tab.id);
    assert.deepEqual(scope.hostnames, hosts);
    assert.equal(scope.source, 'CANONICAL_REDIRECT');
    const started = await firefox.send({ kind: 'START_ACCESS', tabId: tab.id, scopeId: scope.id });
    assert.equal(started.result.type, 'REJECTED');
    assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, []);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
    assert.equal((await firefox.request(tab.id, 'https://www.goodreads.com/')).cancel, true);
    assert.equal(viewContext(adapter, tab.id).latest.decision.outcome, 'DENY');
  }
});

test('failed discovery and unrelated or invalid suggestions keep the scope exact', async t => {
  for (const partner of [null, 'accounts.google.com', 'api.goodreads.com', 'www.goodreads.com.attacker.com',
    'https://www.goodreads.com/', undefined, 1, 'throw']) {
    const { firefox, adapter, controller } = await fixture(t, true, {
      discoverCanonicalEntry: async () => {
        if (partner === 'throw') throw new Error('Discovery unavailable');
        return partner;
      },
    });
    const tab = await firefox.tabs.create({});
    await firefox.visit(tab.id, 'https://goodreads.com/');
    const scope = await prepare(firefox, adapter, tab.id);
    assert.equal(scope.source, 'EXACT');
    assert.deepEqual(scope.hostnames, ['goodreads.com']);
    await start(firefox, tab.id, scope);
    assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests[0].scopeHostnames, ['goodreads.com']);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  }
});

test('declared aliases require review but need no network discovery', async t => {
  let probes = 0;
  const { firefox, adapter, controller } = await fixture(t, true, {
    discoverCanonicalEntry: async () => { probes += 1; return 'unrelated.com'; },
  });
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://amazon.se/');
  const scope = await prepare(firefox, adapter, tab.id);
  assert.equal(scope.source, 'DECLARED');
  assert.deepEqual(scope.hostnames, ['amazon.se', 'www.amazon.se']);
  assert.equal(probes, 0);
  await start(firefox, tab.id, scope);
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests[0].scopeHostnames, scope.hostnames);
});

test('discovery never bypasses manual or managed Blacklist checks on a proposed partner', async t => {
  for (const kind of ['manual', 'managed']) {
    const managed = compileManagedBlacklist(['www.goodreads.com']);
    const { firefox, adapter, controller } = await fixture(t, true, {
      policy: { whitelist: [], blacklist: kind === 'manual' ? ['www.goodreads.com'] : [] },
      ...(kind === 'managed' ? { managedBlacklist: () => managed } : {}),
      discoverCanonicalEntry: async () => 'www.goodreads.com',
    });
    const tab = await firefox.tabs.create({});
    await firefox.visit(tab.id, 'https://goodreads.com/');
    const scope = await prepare(firefox, adapter, tab.id);
    const started = await firefox.send({ kind: 'START_ACCESS', tabId: tab.id, scopeId: scope.id });
    assert.equal(started.result.type, 'REJECTED');
    assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, []);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
    assert.equal((await firefox.request(tab.id, 'https://www.goodreads.com/')).cancel, true);
  }
});

test('Start requires the reviewed scope for its own tab and websites cannot prepare requests', async t => {
  const { firefox, adapter, controller } = await fixture(t, true, {
    discoverCanonicalEntry: async () => 'www.goodreads.com',
  });
  const first = await firefox.tabs.create({});
  const second = await firefox.tabs.create({});
  await firefox.visit(first.id, 'https://goodreads.com/');
  await firefox.visit(second.id, 'https://goodreads.com/');
  assert.equal((await firefox.send({ kind: 'START_ACCESS', tabId: first.id })).error, 'SCOPE_REVIEW_REQUIRED');
  const scope = await prepare(firefox, adapter, first.id);
  assert.equal((await firefox.send({ kind: 'START_ACCESS', tabId: first.id, scopeId: 'wrong' })).error, 'SCOPE_REVIEW_REQUIRED');
  assert.equal((await firefox.send({ kind: 'START_ACCESS', tabId: second.id, scopeId: scope.id })).error, 'SCOPE_REVIEW_REQUIRED');
  assert.equal(await firefox.send({ kind: 'PREPARE_ACCESS', tabId: second.id },
    { id: firefox.runtime.id, url: 'https://goodreads.com/', frameId: 0, tab: { id: second.id } }), false);
  assert.equal(viewContext(adapter, second.id).accessScope, null);
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, []);
  const secondScope = await prepare(firefox, adapter, second.id);
  assert.notEqual(secondScope.id, scope.id);
  assert.equal((await firefox.send({ kind: 'START_ACCESS', tabId: second.id, scopeId: scope.id })).error, 'SCOPE_REVIEW_REQUIRED');
  await start(firefox, first.id, scope);
});

test('a delayed shared preparation does not hold other navigation or create a waiting request', async t => {
  const probe = deferred();
  let calls = 0;
  const { firefox, adapter, controller } = await fixture(t, true, {
    discoverCanonicalEntry: () => { calls += 1; return probe.promise; },
  });
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://goodreads.com/');
  const first = firefox.send({ kind: 'PREPARE_ACCESS', tabId: tab.id });
  await adapter.whenIdle();
  const pending = viewContext(adapter, tab.id).accessScope;
  assert.equal(pending.status, 'PREPARING');
  assert.deepEqual(pending.hostnames, ['goodreads.com']);
  const second = firefox.send({ kind: 'PREPARE_ACCESS', tabId: tab.id });
  await adapter.whenIdle();
  assert.equal(viewContext(adapter, tab.id).accessScope.id, pending.id);
  assert.equal(calls, 1);
  assert.equal((await firefox.send({ kind: 'START_ACCESS', tabId: tab.id, scopeId: pending.id })).error, 'SCOPE_REVIEW_REQUIRED');
  const other = await firefox.tabs.create({});
  assert.deepEqual(await firefox.visit(other.id, 'https://root.example/'), {});
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, []);
  probe.resolve('www.goodreads.com');
  await Promise.all([first, second]);
  assert.equal(viewContext(adapter, tab.id).accessScope.status, 'READY');
  assert.equal(viewContext(adapter, tab.id).accessScope.id, pending.id);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('navigation supersession and tab closure discard a late discovery result', async t => {
  for (const action of ['navigate', 'close']) {
    const probe = deferred();
    const { firefox, adapter, controller } = await fixture(t, true, { discoverCanonicalEntry: () => probe.promise });
    const tab = await firefox.tabs.create({});
    await firefox.visit(tab.id, 'https://goodreads.com/');
    const preparation = firefox.send({ kind: 'PREPARE_ACCESS', tabId: tab.id });
    await adapter.whenIdle();
    const scope = viewContext(adapter, tab.id).accessScope;
    if (action === 'navigate') await firefox.visit(tab.id, 'https://goodreads.com/another-page');
    else await firefox.tabs.remove(tab.id);
    probe.resolve('www.goodreads.com');
    await preparation;
    assert.equal(viewContext(adapter, tab.id)?.accessScope ?? null, null);
    const started = await firefox.send({ kind: 'START_ACCESS', tabId: tab.id, scopeId: scope.id });
    assert.equal(started.error, action === 'navigate' ? 'SCOPE_REVIEW_REQUIRED' : 'CONTEXT_UNAVAILABLE');
    assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, []);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  }
});

test('a committed policy revision discards an in-flight scope proposal', async t => {
  const probe = deferred();
  const { firefox, adapter, clock, controller } = await fixture(t, true, { discoverCanonicalEntry: () => probe.promise });
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://goodreads.com/');
  const preparation = firefox.send({ kind: 'PREPARE_ACCESS', tabId: tab.id });
  await adapter.whenIdle();
  const scope = viewContext(adapter, tab.id).accessScope;
  const candidatePolicy = { whitelist: ['root.example', 'another.example'], blacklist: ['blocked.example'] };
  const proposed = await controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy });
  assert.equal(proposed.type, 'COMMITTED');
  clock.time += configuration.vaultTiming.waitMs;
  assert.equal((await controller.handle({ kind: 'CONFIRM_POLICY', proposalId: proposed.referenceId })).type, 'COMMITTED');
  probe.resolve('www.goodreads.com');
  await preparation;
  assert.equal(viewContext(adapter, tab.id).accessScope, null);
  assert.equal((await firefox.send({ kind: 'START_ACCESS', tabId: tab.id, scopeId: scope.id })).error, 'SCOPE_REVIEW_REQUIRED');
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, []);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('failed, conflicted and uncertain confirmation saves never release a discovered scope', async t => {
  for (const outcome of ['NOT_WRITTEN', 'CONFLICT', 'UNKNOWN']) {
    const { firefox, adapter, clock, controller, repository } = await fixture(t, true, {
      discoverCanonicalEntry: async () => 'www.goodreads.com',
    });
    const tab = await firefox.tabs.create({});
    await firefox.visit(tab.id, 'https://goodreads.com/');
    const requestId = await start(firefox, tab.id, await prepare(firefox, adapter, tab.id));
    clock.time = controller.getView().snapshot.accessState.pendingRequests[0].readyAt;
    const commit = repository.commit.bind(repository);
    repository.commit = async request => {
      if (outcome === 'UNKNOWN') await commit(request);
      return { type: outcome, commitId: request.commitId };
    };
    const updates = firefox.updates.length;
    const confirmed = await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
    assert.equal(confirmed.opened, false, outcome);
    assert.equal(firefox.updates.length, updates);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
    for (const hostname of hosts) assert.equal((await firefox.request(tab.id, `https://${hostname}/`)).cancel, true, outcome);
  }
});

test('expired requests need a new scope review and full wait; cancelled requests cannot confirm', async t => {
  const { firefox, adapter, clock, controller } = await fixture(t, true, {
    discoverCanonicalEntry: async () => 'www.goodreads.com',
  });
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://goodreads.com/');
  const scope = await prepare(firefox, adapter, tab.id);
  const expiredId = await start(firefox, tab.id, scope);
  const expired = controller.getView().snapshot.accessState.pendingRequests[0];
  clock.time = expired.confirmBy;
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId: expiredId })).result.reason, 'REQUEST_EXPIRED');
  assert.equal((await firefox.send({ kind: 'START_ACCESS', tabId: tab.id, scopeId: scope.id })).error, 'SCOPE_REVIEW_REQUIRED');
  const fresh = await prepare(firefox, adapter, tab.id);
  assert.notEqual(fresh.id, scope.id);
  const requestId = await start(firefox, tab.id, fresh);
  assert.equal(controller.getView().snapshot.accessState.pendingRequests[0].readyAt, clock.time + configuration.accessTiming.waitMs);
  assert.equal((await firefox.send({ kind: 'CANCEL_ACCESS', requestId })).result.type, 'COMMITTED');
  clock.time += configuration.accessTiming.waitMs;
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS', requestId })).result.reason, 'REQUEST_NOT_FOUND');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('a reviewed reverse redirect preserves existing singleton consent until a new full wait after expiry', async t => {
  let probes = 0;
  const { firefox, adapter, clock, controller } = await fixture(t, true, {
    discoverCanonicalEntry: async origin => {
      probes += 1;
      // Model evidence in either direction; a self-redirect is not an alias suggestion.
      return origin === 'https://www.goodreads.com' ? 'goodreads.com' : 'www.goodreads.com';
    },
  });
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://goodreads.com/');
  const started = await controller.handle({ kind: 'START_ACCESS', target: { hostname: 'goodreads.com' } });
  const singleton = structuredClone(controller.getView().snapshot.accessState.pendingRequests[0]);
  assert.equal((await firefox.send({ kind: 'PREPARE_ACCESS', tabId: tab.id })).error, 'NOT_GREYLIST');
  assert.equal(probes, 0);
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests, [singleton]);
  clock.time = singleton.readyAt;
  await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId: started.referenceId });
  const grant = structuredClone(controller.getView().snapshot.accessState.grants[0]);
  assert.equal(grant.scopeHostnames, undefined);
  assert.deepEqual(await firefox.request(tab.id, 'https://goodreads.com/'), {});
  assert.equal((await firefox.redirect(tab.id, 'https://www.goodreads.com/')).cancel, true);
  const scope = await prepare(firefox, adapter, tab.id);
  assert.equal((await firefox.send({ kind: 'START_ACCESS', tabId: tab.id, scopeId: scope.id })).result.reason, 'SCOPE_CONFLICT');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, [grant]);
  clock.time = grant.expiresAt;
  const requestId = await start(firefox, tab.id, scope);
  const request = controller.getView().snapshot.accessState.pendingRequests[0];
  assert.equal(request.id, requestId);
  assert.deepEqual(request.scopeHostnames, hosts);
  assert.equal(request.readyAt, clock.time + configuration.accessTiming.waitMs);
});

test('restart preserves a discovered pending scope and the confirmed grant deadline', async t => {
  const { firefox, adapter, clock, controller, repository } = await fixture(t, true, {
    discoverCanonicalEntry: async () => 'www.goodreads.com',
  });
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://goodreads.com/');
  const requestId = await start(firefox, tab.id, await prepare(firefox, adapter, tab.id));
  const request = structuredClone(controller.getView().snapshot.accessState.pendingRequests[0]);
  adapter.stop();
  const restored = createAtlasController({ repository, clock, configuration, ownerId: 'scope_restart' });
  let probes = 0;
  const restarted = new FirefoxAdapter(firefox, Promise.resolve({ repository, controller: restored }),
    () => 'restored_scope_context', () => clock.now(), firefox.schedule, firefox.unschedule,
    async () => { probes += 1; return 'unrelated.com'; });
  t.after(() => restarted.stop());
  await restarted.ready;
  firefox.settle = () => restarted.whenIdle();
  assert.deepEqual(restored.getView().snapshot.accessState.pendingRequests, [request]);
  await firefox.visit(tab.id, 'https://www.goodreads.com/');
  assert.equal((await firefox.send({ kind: 'PREPARE_ACCESS', tabId: tab.id })).error, 'NOT_GREYLIST');
  assert.equal(probes, 0);
  clock.time = request.readyAt;
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId })).opened, true);
  const grant = structuredClone(restored.getView().snapshot.accessState.grants[0]);
  assert.deepEqual(grant.scopeHostnames, hosts);
  assert.equal(grant.expiresAt, request.readyAt + request.grantDurationMs);
  restarted.stop();
  const reloaded = createAtlasController({ repository, clock, configuration, ownerId: 'scope_restart_again' });
  const nextAdapter = new FirefoxAdapter(firefox, Promise.resolve({ repository, controller: reloaded }),
    () => 'reloaded_scope_context', () => clock.now(), firefox.schedule, firefox.unschedule,
    async () => { probes += 1; return 'unrelated.com'; });
  t.after(() => nextAdapter.stop());
  await nextAdapter.ready;
  firefox.settle = () => nextAdapter.whenIdle();
  assert.deepEqual(reloaded.getView().snapshot.accessState.grants, [grant]);
  assert.deepEqual(await firefox.visit(tab.id, 'https://goodreads.com/'), {});
  assert.deepEqual(await firefox.visit(tab.id, 'https://www.goodreads.com/'), {});
  assert.equal(probes, 0);
  clock.time = grant.expiresAt;
  for (const hostname of hosts) assert.equal((await firefox.request(tab.id, `https://${hostname}/`)).cancel, true);
});
