import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { evaluate } from '@atlas/core';
import { draftBaseline, newDestinationDraft, stageDestination, unstageDestination, assessDraft, reconcileDraft, validateDraftCandidate, readDestinationDraft, destinationChangeSummary } from '../dist/lib/ui/destination-draft.js';
import { openDraftRepository, readDestinationWorkspace } from '../dist/lib/ui/draft-storage.js';
import { DestinationWorkspaceSession, receiptOutcome } from '../dist/lib/ui/destination-workspace.js';
import { canonicalCategory, categorySuggestions } from '../dist/lib/ui/categories.js';
import { destinationIndex } from '../dist/lib/ui/destinations.js';
import { readDestinationPreferences, replaceDestinationMetadata } from '../dist/lib/ui/destination-metadata.js';
import { explicitDestinationHosts } from '../dist/lib/ui/destination-policy.js';
import { initializeSites } from '../dist/lib/ui/sites.js';
import { fixture } from './support/fixture.mjs';
import { sitesFixture, original } from './support/ui-fixture.mjs';

const empty = { version: 1, destinations: [], pending: null };
const desired = (host, classification = 'WHITELIST', extra = {}) => ({ metadata: { id: `host:${host}`, label: host, category: 'Books', primaryHostname: host, hostnames: [host] }, classification, pinned: false, ...extra });
async function model(t) { const f = await fixture(t); const base = draftBaseline(f.controller.getView().snapshot, empty, []); return { ...f, base, draft: newDestinationDraft('draft1', base) }; }
async function add(f, hostname, access = 'WHITELIST', name = hostname) {
  f.el('add-site').fire('click'); f.el('site-name').value = name; f.el('site-hostname').value = hostname;
  f.el('site-access').value = access; f.el('site-category').value = 'Books'; await f.stage();
}

