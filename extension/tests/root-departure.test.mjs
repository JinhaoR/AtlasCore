import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '@atlas/core';
import { fixture, configuration, deferred } from './support/fixture.mjs';

const current = (adapter, tabId) => adapter.view().contexts.find(context => context.tabId === tabId);
async function loadedRoot(firefox, url = 'https://root.example/') {
  const tab = await firefox.tabs.create({});
  assert.deepEqual(await firefox.visit(tab.id, url), {});
  return tab.id;
}

test('a loaded Canvas departure starts a bounded source-root Journey and HTTP continuation returns normally', async t => {
  const { firefox, adapter, controller, clock } = await fixture(t, true, {
    policy: { whitelist: ['canvas.kth.se'], blacklist: ['blocked.example'] },
  });
  const tabId = await loadedRoot(firefox, 'https://canvas.kth.se/');
  const reached = current(adapter, tabId).journey;
  const policy = structuredClone(controller.getView().snapshot.policy);
  assert.equal(reached.endReason, 'REACHED');
  clock.time += 20;
  assert.deepEqual(await firefox.request(tabId, 'https://app.kth.se/', { originUrl: 'https://canvas.kth.se/', method: 'POST' }), {});
  const departure = current(adapter, tabId).journey;
  assert.notEqual(departure.id, reached.id);
  assert.equal(departure.rootHostname, 'canvas.kth.se');
  assert.equal(departure.currentHostname, 'app.kth.se');
  assert.equal(departure.phase, 'IN_TRANSIT');
  assert.equal(departure.startedAt, clock.time);
  assert.equal(departure.expiresAt, clock.time + configuration.journeyLimits.lifetimeMs);
  assert.equal(departure.hopCount, 1);
  assert.equal(departure.maxHops, configuration.journeyLimits.maxHops);
  firefox.arrive(tabId, 'https://app.kth.se/'); await firefox.flush();
  assert.deepEqual(await firefox.request(tabId, 'https://app.kth.se/choose', { originUrl: 'https://app.kth.se/' }), {});
  clock.time += 20;
  assert.deepEqual(await firefox.redirect(tabId, 'https://identity.example/'), {});
  assert.equal(current(adapter, tabId).journey.hopCount, 2);
  assert.equal(current(adapter, tabId).journey.expiresAt, departure.expiresAt);
  assert.deepEqual(await firefox.request(tabId, 'https://identity.example/return', { originUrl: 'https://identity.example/' }), {});
  assert.deepEqual(await firefox.redirect(tabId, 'https://canvas.kth.se/'), {});
  assert.equal(current(adapter, tabId).journey.endReason, 'RETURNED');
  assert.equal(current(adapter, tabId).journey.id, departure.id);
  assert.equal(current(adapter, tabId).journey.expiresAt, departure.expiresAt);
  assert.deepEqual(controller.getView().snapshot.policy, policy);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  assert.equal(evaluate('app.kth.se', policy).outcome, 'GREYLIST');
  assert.equal(evaluate('identity.example', policy).outcome, 'GREYLIST');
});

test('root departure immediately after actual arrival works before queued completion and preserves the original source origin for retry', async t => {
  const { firefox, adapter } = await fixture(t);
  const tab = await firefox.tabs.create({});
  await firefox.request(tab.id, 'https://root.example:8443/');
  const first = current(adapter, tab.id).journey;
  firefox.arrive(tab.id, 'https://root.example:8443/');
  assert.deepEqual(await firefox.request(tab.id, 'https://auth.example/', { originUrl: 'https://root.example:8443/' }), {});
  const departure = current(adapter, tab.id).journey;
  assert.notEqual(departure.id, first.id);
  assert.equal(departure.rootHostname, 'root.example');
  assert.equal(departure.phase, 'IN_TRANSIT');
  firefox.arrive(tab.id, 'https://auth.example/'); await firefox.flush();
  assert.equal((await firefox.visit(tab.id, 'https://google.com/')).cancel, true);
  assert.equal((await firefox.send({ kind: 'RESTART_JOURNEY', tabId: tab.id, journeyId: departure.id })).opened, true);
  assert.equal(firefox.updates.at(-1).url, 'https://root.example:8443/');
});

