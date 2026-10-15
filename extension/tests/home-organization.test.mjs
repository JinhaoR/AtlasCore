import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { homeCategories, reconcileHomeLayout, changeHomeLayout, displayedHomeCategories, readHomeLayout } from '../dist/lib/ui/home-layout.js';
import { HomeLayoutSession } from '../dist/lib/ui/home-layout-session.js';
import { openHomeLayoutRepository } from '../dist/lib/ui/home-layout-storage.js';
import { destinationIndex, policyDestinationIndex, searchDestinationTargets } from '../dist/lib/ui/destinations.js';
import { pinnedDestinations, destinationId } from '../dist/lib/ui/home-model.js';
import { rankDestinations } from '../dist/lib/ui/destination-usage.js';
import { homeAccessSummary } from '../dist/lib/ui/home-access.js';
import { pendingAccessView } from '../dist/lib/adapter/temporary-access.js';
import { emptyNavigationState, navigationMemory, readNavigationState } from '../dist/lib/ui/navigation-state.js';
import { readVerifiedController } from '../dist/lib/ui/verified-view.js';
import { fixture } from './support/fixture.mjs';
import { sitesFixture, original, metadataKey } from './support/ui-fixture.mjs';

const entry = (category, n = 0) => ({ id: `host:site-${n}.example`, label: `Destination ${n}`, hostname: `site-${n}.example`, hostnames: [`site-${n}.example`], category });
const catalog = homeCategories([entry('University'), entry('Books', 1), entry('Tools', 2), entry('Mail', 3), entry('Research', 4)]);
const initial = () => reconcileHomeLayout(null, catalog);
const keys = l => l.categories.map(c => c.key);
const changed = (l, key, action) => changeHomeLayout(l, key, action);
async function repository(t) {
  const factory = new IDBFactory(), r = await openHomeLayoutRepository(factory); t.after(() => r.close()); return { factory, r };
}