test('multiple Whitelist additions form one complete immutable candidate', async t => {
  const f = await model(t), before = structuredClone(f.controller.getView().snapshot); let d = f.draft;
  for (const host of ['arxiv.org', 'journals.aps.org', 'paper.example']) d = stageDestination(d, `host:${host}`, desired(host));
  const assessment = validateDraftCandidate(d, f.base, before); assert.equal(assessment.conflicts.length, 0);
  assert.deepEqual(assessment.candidatePolicy.whitelist, ['arxiv.org', 'journals.aps.org', 'paper.example', 'root.example']);
  assert.deepEqual(f.controller.getView().snapshot, before); assert.equal(f.draft.changes.length, 0);
});
test('multiple Blacklist and mixed additions retain all unaffected rules', async t => {
  const f = await model(t); let d = f.draft;
  for (const host of ['distraction.example', 'another.example']) d = stageDestination(d, `host:${host}`, desired(host, 'BLACKLIST'));
  d = stageDestination(d, 'host:research.example', desired('research.example'));
  assert.deepEqual(assessDraft(d, f.base).candidatePolicy, { whitelist: ['research.example', 'root.example'], blacklist: ['another.example', 'blocked.example', 'distraction.example'] });
});
test('removal and classification change describe desired state rather than click order', async t => {
  const f = await model(t); let d = stageDestination(f.draft, 'host:root.example', null);
  d = stageDestination(d, 'host:blocked.example', desired('blocked.example', 'WHITELIST'));
  assert.deepEqual(assessDraft(d, f.base).candidatePolicy, { whitelist: ['blocked.example'], blacklist: [] });
});
test('add then edit updates the addition; add then remove cancels it', async t => {
  const f = await model(t); let d = stageDestination(f.draft, 'host:new.example', desired('new.example'));
  d = stageDestination(d, 'host:new.example', desired('new.example', 'BLACKLIST'));
  assert.equal(d.changes.length, 1); assert.equal(d.changes[0].before, null); assert.equal(d.changes[0].after.classification, 'BLACKLIST');
  d = stageDestination(d, 'host:new.example', null); assert.equal(d.changes.length, 0); assert.equal(assessDraft(d, f.base).policyChanged, false);
});
test('edit twice, edit/remove and remove/readd preserve the original committed baseline', async t => {
  const f = await model(t), before = f.base.entries.find(e => e.metadata.id === 'host:root.example');
  let d = stageDestination(f.draft, before.metadata.id, { ...before, metadata: { ...before.metadata, label: 'One' } });
  d = stageDestination(d, before.metadata.id, { ...before, metadata: { ...before.metadata, label: 'Two' } }); assert.equal(d.changes.length, 1);
  d = stageDestination(d, before.metadata.id, null); assert.deepEqual(d.changes[0].before, before);
  d = stageDestination(d, before.metadata.id, before); assert.equal(d.changes.length, 0);
});
test('conflicting ownership is visible and blocks the whole candidate until resolved', async t => {
  const f = await model(t); let d = stageDestination(f.draft, 'host:one.example', desired('one.example'));
  const duplicate = desired('two.example'); duplicate.metadata.hostnames.push('one.example');
  d = stageDestination(d, duplicate.metadata.id, duplicate); assert.equal(assessDraft(d, f.base).candidatePolicy, null);
  assert.ok(assessDraft(d, f.base).conflicts.some(c => c.id === 'host:one.example'));
  d = unstageDestination(d, duplicate.metadata.id); assert.ok(assessDraft(d, f.base).candidatePolicy);
});
test('host normalization and optional www stay explicit without subdomain equivalence', async t => {
  const f = await model(t), hosts = explicitDestinationHosts(' EXAMPLE.COM. ', true, 'EXTRA.EXAMPLE.COM');
  assert.deepEqual(hosts, ['example.com', 'extra.example.com', 'www.example.com']);
  const item = desired(hosts[0]); item.metadata.hostnames = hosts;
  const policy = assessDraft(stageDestination(f.draft, item.metadata.id, item), f.base).candidatePolicy;
  assert.equal(evaluate('www.example.com', policy).outcome, 'ALLOW'); assert.equal(evaluate('other.example.com', policy).outcome, 'GREYLIST');
});
test('invalid restored drafts and forged baselines cannot submit', async t => {
  const f = await model(t), malformed = structuredClone(f.draft); malformed.version = 2; assert.equal(readDestinationDraft(malformed), null);
  const forged = stageDestination(f.draft, 'host:new.example', desired('new.example')); forged.changes[0].before = f.base.entries[0];
  assert.equal(readDestinationDraft(forged), null); assert.equal(validateDraftCandidate(forged, f.base, f.controller.getView().snapshot).candidatePolicy, null);
  const bad = { ...f.draft, editor: { id: null, name: '', hostname: '', category: '', access: 'BYPASS', www: false, extra: '', pinned: false } }; assert.equal(readDestinationDraft(bad), null);
});
test('persistent draft restores raw inputs without treating incomplete hostname as a rule', async t => {
  const f = await model(t), repository = await openDraftRepository(f.factory); t.after(() => repository.close());
  const d = { ...f.draft, editor: { id: null, name: 'Still editing', hostname: 'exa', category: 'Books', access: 'WHITELIST', www: false, extra: '', pinned: true } };
  assert.equal((await repository.save(0, { version: 1, draft: d, receipt: null })).type, 'SAVED'); repository.close();
  const reopened = await openDraftRepository(f.factory); t.after(() => reopened.close()); const restored = (await reopened.load()).value.draft;
  assert.deepEqual(restored.editor, d.editor); assert.equal(restored.changes.length, 0); assert.equal(evaluate('exa', f.base.policy).outcome, 'GREYLIST');
});
test('transactional concurrent writers acknowledge exactly one update', async t => {
  const factory = new IDBFactory(), a = await openDraftRepository(factory), b = await openDraftRepository(factory); t.after(() => { a.close(); b.close(); });
  const value = { version: 1, draft: null, receipt: null };
  const results = await Promise.all([a.save(0, value), b.save(0, value)]); assert.deepEqual(results.map(r => r.type).sort(), ['CONFLICT', 'SAVED']);
  assert.equal((await a.load()).revision, 1); assert.equal((await b.save(0, value)).type, 'CONFLICT');
});
test('rapid input saves serialize and stale sessions retain their work without overwriting', async t => {
  const f = await model(t), repo = await openDraftRepository(f.factory); t.after(() => repo.close());
  const a = new DestinationWorkspaceSession(repo, () => {}), b = new DestinationWorkspaceSession(repo, () => {}); await a.load(); await b.load();
  await Promise.all([a.setDraft(f.draft), a.setDraft(stageDestination(f.draft, 'host:one.example', desired('one.example')))]);
  assert.equal((await repo.load()).value.draft.changes.length, 1);
  await b.setDraft(stageDestination(f.draft, 'host:two.example', desired('two.example')));
  assert.equal(b.conflict, true); assert.equal(b.value.draft.changes[0].id, 'host:two.example'); assert.equal((await repo.load()).value.draft.changes[0].id, 'host:one.example');
});
test('a delayed shared refresh cannot restore discarded work or conflict with its own newer save', async t => {
  const f = await model(t), repo = await openDraftRepository(f.factory); t.after(() => repo.close());
  for (const discard of [false, true]) {
    let release, started;
    const reading = new Promise(resolve => { started = resolve; });
    let delayed = false;
    const wrapper = { ...repo, load: async () => {
      const observed = await repo.load();
      if (!delayed) return observed;
      delayed = false; started();
      return new Promise(resolve => { release = () => resolve(observed); });
    } };
    const session = new DestinationWorkspaceSession(wrapper, () => {}); await session.load();
    await session.setDraft(f.draft); delayed = true;
    const refresh = session.refresh(); await reading;
    const desiredDraft = discard ? null : stageDestination(f.draft, 'host:new.example', desired('new.example'));
    await session.setDraft(desiredDraft); release(); await refresh;
    assert.equal(session.conflict, false, 'a read started before our save does not indicate another writer');
    assert.deepEqual(session.value.draft, desiredDraft);
    assert.deepEqual((await repo.load()).value.draft, desiredDraft);
    assert.equal(session.unsaved, false);
  }
});
test('failed draft persistence retains work in memory and explicit retry is required', async t => {
  const f = await sitesFixture(t); f.draftMode('FAILED'); f.el('add-site').fire('click'); f.el('site-name').value = 'Unwritten';
  f.el('site-hostname').value = 'unwritten.example'; await f.stage();
  assert.equal(f.el('site-name').value, 'Unwritten'); assert.equal(f.sites.session().unsaved, true); await f.submit(); assert.equal(f.proposals(), 0);
  f.draftMode('OK'); f.el('retry-destination-draft').fire('click'); await f.flush(); assert.equal(f.sites.session().unsaved, false);
  assert.equal((await f.raw.load()).value.draft.editor.name, 'Unwritten');
});
test('draft survives local page navigation/reload and restores pending form values', async t => {
  const f = await sitesFixture(t); await add(f, 'new.example'); f.el('add-site').fire('click'); f.el('site-name').value = 'In progress'; f.el('site-name').fire('input'); await f.flush();
  f.sites.render(true); assert.equal(f.sites.session().value.draft.changes.length, 1);
  f.clearHandlers(); const restored = initializeSites(f.settings); await restored.initialized; restored.render(true); await f.flush(restored);
  assert.equal(f.el('site-name').value, 'In progress'); assert.equal(restored.session().value.draft.changes.length, 1); assert.equal(f.proposals(), 0);
});
test('temporary unavailable adapter never erases draft or permits submission', async t => {
  const f = await sitesFixture(t); await add(f, 'preserved.example'); f.available(false); f.sites.render(false); await f.flush();
  assert.equal(f.sites.session().value.draft.changes.length, 1); assert.match(f.el('destination-draft-status').textContent, /unavailable/);
  assert.equal(f.el('submit-destination-draft').disabled, true); f.available(true); f.sites.render(true); await f.flush();
});
test('explicit discard is confirmable and never changes policy', async t => {
  const f = await sitesFixture(t); await add(f, 'discard.example'); const before = structuredClone(f.controller.getView().snapshot);
  window.confirm = () => false; f.el('discard-destination-draft').fire('click'); assert.ok(f.sites.session().value.draft);
  window.confirm = () => true; f.el('discard-destination-draft').fire('click'); await f.flush(); assert.equal(f.sites.session().value.draft, null); assert.deepEqual(f.controller.getView().snapshot, before);
});
test('stale policy, metadata and pin baselines are separately identified', async t => {
  const f = await model(t), d = stageDestination(f.draft, 'host:new.example', desired('new.example'));
  const changed = { ...f.base, policyRevision: 1, metadata: [original], pins: ['host:root.example'] };
  assert.equal(assessDraft(d, changed).stale.length, 3); assert.equal(d.baseline.policyRevision, 0);
});
test('stale UI draft requires explicit reconciliation review before submission', async t => {
  const f = await sitesFixture(t); await add(f, 'draft.example');
  const policy = f.controller.getView().snapshot.policy;
  await f.firefox.send({ kind: 'PROPOSE_POLICY', candidatePolicy: { ...policy, whitelist: [...policy.whitelist, 'elsewhere.example'] } });
  const p = f.controller.getView().snapshot.vaultState.pendingProposal; f.clock.time = p.readyAt; await f.firefox.send({ kind: 'CONFIRM_POLICY', proposalId: p.id });
  f.sites.render(true); await f.flush(); await f.submit(); assert.equal(f.proposals(), 0); assert.match(f.el('destination-draft-stale').textContent, /policy changed/i);
  f.el('reconcile-destination-draft').fire('click'); await f.flush(); assert.equal(f.sites.session().value.draft.baseline.policyRevision, 0);
  f.el('accept-draft-reconciliation').fire('click'); await f.flush(); assert.equal(f.sites.session().value.draft.baseline.policyRevision, 1);
  await f.submit(); assert.equal(f.proposals(), 1); assert.ok(f.controller.getView().snapshot.vaultState.pendingProposal.candidatePolicy.whitelist.includes('elsewhere.example'));
});
test('reconciliation shows conflicting committed destination edits and preserves desired result', async t => {
  const f = await model(t), before = f.base.entries[0]; const d = stageDestination(f.draft, before.metadata.id, { ...before, metadata: { ...before.metadata, label: 'My label' } });
  const current = { ...f.base, entries: f.base.entries.map(e => e.metadata.id === before.metadata.id ? { ...e, metadata: { ...e.metadata, label: 'Elsewhere label' } } : e) };
  const preview = reconcileDraft(d, current); assert.ok(preview.conflicts.length); assert.equal(d.changes[0].before.metadata.label, before.metadata.label);
  assert.equal(preview.draft.changes[0].before.metadata.label, 'Elsewhere label'); assert.equal(preview.draft.changes[0].after.metadata.label, 'My label');
});
test('one complete mixed batch commits through one unchanged Vault wait and cannot replay', async t => {
  const f = await sitesFixture(t), initial = structuredClone(f.controller.getView().snapshot);
  for (const host of ['one.example', 'two.example', 'three.example']) await add(f, host);
  for (const host of ['four.example', 'five.example']) await add(f, host, 'BLACKLIST');
  f.el('sites-list').children.find(n => n.dataset.destinationId === 'host:blocked.example').fire('click'); f.el('remove-site').fire('click'); await f.flush();
  f.edit(); f.el('site-name').value = 'Renamed root'; f.el('site-category').value = 'Books'; f.el('site-pin').checked = true; await f.stage();
  assert.deepEqual(f.controller.getView().snapshot, initial); assert.equal(f.proposals(), 0); await f.submit(); assert.equal(f.proposals(), 1);
  const pending = f.controller.getView().snapshot.vaultState.pendingProposal;
  assert.equal(pending.readyAt - pending.createdAt, initial.configuration.vaultTiming.waitMs);
  assert.deepEqual(f.controller.getView().snapshot.policy, initial.policy); assert.equal((await f.firefox.send({ kind: 'CONFIRM_POLICY', proposalId: pending.id })).result.reason, 'NOT_READY');
  assert.equal(f.sites.session().value.receipt.draft.changes.length, 7);
  await f.confirm(); const committed = f.controller.getView().snapshot;
  assert.deepEqual(committed.policy.whitelist, ['one.example', 'root.example', 'three.example', 'two.example']); assert.deepEqual(committed.policy.blacklist, ['five.example', 'four.example']);
  assert.equal(committed.policyRevision, initial.policyRevision + 1); assert.equal(f.sites.metadata().find(d => d.id === original.id).label, 'Renamed root');
  const replay = await f.firefox.send({ kind: 'CONFIRM_POLICY', proposalId: pending.id }); assert.equal(replay.result.reason, 'ALREADY_COMMITTED'); assert.equal(f.controller.getView().snapshot.policyRevision, committed.policyRevision);
});
test('drafts never authorize navigation before or during a proposal', async t => {
  const f = await sitesFixture(t); await add(f, 'draft.example'); const tab = await f.firefox.tabs.create({ url: 'about:blank' });
  assert.equal((await f.firefox.visit(tab.id, 'https://draft.example/')).cancel, true);
  await f.submit(); assert.equal(evaluate('draft.example', f.controller.getView().snapshot.policy).outcome, 'GREYLIST');
  assert.equal((await f.firefox.visit(tab.id, 'https://draft.example/')).cancel, true); await f.flush();
});
test('pending proposal cannot be silently replaced but local edits can accumulate', async t => {
  const f = await sitesFixture(t); const policy = f.controller.getView().snapshot.policy;
  await f.firefox.send({ kind: 'PROPOSE_POLICY', candidatePolicy: { ...policy, blacklist: [...policy.blacklist, 'pending.example'] } });
  const id = f.controller.getView().snapshot.vaultState.pendingProposal.id; await add(f, 'later.example'); await f.submit();
  assert.equal(f.proposals(), 0); assert.equal(f.controller.getView().snapshot.vaultState.pendingProposal.id, id); assert.equal(f.sites.session().value.draft.changes.length, 1);
});
test('definite submission failure keeps editable batch and retries only by explicit action', async t => {
  const f = await sitesFixture(t); await add(f, 'retry.example'); f.commandMode('FAIL'); await f.submit();
  assert.equal(f.sites.session().value.receipt.phase, 'RESOLVED'); assert.equal(f.controller.getView().snapshot.vaultState.pendingProposal, null);
  f.commandMode('OK'); await f.submit(); assert.equal(f.proposals(), 2); assert.ok(f.controller.getView().snapshot.vaultState.pendingProposal);
});
test('lost proposal response is correlated after recovery without a second submission', async t => {
  const f = await sitesFixture(t); await add(f, 'unknown.example'); f.commandMode('UNKNOWN_AFTER'); await f.submit();
  assert.equal(f.el('keep-current-display').hidden, true);
  f.el('keep-current-display').fire('click'); await f.flush();
  assert.equal(f.sites.session().value.receipt.phase, 'PREPARED'); await f.submit(); assert.equal(f.proposals(), 1);
  f.el('check-draft-submission').fire('click'); await f.flush(); assert.equal(f.sites.session().value.receipt.phase, 'PROPOSED');
  assert.equal(f.proposals(), 1); assert.ok(f.controller.getView().snapshot.vaultState.pendingProposal);
});
test('unknown submission before receipt creation remains frozen until explicit authority check', async t => {
  const f = await sitesFixture(t); await add(f, 'never-sent.example'); f.commandMode('UNKNOWN_BEFORE'); await f.submit();
  assert.equal(f.sites.session().value.receipt.phase, 'PREPARED'); f.sites.render(true); await f.flush(); assert.equal(f.proposals(), 1);
  f.el('check-draft-submission').fire('click'); await f.flush(); assert.equal(f.sites.session().value.receipt.phase, 'RESOLVED');
  assert.equal(evaluate('never-sent.example', f.controller.getView().snapshot.policy).outcome, 'GREYLIST');
});
test('uncorrelated submission can be explicitly discarded after verified recovery without repeating policy commands', async t => {
  const f = await sitesFixture(t); await add(f, 'uncertain.example'); f.commandMode('UNKNOWN_BEFORE'); await f.submit();
  const policy = f.controller.getView().snapshot.policy;
  const response = await f.firefox.send({ kind: 'PROPOSE_POLICY', candidatePolicy: { ...policy, whitelist: [...policy.whitelist, 'other-proposal.example'] } });
  await f.firefox.send({ kind: 'CANCEL_POLICY', proposalId: response.view.controller.snapshot.vaultState.pendingProposal.id });
  f.commandMode('OK'); f.el('check-draft-submission').fire('click'); await f.flush(); f.sites.render(true);
  assert.equal(f.sites.session().value.receipt.phase, 'PREPARED');
  assert.equal(f.el('keep-current-display').hidden, false, 'uncorrelated intent has an explicit non-authoritative exit');
  window.confirm = () => false; f.el('keep-current-display').fire('click'); await f.flush();
  assert.equal(f.sites.session().value.receipt.phase, 'PREPARED');
  const route = f.settings.propose;
  f.settings.propose = async command => {
    if (command.kind === 'RECOVER') await f.firefox.send({ kind: 'PROPOSE_POLICY', candidatePolicy: { ...policy, whitelist: [...policy.whitelist, 'racing-proposal.example'] } });
    return route(command);
  };
  window.confirm = () => true; f.el('keep-current-display').fire('click'); await f.flush();
  assert.equal(f.sites.session().value.receipt.phase, 'PREPARED', 'a new pending proposal during recovery prevents discard');
  const racing = f.controller.getView().snapshot.vaultState.pendingProposal;
  assert.ok(racing); await f.firefox.send({ kind: 'CANCEL_POLICY', proposalId: racing.id });
  f.settings.propose = route; f.sites.render(true);
  const before = structuredClone(f.controller.getView().snapshot);
  window.confirm = () => true; f.el('keep-current-display').fire('click'); await f.flush();
  assert.equal(f.sites.session().value.receipt.phase, 'KEPT'); assert.equal(f.sites.session().value.draft, null);
  assert.deepEqual(f.controller.getView().snapshot.policy, before.policy);
  assert.equal(f.controller.getView().snapshot.vaultState.nextProposalId, before.vaultState.nextProposalId);
  assert.equal(f.proposals(), 1); assert.equal((await f.raw.load()).value.receipt.phase, 'KEPT');
});
test('expired proposal cannot create policy or accompanying metadata', async t => {
  const f = await sitesFixture(t); await add(f, 'expired.example'); await f.submit(); const p = f.controller.getView().snapshot.vaultState.pendingProposal;
  f.clock.time = p.confirmBy; assert.equal((await f.firefox.send({ kind: 'CONFIRM_POLICY', proposalId: p.id })).result.reason, 'PROPOSAL_EXPIRED');
  f.sites.render(true); await f.flush(); assert.equal(evaluate('expired.example', f.controller.getView().snapshot.policy).outcome, 'GREYLIST');
  assert.equal(f.sites.metadata().some(d => d.primaryHostname === 'expired.example'), false);
});
test('receipt validation rejects changed candidate contents and invalid presentation without losing authority', async t => {
  assert.equal(readDestinationWorkspace({ version: 1, draft: null }), null);
  assert.equal(readDestinationWorkspace({ version: 1, draft: null, receipt: false }), null);
  const f = await sitesFixture(t); await add(f, 'frozen.example'); await f.submit(); const value = structuredClone(f.sites.session().value);
  const initial = structuredClone(f.controller.getView().snapshot.policy); value.receipt.candidatePolicy.whitelist.push('silently-added.example');
  assert.equal(readDestinationWorkspace(value), null); value.receipt.candidatePolicy.whitelist.pop(); value.receipt.draft.changes[0].after.pinned = true;
  assert.equal(readDestinationWorkspace(value).receipt.draft.changes[0].after.pinned, true, 'display receipt is local, not authority');
  assert.deepEqual(f.controller.getView().snapshot.policy, initial);
});
test('custom category suggestions reuse case/whitespace while preserving legacy bytes', () => {
  const legacy = [{ ...original, category: 'Books' }, { ...original, id: 'host:other.example', primaryHostname: 'other.example', hostnames: ['other.example'], category: ' books ' }];
  const preferences = readDestinationPreferences({ version: 1, destinations: legacy, pending: null }); const before = JSON.stringify(preferences);
  const suggestions = categorySuggestions(preferences.destinations.map(d => d.category), ['BOOKS', 'Miscellaneous']);
  assert.ok(suggestions.includes('University')); assert.ok(suggestions.includes('Books')); assert.ok(suggestions.includes('Miscellaneous'));
  assert.equal(suggestions.filter(s => s.toLowerCase() === 'books').length, 1); assert.equal(canonicalCategory(' BOOKS ', suggestions), 'Books');
  const index = destinationIndex({ whitelist: ['root.example', 'other.example'], blacklist: [] }, preferences.destinations);
  assert.equal(new Set(index.map(e => e.category)).size, 1); assert.equal(JSON.stringify(preferences), before);
});
test('display-only batch saves names/categories/pins with no policy revision or cooldown', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  f.edit(); f.el('site-name').value = 'Research root'; f.el('site-category').value = 'Books'; f.el('site-pin').checked = true; await f.stage();
  await f.submit(); assert.equal(f.proposals(), 0); assert.deepEqual(f.controller.getView().snapshot, before);
  assert.equal(f.sites.metadata()[0].category, 'Books'); assert.ok(f.settings.pins().includes(original.id));
});
test('complete destination review includes classification, explicit scopes, category and pins', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Named'; f.el('site-category').value = 'Books'; f.el('site-access').value = 'BLACKLIST'; await f.stage();
  const draft = f.sites.session().value.draft, candidate = assessDraft(draft, draft.baseline).candidatePolicy;
  const lines = destinationChangeSummary(draft.changes[0], draft.baseline.policy, candidate).join('\n');
  for (const term of ['Named', 'Whitelist → Blacklist', 'root.example', 'Category:', 'Pin:']) assert.ok(lines.includes(term));
  await f.submit(); f.sites.renderFrozenReview(); assert.equal(f.el('vault-destination-review').hidden, false); assert.match(f.el('vault-destination-items').children[0].textContent, /Books/); await f.flush();
});
test('www choice survives hostname editing and pin controls exclude Blacklist', async t => {
  const f = await sitesFixture(t); f.el('add-site').fire('click'); f.el('site-hostname').value = 'example.com'; f.el('site-hostname').fire('input');
  f.el('site-www').checked = true; f.el('site-www').fire('input'); f.el('site-hostname').value = ''; f.el('site-hostname').fire('input');
  assert.equal(f.el('site-www').checked, true); f.el('site-hostname').value = 'another.com'; f.el('site-hostname').fire('input'); assert.equal(f.el('site-www').checked, true);
  f.el('site-www').checked = false; f.el('site-www').fire('input'); f.el('site-hostname').value = 'third.com'; f.el('site-hostname').fire('input'); assert.equal(f.el('site-www').checked, false);
  f.el('site-access').value = 'BLACKLIST'; f.el('site-access').fire('input'); assert.equal(f.el('site-pin-field').hidden, true); await f.flush();
});
test('ordinary display replacement retains order and Home grouping stays functional', () => {
  const other = { ...original, id: 'host:other.example', label: 'Other', category: 'Books', primaryHostname: 'other.example', hostnames: ['other.example'] };
  const updated = replaceDestinationMetadata([original, other], { ...original, label: 'Renamed' }, original.id);
  assert.deepEqual(updated.map(e => e.id), [original.id, other.id]);
  const index = destinationIndex({ whitelist: ['root.example', 'other.example'], blacklist: [] }, updated); assert.equal(index.length, 2); assert.ok(index.some(e => e.category === 'Books'));
});