test('the first departure of an explicitly started root attempt uses its existing ID and deadline', async t => {
  const { firefox, adapter, clock } = await fixture(t);
  const tabId = await loadedRoot(firefox);
  assert.equal((await firefox.send({ kind: 'START_JOURNEY', tabId })).result.type, 'COMMITTED');
  const started = current(adapter, tabId).journey;
  clock.time += 20;
  assert.deepEqual(await firefox.visit(tabId, 'https://auth.example/', { originUrl: 'https://root.example/' }), {});
  assert.equal(current(adapter, tabId).journey.id, started.id);
  assert.equal(current(adapter, tabId).journey.expiresAt, started.expiresAt);
  assert.equal(current(adapter, tabId).journey.hopCount, 1);
});

test('typed targets, mismatched sources and a source without an arrived document cannot start root departure', async t => {
  for (const attempt of ['typed', 'wrong-host', 'wrong-origin', 'not-arrived']) {
    const { firefox, adapter, controller } = await fixture(t);
    const tabId = attempt === 'not-arrived' ? (await firefox.tabs.create({})).id : await loadedRoot(firefox);
    if (attempt === 'not-arrived') await firefox.request(tabId, 'https://root.example/');
    const nextId = controller.getView().snapshot.journeyState.nextJourneyId;
    const origin = attempt === 'typed' ? {} : { originUrl: attempt === 'wrong-host' ? 'https://other.example/'
      : attempt === 'wrong-origin' ? 'http://root.example/' : 'https://root.example/' };
    assert.equal((await firefox.request(tabId, 'https://auth.example/', origin)).cancel, true, attempt);
    assert.equal(controller.getView().snapshot.journeyState.nextJourneyId, nextId, attempt);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
    assert.notEqual(current(adapter, tabId).journey?.phase, 'IN_TRANSIT');
  }
});

test('a non-HTTP replacement cannot retain a departed root as first-departure authority', async t => {
  for (const pending of ['NONE', 'LAUNCH', 'FLIGHT']) {
    for (const replacement of ['about:blank', 'about:newtab']) {
      for (const immediately of [false, true]) {
        const { firefox, adapter, controller } = await fixture(t);
        const tabId = await loadedRoot(firefox);
        if (pending === 'LAUNCH') await firefox.send({ kind: 'OPEN_HOME', tabId });
        if (pending === 'FLIGHT') await firefox.request(tabId, 'https://root.example/next');
        const nextId = controller.getView().snapshot.journeyState.nextJourneyId;
        firefox.arrive(tabId, replacement);
        if (!immediately) await firefox.flush();
        assert.equal((await firefox.request(tabId, 'https://auth.example/', {
          originUrl: 'https://root.example/',
        })).cancel, true, `${pending}, ${replacement}, immediate=${immediately}`);
        assert.equal(controller.getView().snapshot.journeyState.nextJourneyId, nextId);
        assert.equal(current(adapter, tabId).displayedHostname, null);
        assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
      }
    }
  }
});

test('an intermediate cannot open a second unfamiliar destination directly or renew its attempt after expiry', async t => {
  for (const expired of [false, true]) {
    const { firefox, adapter, controller, clock } = await fixture(t);
    const tabId = await loadedRoot(firefox);
    await firefox.visit(tabId, 'https://auth.example/', { originUrl: 'https://root.example/' });
    const journey = current(adapter, tabId).journey;
    const nextId = controller.getView().snapshot.journeyState.nextJourneyId;
    if (expired) clock.time = journey.expiresAt;
    assert.equal((await firefox.request(tabId, 'https://other-auth.example/', { originUrl: 'https://auth.example/', method: 'POST' })).cancel, true);
    assert.equal(current(adapter, tabId).journey.id, journey.id);
    assert.equal(current(adapter, tabId).journey.expiresAt, journey.expiresAt);
    assert.equal(current(adapter, tabId).journey.endReason, expired ? 'EXPIRED' : 'UNRELATED_NAVIGATION');
    assert.equal(controller.getView().snapshot.journeyState.nextJourneyId, nextId);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  }
});

test('departures stay context-bound and separate loaded roots create independent attempts', async t => {
  const { firefox, adapter } = await fixture(t);
  const owner = await loadedRoot(firefox);
  await firefox.visit(owner, 'https://auth.example/', { originUrl: 'https://root.example/' });
  const ownerJourney = current(adapter, owner).journey;
  const blank = await firefox.tabs.create({});
  assert.equal((await firefox.visit(blank.id, 'https://auth.example/', { originUrl: 'https://root.example/' })).cancel, true);
  assert.equal(current(adapter, blank.id).journey, null);
  const other = await loadedRoot(firefox);
  assert.deepEqual(await firefox.visit(other, 'https://auth.example/', { originUrl: 'https://root.example/' }), {});
  assert.notEqual(current(adapter, other).journey.id, ownerJourney.id);
  assert.notEqual(current(adapter, other).journey.contextId, ownerJourney.contextId);
  assert.equal(current(adapter, owner).journey.phase, 'IN_TRANSIT');
});

