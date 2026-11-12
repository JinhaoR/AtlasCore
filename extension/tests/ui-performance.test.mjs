import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '@atlas/core';
import { destinationIndex, policyDestinationIndex } from '../dist/lib/ui/destinations.js';
import { initializeSites } from '../dist/lib/ui/sites.js';
import { sitesFixture, original } from './support/ui-fixture.mjs';
import { deferred } from './support/fixture.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));

test('directory display projection invalidates on policy changes and never supplies authority', async t => {
  const f = await sitesFixture(t), committed = structuredClone(f.controller.getView());
  let shown = structuredClone(committed);
  f.settings.controller = () => shown;
  f.sites.render(true);
  const row = f.el('sites-list').children.find(n => n.dataset.destinationId === original.id);
  assert.match(row.textContent, /Allowed/);
  for (let i=0;i<10;i++) { shown = structuredClone(shown); f.sites.render(true); }
  assert.equal(f.el('sites-list').children.find(n => n.dataset.destinationId === original.id), row);
  shown.snapshot.policy.blacklist.push(original.primaryHostname);
  shown.snapshot.policyRevision++;
  f.sites.render(true);
  assert.match(row.textContent, /Blocked/);
  f.el('sites-filter').value = 'WHITELIST'; f.sites.render(true);
  assert.ok(!f.el('sites-list').children.includes(row));
  f.el('sites-filter').value = 'BLACKLIST'; f.sites.render(true);
  assert.ok(f.el('sites-list').children.includes(row));
  shown.snapshot.policy.blacklist = []; f.sites.render(true);
  assert.ok(!f.el('sites-list').children.includes(row));
  shown.snapshot.policy.whitelist.push('*.invalid.example'); f.el('sites-filter').value = 'ALL'; f.sites.render(false);
  assert.equal(f.el('sites-list').children.length, 0);
  assert.deepEqual(f.controller.getView(), committed);
  assert.equal(f.proposals(), 0);
});
async function add(f, host) {
  f.el('add-site').fire('click'); f.el('site-name').value = host; f.el('site-hostname').value = host;
  f.el('site-access').value = 'WHITELIST'; f.el('site-category').value = 'Research'; await f.stage();
}

test('all-terms presentation retains grouping, metadata and Blacklist precedence without becoming authority', () => {
  const policy = { whitelist: ['github.com', 'www.github.com', 'custom.example'], blacklist: ['github.com', 'denied.example'] };
  const metadata = [{ id: 'mine', label: 'Mine', category: 'Books', primaryHostname: 'custom.example', hostnames: ['custom.example', 'missing.example'] }];
  const before = structuredClone(policy);
  const expected = destinationIndex({ whitelist: [...new Set([...policy.whitelist, ...policy.blacklist])], blacklist: [] }, metadata);
  for (let i = 0; i < 20; i++) assert.deepEqual(policyDestinationIndex(policy, metadata), expected);
  assert.deepEqual(policy, before);
  assert.equal(evaluate('github.com', policy).reason, 'BLACKLISTED');
  assert.equal(evaluate('missing.example', policy).outcome, 'GREYLIST');
  assert.deepEqual(policyDestinationIndex({ whitelist: ['valid.example', '*.invalid.example'], blacklist: [] }, metadata), []);
});

test('uncommitted additions and edits retain existing Sites and draft controls and exact targets', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  const committed = [...f.el('sites-list').children];
  await add(f, 'one.example'); const row = f.el('destination-draft-items').children[0];
  const content = row.children[0], edit = row.children[1].children[0]; edit.focus();
  await add(f, 'two.example');
  assert.deepEqual(f.el('sites-list').children, committed);
  assert.equal(f.el('destination-draft-items').children[0], row);
  assert.equal(row.children[0], content); assert.equal(row.children[1].children[0], edit);
  edit.fire('click'); f.sites.render(true); f.el('site-name').value = 'Updated one'; await f.stage();
  assert.equal(f.el('destination-draft-items').children[0], row);
  assert.equal(row.children[1].children[0], edit);
  assert.match(content.children.map(n => n.textContent).join('\n'), /Updated one/);
  assert.equal(f.sites.session().value.draft.changes[0].after.metadata.primaryHostname, 'one.example');
  row.children[1].children.find(n => n.dataset.draftAction === 'REMOVE').fire('click'); await f.flush(); f.sites.render(true);
  assert.equal(f.el('destination-draft-items').children.length, 1);
  assert.equal(f.el('destination-draft-items').children[0].dataset.destinationId, 'host:two.example');
  assert.deepEqual(f.controller.getView().snapshot, before); assert.equal(f.proposals(), 0);
});

test('reused committed rows update display labels and continue selecting the current exact destination', async t => {
  const f = await sitesFixture(t), row = f.el('sites-list').children.find(n => n.dataset.destinationId === original.id);
  const key = 'atlas-destinations-v1', saved = JSON.parse(f.saved.get(key));
  saved.destinations[0].label = 'Renamed without replacing row'; f.saved.set(key, JSON.stringify(saved));
  for (const notify of window.listeners.storage ?? []) notify({ key }); f.sites.render(true);
  assert.equal(f.el('sites-list').children.find(n => n.dataset.destinationId === original.id), row);
  assert.equal(row.children[0].textContent, saved.destinations[0].label);
  row.fire('click'); f.sites.render(true); f.el('edit-site').fire('click');
  assert.equal(f.el('site-hostname').value, original.primaryHostname);
});

test('closing a view drains its already-queued draft save before closing the owned repository', async t => {
  const f = await sitesFixture(t); await f.flush();
  const repo = f.sites.session().repository, save = repo.save, held = deferred(), began = deferred(); let closed = 0;
  repo.save = async (...args) => { began.resolve(); await held.promise; return save(...args); };
  repo.close = () => { closed++; };
  f.el('add-site').fire('click'); await began.promise;
  for (const callback of window.listeners.pagehide ?? []) callback(); await turn(); assert.equal(closed, 0);
  held.resolve(); await f.sites.idle(); await turn(); assert.equal(closed, 1);
  assert.ok((await f.raw.load()).value.draft.editor, 'the edit is durable before the connection closes');
  window.listeners.pagehide = [];
});

test('a repository that opens after its view closed is closed without loading or subscribing', async t => {
  const f = await sitesFixture(t), held = deferred(); let closed = 0, loaded = 0;
  const sites = initializeSites({ ...f.settings, drafts: held.promise });
  for (const callback of window.listeners.pagehide ?? []) callback();
  held.resolve({ close() { closed++; }, load() { loaded++; throw Error('disposed view must not load'); } });
  await sites.initialized; await turn();
  assert.equal(closed, 1); assert.equal(loaded, 0); assert.equal(sites.session(), null);
  window.listeners.pagehide = [];
});
