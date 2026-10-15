import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { setProperty, setAttribute, reconcileChildren } from '../dist/lib/ui/dom.js';
import { RefreshLoop } from '../dist/lib/ui/refresh-loop.js';
import { HomeLayoutSession } from '../dist/lib/ui/home-layout-session.js';
import { openHomeLayoutRepository } from '../dist/lib/ui/home-layout-storage.js';
import { homeCategories } from '../dist/lib/ui/home-layout.js';
import { matchingReview, needsPolicyReview } from '../dist/lib/ui/vault-presentation.js';
import { hasCommittedCollection, collectionPresentation } from '../dist/lib/ui/data-view.js';
import { fixture, deferred } from './support/fixture.mjs';
import { sitesFixture, metadataKey, original } from './support/ui-fixture.mjs';

const categories = homeCategories(['Research', 'Tools', 'Books'].map((category, index) => ({
  id: `host:site-${index}.example`, hostname: `site-${index}.example`, hostnames: [`site-${index}.example`], label: category, category })));
const turn = () => new Promise(resolve => setImmediate(resolve));

test('housekeeping commit retains the acknowledged collection; loading and failed authority stay distinct', async t => {
  const f = await fixture(t), controller = f.controller.getView(), snapshot = structuredClone(controller.snapshot);
  const committing = { ...controller, status: 'COMMITTING' };
  assert.equal(hasCommittedCollection(committing), true);
  assert.deepEqual(collectionPresentation(committing, 1, true, true), collectionPresentation(controller, 1, true, true));
  assert.equal(hasCommittedCollection({ ...controller, status: 'LOADING' }), true);
  assert.equal(hasCommittedCollection({ ...controller, status: 'LOADING', snapshot: null }), false);
  assert.equal(collectionPresentation({ ...controller, status: 'LOADING', snapshot: null }, 0, false, false).phase, 'LOADING');
  for (const status of ['UNAVAILABLE', 'RECONCILING', 'UNINITIALIZED']) {
    const value = { ...controller, status }; assert.equal(hasCommittedCollection(value), false);
    assert.notEqual(collectionPresentation(value, 1, true, true).phase, 'READY');
  }
  assert.equal(hasCommittedCollection({ ...committing, snapshot: null }), false);
  assert.deepEqual(f.controller.getView().snapshot, snapshot);
});

async function layout(t, override = {}) {
  const repository = await openHomeLayoutRepository(new IDBFactory()); t.after(() => repository.close());
  const events = []; let reads = 0;
  const session = new HomeLayoutSession({ ...repository, load: () => { reads++; return repository.load(); }, ...override },
    () => events.push({ busy: session.busy, failure: session.failure }));
  await session.refresh(categories); events.length = 0;
  return { repository, session, events, reads: () => reads };
}

test('unchanged native values are never rewritten; a real change is written exactly once', () => {
  let writes = 0, value = 'unchanged';
  const node = { get value() { return value; }, set value(next) { writes++; value = next; } };
  for (let tick = 0; tick < 60; tick++) setProperty(node, 'value', 'unchanged');
  assert.equal(writes, 0); setProperty(node, 'value', 'changed'); assert.equal(writes, 1);
  let attributes = 0; const attrs = new Map([['aria-expanded', 'true']]);
  const element = { getAttribute: key => attrs.get(key) ?? null,
    setAttribute(key, value) { attributes++; attrs.set(key, value); }, removeAttribute(key) { attributes++; attrs.delete(key); } };
  for (let tick = 0; tick < 60; tick++) { setAttribute(element, 'aria-expanded', 'true'); setAttribute(element, 'aria-current', null); }
  assert.equal(attributes, 0); setAttribute(element, 'aria-expanded', 'false'); setAttribute(element, 'aria-expanded', null);
  assert.equal(attributes, 2);
});

test('list reconciliation retains unchanged controls and moves only changed membership/order', () => {
  let moves = 0, removals = 0;
  const parent = { children: [], insertBefore(child, before) { moves++; this.children = this.children.filter(n => n !== child);
    const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, child); } };
  const node = name => ({ name, value: 'selected exact entry', open: true, remove() { removals++; parent.children = parent.children.filter(n => n !== this); } });
  const a = node('a'), b = node('b'), c = node('c'); parent.children = [a, b, c];
  for (let tick = 0; tick < 60; tick++) reconcileChildren(parent, [a, b, c]);
  assert.equal(moves, 0); assert.equal(removals, 0);
  reconcileChildren(parent, [b, a, c]); assert.equal(moves, 1); assert.equal(removals, 0);
  assert.equal(b.value, 'selected exact entry'); assert.equal(b.open, true);
  reconcileChildren(parent, [b, c]); assert.equal(removals, 1); assert.deepEqual(parent.children, [b, c]);
});

function loop(refresh) {
  let sequence = 0; const timers = new Map();
  const instance = new RefreshLoop(refresh, { delay: () => 1000,
    schedule(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; }, cancel: id => timers.delete(id) });
  const fire = () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); };
  return { instance, timers, fire };
}

