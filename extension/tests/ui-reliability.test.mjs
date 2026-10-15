import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeSites } from '../dist/lib/ui/sites.js';
import { savePresentation } from '../dist/lib/ui/presentation-storage.js';
import { actionFeedback, renderFeedback } from '../dist/lib/ui/feedback.js';
import { collectionPresentation } from '../dist/lib/ui/data-view.js';
import { destinationIndex, searchDestinationTargets } from '../dist/lib/ui/destinations.js';
import { startupCopy } from '../dist/lib/ui/presentation.js';
import { fixture } from './support/fixture.mjs';
import { dom, Node, original, metadataKey as key, sitesFixture } from './support/ui-fixture.mjs';

test('display save publishes only persisted values without policy commands', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  f.edit(); f.el('site-name').value = 'Saved label'; f.el('save-site-display').fire('click'); await f.flush();
  assert.equal(f.sites.metadata()[0].label, 'Saved label'); assert.equal(JSON.parse(f.saved.get(key)).destinations[0].label, 'Saved label');
  assert.equal(f.el('site-draft').hidden, true); assert.equal(f.proposals(), 0); assert.deepEqual(f.controller.getView().snapshot, before);
  assert.equal(f.feedback.at(-1).tone, 'success');
});
test('failed display save preserves frozen retry values, publishes no false success, and explicit retry works', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Unsaved label'; f.mode('FAIL');
  f.el('save-site-display').fire('click'); await f.flush(); f.sites.render(true);
  assert.equal(f.sites.metadata()[0].label, 'Original'); assert.equal(JSON.parse(f.saved.get(key)).destinations[0].label, 'Original');
  assert.equal(f.feedback.at(-1).tone, 'error'); assert.equal(f.sites.session().value.receipt.draft.changes[0].after.metadata.label, 'Unsaved label');
  f.mode('OK'); f.el('retry-site-save').fire('click'); await f.flush();
  assert.equal(f.sites.metadata()[0].label, 'Unsaved label'); assert.equal(f.proposals(), 0);
});
test('reload after failed presentation save retains acknowledged values and durable display retry', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Failed label'; f.mode('FAIL'); f.el('save-site-display').fire('click'); await f.flush();
  f.mode('OK'); f.clearHandlers(); const reloaded = initializeSites(f.settings); await reloaded.initialized;
  assert.equal(reloaded.metadata()[0].label, 'Original'); assert.equal(reloaded.session().value.receipt.phase, 'APPLYING');
  reloaded.render(true); await f.flush(reloaded); assert.equal(reloaded.metadata()[0].label, 'Original', 'reload does not retry a failed display write');
  f.el('retry-site-save').fire('click'); await f.flush(reloaded); assert.equal(reloaded.metadata()[0].label, 'Failed label');
});
test('uncertain presentation save remains unverified without automatic retry', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Unknown'; await f.stage();
  f.mode('UNKNOWN'); await f.submit();
  assert.notEqual(f.sites.session().value.receipt?.phase, 'DONE'); assert.equal(f.proposals(), 0);
  assert.equal(f.sites.metadata()[0].label, 'Original'); const writes = f.writes(); f.sites.render(true); await f.flush(); assert.equal(f.writes(), writes);
});
test('thrown writes distinguish unchanged, already successful and unknown storage', () => {
  let value = 'old'; const storage = { getItem: () => value, setItem() { throw Error(); } };
  assert.equal(savePresentation(storage, 'key', 'new'), 'FAILED');
  storage.setItem = (_, next) => { value = next; throw Error(); }; assert.equal(savePresentation(storage, 'key', 'new'), 'SAVED');
  storage.getItem = () => { throw Error(); }; assert.equal(savePresentation(storage, 'key', 'other'), 'UNCERTAIN');
});
test('saved Vault receipt freezes complete display terms without resubmitting on duplicate clicks', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Protected'; f.el('site-access').value = 'BLACKLIST'; await f.stage();
  await f.submit(); f.el('submit-destination-draft').fire('click'); await f.flush();
  assert.equal(f.proposals(), 1); assert.ok(f.controller.getView().snapshot.vaultState.pendingProposal);
  assert.equal(f.sites.session().value.receipt.draft.changes[0].after.metadata.label, 'Protected'); assert.equal(f.sites.metadata()[0].label, 'Original');
  assert.ok(f.controller.getView().snapshot.policy.whitelist.includes('root.example'));
});
test('policy commit survives failed accompanying display write and explicit recovery uses same receipt', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Protected'; f.el('site-access').value = 'BLACKLIST'; await f.stage(); await f.submit();
  f.mode('FAIL'); await f.confirm(); assert.ok(f.controller.getView().snapshot.policy.blacklist.includes('root.example'));
  assert.equal(f.sites.metadata()[0].label, 'Original'); assert.match(f.feedback.at(-1).message, /^Policy committed and is active/);
  const count = f.writes(); f.sites.render(true); await f.flush(); assert.equal(f.writes(), count);
  f.mode('OK'); f.el('retry-site-save').fire('click'); await f.flush(); assert.equal(f.proposals(), 1); assert.equal(f.sites.metadata()[0].label, 'Protected');
});
test('pin failure after commit remains recoverable through reload', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Pinned'; await f.stage(); await f.submit();
  assert.equal(f.proposals(), 0); // Display-only receipt exercises the same acknowledged metadata/pin stages.
  f.edit(); f.el('site-pin').checked = true; f.el('save-site-display').fire('click'); f.failPin(true); await f.flush();
  assert.equal(f.sites.session().value.receipt.phase, 'APPLYING'); f.failPin(false);
  f.clearHandlers(); const reloaded = initializeSites(f.settings); await reloaded.initialized; reloaded.render(true);
  f.el('retry-site-save').fire('click'); await f.flush(reloaded); assert.equal(reloaded.session().value.receipt.phase, 'DONE');
});
test('cancelled batch never activates accompanying display details', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Cancelled'; f.el('site-access').value = 'BLACKLIST'; await f.stage(); await f.submit();
  const id = f.controller.getView().snapshot.vaultState.pendingProposal.id; await f.firefox.send({ kind: 'CANCEL_POLICY', proposalId: id });
  f.sites.render(true); await f.flush(); assert.equal(f.sites.metadata()[0].label, 'Original'); assert.equal(f.sites.session().value.receipt.phase, 'RESOLVED');
});
test('commit elsewhere reports active policy while accompanying display persistence is failed', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Elsewhere'; f.el('site-access').value = 'BLACKLIST'; await f.stage(); await f.submit();
  f.mode('FAIL'); await f.confirm(); assert.match(f.feedback.at(-1).message, /^Policy committed and is active/);
  f.mode('OK'); f.el('retry-site-save').fire('click'); await f.flush(); assert.equal(f.sites.metadata()[0].label, 'Elsewhere'); assert.equal(f.proposals(), 1);
});
test('another page saving matching display terms does not strand failed local retry', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-access').value = 'BLACKLIST'; f.el('site-name').value = 'Shared'; await f.stage(); await f.submit();
  f.mode('FAIL'); await f.confirm(); f.mode('OK');
  const value = JSON.stringify({ version: 1, destinations: [{ ...original, label: 'Shared' }], pending: null }); f.saved.set(key, value);
  for (const listener of window.listeners.storage) listener({ key, newValue: value });
  f.el('retry-site-save').fire('click'); await f.flush(); assert.equal(f.sites.session().value.receipt.phase, 'DONE'); assert.equal(f.proposals(), 1);
});
test('failed initial Sites load displays unavailable with recovery rather than empty data', t => {
  const d = dom(t); const sites = initializeSites({ drafts: Promise.reject(Error()), controller: () => undefined, attempted: () => true, canEdit: () => false,
    pins: () => [], pin: () => 'SAVED', propose: async () => assert.fail(), vault() {}, changed() {}, feedback() {} });
  sites.render(false); assert.equal(d.el('sites-section').dataset.phase, 'UNAVAILABLE'); assert.equal(d.el('sites-empty').hidden, true);
  assert.equal(d.el('sites-recovery').hidden, false); assert.equal(d.el('add-site').disabled, true);
});
test('reconciliation of resolved presentation does not close another local editor or steal focus', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'One'; await f.stage(); await f.submit();
  f.el('add-site').fire('click'); f.el('site-name').value = 'Next'; f.el('site-name').fire('input'); f.el('site-name').focus();
  f.sites.render(true); await f.flush(); assert.equal(f.el('site-draft').hidden, false); assert.equal(f.el('site-name').value, 'Next'); assert.equal(document.activeElement, f.el('site-name'));
});
test('Sites retains labelled stale rows after authority loss and recovers without fake empty state', async t => {
  const f = await sitesFixture(t), count = f.el('sites-list').children.length; f.available(false); f.sites.render(false);
  assert.equal(f.el('sites-list').children.length, count); assert.equal(f.el('sites-empty').hidden, true); assert.match(f.el('sites-status').textContent, /last verified/);
  assert.equal(f.el('add-site').disabled, true); f.available(true); f.sites.render(true); assert.match(f.el('sites-status').textContent, /Committed policy/); await f.flush();
});

