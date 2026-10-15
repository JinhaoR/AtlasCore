import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, configuration, deferred } from './support/fixture.mjs';

const current = (adapter, tabId) => adapter.view().contexts.find(context => context.tabId === tabId);
async function transit(f) {
  const tab = await f.firefox.tabs.create({});
  await f.firefox.request(tab.id, 'https://root.example:8443/public-entry');
  await f.firefox.redirect(tab.id, 'https://auth.example/');
  return tab.id;
}

test('saved Journey expiry returns its owning tab to recorded root origin without renewing authority', async t => {
  const f = await fixture(t);
  const id = await transit(f);
  const other = await f.firefox.tabs.create({});
  const journey = current(f.adapter, id).journey;
  f.clock.time = journey.expiresAt;
  await f.adapter.refresh(); await f.firefox.flush();
  assert.equal(f.firefox.updates.at(-1).url, 'https://root.example:8443/');
  assert.equal(f.firefox.updates.at(-1).id, id);
  assert.equal(f.firefox.documents.get(other.id).url, 'about:blank');
  assert.deepEqual(await f.firefox.request(id, 'https://root.example:8443/'), {});
  assert.equal(current(f.adapter, id).journey.id, journey.id);
  assert.equal(current(f.adapter, id).journey.endReason, 'EXPIRED');
  assert.equal((await f.firefox.redirect(id, 'https://auth.example/')).cancel, true, 'automatic root redirect cannot renew');
  assert.equal(current(f.adapter, id).journey.id, journey.id);
  assert.deepEqual(f.controller.getView().snapshot.accessState.grants, []);
});

test('a synthetic return and unattributed reload cannot renew; browser-attested root arrival permits a fresh departure', async t => {
  const f = await fixture(t);
  const id = await transit(f);
  const old = current(f.adapter, id).journey;
  f.clock.time = old.expiresAt;
  await f.adapter.refresh(); await f.firefox.flush();
  await f.firefox.request(id, 'https://root.example/'); // Browser canonicalizes the saved port.
  f.firefox.arrive(id, 'https://root.example/', { transitionType: 'typed' }); await f.firefox.flush();
  assert.equal((await f.firefox.visit(id, 'https://auth.example/', { originUrl: 'https://root.example/' })).cancel, true);
  assert.equal(current(f.adapter, id).journey.id, old.id);
  await f.firefox.request(id, 'https://root.example:8443/');
  f.firefox.arrive(id, 'https://root.example:8443/', { transitionType: 'reload' }); await f.firefox.flush();
  assert.equal(current(f.adapter, id).journey.id, old.id);
  assert.equal((await f.firefox.visit(id, 'https://auth.example/', { originUrl: 'https://root.example:8443/' })).cancel, true);
  await f.firefox.request(id, 'https://root.example:8443/');
  f.firefox.arrive(id, 'https://root.example:8443/', { transitionType: 'typed' }); await f.firefox.flush();
  assert.deepEqual(await f.firefox.visit(id, 'https://auth.example/', { originUrl: 'https://root.example:8443/' }), {});
  assert.notEqual(current(f.adapter, id).journey.id, old.id, 'attested user arrival allows the next loaded-root departure');
  assert.equal((await f.firefox.request(id, 'https://unrelated.example/')).cancel, true);
});

test('current root denial and failed, conflicting or unknown expiry persistence prevent a timeout return', async t => {
  for (const mode of ['POLICY', 'NOT_WRITTEN', 'CONFLICT', 'UNKNOWN']) {
    const f = await fixture(t);
    const id = await transit(f);
    const journey = current(f.adapter, id).journey;
    if (mode === 'POLICY') {
      await f.controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: [], blacklist: ['root.example'] } });
      const proposal = f.controller.getView().snapshot.vaultState.pendingProposal;
      f.clock.time += configuration.vaultTiming.waitMs;
      assert.equal((await f.controller.handle({ kind: 'CONFIRM_POLICY', proposalId: proposal.id })).type, 'COMMITTED');
    } else f.repository.commit = async request => ({ type: mode, commitId: request.commitId });
    f.clock.time = journey.expiresAt;
    await f.adapter.refresh(); await f.firefox.flush();
    assert.ok(!f.firefox.updates.some(update => update.url === 'https://root.example:8443/'));
    assert.ok(f.firefox.updates.at(-1).url.startsWith(f.adapter.uiUrl));
    assert.equal((await f.firefox.request(id, 'https://auth.example/')).cancel, true);
  }
});

test('closed and superseded contexts never receive delayed timeout navigation', async t => {
  for (const mode of ['CLOSED', 'SUPERSEDED']) {
    const f = await fixture(t);
    const id = await transit(f);
    f.clock.time = current(f.adapter, id).journey.expiresAt;
    const entered = deferred(), release = deferred();
    const commit = f.repository.commit.bind(f.repository);
    let first = true;
    f.repository.commit = async request => { if (first) { first = false; entered.resolve(); await release.promise; } return commit(request); };
    const refresh = f.adapter.refresh();
    await entered.promise;
    let next;
    if (mode === 'CLOSED') await f.firefox.tabs.remove(id);
    else next = f.firefox.request(id, 'https://unrelated.example/');
    release.resolve();
    await refresh; await f.firefox.flush();
    if (next) assert.equal((await next).cancel, true);
    assert.ok(!f.firefox.updates.some(update => update.id === id && update.url === 'https://root.example:8443/'));
  }
});

test('popularity records intentional launches and typed arrivals, excluding resources, redirects and intermediates', async t => {
  const launches = [];
  const f = await fixture(t, true, { onDestinationLaunch: (hostname, at) => launches.push({ hostname, at }) });
  const opened = await f.firefox.send({ kind: 'OPEN_DESTINATION', url: 'https://root.example/' });
  await f.firefox.request(opened.tabId, 'https://root.example/');
  await f.firefox.redirect(opened.tabId, 'https://auth.example/');
  assert.deepEqual(launches.map(item => item.hostname), ['root.example']);
  await f.firefox.request(opened.tabId, 'https://root.example/image', { type: 'image' });
  assert.equal(launches.length, 1);
  const tab = await f.firefox.tabs.create({});
  await f.firefox.request(tab.id, 'https://root.example/');
  f.firefox.arrive(tab.id, 'https://root.example/', { transitionType: 'typed' }); await f.firefox.flush();
  assert.deepEqual(launches.map(item => item.hostname), ['root.example', 'root.example']);
});

test('a destination draft is rejected when its base revision is stale, including malformed revisions', async t => {
  const f = await fixture(t);
  const policy = f.controller.getView().snapshot.policy;
  const revision = f.controller.getView().snapshot.policyRevision;
  for (const basePolicyRevision of [-1, '0', revision + 1]) {
    const response = await f.firefox.send({ kind: 'PROPOSE_POLICY', candidatePolicy: policy, basePolicyRevision });
    assert.equal(response.error, typeof basePolicyRevision === 'number' && basePolicyRevision >= 0 ? 'POLICY_DRAFT_STALE' : 'INVALID_COMMAND');
    assert.equal(f.controller.getView().snapshot.vaultState.pendingProposal, null);
    assert.deepEqual(f.controller.getView().snapshot.policy, policy);
  }
  const proposed = await f.firefox.send({ kind: 'PROPOSE_POLICY', candidatePolicy: { ...policy, whitelist: [...policy.whitelist, 'new.example'] }, basePolicyRevision: revision });
  assert.equal(proposed.result.type, 'COMMITTED');
  assert.deepEqual(f.controller.getView().snapshot.policy, policy);
});
