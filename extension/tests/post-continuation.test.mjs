import test from 'node:test';
import assert from 'node:assert/strict';
import { compileManagedBlacklist } from '@atlas/core';
import { fixture, configuration, deferred } from './support/fixture.mjs';

const current = (adapter, tabId) => adapter.view().contexts.find(context => context.tabId === tabId);
const root = 'https://student.ladok.se/';
const saml = 'https://saml.example/';
const login = 'https://login.example/';
const policy = { whitelist: ['student.ladok.se'], blacklist: ['blocked.example'] };
async function transit(firefox, arrive = true) {
  const tab = await firefox.tabs.create({});
  await firefox.request(tab.id, root);
  await firefox.redirect(tab.id, saml, false);
  await firefox.redirect(tab.id, login, arrive);
  return tab.id;
}

test('a loaded login POST returns through SAML with one saved Journey and its original deadline', async t => {
  const { firefox, adapter, controller, clock } = await fixture(t, true, { policy });
  const tabId = await transit(firefox);
  const original = current(adapter, tabId).journey;
  clock.time += 100; // A phone interaction takes time, but remains inside the frozen window.
  assert.deepEqual(await firefox.request(tabId, saml, { method: 'POST', originUrl: login }), {});
  const adopted = current(adapter, tabId).journey;
  assert.equal(adopted.id, original.id);
  assert.equal(adopted.currentHostname, 'saml.example');
  assert.equal(adopted.hopCount, 3);
  assert.equal(adopted.expiresAt, original.expiresAt);
  assert.equal(adopted.startedAt, original.startedAt);
  assert.equal(adopted.phase, 'IN_TRANSIT');
  assert.deepEqual(await firefox.redirect(tabId, root), {});
  assert.equal(current(adapter, tabId).journey.endReason, 'RETURNED');
  assert.equal(current(adapter, tabId).journey.id, original.id);
  assert.deepEqual(controller.getView().snapshot.policy, policy);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('an immediate login POST retains matched arrival evidence before queued publication', async t => {
  const { firefox, adapter } = await fixture(t, true, { policy });
  const tabId = await transit(firefox, false);
  const original = current(adapter, tabId).journey;
  firefox.arrive(tabId, login);
  assert.deepEqual(await firefox.request(tabId, saml, { method: 'POST', originUrl: login }), {});
  assert.equal(current(adapter, tabId).journey.id, original.id);
  assert.equal(current(adapter, tabId).journey.expiresAt, original.expiresAt);
});

test('POST continuation requires the actual loaded source origin; later GET and typed POST stay Greylist', async t => {
  for (const options of [
    { method: 'GET', originUrl: login },
    { method: 'POST' },
    { method: 'POST', originUrl: saml },
    { method: 'POST', originUrl: 'http://login.example/' },
    { method: 'POST', originUrl: 'https://login.example:8443/' },
    { method: 'POST', documentUrl: login },
  ]) {
    const { firefox, adapter, controller } = await fixture(t, true, { policy });
    const tabId = await transit(firefox);
    assert.equal((await firefox.visit(tabId, saml, options)).cancel, true, JSON.stringify(options));
    assert.equal(current(adapter, tabId).journey.endReason, 'UNRELATED_NAVIGATION');
    assert.equal(current(adapter, tabId).latest.decision.outcome, 'GREYLIST');
    assert.equal(current(adapter, tabId).retry.endReason, 'UNRELATED_NAVIGATION');
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  }
});

test('unarrived and replaced documents cannot provide POST authority; tabs cannot share it', async t => {
  for (const kind of ['unarrived', 'internal', 'restored', 'other-tab']) {
    const { firefox, adapter } = await fixture(t, true, { policy });
    let tabId = await transit(firefox, kind !== 'unarrived');
    if (kind === 'internal') firefox.arrive(tabId, 'about:blank');
    if (kind === 'restored') { firefox.arrive(tabId, login); await firefox.flush(); }
    if (kind === 'other-tab') tabId = (await firefox.tabs.create({})).id;
    assert.equal((await firefox.request(tabId, saml, { method: 'POST', originUrl: login })).cancel, true, kind);
    assert.equal(current(adapter, tabId).latest.decision.outcome, 'GREYLIST');
  }
});

test('the accepted POST exception is bounded provenance, not an authentication classifier', async t => {
  const { firefox, adapter, controller } = await fixture(t, true, { policy });
  const tabId = await transit(firefox);
  const original = current(adapter, tabId).journey;
  assert.deepEqual(await firefox.visit(tabId, 'https://unrelated.example/', { method: 'POST', originUrl: login }), {});
  assert.equal(current(adapter, tabId).journey.hopCount, 3);
  assert.equal(current(adapter, tabId).journey.expiresAt, original.expiresAt);
  assert.deepEqual(controller.getView().snapshot.policy, policy);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('POST continuation cannot bypass expiry, cancellation, hop exhaustion or current policy revision', async t => {
  for (const boundary of ['expiry', 'cancelled', 'hops', 'revision']) {
    const { firefox, adapter, clock, controller } = await fixture(t, true, { policy });
    const tabId = await transit(firefox);
    const original = current(adapter, tabId).journey;
    let from = login;
    if (boundary === 'expiry') clock.time = original.expiresAt;
    if (boundary === 'cancelled') await firefox.send({ kind: 'CANCEL_JOURNEY', tabId });
    if (boundary === 'hops') {
      await firefox.visit(tabId, saml, { method: 'POST', originUrl: login });
      from = saml;
    }
    if (boundary === 'revision') {
      await controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: { ...policy, whitelist: [...policy.whitelist, 'another.example'] } });
      clock.time += configuration.vaultTiming.waitMs;
      assert.equal((await controller.handle({ kind: 'CONFIRM_POLICY', proposalId: 1 })).type, 'COMMITTED');
    }
    assert.equal((await firefox.request(tabId, 'https://next.example/', { method: 'POST', originUrl: from })).cancel, true, boundary);
    assert.equal(current(adapter, tabId).journey.id, original.id);
    assert.equal(current(adapter, tabId).journey.expiresAt, original.expiresAt);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  }
});

test('manual and managed Blacklist still deny a browser-attested POST', async t => {
  for (const managed of [false, true]) {
    const managedList = compileManagedBlacklist(['managed.example']);
    const { firefox, adapter } = await fixture(t, true, { policy,
      ...(managed ? { managedBlacklist: () => managedList } : {}) });
    const tabId = await transit(firefox);
    const target = managed ? 'https://managed.example/' : 'https://blocked.example/';
    assert.equal((await firefox.request(tabId, target, { method: 'POST', originUrl: login })).cancel, true);
    assert.equal(current(adapter, tabId).latest.decision.reason, managed ? 'MANAGED_BLACKLISTED' : 'BLACKLISTED');
  }
});

test('the POST is held until the new cursor is committed, and a late save cannot extend time', { timeout: 3000 }, async t => {
  for (const expire of [false, true]) {
    const { firefox, adapter, repository, controller, clock } = await fixture(t, true, { policy });
    const tabId = await transit(firefox);
    const original = current(adapter, tabId).journey;
    const commit = repository.commit.bind(repository);
    const entered = deferred(), release = deferred();
    repository.commit = async request => {
      const candidate = request.next.snapshot.journeyState.journeys[0];
      if (candidate.currentHostname === 'saml.example' && candidate.hopCount === 3) {
        entered.resolve(); await release.promise;
      }
      return commit(request);
    };
    let settled = false;
    const navigation = firefox.request(tabId, saml, { method: 'POST', originUrl: login }).then(result => { settled = true; return result; });
    try {
      await entered.promise;
      assert.equal(settled, false);
      assert.equal(controller.getView().status, 'COMMITTING');
      assert.equal(current(adapter, tabId).journey.currentHostname, 'login.example');
      if (expire) clock.time = original.expiresAt;
    } finally { release.resolve(); }
    assert.deepEqual(await navigation, expire ? { cancel: true } : {});
    assert.equal(current(adapter, tabId).journey.expiresAt, original.expiresAt);
  }
});

test('failed, conflicting and unknown POST commits never release the request or create grants', async t => {
  for (const outcome of ['NOT_WRITTEN', 'CONFLICT', 'UNKNOWN']) {
    const { firefox, adapter, repository, controller } = await fixture(t, true, { policy });
    const tabId = await transit(firefox);
    const commit = repository.commit.bind(repository);
    repository.commit = async request => {
      const candidate = request.next.snapshot.journeyState.journeys[0];
      if (candidate.currentHostname === 'saml.example' && candidate.hopCount === 3) {
        if (outcome === 'UNKNOWN') await commit(request);
        return { type: outcome, commitId: request.commitId };
      }
      return commit(request);
    };
    assert.equal((await firefox.request(tabId, saml, { method: 'POST', originUrl: login })).cancel, true, outcome);
    const diagnostics = await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId });
    assert.equal(diagnostics.entries.some(entry => entry.event === 'RELEASED' && entry.navigationId === current(adapter, tabId).navigationId), false);
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  }
});

test('POST diagnostics expose sanitized method/source/continuation and exclude URL details', async t => {
  const { firefox } = await fixture(t, true, { policy });
  const tabId = await transit(firefox);
  assert.deepEqual(await firefox.request(tabId, `${saml}fixture-return?search=not-recorded`,
    { method: 'POST', originUrl: `${login}fixture-source?search=not-recorded` }), {});
  const { entries } = await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId });
  const entry = entries.findLast(item => item.event === 'RELEASED');
  assert.equal(entry.method, 'POST');
  assert.equal(entry.sourceHostname, 'login.example');
  assert.equal(entry.continuationKind, 'FORM_POST');
  const exported = JSON.stringify(entries);
  for (const excluded of ['fixture-source', 'fixture-return', 'not-recorded', 'https://']) assert.equal(exported.includes(excluded), false);
});