test('Greylist and temporary-granted source documents cannot establish Pure Whitelist departures', async t => {
  for (const granted of [false, true]) {
    const { firefox, adapter, controller, clock } = await fixture(t);
    const tab = await firefox.tabs.create({});
    await firefox.visit(tab.id, 'https://unknown.example/');
    if (granted) {
      const requestId = (await firefox.send({ kind: 'START_ACCESS', tabId: tab.id })).result.referenceId;
      clock.time += configuration.accessTiming.waitMs;
      assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS', requestId })).result.type, 'COMMITTED');
      assert.deepEqual(await firefox.visit(tab.id, 'https://unknown.example/'), {});
      assert.equal(current(adapter, tab.id).latest.decision.reason, 'ACTIVE_GRANT');
    }
    assert.equal((await firefox.request(tab.id, 'https://auth.example/', { originUrl: 'https://unknown.example/' })).cancel, true);
    assert.deepEqual(controller.getView().snapshot.journeyState.journeys, []);
    assert.equal(controller.getView().snapshot.accessState.grants.length, granted ? 1 : 0);
  }
});

test('current source policy and target Blacklist override old saved Whitelist presentation', async t => {
  for (const change of ['removed-source', 'blacklisted-source', 'blacklisted-target']) {
    const { firefox, adapter, controller, clock } = await fixture(t);
    const tabId = await loadedRoot(firefox);
    const before = controller.getView().snapshot.journeyState.nextJourneyId;
    if (change !== 'blacklisted-target') {
      const candidatePolicy = { whitelist: change === 'removed-source' ? [] : ['root.example'],
        blacklist: change === 'blacklisted-source' ? ['root.example'] : [] };
      const proposal = await controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy });
      clock.time += configuration.vaultTiming.waitMs;
      assert.equal((await controller.handle({ kind: 'CONFIRM_POLICY', proposalId: proposal.referenceId })).type, 'COMMITTED');
      assert.equal(current(adapter, tabId).latest.policyRevision, 0, 'the adapter still holds the deliberately stale source assessment');
    }
    assert.equal((await firefox.request(tabId, change === 'blacklisted-target' ? 'https://blocked.example/' : 'https://auth.example/',
      { originUrl: 'https://root.example/' })).cancel, true, change);
    if (change === 'blacklisted-target') assert.equal(current(adapter, tabId).latest.decision.reason, 'BLACKLISTED');
    assert.equal(controller.getView().snapshot.journeyState.nextJourneyId, before);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  }
});