test('explicit refreshes replace the scheduled timer rather than multiplying poll chains', async () => {
  let calls = 0; const f = loop(async () => { calls++; }); f.instance.setActive(true); await turn();
  for (let i = 0; i < 30; i++) { assert.equal(f.timers.size, 1); await f.instance.request(); assert.equal(f.timers.size, 1); }
  f.fire(); await turn(); assert.equal(calls, 32); assert.equal(f.timers.size, 1); f.instance.dispose(); assert.equal(f.timers.size, 0);
});

test('overlapping refreshes coalesce into one in-flight request and one follow-up', async () => {
  let calls = 0; const held = deferred();
  const f = loop(async () => { if (++calls === 1) await held.promise; }); f.instance.setActive(true); await turn();
  for (let i = 0; i < 30; i++) void f.instance.request();
  assert.equal(calls, 1); assert.equal(f.timers.size, 0); held.resolve(); await turn();
  assert.equal(calls, 2); assert.equal(f.timers.size, 1); f.instance.dispose();
});

test('hidden and disposed pages stop polling; resuming schedules one immediate fresh read', async () => {
  let calls = 0; const held = deferred(); const f = loop(async () => { calls++; await held.promise; });
  f.instance.setActive(true); await turn(); f.instance.setActive(false); held.resolve(); await turn();
  assert.equal(f.timers.size, 0); await f.instance.request(); assert.equal(calls, 1);
  f.instance.setActive(true); await turn(); assert.equal(calls, 2); assert.equal(f.timers.size, 1);
  f.instance.dispose(); f.instance.setActive(true); await f.instance.request(); assert.equal(calls, 2); assert.equal(f.timers.size, 0);
});

test('unchanged Home layout reads never publish loading or disable acknowledged controls', async t => {
  const f = await layout(t); const before = structuredClone(f.session.saved);
  for (let tick = 0; tick < 60; tick++) await f.session.refresh(categories);
  assert.deepEqual(f.events, []); assert.deepEqual(f.session.saved, before); assert.equal(f.session.busy, false);
});

test('a click during a slow Home read waits and saves using the latest revision', async t => {
  const f = await layout(t), held = deferred(), reading = deferred();
  const load = f.session.repository.load;
  f.session.repository.load = async () => { const value = await load(); reading.resolve(); await held.promise; return value; };
  const first = f.session.refresh(categories); await reading.promise;
  const second = f.session.refresh(categories); assert.equal(f.session.busy, false);
  const click = f.session.change('books', 'UP'); held.resolve(); await Promise.all([first, second]);
  assert.equal(await click, true); assert.equal(f.session.saved.revision, 2); assert.equal(f.session.draft, null);
});

test('repeated read failures notify once, retain saved values, and explicit retry recovers', async t => {
  const f = await layout(t), before = structuredClone(f.session.saved), load = f.session.repository.load;
  f.session.repository.load = async () => { throw Error('synthetic failure'); };
  for (let i = 0; i < 60; i++) await f.session.refresh(categories);
  assert.equal(f.events.length, 1); assert.equal(f.session.failure, 'UNAVAILABLE'); assert.deepEqual(f.session.saved, before);
  assert.equal(await f.session.change('books', 'UP'), false);
  f.session.repository.load = load; assert.equal(await f.session.retry(categories), true); assert.equal(f.session.failure, null);
});

test('other-page layout changes produce one acknowledged update without a loading flash', async t => {
  const f = await layout(t); const second = new HomeLayoutSession(f.repository);
  await second.refresh(categories); await second.change('books', 'UP'); await f.session.refresh(categories);
  assert.deepEqual(f.session.saved, second.saved); assert.equal(f.events.length, 1); assert.ok(f.events.every(e => !e.busy));
  for (let i = 0; i < 20; i++) await f.session.refresh(categories); assert.equal(f.events.length, 1);
});

test('frozen Vault review is reused until a Core deadline/revision changes; time never commits', async t => {
  const f = await fixture(t); const proposal = await f.controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: ['root.example', 'next.example'], blacklist: [] } });
  const read = await f.controller.handle({ kind: 'REVIEW_POLICY', proposalId: proposal.referenceId });
  const review = read.review, controller = f.controller.getView(), before = structuredClone(controller.snapshot);
  assert.equal(matchingReview(controller, review), review);
  for (let now = review.createdAt; now < review.readyAt; now++) assert.equal(needsPolicyReview(controller, review, now), false);
  assert.equal(needsPolicyReview(controller, review, review.readyAt), true);
  assert.equal(matchingReview({ ...controller, status: 'COMMITTING' }, review), review);
  assert.equal(needsPolicyReview({ ...controller, status: 'COMMITTING' }, review, review.readyAt), false);
  assert.equal(matchingReview({ ...controller, status: 'UNAVAILABLE' }, review), null);
  assert.equal(matchingReview({ ...controller, snapshot: { ...before, policyRevision: before.policyRevision + 1 } }, review), null);
  assert.equal(matchingReview(controller, { ...review, candidatePolicy: { whitelist: [], blacklist: [] } }), null);
  assert.deepEqual(f.controller.getView().snapshot, before);
  f.clock.time = review.readyAt; const ready = (await f.controller.handle({ kind: 'REVIEW_POLICY', proposalId: review.proposalId })).review;
  assert.equal(needsPolicyReview(f.controller.getView(), ready, ready.confirmBy - 1), false);
  assert.equal(needsPolicyReview(f.controller.getView(), ready, ready.confirmBy), true);
  assert.deepEqual(f.controller.getView().snapshot.policy, before.policy);
});

