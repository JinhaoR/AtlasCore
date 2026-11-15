import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeSites } from '../dist/lib/ui/sites.js';
import { sitesFixture, original } from './support/ui-fixture.mjs';

function selectOriginal(f, sites = f.sites) {
  sites.render(true);
  f.el('sites-list').children.find(row => row.dataset.destinationId === original.id).fire('click');
  sites.render(true);
}

async function stagedAddition(f) {
  f.el('add-site').fire('click');
  f.el('site-name').value = 'Staged research'; f.el('site-hostname').value = 'staged.example';
  f.el('site-category').value = 'Research'; f.el('site-access').value = 'WHITELIST'; await f.stage();
}

test('editing replaces committed detail and review disclosure preserves the durable batch and authority', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  selectOriginal(f); f.el('edit-site').fire('click'); await f.flush(); f.sites.render(true);
  assert.equal(f.el('site-detail').hidden, true); assert.equal(f.el('site-draft').hidden, false);
  f.el('site-name').value = 'Updated label'; await f.stage();
  assert.equal(f.sites.view(), 'review', 'an acknowledged edit goes directly to review');
  assert.equal(f.el('destination-draft-items').hidden, false);
  assert.equal(f.el('reconcile-destination-draft').hidden, true);
  assert.equal(f.el('destination-draft-items').hidden, false);
  const row = f.el('destination-draft-items').children[0];
  f.sites.render(true); assert.equal(f.el('destination-draft-items').children[0], row);
  f.el('review-destination-draft').fire('click'); f.sites.render(true);
  assert.equal(f.el('destination-draft-items').hidden, true);
  assert.equal((await f.raw.load()).value.draft.changes.length, 1);
  assert.deepEqual(f.controller.getView().snapshot, before); assert.equal(f.proposals(), 0);
});

test('an untouched blank Add editor does not block editing the selected committed destination', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  f.el('add-site').fire('click'); await f.flush();
  assert.equal(f.sites.session().value.draft.editor.id, null);
  selectOriginal(f); f.el('edit-site').fire('click'); await f.flush(); f.sites.render(true);
  assert.equal(f.el('site-name').value, original.label);
  assert.equal(f.el('site-hostname').value, original.primaryHostname);
  assert.equal(f.sites.session().value.draft.editor.id, original.id);
  assert.deepEqual((await f.raw.load()).value.draft.editor, f.sites.session().value.draft.editor);
  assert.deepEqual(f.controller.getView().snapshot, before); assert.equal(f.proposals(), 0);
});

test('an untouched blank editor restored from storage does not block selecting an existing destination', async t => {
  const f = await sitesFixture(t);
  f.el('add-site').fire('click'); await f.flush();
  for (const callback of window.listeners.pagehide ?? []) callback();
  f.clearHandlers();
  const reopened = initializeSites(f.settings); await reopened.initialized; reopened.render(true);
  assert.equal(f.el('site-draft').hidden, false);
  selectOriginal(f, reopened); f.el('edit-site').fire('click'); await f.flush(reopened); reopened.render(true);
  assert.equal(f.el('site-hostname').value, original.primaryHostname);
  assert.equal(reopened.session().value.draft.editor.id, original.id);
  assert.equal(f.proposals(), 0);
});

test('Review draft can preview saved staged changes despite an unused blank Add editor', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  await stagedAddition(f); f.el('add-site').fire('click'); await f.flush(); f.sites.render(true);
  assert.equal(f.el('review-destination-draft').disabled, false);
  f.el('review-destination-draft').fire('click'); await f.flush(); f.sites.render(true);
  const summary = f.el('destination-draft-items').children[0].children[0].children.map(n => n.textContent).join('\n');
  assert.match(summary, /Staged research/); assert.match(summary, /staged\.example/);
  assert.equal(f.el('destination-draft-items').children[0].children[0].children.find(n => n.className === 'change-display').textContent, 'Research');
  assert.equal(f.sites.session().value.draft.changes.length, 1);
  assert.deepEqual(f.controller.getView().snapshot, before); assert.equal(f.proposals(), 0);
});

test('selecting another destination never silently discards meaningful entered values', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  f.el('add-site').fire('click'); await f.flush();
  f.el('site-name').value = 'Work in progress'; f.el('site-name').fire('input');
  f.el('site-hostname').value = 'partially-entered'; f.el('site-hostname').fire('input');
  f.el('site-category').value = 'Shopping'; f.el('site-category').fire('input');
  await f.flush(); const editor = structuredClone(f.sites.session().value.draft.editor);
  selectOriginal(f); f.el('edit-site').fire('click'); await f.flush(); f.sites.render(true);
  assert.deepEqual(f.sites.session().value.draft.editor, editor);
  assert.equal(f.el('site-name').value, editor.name); assert.equal(f.el('site-hostname').value, editor.hostname);
  assert.deepEqual((await f.raw.load()).value.draft.editor, editor);
  assert.deepEqual(f.controller.getView().snapshot, before); assert.equal(f.proposals(), 0);
});

test('category or access choices alone make a blank editor meaningful and cannot be discarded on selection', async t => {
  for (const [id, value] of [['site-category', 'Shopping'], ['site-access', 'BLACKLIST']]) await t.test(id, async child => {
    const f = await sitesFixture(child); f.el('add-site').fire('click'); await f.flush();
    f.el(id).value = value; f.el(id).fire('input'); await f.flush();
    const editor = structuredClone(f.sites.session().value.draft.editor);
    selectOriginal(f); f.el('edit-site').fire('click'); await f.flush();
    assert.deepEqual(f.sites.session().value.draft.editor, editor);
    assert.equal(f.el(id).value, value); assert.equal(f.proposals(), 0);
  });
});