const searchPolicy = { whitelist: ['outlook.com', 'www.outlook.com', 'outlook.office.com', 'outlook.live.com', 'github.com', 'www.github.com'], blacklist: [] };
test('search targets exact entry points and aliases; service names keep the default', () => {
  const entries = destinationIndex(searchPolicy);
  assert.equal(searchDestinationTargets(entries, 'outlook.office.com')[0].hostname, 'outlook.office.com');
  assert.equal(searchDestinationTargets(entries, 'Outlook')[0].hostname, 'outlook.com');
  assert.equal(searchDestinationTargets(entries, 'www.github.com')[0].hostname, 'www.github.com');
  assert.equal(searchDestinationTargets(entries, 'www.github')[0].hostname, 'www.github.com', 'partial host queries remain searchable');
  const ambiguous = searchDestinationTargets(entries, 'outlook.');
  assert.ok(ambiguous.some(result => result.hostname === 'outlook.office.com' && result.match === 'ENTRY_POINT'));
  assert.ok(ambiguous.some(result => result.hostname === 'www.outlook.com' && result.match === 'ALIAS'));
  assert.equal(new Set(ambiguous.map(result => result.hostname)).size, ambiguous.length);
  for (const unknown of ['outlook.office.com.evil.example', 'outlook.office.co', 'unrecognized.example']) assert.deepEqual(searchDestinationTargets(entries, unknown), []);
  assert.deepEqual(searchDestinationTargets(destinationIndex({ whitelist: ['github.com'], blacklist: [] }), 'www.github.com'), [], 'no inferred equivalence');
});