test('startup CHECK of an existing Whitelist document can support a new departure without restoring old bindings', async t => {
  const { firefox, adapter, controller } = await fixture(t);
  const tab = await firefox.tabs.create({ url: 'https://root.example/' });
  await adapter.refresh();
  assert.equal(current(adapter, tab.id).journey, null);
  assert.equal(current(adapter, tab.id).latest.decision.reason, 'WHITELISTED');
  assert.deepEqual(await firefox.visit(tab.id, 'https://auth.example/', { originUrl: 'https://root.example/' }), {});
  assert.equal(current(adapter, tab.id).journey.rootHostname, 'root.example');
  assert.equal(current(adapter, tab.id).journey.phase, 'IN_TRANSIT');
  assert.equal(current(adapter, tab.id).journey.hopCount, 1);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('both root-departure saves hold the Firefox request and expose only previously verified authority', { timeout: 3000 }, async t => {
  for (const phase of ['STARTED', 'IN_TRANSIT']) {
    const { firefox, adapter, controller, repository, clock } = await fixture(t);
    const tabId = await loadedRoot(firefox);
    const reached = current(adapter, tabId).journey;
    const commit = repository.commit.bind(repository);
    const entered = deferred(), release = deferred();
    repository.commit = async request => {
      const candidate = request.next.snapshot.journeyState.journeys.find(journey => journey.contextId === reached.contextId);
      if (candidate?.id !== reached.id && candidate?.phase === phase) { entered.resolve(); await release.promise; }
      return commit(request);
    };
    clock.time++;
    let settled = false;
    const navigation = firefox.request(tabId, 'https://auth.example/', { originUrl: 'https://root.example/' }).then(result => { settled = true; return result; });
    try {
      await entered.promise;
      const view = (await firefox.send({ kind: 'GET_VIEW' })).view;
      assert.equal(settled, false);
      assert.equal(view.controller.status, 'COMMITTING');
      assert.equal(current(adapter, tabId).latest.decision.reason, 'WHITELISTED');
      const saved = view.controller.snapshot.journeyState.journeys.find(journey => journey.contextId === reached.contextId);
      assert.equal(saved.phase, phase === 'STARTED' ? 'ENDED' : 'STARTED');
      assert.equal(saved.hopCount, 0);
      assert.deepEqual(view.controller.snapshot.accessState.grants, []);
    } finally { release.resolve(); }
    assert.deepEqual(await navigation, {});
    assert.equal(controller.getView().snapshot.journeyState.journeys.find(journey => journey.contextId === reached.contextId).phase, 'IN_TRANSIT');
  }
});

test('failed or unknown start and first-hop commits cannot release root departure', async t => {
  for (const phase of ['STARTED', 'IN_TRANSIT']) {
    for (const outcome of ['NOT_WRITTEN', 'UNKNOWN']) {
      const { firefox, adapter, controller, repository } = await fixture(t);
      const tabId = await loadedRoot(firefox);
      const reached = current(adapter, tabId).journey;
      const commit = repository.commit.bind(repository);
      let failed = false;
      repository.commit = async request => {
        const candidate = request.next.snapshot.journeyState.journeys.find(journey => journey.contextId === reached.contextId);
        if (candidate?.id !== reached.id && candidate?.phase === phase) {
          failed = true;
          if (outcome === 'UNKNOWN') await commit(request);
          return { type: outcome, commitId: request.commitId };
        }
        return commit(request);
      };
      assert.equal((await firefox.request(tabId, 'https://auth.example/', { originUrl: 'https://root.example/' })).cancel, true, `${phase} ${outcome}`);
      assert.equal(failed, true);
      assert.equal(controller.getView().status, outcome === 'UNKNOWN' ? 'RECONCILING' : 'UNAVAILABLE');
      const saved = controller.getView().snapshot.journeyState.journeys.find(journey => journey.contextId === reached.contextId);
      assert.equal(saved.phase, phase === 'STARTED' ? 'ENDED' : 'STARTED');
      assert.equal(saved.hopCount, 0);
      assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
      const diagnostics = await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId });
      assert.equal(diagnostics.entries.some(entry => entry.navigationId === current(adapter, tabId).navigationId && entry.event === 'RELEASED'), false);
    }
  }
});

test('a first-hop commit crossing its fixed deadline cancels departure instead of extending the Journey', { timeout: 3000 }, async t => {
  const { firefox, adapter, repository, controller, clock } = await fixture(t);
  const tabId = await loadedRoot(firefox);
  const reached = current(adapter, tabId).journey;
  const commit = repository.commit.bind(repository);
  const entered = deferred(), release = deferred();
  let candidateExpiry;
  repository.commit = async request => {
    const candidate = request.next.snapshot.journeyState.journeys.find(journey => journey.contextId === reached.contextId);
    if (candidate?.id !== reached.id && candidate?.phase === 'IN_TRANSIT') {
      candidateExpiry = candidate.expiresAt;
      entered.resolve(); await release.promise;
    }
    return commit(request);
  };
  const navigation = firefox.request(tabId, 'https://auth.example/', { originUrl: 'https://root.example/' });
  try {
    await entered.promise;
    clock.time = candidateExpiry;
  } finally { release.resolve(); }
  assert.equal((await navigation).cancel, true);
  assert.equal(current(adapter, tabId).journey.expiresAt, candidateExpiry);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  const diagnostics = await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId });
  assert.equal(diagnostics.entries.some(entry => entry.navigationId === current(adapter, tabId).navigationId && entry.event === 'RELEASED'), false);
});