test('initial migration preserves legacy visible ordering and custom insertion order, without modifying entries', () => {
  const entries = [entry('Tools'), entry('Mail', 1), entry('University', 2), entry('Books', 3)], before = structuredClone(entries);
  const value = reconcileHomeLayout(null, homeCategories(entries));
  assert.deepEqual(keys(value), ['university', 'mail', 'tools', 'books']);
  assert.ok(value.categories.every(c => c.visible && !c.collapsed)); assert.deepEqual(entries, before);
});
test('explicit ordering is stable through destination rename, movement, insertions and usage rerenders', () => {
  let value = changed(initial(), 'tools', 'UP'); const order = keys(value);
  const entries = [entry('Tools', 2), entry('Research', 4), entry('Books', 1), entry('University'), entry('Mail', 3)];
  entries[0].label = 'A renamed destination';
  for (let i = 0; i < 50; i++) value = reconcileHomeLayout(value, homeCategories(rankDestinations(entries, { 'host:site-2.example': { count: i + 1, score: i + 1, lastOpenedAt: 1000 } }, 1000 + i)));
  assert.deepEqual(keys(value), order);
  assert.deepEqual(keys(reconcileHomeLayout(value, homeCategories([...entries, entry('Books', 9)]))), order);
});
test('hidden categories remain searchable, manageable and pinned in their explicit order', () => {
  const policy = { whitelist: ['root.example', 'other.example'], blacklist: [] }, before = structuredClone(policy);
  const metadata = [original, { ...original, id: 'host:other.example', label: 'Other', primaryHostname: 'other.example', hostnames: ['other.example'] }];
  const entries = destinationIndex(policy, metadata), cats = homeCategories(entries);
  const value = changed(reconcileHomeLayout(null, cats), 'your destinations', 'VISIBILITY');
  assert.deepEqual(displayedHomeCategories(value, cats), []);
  assert.equal(searchDestinationTargets(entries, 'root.example')[0].hostname, 'root.example');
  assert.equal(policyDestinationIndex(policy, metadata).length, 2);
  const pins = ['host:other.example', 'host:root.example'];
  assert.deepEqual(pinnedDestinations(entries, pins).map(destinationId), pins); assert.deepEqual(policy, before);
});
test('collapse is independent of visibility and order; restoring visibility retains collapse', () => {
  let value = changed(initial(), 'books', 'COLLAPSE'), order = keys(value);
  assert.equal(displayedHomeCategories(value, catalog).find(c => c.key === 'books').collapsed, true);
  value = changed(value, 'books', 'VISIBILITY'); assert.ok(!displayedHomeCategories(value, catalog).some(c => c.key === 'books'));
  value = changed(value, 'books', 'VISIBILITY'); assert.equal(value.categories.find(c => c.key === 'books').collapsed, true);
  assert.deepEqual(keys(value), order);
});
test('empty categories retain layout and identity without rendering empty Home rows', () => {
  const value = changed(initial(), 'books', 'COLLAPSE');
  const cats = homeCategories([entry('University')], [entry('University')], ['Books', 'Empty']);
  const next = reconcileHomeLayout(value, cats);
  assert.ok(next.categories.find(c => c.key === 'books').collapsed);
  assert.ok(next.categories.some(c => c.key === 'empty'));
  assert.deepEqual(displayedHomeCategories(next, cats).map(c => c.key), ['university']);
});
test('a complete unambiguous category rename retains position, visibility and collapse', () => {
  let value = changed(changed(initial(), 'books', 'UP'), 'books', 'VISIBILITY'); value = changed(value, 'books', 'COLLAPSE');
  const index = keys(value).indexOf('books'), cats = homeCategories([entry('University'), entry('Novels', 1), entry('Tools', 2), entry('Mail', 3), entry('Research', 4)]);
  const next = reconcileHomeLayout(value, cats);
  assert.equal(next.categories[index].key, 'novels'); assert.equal(next.categories[index].visible, false); assert.equal(next.categories[index].collapsed, true);
});
test('partial moves, merges and ambiguous renames do not transfer hidden preference', () => {
  const entries = [entry('Books'), entry('Books', 1), entry('Tools', 2)];
  const old = changed(reconcileHomeLayout(null, homeCategories(entries)), 'books', 'VISIBILITY');
  const next = reconcileHomeLayout(old, homeCategories([entry('Books'), entry('Novels', 1), entry('Tools', 2)]));
  assert.equal(next.categories.find(c => c.key === 'novels').visible, true); assert.equal(next.categories.find(c => c.key === 'books').visible, false);
});
test('legacy category case and whitespace reuse canonical identity and saved preferences', () => {
  const cats = homeCategories([entry(' Books '), entry('BOOKS', 1)]); assert.equal(cats.length, 1);
  const old = changed(reconcileHomeLayout(null, cats), 'books', 'VISIBILITY');
  const next = reconcileHomeLayout(old, homeCategories([entry('books'), entry(' Books ', 1)]));
  assert.equal(next.categories.length, 1); assert.equal(next.categories[0].visible, false);
});
test('new categories append deterministically and initially visible after customization', () => {
  const old = changed(initial(), 'research', 'UP'), order = keys(old);
  const next = reconcileHomeLayout(old, [...catalog, ...homeCategories([entry('Zoology', 10), entry('Astronomy', 11)])]);
  assert.deepEqual(keys(next), [...order, 'astronomy', 'zoology']); assert.ok(next.categories.slice(-2).every(c => c.visible));
});
for (const count of [5, 15, 30]) test(`${count} crowded categories and long labels retain stable order across repeated updates`, () => {
  const entries = Array.from({ length: count * 20 }, (_, i) => ({ ...entry(`Category ${String(i % count).padStart(2, '0')} ${'x'.repeat(45)}`, i), label: 'Long destination '.repeat(6) }));
  const cats = homeCategories(entries); let value = changed(reconcileHomeLayout(null, cats), cats.at(-1).key, 'UP'), order = keys(value);
  for (let i = 0; i < 20; i++) value = reconcileHomeLayout(value, homeCategories([...entries].reverse()));
  assert.deepEqual(keys(value), order); assert.equal(displayedHomeCategories(value, cats).length, count); assert.ok(readHomeLayout(value));
});
test('strict preference validation rejects damaged records without accepting authority fields', () => {
  for (const bad of [null, [], { ...initial(), policy: {} }, { ...initial(), version: 2 }, { version: 1, categories: [{ ...initial().categories[0], visible: 'false' }] },
    { version: 1, categories: [initial().categories[0], initial().categories[0]] }]) assert.equal(readHomeLayout(bad), null);
});
test('layout accepts existing large collections and the full Milestone B destination identity length', () => {
  const host = [63, 63, 63, 61].map(n => 'a'.repeat(n)).join('.'), id = `service:${host}`;
  assert.ok(readHomeLayout({ version: 1, categories: [{ key: 'books', label: 'Books', visible: true, collapsed: false, members: [id] }] }));
  assert.ok(readNavigationState({ ...emptyNavigationState(), sites: { selection: id, search: '', filter: 'ALL', scroll: 0 } }));
  const many = Array.from({ length: 10000 }, (_, i) => entry('Your destinations', i));
  assert.ok(readHomeLayout(reconcileHomeLayout(null, homeCategories(many))));
});