test('actual staged editor updates an addition and removal cancels it without a Vault cycle', async t => {
  const f = await sitesFixture(t); await add(f, 'same.example', 'WHITELIST', 'First');
  const item = f.el('destination-draft-items').children[0]; item.children[1].children[0].fire('click');
  f.el('site-name').value = 'Second'; f.el('site-access').value = 'BLACKLIST'; await f.stage();
  assert.equal(f.sites.session().value.draft.changes.length, 1); assert.equal(f.sites.session().value.draft.changes[0].after.metadata.label, 'Second');
  f.el('destination-draft-items').children[0].children[1].children[2].fire('click'); await f.flush();
  assert.equal(f.sites.session().value.draft.changes.length, 0); assert.equal(f.proposals(), 0);
});
test('an invalid candidate conflict is shown beside items and cannot submit', async t => {
  const f = await sitesFixture(t); await add(f, 'one.example'); f.el('add-site').fire('click'); f.el('site-name').value = 'Two';
  f.el('site-hostname').value = 'two.example'; f.el('site-extra').value = 'one.example'; await f.stage(); await f.submit();
  assert.equal(f.proposals(), 0); assert.match(f.el('destination-draft-conflicts').children[0].textContent, /also belongs/);
  assert.equal(f.el('submit-destination-draft').disabled, true); await f.flush();
});
test('mixed-display failure after commit survives restart without automatic retry or stale metadata activation', async t => {
  const f = await sitesFixture(t); await add(f, 'one.example'); await add(f, 'two.example', 'BLACKLIST'); await f.submit();
  f.mode('FAIL'); await f.confirm(); const revision = f.controller.getView().snapshot.policyRevision, nextId = f.controller.getView().snapshot.vaultState.nextProposalId;
  f.mode('OK'); f.clearHandlers(); const restarted = initializeSites(f.settings); await restarted.initialized; restarted.render(true); await f.flush(restarted);
  assert.equal(restarted.metadata().some(d => d.primaryHostname === 'one.example'), false); assert.equal(restarted.session().value.receipt.phase, 'APPLYING');
  f.el('retry-site-save').fire('click'); await f.flush(restarted); assert.equal(restarted.session().value.receipt.phase, 'DONE');
  assert.equal(restarted.metadata().some(d => d.primaryHostname === 'one.example'), true); assert.equal(f.controller.getView().snapshot.policyRevision, revision);
  assert.equal(f.controller.getView().snapshot.vaultState.nextProposalId, nextId); assert.equal(f.proposals(), 1);
});
test('receipt completion failure retries cleanup only and never duplicates committed authority', async t => {
  const f = await sitesFixture(t); await add(f, 'committed.example'); await f.submit();
  const originalSave = f.raw.save.bind(f.raw); let failDone = true;
  f.raw.save = async (revision, value) => value.receipt?.phase === 'DONE' && failDone ? { type: 'FAILED' } : originalSave(revision, value);
  await f.confirm(); assert.equal(f.sites.session().failure, 'FAILED'); assert.ok(f.sites.metadata().some(d => d.primaryHostname === 'committed.example'));
  const after = structuredClone(f.controller.getView().snapshot.policy); failDone = false;
  f.el('retry-destination-draft').fire('click'); await f.flush(); assert.equal(f.sites.session().value.receipt.phase, 'DONE'); assert.deepEqual(f.controller.getView().snapshot.policy, after); assert.equal(f.proposals(), 1);
});
test('later committed metadata conflicts cannot be overwritten by a frozen display retry', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Frozen label'; f.el('site-access').value = 'BLACKLIST'; await f.stage(); await f.submit();
  f.mode('FAIL'); await f.confirm(); f.mode('OK'); f.saved.set('atlas-destinations-v1', JSON.stringify({ version: 1, destinations: [{ ...original, label: 'Newer edit' }], pending: null }));
  f.el('retry-site-save').fire('click'); await f.flush(); assert.equal(JSON.parse(f.saved.get('atlas-destinations-v1')).destinations[0].label, 'Newer edit');
  assert.match(f.feedback.at(-1).message, /another page changed/); assert.equal(f.proposals(), 1);
  f.el('keep-current-display').fire('click'); await f.flush(); assert.equal(f.sites.session().value.receipt.phase, 'KEPT'); assert.ok(f.controller.getView().snapshot.policy.blacklist.includes('root.example'));
});
test('legacy single-proposal display envelopes still reconcile after a verified commit', async t => {
  const f = await sitesFixture(t); const policy = f.controller.getView().snapshot.policy;
  const response = await f.firefox.send({ kind: 'PROPOSE_POLICY', candidatePolicy: { ...policy, blacklist: [...policy.blacklist, 'root.example'] } });
  const p = response.view.controller.snapshot.vaultState.pendingProposal;
  f.saved.set('atlas-destinations-v1', JSON.stringify({ version: 1, destinations: [original], pending: { proposalId: p.id, basePolicyRevision: p.basePolicyRevision,
    candidatePolicy: p.candidatePolicy, destination: { ...original, label: 'Legacy label' }, removedId: original.id, pin: false } }));
  for (const handler of window.listeners.storage) handler({ key: 'atlas-destinations-v1' });
  f.clock.time = p.readyAt; await f.firefox.send({ kind: 'CONFIRM_POLICY', proposalId: p.id }); f.sites.render(true); await f.flush();
  assert.equal(f.sites.metadata()[0].label, 'Legacy label'); assert.equal(JSON.parse(f.saved.get('atlas-destinations-v1')).pending, null);
});
test('removing an explicit Blacklist rule never removes the separate managed denial', async t => {
  const { compileManagedBlacklist } = await import('@atlas/core');
  const managed = compileManagedBlacklist(['blocked.example']);
  const f = await sitesFixture(t, { managedBlacklist: () => managed });
  f.el('sites-list').children.find(n => n.dataset.destinationId === 'host:blocked.example').fire('click'); f.el('remove-site').fire('click'); await f.flush(); await f.submit(); await f.confirm();
  assert.equal(f.controller.getView().snapshot.policy.blacklist.includes('blocked.example'), false);
  const opened = await f.firefox.send({ kind: 'OPEN_DESTINATION', url: 'https://blocked.example/' });
  assert.equal((await f.firefox.visit(opened.tabId, 'https://blocked.example/')).cancel, true);
  assert.equal(f.adapter.view().contexts.find(c => c.tabId === opened.tabId).latest.decision.reason, 'MANAGED_BLACKLISTED'); await f.flush();
});