test('a superseded unreleased departure cannot prevent a second departure from the still-loaded root', { timeout: 3000 }, async t => {
  for (const phase of ['STARTED', 'IN_TRANSIT']) {
    for (const nextHostname of ['auth.example', 'other-auth.example']) {
      const { firefox, adapter, repository, controller, clock } = await fixture(t);
      const tabId = await loadedRoot(firefox);
      const policy = structuredClone(controller.getView().snapshot.policy);
      const reached = current(adapter, tabId).journey;
      const commit = repository.commit.bind(repository);
      const entered = deferred(), release = deferred();
      const saved = [];
      let discarded;
      let hold = true;
      repository.commit = async request => {
        const candidate = request.next.snapshot.journeyState.journeys.find(journey => journey.contextId === reached.contextId);
        if (hold && candidate?.id !== reached.id && candidate?.phase === phase) {
          hold = false;
          discarded = structuredClone(candidate);
          entered.resolve(); await release.promise;
        }
        const receipt = await commit(request);
        if (receipt.type === 'COMMITTED') saved.push(structuredClone(request.next.snapshot.journeyState.journeys));
        return receipt;
      };
      const first = firefox.request(tabId, 'https://auth.example/', { originUrl: 'https://root.example/' });
      let second;
      try {
        await entered.promise;
        assert.equal(firefox.documents.get(tabId).url, 'https://root.example/');
        assert.equal(controller.getView().snapshot.journeyState.journeys.find(journey => journey.contextId === reached.contextId).phase,
          phase === 'STARTED' ? 'ENDED' : 'STARTED');
        clock.time += 20;
        second = firefox.request(tabId, `https://${nextHostname}/`, { originUrl: 'https://root.example/' });
      } finally { release.resolve(); }
      assert.equal((await first).cancel, true, 'the first request is superseded before it can release');
      assert.deepEqual(await second, {}, 'a discarded save cannot strand the physically loaded Whitelist root');
      const fresh = current(adapter, tabId).journey;
      assert.notEqual(fresh.id, discarded.id);
      assert.equal(fresh.phase, 'IN_TRANSIT');
      assert.equal(fresh.currentHostname, nextHostname);
      assert.equal(fresh.rootHostname, 'root.example');
      assert.equal(fresh.startedAt, clock.time);
      assert.equal(fresh.expiresAt, clock.time + configuration.journeyLimits.lifetimeMs);
      assert.equal(fresh.hopCount, 1);
      assert.equal(saved.some(records => records.some(journey => journey.id === discarded.id && journey.endReason === 'CONTEXT_CLOSED')), true,
        'the unexecuted saved attempt must end before a fresh one replaces it');
      assert.deepEqual(controller.getView().snapshot.policy, policy);
      assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
    }
  }
});

test('failed or unknown abandonment commits block the superseding root departure without publishing a replacement', { timeout: 3000 }, async t => {
  for (const phase of ['STARTED', 'IN_TRANSIT']) {
    for (const outcome of ['NOT_WRITTEN', 'UNKNOWN']) {
      const { firefox, adapter, repository, controller, clock } = await fixture(t);
      const tabId = await loadedRoot(firefox);
      const reached = current(adapter, tabId).journey;
      const commit = repository.commit.bind(repository);
      const entered = deferred(), release = deferred();
      let hold = true;
      let discarded;
      let failedClosure = false;
      repository.commit = async request => {
        const candidate = request.next.snapshot.journeyState.journeys.find(journey => journey.contextId === reached.contextId);
        if (hold && candidate?.id !== reached.id && candidate?.phase === phase) {
          hold = false;
          discarded = structuredClone(candidate);
          entered.resolve(); await release.promise;
        }
        if (candidate?.id === discarded?.id && candidate?.endReason === 'CONTEXT_CLOSED') {
          failedClosure = true;
          if (outcome === 'UNKNOWN') await commit(request);
          return { type: outcome, commitId: request.commitId };
        }
        return commit(request);
      };
      const first = firefox.request(tabId, 'https://auth.example/', { originUrl: 'https://root.example/' });
      let second;
      try {
        await entered.promise;
        clock.time += 20;
        second = firefox.request(tabId, 'https://other-auth.example/', { originUrl: 'https://root.example/' });
      } finally { release.resolve(); }
      assert.equal((await first).cancel, true);
      assert.equal((await second).cancel, true, `${phase} ${outcome}`);
      assert.equal(failedClosure, true, 'the discarded saved attempt cannot be replaced without acknowledged closure');
      assert.equal(controller.getView().status, outcome === 'UNKNOWN' ? 'RECONCILING' : 'UNAVAILABLE');
      const snapshot = controller.getView().snapshot;
      const saved = snapshot.journeyState.journeys.find(journey => journey.contextId === reached.contextId);
      assert.equal(saved.id, discarded.id);
      assert.equal(saved.phase, phase);
      assert.equal(saved.expiresAt, discarded.expiresAt);
      assert.equal(snapshot.journeyState.nextJourneyId, discarded.id + 1, 'no replacement ID has been allocated');
      assert.deepEqual(snapshot.accessState.grants, []);
      const diagnostics = await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId });
      assert.equal(diagnostics.entries.some(entry => entry.navigationId === current(adapter, tabId).navigationId && entry.event === 'RELEASED'), false);
    }
  }
});