test('layout order, hidden and collapsed states survive UI reload and repository reopen', async t => {
  const { factory, r } = await repository(t); const value = changed(changed(changed(initial(), 'books', 'UP'), 'tools', 'VISIBILITY'), 'research', 'COLLAPSE');
  const result = await r.save(0, value); assert.equal(result.type, 'SAVED'); r.close();
  const restarted = await openHomeLayoutRepository(factory); t.after(() => restarted.close());
  const ui = new HomeLayoutSession(restarted); await ui.refresh(catalog); assert.deepEqual(ui.current(), value); assert.equal(ui.draft, null);
});
test('transactional revisions prevent concurrent Atlas pages from overwriting newer layout', async t => {
  const { factory, r } = await repository(t); await r.save(0, initial());
  const second = await openHomeLayoutRepository(factory); t.after(() => second.close());
  const results = await Promise.all([r.save(1, changed(initial(), 'books', 'UP')), second.save(1, changed(initial(), 'tools', 'VISIBILITY'))]);
  assert.deepEqual(results.map(r => r.type).sort(), ['CONFLICT', 'SAVED']); assert.equal((await r.load()).revision, 2);
});
test('a stale page retains its unsaved requested arrangement and explicitly loads newer saved layout', async t => {
  const { r } = await repository(t); const a = new HomeLayoutSession(r), b = new HomeLayoutSession(r);
  await a.refresh(catalog); await b.refresh(catalog); await a.change('books', 'UP');
  assert.equal(await b.change('tools', 'VISIBILITY'), false); assert.equal(b.conflict, true); assert.ok(b.draft);
  const newer = await r.load(); assert.deepEqual(newer.value, a.current());
  assert.equal(await b.retry(catalog), false); assert.deepEqual(await r.load(), newer);
  await b.useSaved(catalog); assert.equal(b.draft, null); assert.equal(b.conflict, false); assert.deepEqual(b.current(), a.current());
});
test('failed saves publish only acknowledged layout, retain requested draft, and recover with explicit retry', async t => {
  const { r } = await repository(t); let fail = false;
  const s = new HomeLayoutSession({ ...r, save: (rev, value) => fail ? Promise.resolve({ type: 'FAILED' }) : r.save(rev, value) });
  await s.refresh(catalog); const before = s.current(); fail = true;
  assert.equal(await s.change('books', 'UP'), false); assert.deepEqual(s.current(), before); assert.notDeepEqual(s.requested(), before);
  await s.refresh(catalog); assert.equal(s.failure, 'FAILED'); fail = false;
  assert.equal(await s.retry(catalog), true); assert.equal(s.draft, null); assert.notDeepEqual(s.current(), before);
});
test('uncertain successful writes reconcile by reading matching saved values without repeating the write', async t => {
  const { r } = await repository(t); let lost = false, writes = 0;
  const s = new HomeLayoutSession({ ...r, save: async (rev, v) => { writes++; const result = await r.save(rev, v); return lost ? { type: 'UNCERTAIN' } : result; } });
  await s.refresh(catalog); lost = true; await s.change('books', 'UP'); assert.equal(s.failure, 'UNCERTAIN');
  assert.equal(await s.retry(catalog), true); assert.equal(writes, 2); assert.equal(s.draft, null);
});
test('unavailable presentation read retains existing values and cannot manufacture a fresh saved layout', async t => {
  const { r } = await repository(t); let fail = false;
  const s = new HomeLayoutSession({ ...r, load: () => fail ? Promise.reject(Error('unavailable')) : r.load() });
  await s.refresh(catalog); const before = s.current(); fail = true; await s.refresh(catalog);
  assert.equal(s.failure, 'UNAVAILABLE'); assert.deepEqual(s.current(), before); assert.equal(await s.change('tools', 'UP'), false);
  fail = false; assert.equal(await s.retry(catalog), true); assert.deepEqual(s.current(), before);
});
test('damaged saved layout is unavailable and is never silently reset', async t => {
  const { factory, r } = await repository(t);
  const db = await new Promise(resolve => { const q = factory.open('atlas-home-layout-v1', 1); q.onsuccess = () => resolve(q.result); });
  await new Promise(resolve => { const tx = db.transaction('layout', 'readwrite'); tx.objectStore('layout').put({ revision: 2, value: { version: 1, categories: 'bad' } }, 'current'); tx.oncomplete = resolve; }); db.close();
  const s = new HomeLayoutSession(r); await s.refresh(catalog); assert.equal(s.failure, 'UNAVAILABLE'); assert.equal(s.saved, null);
  assert.equal((await r.save(0, initial())).type, 'FAILED'); await assert.rejects(r.load());
});
test('read-only refresh observes another page without changing explicit pins, authority or layout order', async t => {
  const f = await fixture(t), { r } = await repository(t); const before = f.controller.getView().snapshot;
  const s = new HomeLayoutSession(r), other = new HomeLayoutSession(r); await s.refresh(catalog); await other.refresh(catalog);
  await other.change('books', 'UP'); await s.refresh(catalog); assert.deepEqual(s.current(), other.current()); assert.deepEqual(f.controller.getView().snapshot, before);
});