test('damaged local draft is retained until explicit discard and never resets authority', async t => {
  const f = await model(t), repo = await openDraftRepository(f.factory); t.after(() => repo.close());
  const db = await new Promise(resolve => { const r=f.factory.open('atlas-destination-drafts-v1');r.onsuccess=()=>resolve(r.result); });
  await new Promise(resolve => { const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put({ revision: 1, value: { version: 999, draft: 'invalid' } },'current');tx.oncomplete=resolve; });
  const session = new DestinationWorkspaceSession(repo, () => {}); assert.equal(await session.load(), false); assert.equal(session.loadReason, 'INVALID');
  const policy = structuredClone(f.controller.getView().snapshot.policy); await assert.rejects(repo.load(), /INVALID/);
  assert.equal(await repo.discardInvalid(), true); assert.equal(await session.load(), true); assert.equal(session.value.draft, null); assert.deepEqual(f.controller.getView().snapshot.policy, policy);
  await repo.save(0, { version: 1, draft: f.draft, receipt: null }); assert.equal(await repo.discardInvalid(), false, 'repaired/new valid drafts cannot be discarded by a stale recovery action'); db.close();
});
test('unavailable post-commit display storage retains old metadata and an uncertain receipt', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Protected name'; f.el('site-access').value = 'BLACKLIST'; await f.stage(); await f.submit();
  f.mode('UNKNOWN'); await f.confirm(); assert.equal(f.sites.metadata()[0].label, 'Original'); assert.equal(f.feedback.at(-1).tone, 'uncertain');
  assert.equal(f.sites.session().value.receipt.phase, 'APPLYING'); const writes=f.writes();f.sites.render(true);await f.flush();assert.equal(f.writes(),writes);
  f.mode('OK');f.el('retry-site-save').fire('click');await f.flush();assert.equal(f.sites.metadata()[0].label,'Protected name');assert.equal(f.proposals(),1);
});
