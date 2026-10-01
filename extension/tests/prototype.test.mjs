import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './support/fixture.mjs';

test('views remain responsive while a save is pending and expose no candidate grant', async (t) => {
  const { firefox, repository, clock } = await fixture(t);
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://unknown.example/');
  const requestId = (await firefox.send({ kind: 'START_ACCESS', tabId: tab.id })).result.referenceId;
  clock.time += 10;
  const entered = deferred(); const release = deferred();
  const commit = repository.commit.bind(repository);
  repository.commit = async (request) => { entered.resolve(); await release.promise; return commit(request); };
  const pending = firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
  await entered.promise;
  const { view } = await firefox.send({ kind: 'GET_VIEW' });
  assert.equal(view.controller.status, 'COMMITTING');
  assert.deepEqual(view.controller.snapshot.accessState.grants, []);
  assert.ok((await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null })).entries.length > 0);
  release.resolve();
  assert.equal((await pending).opened, true);
});

test('Confirm and open uses one explicit saved confirmation and a fresh gated homepage GET', async (t) => {
  const { firefox, clock, controller } = await fixture(t);
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://unknown.example/private-path?search=not-recorded#section', { method: 'POST' });
  const requestId = (await firefox.send({ kind: 'START_ACCESS', tabId: tab.id })).result.referenceId;
  const before = firefox.updates.length;
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId })).opened, false);
  assert.equal(firefox.updates.length, before);
  clock.time += 10;
  const confirmed = await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
  assert.equal(confirmed.result.type, 'COMMITTED');
  assert.equal(confirmed.opened, true);
  assert.equal(firefox.updates.at(-1).url, 'https://unknown.example/');
  assert.equal((await firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId })).error, 'REQUEST_CONTEXT_CHANGED');
  assert.equal(controller.getView().snapshot.accessState.grants.length, 1);
  assert.deepEqual(await firefox.visit(tab.id, 'https://unknown.example/'), {});
});

test('failed saves and changed contexts never open a confirmed destination', async (t) => {
  for (const change of ['save', 'close', 'navigate']) {
    const { firefox, repository, clock } = await fixture(t);
    const tab = await firefox.tabs.create({});
    await firefox.visit(tab.id, 'https://unknown.example/');
    const requestId = (await firefox.send({ kind: 'START_ACCESS', tabId: tab.id })).result.referenceId;
    clock.time += 10;
    const commit = repository.commit.bind(repository);
    const entered = deferred(); const release = deferred();
    repository.commit = async (request) => {
      entered.resolve(); await release.promise;
      return change === 'save' ? { type: 'NOT_WRITTEN', commitId: request.commitId } : commit(request);
    };
    const before = firefox.updates.length;
    const confirming = firefox.send({ kind: 'CONFIRM_ACCESS_AND_OPEN', tabId: tab.id, requestId });
    await entered.promise;
    let navigation;
    if (change === 'close') await firefox.tabs.remove(tab.id);
    if (change === 'navigate') navigation = firefox.request(tab.id, 'https://root.example/');
    release.resolve();
    assert.equal((await confirming).opened, false, change);
    if (navigation) await navigation;
    assert.equal(firefox.updates.length, before, change);
  }
});

test('rejected Journey launch closes its temporary tab; toolbar reuses a control tab', async (t) => {
  const { firefox, adapter } = await fixture(t);
  const rejected = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://unknown.example/' });
  assert.equal(rejected.result.type, 'REJECTED');
  assert.equal(firefox.documents.size, 0);
  const tab = await firefox.tabs.create({});
  await firefox.visit(tab.id, 'https://unknown.example/');
  firefox.browserAction.onClicked.emit({ id: tab.id });
  await firefox.flush();
  assert.equal(firefox.documents.size, 2, 'blocked view is preserved');
  firefox.browserAction.onClicked.emit({ id: tab.id });
  await firefox.flush();
  assert.equal(firefox.documents.size, 2);
  assert.equal(firefox.badges.get(tab.id), '!');
  assert.equal(adapter.view().contexts.find((context) => context.tabId === tab.id).latest.decision.outcome, 'GREYLIST');
});

test('diagnostics correlate redirects without authorizing them and export only bounded hostname facts', async (t) => {
  const { firefox, controller, adapter } = await fixture(t);
  const { tabId } = await firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  const url = 'https://root.example/private-path?search=not-recorded#section';
  await firefox.request(tabId, url, { requestId: 'raw-browser-id' });
  firefox.webRequest.onBeforeRedirect.emit({ tabId, frameId: 0, type: 'main_frame', requestId: 'raw-browser-id',
    url, redirectUrl: 'https://login.example/another-path?search=not-recorded' });
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].hopCount, 0);
  await firefox.visit(tabId, 'https://login.example/another-path?search=not-recorded', { requestId: 'raw-browser-id' });
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].hopCount, 1);
  const { entries } = await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId });
  const redirect = entries.find((entry) => entry.event === 'REDIRECT');
  assert.equal(redirect.hostname, 'login.example');
  assert.ok(redirect.contextId);
  assert.ok(redirect.navigationId > 0);
  assert.equal(entries.some((entry) => entry.event === 'SUPERSEDED'), false, 'a redirect continuation is not a superseded request');
  const exported = JSON.stringify(entries);
  for (const forbidden of ['private-path', 'not-recorded', 'section', 'raw-browser-id', 'another-path', 'https:'])
    assert.equal(exported.includes(forbidden), false, forbidden);
  const other = await firefox.tabs.create({});
  await firefox.visit(other.id, 'https://root.example/');
  const before = (await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: other.id })).entries.length;
  await adapter.refresh(); await adapter.refresh();
  assert.equal((await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: other.id })).entries.length, before, 'polls do not flood the log');
  for (let i = 0; i < 75; i++) await firefox.visit(other.id, 'https://root.example/');
  const bounded = (await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null })).entries;
  assert.equal(bounded.length, 200);
  assert.ok(bounded.every((entry, index) => index === 0 || entry.sequence > bounded[index - 1].sequence));
  bounded[0].hostname = 'changed';
  assert.notEqual((await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null })).entries[0].hostname, 'changed');
  await firefox.send({ kind: 'CLEAR_DIAGNOSTICS' });
  assert.deepEqual((await firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null })).entries, []);
  for (const kind of ['toString', '__proto__', 'constructor'])
    assert.equal((await firefox.send({ kind })).error, 'INVALID_COMMAND');
  assert.equal((await firefox.send(Object.assign(Object.create({ kind: 'START_ACCESS' }), { tabId, extra: true }))).error, 'INVALID_COMMAND');
});