test('exact search prioritizes the matching host over similar service names', () => {
  const entries = [{ label: 'example.com guides', hostname: 'guide.example', hostnames: ['guide.example'] },
    { label: 'Example', hostname: 'www.example.com', hostnames: ['example.com', 'www.example.com'] }];
  assert.deepEqual(searchDestinationTargets(entries, 'EXAMPLE.COM').map(result => result.hostname), ['example.com']);
});

test('search address remains an ordinary adapter intent, denied by Core if policy changes after indexing', async t => {
  const f = await fixture(t, true, { policy: searchPolicy }); const entries = destinationIndex(searchPolicy);
  const address = searchDestinationTargets(entries, 'outlook.office.com')[0].hostname;
  const proposal = await f.firefox.send({ kind: 'PROPOSE_POLICY', candidatePolicy: { ...searchPolicy, blacklist: [address] } });
  const pending = proposal.view.controller.snapshot.vaultState.pendingProposal; f.clock.time = pending.readyAt;
  await f.firefox.send({ kind: 'CONFIRM_POLICY', proposalId: pending.id });
  const opened = await f.firefox.send({ kind: 'OPEN_DESTINATION', url: `https://${address}/` });
  assert.equal((await f.firefox.visit(opened.tabId, `https://${address}/`)).cancel, true);
  assert.equal(f.adapter.view().contexts.find(c => c.tabId === opened.tabId).latest.decision.reason, 'BLACKLISTED');
});

test('collection phases distinguish first loading, verified empty, initial failure, stale failure and recovery', () => {
  assert.equal(collectionPresentation(null, 0, false, false).phase, 'LOADING');
  assert.equal(collectionPresentation({ status: 'READY', snapshot: {} }, 0, true, true).phase, 'EMPTY');
  assert.equal(collectionPresentation(null, 0, true, false).phase, 'UNAVAILABLE');
  const stale = collectionPresentation(null, 2, true, true); assert.equal(stale.stale, true); assert.doesNotMatch(stale.message, /empty|deleted/);
  assert.equal(collectionPresentation({ status: 'READY', snapshot: {} }, 2, true, true).phase, 'READY');
});

test('feedback distinguishes saved proposals, activated policy, failures and unknown outcomes with appropriate roles', () => {
  const committed = { result: { type: 'COMMITTED' } };
  assert.match(actionFeedback('PROPOSE_POLICY', committed).message, /proposal saved.*unchanged/i);
  assert.match(actionFeedback('CONFIRM_POLICY', committed).message, /committed.*now active/i);
  assert.equal(actionFeedback('CONFIRM_POLICY', { result: { type: 'BLOCKED', reason: 'COMMIT_UNKNOWN' } }).tone, 'uncertain');
  assert.equal(actionFeedback('PROPOSE_POLICY', { result: { type: 'BLOCKED', reason: 'WRITE_FAILED' } }).tone, 'error');
  assert.doesNotMatch(actionFeedback('PROPOSE_POLICY', { result: { type: 'REJECTED', reason: 'PROPOSAL_PENDING' } }).message, /PROPOSAL_PENDING/);
  const node = new Node(); renderFeedback(node, actionFeedback('CONFIRM_POLICY', committed)); assert.equal(node.attrs.role, 'status');
  renderFeedback(node, actionFeedback('CONFIRM_POLICY', undefined)); assert.equal(node.attrs.role, 'alert');
  assert.doesNotMatch(startupCopy({ status: 'FAILED', stage: 'MANAGED_BLACKLIST' }), /extension\/dist|about:debugging/);
});
