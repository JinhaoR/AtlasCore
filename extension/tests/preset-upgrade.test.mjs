import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtlasController, evaluate } from '@atlas/core';
import { compileCuratedWhitelist } from '../dist/lib/presets/curated-whitelist.js';
import { FirefoxAdapter } from '../dist/lib/adapter/firefox-adapter.js';
import { fixture, configuration } from './support/fixture.mjs';

const policy = { whitelist: ['root.example', 'personal.example'], blacklist: ['blocked.example', 'claude.ai'] };

test('existing policy gains defaults only after reviewed, ready, saved Vault confirmation', async (t) => {
  const { firefox, controller, clock, repository } = await fixture(t, true, { policy });
  const proposed = await firefox.send({ kind: 'PROPOSE_CURATED_DEFAULTS' });
  const proposalId = proposed.result.referenceId;
  assert.equal(proposed.result.type, 'COMMITTED');
  assert.deepEqual(controller.getView().snapshot.policy, policy);
  const pending = controller.getView().snapshot.vaultState.pendingProposal;
  assert.deepEqual(pending.candidatePolicy.blacklist, policy.blacklist);
  assert.ok(pending.candidatePolicy.whitelist.includes('personal.example'));
  assert.ok(compileCuratedWhitelist().whitelist.every((hostname) => pending.candidatePolicy.whitelist.includes(hostname)));
  let review = (await firefox.send({ kind: 'REVIEW_POLICY', proposalId })).result.review;
  assert.equal(review.phase, 'WAITING');
  assert.deepEqual(review.whitelist.removed, []); assert.deepEqual(review.blacklist.removed, []);
  assert.equal((await firefox.send({ kind: 'CONFIRM_POLICY', proposalId })).result.reason, 'NOT_READY');
  clock.time = pending.readyAt;
  review = (await firefox.send({ kind: 'REVIEW_POLICY', proposalId })).result.review;
  assert.equal(review.phase, 'READY');
  assert.deepEqual(controller.getView().snapshot.policy, policy, 'time and review cannot commit');
  assert.equal((await firefox.send({ kind: 'CONFIRM_POLICY', proposalId })).result.type, 'COMMITTED');
  const active = (await repository.load()).envelope.snapshot;
  assert.equal(active.policyRevision, 1); assert.equal(active.vaultState.pendingProposal, null);
  assert.equal(evaluate('chatgpt.com', active.policy).outcome, 'ALLOW');
  assert.equal(evaluate('claude.ai', active.policy).outcome, 'DENY', 'manual exclusion survives the preset');
  assert.deepEqual(active.policy.blacklist, policy.blacklist);
  assert.equal(firefox.updates.length, 0, 'saving a policy does not navigate');
  assert.equal((await firefox.send({ kind: 'CONFIRM_POLICY', proposalId })).result.reason, 'ALREADY_COMMITTED');
  assert.equal((await firefox.send({ kind: 'PROPOSE_CURATED_DEFAULTS' })).result.reason, 'NO_POLICY_CHANGE');
});

test('preset cancellation and expiry leave active policy intact and require a new full wait', async (t) => {
  const { firefox, controller, clock } = await fixture(t, true, { policy });
  const first = await firefox.send({ kind: 'PROPOSE_CURATED_DEFAULTS' });
  const id = first.result.referenceId;
  assert.equal((await firefox.send({ kind: 'CANCEL_POLICY', proposalId: id })).result.type, 'COMMITTED');
  clock.time += 100;
  assert.equal((await firefox.send({ kind: 'CONFIRM_POLICY', proposalId: id })).result.reason, 'PROPOSAL_NOT_FOUND');
  const next = await firefox.send({ kind: 'PROPOSE_CURATED_DEFAULTS' });
  const proposal = controller.getView().snapshot.vaultState.pendingProposal;
  assert.equal(proposal.readyAt, clock.time + configuration.vaultTiming.waitMs);
  clock.time = proposal.confirmBy;
  assert.equal((await firefox.send({ kind: 'CONFIRM_POLICY', proposalId: next.result.referenceId })).result.reason, 'PROPOSAL_EXPIRED');
  assert.deepEqual(controller.getView().snapshot.policy, policy);
});

test('failed preset confirmation never publishes the candidate policy or replaces initialized storage', async (t) => {
  const { firefox, controller, repository, clock } = await fixture(t, true, { policy });
  const id = (await firefox.send({ kind: 'PROPOSE_CURATED_DEFAULTS' })).result.referenceId;
  clock.time = controller.getView().snapshot.vaultState.pendingProposal.readyAt;
  repository.commit = async ({ commitId }) => ({ type: 'NOT_WRITTEN', commitId });
  const result = (await firefox.send({ kind: 'CONFIRM_POLICY', proposalId: id })).result;
  assert.equal(result.type, 'BLOCKED'); assert.equal(result.reason, 'WRITE_FAILED');
  assert.deepEqual(controller.getView().snapshot.policy, policy);
  assert.deepEqual((await repository.load()).envelope.snapshot.policy, policy);
  assert.equal((await firefox.send({ kind: 'SETUP', policy: compileCuratedWhitelist() })).initialized, false);
});

test('reload retains a frozen preset proposal and websites cannot call the policy bridge', async (t) => {
  const { firefox, controller, repository, clock, adapter } = await fixture(t, true, { policy });
  const id = (await firefox.send({ kind: 'PROPOSE_CURATED_DEFAULTS' })).result.referenceId;
  const pending = controller.getView().snapshot.vaultState.pendingProposal;
  assert.equal((await firefox.send({ kind: 'PROPOSE_CURATED_DEFAULTS', candidatePolicy: compileCuratedWhitelist() })).error, 'INVALID_COMMAND');
  for (const command of [{ kind: 'PROPOSE_CURATED_DEFAULTS' }, { kind: 'CONFIRM_POLICY', proposalId: id },
    { kind: 'CANCEL_POLICY', proposalId: id }, { kind: 'REVIEW_POLICY', proposalId: id }]) {
    assert.equal(await firefox.send(command, { id: firefox.runtime.id, url: 'https://root.example/', frameId: 0 }), false);
  }
  assert.deepEqual(controller.getView().snapshot.vaultState.pendingProposal, pending);
  adapter.stop();
  const restored = createAtlasController({ repository, clock, configuration, ownerId: 'preset_restart' });
  const restarted = new FirefoxAdapter(firefox, Promise.resolve({ repository, controller: restored }),
    () => 'restored_context', () => clock.now(), firefox.schedule, firefox.unschedule);
  t.after(() => restarted.stop());
  await restarted.ready;
  assert.deepEqual(restored.getView().snapshot.policy, policy);
  assert.deepEqual(restored.getView().snapshot.vaultState.pendingProposal, pending);
  assert.equal((await firefox.send({ kind: 'PROPOSE_CURATED_DEFAULTS' })).result.reason, 'PROPOSAL_PENDING');
  assert.equal((await firefox.send({ kind: 'REVIEW_POLICY', proposalId: id })).result.review.phase, 'WAITING');
});
