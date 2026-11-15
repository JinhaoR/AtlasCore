import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBObjectStore } from 'fake-indexeddb';
import { evaluate } from '@atlas/core';
import { sitesFixture, original } from './support/ui-fixture.mjs';
import { readDestinationWorkspace } from '../dist/lib/ui/draft-storage.js';

async function remove(f, id = original.id) {
  f.sites.render(true);
  f.el('sites-list').children.find(row => row.dataset.destinationId === id).fire('click');
  f.el('remove-site').fire('click'); await f.flush(); f.sites.render(true);
}
async function add(f, host = 'new.example') {
  f.el('add-site').fire('click'); f.el('site-name').value = 'New'; f.el('site-hostname').value = host;
  f.el('site-category').value = 'Research'; f.el('site-access').value = 'WHITELIST'; await f.stage();
}

test('a reviewed Whitelist-only removal applies without time passing or creating a Vault proposal', async t => {
  const f = await sitesFixture(t), before = f.controller.getView().snapshot, now = f.clock.time;
  await remove(f);
  assert.deepEqual(f.controller.getView().snapshot, before, 'staging cannot modify authority');
  assert.equal(f.el('submit-destination-draft').textContent, 'Remove allowed sites now');
  await f.submit();
  const after = f.controller.getView().snapshot;
  assert.equal(evaluate('root.example', after.policy).outcome, 'GREYLIST');
  assert.equal(after.policyRevision, before.policyRevision + 1); assert.equal(f.clock.time, now);
  assert.deepEqual(after.policy.blacklist, before.policy.blacklist); assert.deepEqual(after.configuration, before.configuration);
  assert.equal(after.vaultState.pendingProposal, null); assert.equal(after.vaultState.nextProposalId, before.vaultState.nextProposalId);
  assert.equal(f.proposals(), 0); assert.equal(f.removals(), 1);
  assert.equal(f.sites.session().value.receipt.kind, 'REMOVAL'); assert.equal(f.sites.session().value.receipt.phase, 'DONE');
  assert.equal(f.sites.metadata().some(item => item.id === original.id), false);
  assert.match(f.feedback.at(-1).message, /without a cooldown/);
});

test('an addition and a mixed batch retain one frozen Vault wait with no early removal', async t => {
  for (const mixed of [false, true]) await t.test(mixed ? 'mixed' : 'addition', async child => {
    const f = await sitesFixture(child), before = f.controller.getView().snapshot;
    if (mixed) await remove(f);
    await add(f); assert.equal(f.el('submit-destination-draft').textContent, 'Send to Vault');
    await f.submit();
    assert.deepEqual(f.controller.getView().snapshot.policy, before.policy); assert.equal(f.removals(), 0); assert.equal(f.proposals(), 1);
    const pending = f.controller.getView().snapshot.vaultState.pendingProposal;
    assert.ok(pending); assert.equal((await f.firefox.send({ kind: 'CONFIRM_POLICY', proposalId: pending.id })).result.reason, 'NOT_READY');
    await f.confirm();
    assert.equal(evaluate('new.example', f.controller.getView().snapshot.policy).outcome, 'ALLOW');
    assert.equal(evaluate('root.example', f.controller.getView().snapshot.policy).outcome, mixed ? 'GREYLIST' : 'ALLOW');
  });
});

test('Blacklist removal cannot use the immediate Whitelist workflow', async t => {
  const f = await sitesFixture(t); await remove(f, 'host:blocked.example');
  assert.equal(f.el('submit-destination-draft').textContent, 'Send to Vault');
  await f.submit(); assert.equal(f.removals(), 0); assert.equal(f.proposals(), 1);
  assert.equal(evaluate('blocked.example', f.controller.getView().snapshot.policy).reason, 'BLACKLISTED');
});

test('removal while another frozen proposal exists preserves its contents and makes it stale', async t => {
  const f = await sitesFixture(t), current = f.controller.getView().snapshot;
  await f.firefox.send({ kind: 'PROPOSE_POLICY', candidatePolicy: { ...current.policy, whitelist: [...current.policy.whitelist, 'external.example'] } });
  const frozen = f.controller.getView().snapshot.vaultState.pendingProposal;
  await remove(f); await f.submit();
  assert.equal(f.removals(), 1); assert.deepEqual(f.controller.getView().snapshot.vaultState.pendingProposal, frozen);
  assert.equal(evaluate('root.example', f.controller.getView().snapshot.policy).outcome, 'GREYLIST');
  f.clock.time = frozen.readyAt;
  assert.equal((await f.firefox.send({ kind: 'CONFIRM_POLICY', proposalId: frozen.id })).result.reason, 'POLICY_CHANGED');
});

test('unknown removal acknowledgements recover desired state without resending the command', async t => {
  for (const mode of ['UNKNOWN_BEFORE', 'UNKNOWN_AFTER']) await t.test(mode, async child => {
    const f = await sitesFixture(child); await remove(f); f.commandMode(mode); await f.submit();
    assert.equal(f.sites.session().value.receipt.phase, 'PREPARED'); assert.equal(f.removals(), 1);
    assert.equal(f.controller.getView().snapshot.policy.whitelist.includes('root.example'), mode === 'UNKNOWN_BEFORE');
    f.commandMode('OK'); f.el('check-draft-submission').fire('click'); await f.flush();
    assert.equal(f.removals(), 1, 'Recovery must not repeat removal');
    assert.equal(f.sites.session().value.receipt.phase, mode === 'UNKNOWN_AFTER' ? 'DONE' : 'RESOLVED');
    if (mode === 'UNKNOWN_BEFORE') assert.equal(f.sites.session().value.draft.changes.length, 1);
  });
});