test('pending Home summary reports wait/readiness through Core and never confirms or changes timestamps', async t => {
  const f = await fixture(t); const start = await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'unknown.example' } });
  const before = f.controller.getView().snapshot;
  let p = pendingAccessView(f.controller.getView(), f.clock.time)[0]; assert.equal(p.outcome, 'WAIT'); assert.equal(p.requestId, start.referenceId);
  f.clock.time = p.readyAt; p = pendingAccessView(f.controller.getView(), f.clock.time)[0]; assert.equal(p.outcome, 'REQUIRE_CONFIRMATION');
  const summary = homeAccessSummary(f.adapter.view(), f.clock.time);
  assert.deepEqual(summary.pending[0].link, { kind: 'OPEN_DESTINATION', url: 'https://unknown.example/' });
  assert.deepEqual(f.controller.getView().snapshot, before); assert.equal(summary.grants.length, 0);
  f.clock.time = p.confirmBy; assert.deepEqual(pendingAccessView(f.controller.getView(), f.clock.time), []);
});
test('temporary Home links select the owning current workflow; grant deadlines never renew', async t => {
  const f = await fixture(t), tab = await f.firefox.tabs.create({});
  await f.firefox.visit(tab.id, 'https://unknown.example/'); await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'unknown.example' } }); await f.adapter.refresh();
  let summary = homeAccessSummary(f.adapter.view(), f.clock.time);
  assert.deepEqual(summary.pending[0].link, { kind: 'CONTEXT', tabId: tab.id, contextId: f.adapter.view().contexts[0].contextId });
  f.clock.time = summary.pending[0].readyAt; await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: summary.pending[0].requestId }); await f.adapter.refresh();
  summary = homeAccessSummary(f.adapter.view(), f.clock.time); const expiresAt = summary.grants[0].expiresAt;
  assert.equal(summary.grants.length, 1); assert.equal(homeAccessSummary(f.adapter.view(), f.clock.time + 10).grants[0].expiresAt, expiresAt);
  assert.equal(homeAccessSummary(f.adapter.view(), expiresAt).grants.length, 0);
});
test('Journey summaries remain tied to real contexts; unavailable or expired state offers no status action', async t => {
  const f = await fixture(t); const opened = await f.firefox.send({ kind: 'OPEN_JOURNEY', url: 'https://root.example/' });
  const summary = homeAccessSummary(f.adapter.view(), f.clock.time); assert.equal(summary.journeys[0].tabId, opened.tabId);
  assert.equal(homeAccessSummary(f.adapter.view(), summary.journeys[0].journey.expiresAt).journeys.length, 0);
  assert.equal(homeAccessSummary(null, f.clock.time).available, false);
  assert.deepEqual(homeAccessSummary({ ...f.adapter.view(), controller: { ...f.controller.getView(), status: 'UNAVAILABLE' } }, f.clock.time).journeys, []);
  await f.firefox.tabs.remove(opened.tabId); await f.adapter.whenIdle(); assert.deepEqual(homeAccessSummary(f.adapter.view(), f.clock.time).journeys, []);
});
test('toolbar reuses an existing control page without replacing URL or editor context', async t => {
  const f = await fixture(t); const control = await f.firefox.tabs.create({ url: f.firefox.runtime.getURL('ui/index.html?view=control#sites'), active: false });
  const count = f.firefox.documents.size; f.firefox.browserAction.onClicked.emit({ id: 99 }); await f.adapter.whenIdle();
  assert.equal(f.firefox.documents.size, count); assert.deepEqual(f.firefox.updates, []); assert.equal(f.firefox.documents.get(control.id).active, true);
});
test('navigation memory restores only selected row, filter, focus and scroll; no editor or authority fields', () => {
  const data = new Map(), storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const value = { ...emptyNavigationState(), tab: '12', sites: { selection: original.id, search: 'Original', filter: 'WHITELIST', scroll: 800 }, pages: { sites: { scroll: 220, focus: 'edit-site' } } };
  navigationMemory(storage).save(value); assert.deepEqual(navigationMemory(storage).value(), value);
  assert.equal(readNavigationState({ ...value, tab: 'stolen' }), null); assert.equal(readNavigationState({ ...value, sites: { ...value.sites, scroll: -1 } }), null);
  assert.equal(readNavigationState({ ...value, editor: {} }), null); assert.equal(readNavigationState({ ...value, policy: {} }), null);
  const failed = navigationMemory({ getItem() { throw Error(); }, setItem() { throw Error(); } }); failed.save(value); assert.deepEqual(failed.value(), value);
});
test('Sites restores selected row and scroll and retains selection/focus through display rerender and editor close', async t => {
  const f = await sitesFixture(t); f.el('sites-list').scrollTop = 340; f.edit(); await f.flush();
  assert.equal(f.sites.navigation().selection, original.id); assert.equal(f.sites.navigation().scroll, 340);
  f.el('cancel-site-draft').fire('click'); await f.flush(); f.sites.render(true);
  assert.equal(document.activeElement.dataset.destinationId, original.id);
  const prefs = JSON.parse(f.saved.get(metadataKey)); prefs.destinations[0].label = 'Renamed'; f.saved.set(metadataKey, JSON.stringify(prefs));
  for (const listener of window.listeners.storage ?? []) listener({ key: metadataKey }); f.sites.render(true);
  assert.equal(f.el('sites-list').scrollTop, 340); assert.equal(document.activeElement.dataset.destinationId, original.id);
  assert.equal(f.sites.navigation().selection, original.id);
});
test('read-only verification waits through housekeeping for acknowledged READY and never retries an operation', async t => {
  const f = await fixture(t), before = f.controller.getView().snapshot;
  const sequence = ['LOADING', 'COMMITTING', 'READY']; let calls = 0, pauses = 0;
  const view = await readVerifiedController(async () => ({ ...f.controller.getView(), status: sequence[calls++] }), async () => { pauses++; });
  assert.equal(view.status, 'READY'); assert.equal(calls, 3); assert.equal(pauses, 2); assert.deepEqual(f.controller.getView().snapshot, before);
});
test('verification is bounded and unavailable/unknown/corrupt responses cannot become verified authority', async t => {
  const f = await fixture(t); let calls = 0;
  assert.equal(await readVerifiedController(async () => { calls++; return { ...f.controller.getView(), status: 'LOADING' }; }, async () => {}), null);
  assert.equal(calls, 21);
  for (const status of ['UNAVAILABLE', 'RECONCILING', 'UNINITIALIZED']) {
    calls = 0; assert.equal(await readVerifiedController(async () => { calls++; return { ...f.controller.getView(), status }; }, async () => {}), null); assert.equal(calls, 1);
  }
  assert.equal(await readVerifiedController(async () => { throw Error(); }), null);
  assert.equal(await readVerifiedController(async () => ({ ...f.controller.getView(), snapshot: null })), null);
  assert.equal(await readVerifiedController(async () => ({ ...f.controller.getView(), snapshot: undefined })), null);
});
test('Sites uses a fresh verified view for display preparation and retains explicit save/row context', async t => {
  const f = await sitesFixture(t); let reads = 0;
  f.settings.verify = async () => { reads++; return f.controller.getView(); };
  f.edit(); f.el('site-name').value = 'Verified display'; await f.stage(); await f.submit();
  assert.equal(JSON.parse(f.saved.get(metadataKey)).destinations[0].label, 'Verified display'); assert.equal(f.proposals(), 0); assert.equal(reads, 3);
  assert.equal(f.sites.navigation().selection, original.id);
});
test('failed fresh verification keeps the destination draft, sends no proposal and reports unavailable rather than stale', async t => {
  const f = await sitesFixture(t); f.settings.verify = async () => null;
  f.edit(); f.el('site-name').value = 'Retain this'; await f.stage(); await f.submit();
  assert.equal(JSON.parse(f.saved.get(metadataKey)).destinations[0].label, 'Original'); assert.equal(f.proposals(), 0);
  assert.equal(f.sites.session().value.draft.changes[0].after.metadata.label, 'Retain this');
  assert.match(f.feedback.at(-1).message, /could not be verified/);
});
test('a fresh query still detects actual metadata changes during frozen preparation and prevents overwriting', async t => {
  const f = await sitesFixture(t); let reads = 0;
  f.settings.verify = async () => { if (++reads === 2) { const prefs = JSON.parse(f.saved.get(metadataKey)); prefs.destinations[0].label = 'Other page'; f.saved.set(metadataKey, JSON.stringify(prefs)); } return f.controller.getView(); };
  f.edit(); f.el('site-name').value = 'My edit'; await f.stage(); await f.submit();
  assert.equal(JSON.parse(f.saved.get(metadataKey)).destinations[0].label, 'Other page'); assert.equal(f.proposals(), 0); assert.match(f.feedback.at(-1).message, /baseline changed/);
});
test('a user layout action waits for an in-flight background read rather than disappearing', async t => {
  const { r } = await repository(t); let hold = false, release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const s = new HomeLayoutSession({ ...r, load: async () => { if (hold) { entered(); await new Promise(resolve => { release = resolve; }); } return r.load(); } });
  await s.refresh(catalog); hold = true; const refresh = s.refresh(catalog); await started;
  const action = s.change('books', 'UP'); hold = false; release(); await refresh;
  assert.equal(await action, true); assert.deepEqual(keys(s.current()), keys(changed(initial(), 'books', 'UP')));
});
