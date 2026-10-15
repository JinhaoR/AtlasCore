import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFeedback } from '../dist/lib/ui/feedback.js';
import { accessCopy, accessOutcomeLabel } from '../dist/lib/ui/presentation.js';
import { sitesFixture, Node, dom } from './support/ui-fixture.mjs';
import { initializeSites } from '../dist/lib/ui/sites.js';

test('identical feedback leaves live-region attributes and text unchanged', () => {
  const node = new Node();
  renderFeedback(node, { tone: 'success', message: 'Saved.' });
  let mutations = 0;
  node.setAttribute = () => { ++mutations; };
  for (let i = 0; i < 30; ++i) renderFeedback(node, { tone: 'success', message: 'Saved.' });
  assert.equal(mutations, 0);
  assert.equal(node.attrs['aria-atomic'], 'true');
  assert.equal(node.attrs.role, 'status');
  assert.equal(node.textContent, 'Saved.');
});

test('failure and uncertainty use alert semantics; acknowledged success uses status', () => {
  const node = new Node();
  for (const tone of ['error', 'uncertain']) {
    renderFeedback(node, { tone, message: 'Work retained. Retry saving.' });
    assert.equal(node.attrs.role, 'alert');
    assert.equal(node.hidden, false);
  }
  renderFeedback(node, { tone: 'success', message: 'Saved.' });
  assert.equal(node.attrs.role, 'status');
  renderFeedback(node, { tone: 'status', message: '' });
  assert.equal(node.hidden, true);
});

test('primary-hostname error retains draft, focuses its field and sends no proposal', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  f.edit(); f.el('site-hostname').value = 'https://wrong.example/path'; await f.stage();
  assert.equal(document.activeElement, f.el('site-hostname'));
  assert.equal(f.el('site-hostname').attrs['aria-invalid'], 'true');
  assert.match(f.el('site-field-error').textContent, /primary hostname/);
  assert.equal(f.el('site-field-error').attrs.role, 'alert');
  assert.equal(f.sites.session().value.draft.editor.hostname, 'root.example');
  assert.equal(f.el('site-hostname').value, 'https://wrong.example/path');
  assert.equal(f.proposals(), 0); assert.deepEqual(f.controller.getView().snapshot, before);
  f.el('site-hostname').value = 'valid.example'; f.el('site-hostname').fire('input'); await f.flush();
  assert.equal(f.el('site-hostname').attrs['aria-invalid'], 'false');
  await f.stage(); assert.equal(f.sites.session().value.draft.changes[0].after.metadata.primaryHostname, 'valid.example');
});

test('invalid additional hosts focus the additional field without changing permission', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-extra').value = '*.other.example'; await f.stage();
  assert.equal(document.activeElement, f.el('site-extra'));
  assert.equal(f.el('site-extra').attrs['aria-invalid'], 'true');
  assert.match(f.el('site-field-error').textContent, /additional exact hostnames/);
  assert.equal(f.sites.session().value.draft.changes.length, 0); assert.equal(f.proposals(), 0);
});

test('invalid additional host retained inside a closed disclosure is revealed before focus', async t => {
  const f = await sitesFixture(t), disclosure = { open: false }; f.edit();
  f.el('site-extra').closest = selector => selector === 'details' ? disclosure : null;
  f.el('site-extra').value = 'https://wrong.example/path'; await f.stage();
  assert.equal(disclosure.open, true); assert.equal(document.activeElement, f.el('site-extra'));
  assert.equal(f.proposals(), 0); assert.equal(f.sites.session().value.draft.changes.length, 0);
});

test('compact empty workspace only represents verified absence of local work', async t => {
  const f = await sitesFixture(t); assert.equal(f.el('destination-draft-panel').dataset.workspace, 'empty');
  f.edit(); f.sites.render(true); assert.equal(f.el('destination-draft-panel').dataset.workspace, 'work');
  f.el('site-name').value = 'Edited'; await f.stage();
  assert.equal(f.el('destination-draft-panel').dataset.workspace, 'work');
  await f.submit(); assert.equal(f.el('destination-draft-panel').dataset.workspace, 'work');
});

test('an unavailable local draft cannot be styled as verified empty', async t => {
  const f = await sitesFixture(t); f.draftMode('FAIL'); f.edit(); await f.flush(); f.sites.render(true);
  assert.equal(f.el('destination-draft-panel').dataset.workspace, 'work');
  assert.match(f.el('destination-draft-status').textContent, /Unsaved/);
});

test('workspace labels distinguish an editable draft, frozen proposal and completed receipt', async t => {
  const f = await sitesFixture(t); assert.equal(f.el('destination-workspace-kind').textContent, 'No staged changes');
  f.edit(); f.el('site-access').value = 'BLACKLIST'; await f.stage();
  assert.equal(f.el('destination-workspace-kind').textContent, 'Editable · no authority');
  await f.submit(); assert.equal(f.el('destination-workspace-kind').textContent, 'Frozen submission');
  assert.equal(f.el('destination-draft-heading').textContent, 'Frozen destination batch');
  assert.ok(f.controller.getView().snapshot.policy.whitelist.includes('root.example'));
  await f.confirm(); assert.equal(f.el('destination-workspace-kind').textContent, 'Completed local batch');
  assert.equal(f.proposals(), 1);
});

test('workspace badge cannot claim no staged changes before failed local storage is verified', async t => {
  const f = dom(t), sites = initializeSites({ drafts: Promise.reject(Error('Unavailable')), controller: () => undefined,
    attempted: () => true, canEdit: () => false, pins: () => [], pin: () => 'SAVED', propose: async () => assert.fail(),
    vault() {}, changed() {}, feedback() {} });
  sites.render(false); assert.equal(f.el('destination-workspace-kind').textContent, 'Loading local workspace');
  await sites.initialized; sites.render(false);
  assert.equal(f.el('destination-workspace-kind').textContent, 'Local state unavailable');
  assert.equal(f.el('destination-draft-panel').dataset.workspace, 'work');
});

test('readable decision labels distinguish policy denial from invalid authority without altering results', () => {
  const cases = [['ALLOW', 'WHITELISTED', 'Allowed'], ['DENY', 'BLACKLISTED', 'Blocked'],
    ['DENY', 'MANAGED_BLACKLISTED', 'Blocked'], ['DENY', 'INVALID_STATE', 'Unavailable'],
    ['GREYLIST', 'UNLISTED', 'Greylist'], ['WAIT', 'PENDING_REQUEST', 'Waiting'],
    ['REQUIRE_CONFIRMATION', 'PENDING_REQUEST', 'Confirm access']];
  for (const [outcome, reason, label] of cases) {
    const decision = { outcome, reason }, before = structuredClone(decision);
    assert.equal(accessOutcomeLabel(decision), label); assert.deepEqual(decision, before);
  }
  assert.equal(accessOutcomeLabel(null), 'No decision');
  assert.equal(accessCopy({ outcome: 'DENY', reason: 'INVALID_STATE' }).tone, 'unavailable');
  assert.equal(accessCopy({ outcome: 'DENY', reason: 'BLACKLISTED' }).tone, 'blocked');
});