test('failed durable draft saving never sends an immediate policy operation', async t => {
  const f = await sitesFixture(t), before = f.controller.getView().snapshot;
  f.draftMode('FAILED'); await remove(f); await f.submit();
  assert.equal(f.removals(), 0); assert.deepEqual(f.controller.getView().snapshot, before);
  assert.equal(f.sites.session().unsaved, true);
  f.draftMode('OK'); f.el('retry-destination-draft').fire('click'); await f.flush(); await f.submit();
  assert.equal(f.removals(), 1); assert.equal(evaluate('root.example', f.controller.getView().snapshot.policy).outcome, 'GREYLIST');
});

test('a real repository write failure retains old authority and requires explicit recovery/review', async t => {
  const f = await sitesFixture(t); await remove(f);
  const addReceipt = IDBObjectStore.prototype.add; let attempts = 0;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'receipts') { attempts++; throw new DOMException('Synthetic quota', 'QuotaExceededError'); }
    return addReceipt.apply(this, args);
  };
  t.after(() => { IDBObjectStore.prototype.add = addReceipt; });
  await f.submit();
  assert.equal(attempts, 1); assert.equal(f.controller.getView().status, 'UNAVAILABLE');
  assert.equal(evaluate('root.example', f.controller.getView().snapshot.policy).outcome, 'ALLOW');
  assert.equal(f.sites.session().value.receipt.phase, 'PREPARED'); assert.equal(f.removals(), 1);
  IDBObjectStore.prototype.add = addReceipt;
  f.el('check-draft-submission').fire('click'); await f.flush();
  assert.equal(f.controller.getView().status, 'READY'); assert.equal(f.sites.session().value.receipt.phase, 'RESOLVED');
  assert.equal(f.removals(), 1); assert.ok(f.sites.session().value.draft);
});

test('post-commit presentation retry never repeats a successful removal', async t => {
  const f = await sitesFixture(t); await remove(f); f.mode('FAIL'); await f.submit();
  assert.equal(f.sites.session().value.receipt.phase, 'APPLYING');
  const revision = f.controller.getView().snapshot.policyRevision;
  assert.equal(f.removals(), 1); assert.equal(evaluate('root.example', f.controller.getView().snapshot.policy).outcome, 'GREYLIST');
  f.mode('OK'); f.el('retry-site-save').fire('click'); await f.flush();
  assert.equal(f.sites.session().value.receipt.phase, 'DONE'); assert.equal(f.removals(), 1);
  assert.equal(f.controller.getView().snapshot.policyRevision, revision);
});

test('a concurrent removal cannot be undone by an older complete candidate', async t => {
  const f = await sitesFixture(t, { policy: { whitelist: ['root.example', 'other.example'], blacklist: ['blocked.example'] } });
  await remove(f);
  const send = f.settings.propose; let raced = false;
  f.settings.propose = async command => {
    if (command.kind === 'REMOVE_WHITELIST' && !raced) {
      raced = true; const state = f.controller.getView().snapshot;
      await f.firefox.send({ kind: 'REMOVE_WHITELIST', candidatePolicy: { ...state.policy, whitelist: ['root.example'] }, basePolicyRevision: state.policyRevision });
    }
    return send(command);
  };
  await f.submit();
  assert.equal(f.controller.getView().snapshot.policy.whitelist.includes('root.example'), true);
  assert.equal(f.controller.getView().snapshot.policy.whitelist.includes('other.example'), false);
  assert.equal(f.sites.session().value.receipt.phase, 'RESOLVED'); assert.ok(f.sites.session().value.draft);
});

test('parent-scope coverage is disclosed instead of falsely promising that exact removal blocks the host', async t => {
  const f = await sitesFixture(t, { policy: { whitelist: ['root.example', 'child.root.example'], blacklist: [], whitelistSubdomains: ['root.example'] } });
  await remove(f, 'host:child.root.example');
  const summary = f.el('destination-draft-items').children[0].children[0].children.map(n => n.textContent).join('\n');
  assert.match(summary, /Still allowed by another saved scope: child\.root\.example/);
  await f.submit();
  assert.equal(f.removals(), 1); assert.equal(f.controller.getView().snapshot.policy.whitelist.includes('child.root.example'), false);
  assert.equal(evaluate('child.root.example', f.controller.getView().snapshot.policy).reason, 'WHITELISTED_SCOPE');
});

test('forged removal receipts cannot disguise additions or Blacklist changes and websites cannot issue commands', async t => {
  const f = await sitesFixture(t); await add(f); await f.submit();
  const workspace = structuredClone(f.sites.session().value); workspace.receipt.kind = 'REMOVAL';
  assert.equal(readDestinationWorkspace(workspace), null);
  const before = f.controller.getView().snapshot;
  const response = await f.firefox.send({ kind: 'REMOVE_WHITELIST', candidatePolicy: { ...before.policy, whitelist: [] }, basePolicyRevision: before.policyRevision },
    { id: f.firefox.runtime.id, url: 'https://root.example/', frameId: 0 });
  assert.equal(response, false); assert.deepEqual(f.controller.getView().snapshot, before);
});