test('rendering Sites sixty times performs no draft storage reads or DOM reconstruction', async t => {
  const f = await sitesFixture(t); await f.flush(); f.sites.render(true);
  const repository = f.sites.session().repository, load = repository.load; let reads = 0, replacements = 0;
  repository.load = () => { reads++; return load(); };
  const list = f.el('sites-list'), replace = list.replaceChildren;
  list.replaceChildren = function(...args) { replacements++; return replace.apply(this, args); };
  const row = list.children[0];
  for (let i = 0; i < 60; i++) f.sites.render(true);
  await turn(); assert.equal(reads, 0); assert.equal(replacements, 0); assert.equal(list.children[0], row);
  await f.sites.refresh(); assert.equal(reads, 1);
});

test('identical metadata storage notifications do not invalidate Sites presentation', async t => {
  const f = await sitesFixture(t); let updates = 0; f.settings.changed = () => updates++;
  const notify = () => { for (const handler of window.listeners.storage ?? []) handler({ key: metadataKey }); };
  for (let i = 0; i < 60; i++) notify(); assert.equal(updates, 0);
  f.saved.set(metadataKey, JSON.stringify({ version: 1, destinations: [{ ...original, label: 'Renamed' }], pending: null }));
  notify(); assert.equal(updates, 1); notify(); assert.equal(updates, 1);
});

test('transient collection display cannot submit policy without fresh READY verification', async t => {
  const f = await sitesFixture(t); f.el('add-site').fire('click'); await f.flush();
  f.el('site-name').value = 'Protected addition'; f.el('site-hostname').value = 'new.example'; f.el('site-category').value = 'Research';
  f.el('site-access').value = 'WHITELIST'; await f.stage(); f.el('review-destination-draft').fire('click'); f.sites.render(true);
  const controller = f.settings.controller, before = structuredClone(f.controller.getView().snapshot);
  f.settings.controller = () => ({ ...controller(), status: 'LOADING' }); f.sites.render(true);
  assert.equal(f.el('submit-destination-draft').disabled, false, 'UI can queue the explicit intent against acknowledged terms');
  f.el('submit-destination-draft').fire('click'); await f.flush();
  assert.equal(f.proposals(), 0); assert.deepEqual(f.controller.getView().snapshot, before);
  assert.match(f.feedback.at(-1).message, /verified current policy|saved state|ready/i);
});

test('delayed reconciliation cannot adopt a preview of a draft that changed during verification', async t => {
  const f = await sitesFixture(t); f.el('add-site').fire('click'); await f.flush();
  f.el('site-hostname').value = 'first.example'; f.el('site-name').value = 'First'; await f.stage();
  const held = deferred(), began = deferred();
  f.settings.verify = async () => { began.resolve(); await held.promise; return f.controller.getView(); };
  f.el('reconcile-destination-draft').fire('click'); await began.promise;
  await f.sites.session().setDraft({ ...f.sites.session().value.draft, editor: { id: null, name: 'Changed while reading', hostname: 'second.example', category: 'Research', access: 'WHITELIST', www: false, extra: '', pinned: false } });
  held.resolve(); await f.flush(); f.sites.render(true);
  assert.equal(f.el('draft-reconciliation').hidden, true);
  assert.match(f.feedback.at(-1).message, /draft changed while checking/i); assert.equal(f.proposals(), 0);
});

test('explicit display retry waits for fresh authority during housekeeping and concurrent clicks coalesce', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Retained display change';
  f.el('site-access').value = 'WHITELIST'; f.el('site-extra').value = 'alias.example'; await f.stage(); await f.submit();
  f.mode('FAIL'); await f.confirm(); assert.equal(f.sites.session().value.receipt.phase, 'APPLYING');
  f.mode('OK'); const controller = f.settings.controller, held = deferred(); let checks = 0;
  f.settings.controller = () => ({ ...controller(), status: 'LOADING' });
  f.settings.verify = async () => { checks++; await held.promise; return controller(); };
  f.sites.render(true); f.el('retry-site-save').fire('click'); f.el('retry-site-save').fire('click'); await turn();
  assert.equal(checks, 1); assert.equal(f.sites.session().value.receipt.phase, 'APPLYING'); held.resolve(); await f.flush();
  assert.equal(f.sites.session().value.receipt.phase, 'DONE'); assert.equal(f.proposals(), 1);
  assert.equal(JSON.parse(f.saved.get(metadataKey)).destinations[0].label, 'Retained display change');
});