test('a shared-draft conflict cannot be bypassed by replacing an otherwise blank editor', async t => {
  const f = await sitesFixture(t); f.el('add-site').fire('click'); await f.flush();
  const local = structuredClone(f.sites.session().value), remote = structuredClone(local);
  remote.draft.editor.name = 'Other window work';
  assert.equal((await f.raw.save(f.sites.session().revision, remote)).type, 'SAVED');
  await f.sites.refresh(); f.sites.render(true); assert.equal(f.sites.session().conflict, true);
  selectOriginal(f); f.el('edit-site').fire('click'); await f.flush();
  assert.deepEqual(f.sites.session().value, local);
  assert.deepEqual((await f.raw.load()).value, remote);
  assert.equal(f.proposals(), 0);
});

test('failed persistence keeps entered work and cannot be hidden by changing the selected destination', async t => {
  const f = await sitesFixture(t); f.el('add-site').fire('click'); await f.flush();
  f.draftMode('FAILED'); f.el('site-name').value = 'Unsaved work'; f.el('site-name').fire('input'); await f.flush();
  const retained = structuredClone(f.sites.session().value.draft.editor);
  selectOriginal(f); f.el('edit-site').fire('click'); await f.flush(); f.sites.render(true);
  assert.equal(f.sites.session().failure, 'FAILED'); assert.equal(f.sites.session().unsaved, true);
  assert.deepEqual(f.sites.session().value.draft.editor, retained);
  assert.equal(f.el('site-name').value, 'Unsaved work');
  assert.equal(f.el('submit-destination-draft').disabled, true); assert.equal(f.proposals(), 0);
});

function deferNextStageWrite(f) {
  const repository = f.sites.session().repository, save = repository.save.bind(repository);
  let release, entered, held = false;
  const started = new Promise(resolve => { entered = resolve; });
  const result = new Promise(resolve => { release = resolve; });
  repository.save = (revision, value) => {
    if (!held && value.draft?.changes.length && value.draft.editor === null) {
      held = true; entered(); return result;
    }
    return save(revision, value);
  };
  return { started, release };
}

test('a failed stage cannot replace a newer editor opened and typed while its save was pending', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  f.el('add-site').fire('click'); await f.flush();
  f.el('site-name').value = 'Earlier staged work'; f.el('site-hostname').value = 'earlier.example';
  f.el('site-category').value = 'Research';
  const deferred = deferNextStageWrite(f);
  f.el('site-form').fire('submit'); await deferred.started;
  assert.equal(f.sites.session().value.draft.editor, null);
  assert.equal(f.sites.session().value.draft.changes.length, 1);

  f.el('add-site').fire('click');
  for (const [id, value] of [['site-name', 'Newer unsaved work'], ['site-hostname', 'newer.example'], ['site-category', 'Numerical methods']]) {
    f.el(id).value = value; f.el(id).fire('input');
  }
  f.el('site-subdomains').checked = true; f.el('site-subdomains').fire('input');
  const latest = structuredClone(f.sites.session().value.draft.editor);
  assert.equal(latest.name, 'Newer unsaved work'); assert.equal(latest.includeSubdomains, true);
  deferred.release({ type: 'FAILED' }); await f.flush(); f.sites.render(true);

  assert.deepEqual(f.sites.session().value.draft.editor, latest, 'failed earlier stage must retain the newer editor identity and raw terms');
  assert.equal(f.el('site-name').value, latest.name); assert.equal(f.el('site-hostname').value, latest.hostname);
  assert.equal(f.el('site-subdomains').checked, true);
  assert.equal(f.sites.session().value.draft.changes[0].after.metadata.label, 'Earlier staged work');
  assert.equal(f.sites.session().failure, 'FAILED'); assert.equal(f.sites.session().unsaved, true);
  assert.equal(f.el('submit-destination-draft').disabled, true);
  assert.deepEqual(f.controller.getView().snapshot, before); assert.equal(f.proposals(), 0);
});

test('a failed stage restores its entered editor when no newer work has replaced it', async t => {
  const f = await sitesFixture(t); f.el('add-site').fire('click'); await f.flush();
  for (const [id, value] of [['site-name', 'Retained failed stage'], ['site-hostname', 'retained.example'], ['site-category', 'Research']]) {
    f.el(id).value = value; f.el(id).fire('input');
  }
  await f.flush(); const editor = structuredClone(f.sites.session().value.draft.editor);
  const deferred = deferNextStageWrite(f);
  f.el('site-form').fire('submit'); await deferred.started;
  deferred.release({ type: 'FAILED' }); await f.flush(); f.sites.render(true);
  assert.deepEqual(f.sites.session().value.draft.editor, editor);
  assert.equal(f.el('site-name').value, editor.name); assert.equal(f.el('site-hostname').value, editor.hostname);
  assert.equal(f.sites.session().value.draft.changes.length, 1);
  assert.equal(f.sites.session().failure, 'FAILED'); assert.equal(f.sites.session().unsaved, true);
  assert.equal(f.el('submit-destination-draft').disabled, true); assert.equal(f.proposals(), 0);
});
