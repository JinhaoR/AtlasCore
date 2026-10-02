import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, configuration, deferred } from './support/fixture.mjs';

const current = (adapter, tabId) => adapter.view().contexts.find(context => context.tabId === tabId);

async function intermediate(firefox, arrive = true) {
  const tab = await firefox.tabs.create({});
  await firefox.request(tab.id, 'https://root.example/');
  await firefox.redirect(tab.id, 'https://auth.example/', arrive);
  return tab.id;
}

test('a same-host action following browser arrival waits for its checkpoint without losing the observed document', async t => {
  const { firefox, adapter, repository, clock, controller } = await fixture(t);
  const tabId = await intermediate(firefox, false);
  const journey = current(adapter, tabId).journey;
  const commit = repository.commit.bind(repository);
  const entered = deferred(), release = deferred();
  let hold = true;
  repository.commit = async request => {
    if (hold) { hold = false; entered.resolve(); await release.promise; }
    return commit(request);
  };
  clock.time++;
  firefox.arrive(tabId, 'https://auth.example/');
  await entered.promise;
  const navigation = firefox.request(tabId, 'https://auth.example/choose', { originUrl: 'https://auth.example/' });
  release.resolve();
  assert.deepEqual(await navigation, {}, 'the observed same-host document action must retain the saved Journey');
  assert.equal(current(adapter, tabId).journey.id, journey.id);
  assert.equal(current(adapter, tabId).journey.phase, 'IN_TRANSIT');
  assert.equal(current(adapter, tabId).journey.hopCount, 1);
  assert.equal(current(adapter, tabId).journey.expiresAt, journey.expiresAt);
  assert.deepEqual(await firefox.redirect(tabId, 'https://identity.example/'), {});
  assert.equal(current(adapter, tabId).journey.hopCount, 2);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('a same-host action immediately after matched arrival retains the Journey before the arrival queue has run', async t => {
  const { firefox, adapter, controller } = await fixture(t);
  const tabId = await intermediate(firefox, false);
  const journey = current(adapter, tabId).journey;
  firefox.arrive(tabId, 'https://auth.example/');
  // No flush or microtask yield: the new request supersedes queued arrival handling.
  const navigation = firefox.request(tabId, 'https://auth.example/choose', { originUrl: 'https://auth.example/' });
  assert.deepEqual(await navigation, {});
  assert.equal(current(adapter, tabId).journey.id, journey.id);
  assert.equal(current(adapter, tabId).journey.phase, 'IN_TRANSIT');
  assert.equal(current(adapter, tabId).journey.hopCount, 1);
  assert.equal(current(adapter, tabId).journey.expiresAt, journey.expiresAt);
  assert.deepEqual(await firefox.redirect(tabId, 'https://identity.example/'), {});
  assert.equal(current(adapter, tabId).journey.hopCount, 2);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('matched root arrival followed immediately by login records completion before creating a fresh Journey', async t => {
  const { firefox, adapter, repository, clock, controller } = await fixture(t);
  const tab = await firefox.tabs.create({});
  await firefox.request(tab.id, 'https://root.example/');
  const first = current(adapter, tab.id).journey;
  const commit = repository.commit.bind(repository);
  const saved = [];
  repository.commit = async request => {
    const receipt = await commit(request);
    if (receipt.type === 'COMMITTED') saved.push(structuredClone(request.next.snapshot.journeyState.journeys));
    return receipt;
  };
  clock.time++;
  firefox.arrive(tab.id, 'https://root.example/');
  const login = firefox.request(tab.id, 'https://root.example/login', { originUrl: 'https://root.example/' });
  assert.deepEqual(await login, {});
  assert.equal(saved.some(records => records.some(journey => journey.id === first.id && journey.endReason === 'REACHED')), true,
    'the superseded publication must still commit the actual root completion');
  const fresh = current(adapter, tab.id).journey;
  assert.notEqual(fresh.id, first.id);
  assert.equal(fresh.startedAt, clock.time);
  assert.equal(fresh.phase, 'STARTED');
  assert.equal(fresh.hopCount, 0);
  assert.deepEqual(await firefox.redirect(tab.id, 'https://auth.example/'), {});
  assert.equal(current(adapter, tab.id).journey.id, fresh.id);
  assert.equal(current(adapter, tab.id).journey.expiresAt, fresh.expiresAt);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('an unmatched restored arrival followed immediately by a same-host action cannot borrow the old Journey', async t => {
  const { firefox, adapter, controller } = await fixture(t);
  const tabId = await intermediate(firefox);
  const journey = current(adapter, tabId).journey;
  firefox.arrive(tabId, 'https://auth.example/');
  const navigation = firefox.request(tabId, 'https://auth.example/choose', { originUrl: 'https://auth.example/' });
  assert.equal((await navigation).cancel, true);
  assert.equal(current(adapter, tabId).journey.id, journey.id);
  assert.equal(current(adapter, tabId).journey.phase, 'ENDED');
  assert.equal(current(adapter, tabId).journey.endReason, 'CONTEXT_CLOSED');
  assert.equal(current(adapter, tabId).latest.decision.outcome, 'GREYLIST');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('failed or uncertain superseded arrival commits cannot release the immediately following held request', async t => {
  for (const outcome of ['NOT_WRITTEN', 'UNKNOWN']) {
    for (const host of ['root.example', 'auth.example']) {
      const { firefox, adapter, repository, clock, controller } = await fixture(t);
      const tabId = host === 'auth.example' ? await intermediate(firefox, false) : (await firefox.tabs.create({})).id;
      if (host === 'root.example') await firefox.request(tabId, 'https://root.example/');
      const before = structuredClone(controller.getView().snapshot);
      const commit = repository.commit.bind(repository);
      const attempted = [];
      repository.commit = async request => {
        attempted.push(request.next.snapshot);
        // Simulate a real successful write whose acknowledgement cannot be trusted.
        if (outcome === 'UNKNOWN') await commit(request);
        return { type: outcome, commitId: request.commitId };
      };
      clock.time++;
      firefox.arrive(tabId, `https://${host}/`);
      const navigation = firefox.request(tabId, `https://${host}/next`, { originUrl: `https://${host}/` });
      assert.equal((await navigation).cancel, true, `${host} ${outcome}`);
      assert.equal(attempted.length, 1, 'the following request cannot attempt another permission transition after the arrival save fails');
      assert.equal(controller.getView().status, outcome === 'UNKNOWN' ? 'RECONCILING' : 'UNAVAILABLE');
      assert.deepEqual(controller.getView().snapshot, before, 'an unacknowledged candidate cannot become the published authority');
      assert.equal(current(adapter, tabId).latest.type, 'BLOCKED');
      assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
      const diagnostics = await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId });
      const navigationId = current(adapter, tabId).navigationId;
      assert.equal(diagnostics.entries.some(entry => entry.navigationId === navigationId && entry.event === 'RELEASED'), false);
    }
  }
});

test('duplicate or out-of-order old arrivals cannot replace newer document facts or end its fresh Journey', async t => {
  const { firefox, adapter, controller } = await fixture(t);
  const tab = await firefox.tabs.create({});
  await firefox.request(tab.id, 'https://root.example/');
  const oldArrivalTime = firefox.eventTime;
  const oldArrival = { tabId: tab.id, frameId: 0, url: 'https://root.example/', timeStamp: oldArrivalTime };
  firefox.arrive(tab.id, 'https://root.example/');
  const login = firefox.request(tab.id, 'https://root.example/login', { originUrl: 'https://root.example/' });
  firefox.webNavigation.onCommitted.emit(oldArrival);
  assert.deepEqual(await login, {});
  await firefox.flush();
  const fresh = current(adapter, tab.id).journey;
  assert.equal(fresh.phase, 'STARTED');
  assert.deepEqual(await firefox.redirect(tab.id, 'https://auth.example/'), {});
  assert.equal(current(adapter, tab.id).displayedHostname, 'auth.example');
  // Late callback delivery does not change the actual current browser document.
  firefox.webNavigation.onCommitted.emit(oldArrival);
  firefox.webNavigation.onCommitted.emit({ ...oldArrival, timeStamp: oldArrivalTime - 1 });
  const navigation = firefox.request(tab.id, 'https://auth.example/choose', { originUrl: 'https://auth.example/' });
  assert.deepEqual(await navigation, {});
  assert.equal(current(adapter, tab.id).displayedHostname, 'auth.example');
  assert.equal(current(adapter, tab.id).journey.id, fresh.id);
  assert.equal(current(adapter, tab.id).journey.phase, 'IN_TRANSIT');
  assert.equal(current(adapter, tab.id).journey.hopCount, 1);
  assert.equal(current(adapter, tab.id).journey.expiresAt, fresh.expiresAt);
  assert.deepEqual(await firefox.redirect(tab.id, 'https://identity.example/'), {});
  assert.equal(current(adapter, tab.id).journey.id, fresh.id);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('a still-displayed expired intermediate is removed before its root Journey can be retried', async t => {
  const { firefox, adapter, clock, controller } = await fixture(t);
  const tabId = await intermediate(firefox);
  const old = current(adapter, tabId).journey;
  firefox.autoArriveUI = false;
  clock.time = old.expiresAt - 1;
  assert.deepEqual(await firefox.request(tabId, 'https://root.example/'), {});
  const interrupted = current(adapter, tabId).journey;
  assert.notEqual(interrupted.id, old.id);
  clock.time = old.expiresAt;
  await adapter.refresh();
  await firefox.flush();
  assert.equal(current(adapter, tabId).journey.phase, 'ENDED', 'a pending root request cannot retain expired intermediate content');
  assert.equal(current(adapter, tabId).effect, 'REMOVING');
  const updates = firefox.updates.length;
  const waiting = await firefox.send({ kind: 'RESTART_JOURNEY', tabId, journeyId: interrupted.id });
  assert.equal(waiting.error, 'JOURNEY_RETRY_UNAVAILABLE', 'lost-binding records do not become eligible retry records');
  assert.notEqual(waiting.opened, true);
  assert.equal(firefox.updates.length, updates);
  firefox.arrive(tabId, firefox.updates.at(-1).url);
  await firefox.flush();
  assert.equal(current(adapter, tabId).effect, 'REMOVED');
  await firefox.send({ kind: 'OPEN_HOME', tabId });
  assert.equal(firefox.updates.at(-1).url, 'https://root.example/');
  assert.deepEqual(await firefox.request(tabId, 'https://root.example/'), {});
  const fresh = current(adapter, tabId).journey;
  assert.notEqual(fresh.id, interrupted.id);
  await adapter.refresh();
  assert.equal(current(adapter, tabId).journey.phase, 'STARTED', 'acknowledged removal clears the old document assessment');
  assert.deepEqual(await firefox.redirect(tabId, 'https://auth.example/'), {});
  assert.equal(current(adapter, tabId).journey.phase, 'IN_TRANSIT');
  assert.equal(current(adapter, tabId).journey.expiresAt, fresh.expiresAt);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('delayed arrival does not authorize cross-host actions or a mismatched claimed source', async t => {
  for (const attempt of ['cross-host', 'source-mismatch']) {
    const { firefox, adapter, repository, clock, controller } = await fixture(t);
    const tabId = await intermediate(firefox, false);
    const policy = structuredClone(controller.getView().snapshot.policy);
    const commit = repository.commit.bind(repository);
    const entered = deferred(), release = deferred();
    let hold = true;
    repository.commit = async request => {
      if (hold) { hold = false; entered.resolve(); await release.promise; }
      return commit(request);
    };
    clock.time++;
    firefox.arrive(tabId, 'https://auth.example/');
    await entered.promise;
    const navigation = firefox.request(tabId, attempt === 'cross-host' ? 'https://unexpected.example/' : 'https://auth.example/choose',
      { originUrl: attempt === 'cross-host' ? 'https://auth.example/' : 'https://root.example/' });
    release.resolve();
    assert.equal((await navigation).cancel, true, attempt);
    assert.equal(current(adapter, tabId).journey.endReason, 'UNRELATED_NAVIGATION', attempt);
    assert.deepEqual(controller.getView().snapshot.policy, policy);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  }
});

test('retry after interruption waits for actual content removal, then the expired old assessment cannot veto the fresh root', async t => {
  const { firefox, adapter, clock, controller } = await fixture(t);
  const tabId = await intermediate(firefox);
  const old = current(adapter, tabId).journey;
  firefox.autoArriveUI = false;
  assert.equal((await firefox.visit(tabId, 'https://google.com/')).cancel, true);
  assert.equal(current(adapter, tabId).effect, 'REMOVING');
  clock.time = old.expiresAt + 1;
  const updates = firefox.updates.length;
  const waiting = await firefox.send({ kind: 'RESTART_JOURNEY', tabId, journeyId: old.id });
  assert.equal(waiting.error, 'CONTENT_REMOVAL_IN_PROGRESS');
  assert.equal(waiting.opened, false);
  assert.equal(firefox.updates.length, updates);
  firefox.arrive(tabId, firefox.updates.at(-1).url);
  await firefox.flush();
  assert.equal(current(adapter, tabId).effect, 'REMOVED');
  assert.equal((await firefox.send({ kind: 'RESTART_JOURNEY', tabId, journeyId: old.id })).opened, true);
  assert.deepEqual(await firefox.request(tabId, 'https://root.example/'), {});
  const fresh = current(adapter, tabId).journey;
  assert.notEqual(fresh.id, old.id);
  // Firefox may publish the requested URL before delivering its document commit.
  firefox.documents.get(tabId).url = 'https://root.example/';
  await adapter.refresh();
  await firefox.flush();
  assert.equal(current(adapter, tabId).journey.id, fresh.id);
  assert.equal(current(adapter, tabId).journey.phase, 'STARTED');
  assert.equal(current(adapter, tabId).journey.expiresAt, clock.time + configuration.journeyLimits.lifetimeMs);
  assert.deepEqual(await firefox.redirect(tabId, 'https://auth.example/'), {});
  assert.equal(current(adapter, tabId).journey.phase, 'IN_TRANSIT');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('actual root arrival replaces old document facts before its delayed checkpoint and the following login request', async t => {
  const { firefox, adapter, repository, clock, controller } = await fixture(t);
  const tabId = await intermediate(firefox);
  const old = current(adapter, tabId).journey;
  clock.time = old.expiresAt - 1;
  assert.deepEqual(await firefox.request(tabId, 'https://root.example/'), {});
  const commit = repository.commit.bind(repository);
  const entered = deferred(), release = deferred();
  let hold = true;
  repository.commit = async request => {
    if (hold) { hold = false; entered.resolve(); await release.promise; }
    return commit(request);
  };
  clock.time = old.expiresAt;
  firefox.arrive(tabId, 'https://root.example/');
  await entered.promise;
  const login = firefox.request(tabId, 'https://root.example/login', { originUrl: 'https://root.example/' });
  release.resolve();
  assert.deepEqual(await login, {});
  const fresh = current(adapter, tabId).journey;
  assert.notEqual(fresh.id, old.id);
  assert.equal(fresh.phase, 'STARTED');
  await adapter.refresh();
  await firefox.flush();
  assert.equal(current(adapter, tabId).journey.id, fresh.id);
  assert.equal(current(adapter, tabId).journey.phase, 'STARTED', 'the physically departed authentication document cannot supply a retained-content veto');
  assert.deepEqual(await firefox.redirect(tabId, 'https://auth.example/'), {});
  assert.equal(current(adapter, tabId).journey.phase, 'IN_TRANSIT');
  assert.equal(current(adapter, tabId).journey.expiresAt, fresh.expiresAt);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('a restored root arrival completes the browser launch watchdog without reconstructing redirect authority', async t => {
  const { firefox, adapter, controller } = await fixture(t);
  const tabId = await intermediate(firefox);
  await firefox.visit(tabId, 'https://google.com/');
  const old = current(adapter, tabId).journey;
  assert.equal((await firefox.send({ kind: 'RESTART_JOURNEY', tabId, journeyId: old.id })).opened, true);
  // A cached/history document can arrive without a corresponding held network request.
  firefox.arrive(tabId, 'https://root.example/');
  await firefox.flush();
  assert.equal(current(adapter, tabId).latest.decision.reason, 'WHITELISTED');
  assert.equal(current(adapter, tabId).journey.id, old.id);
  assert.equal(current(adapter, tabId).journey.phase, 'ENDED');
  firefox.runTimers(10_000);
  await firefox.flush();
  assert.equal(firefox.documents.get(tabId).url, 'https://root.example/', 'an actual root arrival must not time out as a failed launch');
  assert.equal(current(adapter, tabId).latest.decision.reason, 'WHITELISTED');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  assert.deepEqual(await firefox.visit(tabId, 'https://auth.example/', { originUrl: 'https://root.example/' }), {},
    'an actually displayed and rechecked Whitelist root can start a new bounded departure');
  assert.notEqual(current(adapter, tabId).journey.id, old.id);
  assert.equal(current(adapter, tabId).journey.phase, 'IN_TRANSIT');
  assert.equal(old.phase, 'ENDED', 'the saved old record is never revived');
});

test('same-tab root navigation supersedes a denied Google request before its removal effect runs', async t => {
  const { firefox, adapter, clock, controller } = await fixture(t);
  const tabId = await intermediate(firefox);
  const old = current(adapter, tabId).journey;
  const updates = firefox.updates.length;
  assert.equal((await firefox.request(tabId, 'https://google.com/')).cancel, true);
  assert.equal(current(adapter, tabId).journey.endReason, 'UNRELATED_NAVIGATION');
  clock.time += 20;
  assert.deepEqual(await firefox.request(tabId, 'https://root.example/'), {});
  const fresh = current(adapter, tabId).journey;
  assert.notEqual(fresh.id, old.id);
  assert.equal(fresh.startedAt, clock.time);
  assert.equal(fresh.hopCount, 0);
  await firefox.flush();
  assert.equal(firefox.updates.length, updates, 'the superseded denial must not navigate to its access page');
  assert.deepEqual(await firefox.redirect(tabId, 'https://auth.example/'), {});
  assert.equal(current(adapter, tabId).journey.id, fresh.id);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('a delayed private access-page arrival cannot discard a newer root request or its HTTP redirect', async t => {
  const { firefox, adapter } = await fixture(t);
  const tabId = await intermediate(firefox);
  const update = firefox.tabs.update;
  const entered = deferred(), release = deferred();
  firefox.tabs.update = async (id, changes) => {
    if (changes.url?.startsWith('moz-extension:')) { entered.resolve(); await release.promise; }
    return update(id, changes);
  };
  assert.equal((await firefox.request(tabId, 'https://google.com/')).cancel, true);
  firefox.runTimers();
  await entered.promise;
  const navigation = firefox.request(tabId, 'https://root.example/');
  release.resolve();
  assert.deepEqual(await navigation, {});
  await firefox.flush();
  assert.equal(current(adapter, tabId).journey.phase, 'STARTED');
  firefox.runTimers(3000);
  await firefox.flush();
  assert.equal(firefox.documents.has(tabId), true, 'the old removal watchdog must not close the newer navigation');
  assert.deepEqual(await firefox.redirect(tabId, 'https://auth.example/'), {});
  assert.equal(current(adapter, tabId).journey.phase, 'IN_TRANSIT');
  assert.equal(firefox.documents.get(tabId).url, 'https://auth.example/');
});

test('login from a loaded root starts a new Journey only through its ordinary same-host request', async t => {
  const { firefox, adapter, controller } = await fixture(t);
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://root.example/');
  const previous = current(adapter, tab.id).journey;
  assert.equal(previous.endReason, 'REACHED');
  assert.deepEqual(await firefox.request(tab.id, 'https://root.example/login', { originUrl: 'https://root.example/' }), {});
  const login = current(adapter, tab.id).journey;
  assert.notEqual(login.id, previous.id);
  assert.equal(login.phase, 'STARTED');
  assert.deepEqual(await firefox.redirect(tab.id, 'https://auth.example/'), {});
  assert.equal(current(adapter, tab.id).journey.id, login.id);
  assert.equal(current(adapter, tab.id).journey.phase, 'IN_TRANSIT');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('startup reconciliation retains an existing root without inventing a Journey, then its root login request can start one', async t => {
  const { firefox, adapter, controller } = await fixture(t);
  const tab = await firefox.tabs.create({ url: 'https://root.example/course' });
  await adapter.refresh();
  assert.equal(current(adapter, tab.id).latest.decision.reason, 'WHITELISTED');
  assert.equal(current(adapter, tab.id).journey, null);
  assert.deepEqual(controller.getView().snapshot.journeyState.journeys, []);
  assert.deepEqual(await firefox.request(tab.id, 'https://root.example/login', { originUrl: 'https://root.example/course' }), {});
  assert.deepEqual(await firefox.redirect(tab.id, 'https://auth.example/'), {});
  assert.equal(current(adapter, tab.id).journey.phase, 'IN_TRANSIT');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('rechecking the old page during removal preserves the blocked destination and original removal watchdog', async t => {
  const { firefox, adapter, controller } = await fixture(t);
  const tabId = await intermediate(firefox);
  firefox.autoArriveUI = false;
  assert.equal((await firefox.request(tabId, 'https://google.com/')).cancel, true);
  firefox.runTimers();
  await adapter.whenIdle();
  assert.equal(current(adapter, tabId).effect, 'REMOVING');
  assert.equal(firefox.documents.get(tabId).url, 'https://auth.example/');
  const watchdog = [...firefox.timers.entries()].filter(([, timer]) => timer.delay === 3000).map(([id]) => id);
  const updates = firefox.updates.length;
  await adapter.refresh();
  assert.equal(current(adapter, tabId).hostname, 'google.com');
  assert.equal(current(adapter, tabId).latest.decision.target.hostname, 'google.com');
  assert.equal(current(adapter, tabId).latest.decision.outcome, 'GREYLIST');
  assert.equal(current(adapter, tabId).effect, 'REMOVING');
  assert.equal(firefox.updates.length, updates, 'removal must not restart on every old-document observation');
  assert.deepEqual([...firefox.timers.entries()].filter(([, timer]) => timer.delay === 3000).map(([id]) => id), watchdog);
  firefox.arrive(tabId, firefox.updates.at(-1).url);
  await firefox.flush();
  assert.equal(current(adapter, tabId).effect, 'REMOVED');
  assert.equal(current(adapter, tabId).hostname, 'google.com');
  assert.equal(current(adapter, tabId).latest.decision.target.hostname, 'google.com');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});
