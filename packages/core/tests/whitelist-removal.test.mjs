import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessState, createAtlasController, createJourneyState, createVaultState,
  compileManagedBlacklist, evaluate, isWhitelistRemoval, planAtlasOperation, validateAtlasSnapshot } from '../dist/index.js';
import { FakeRepository, deferred } from './support/fake-repository.mjs';

const configuration = { accessTiming: { waitMs: 10, confirmationWindowMs: 100, grantDurationMs: 200 },
  vaultTiming: { waitMs: 10000, confirmationWindowMs: 1000 }, journeyLimits: { lifetimeMs: 20000, maxHops: 3 } };
const policy = { whitelist: ['a.example', 'b.example', 'both.example'], blacklist: ['blocked.example', 'both.example'],
  whitelistSubdomains: ['scoped.example'] };
async function fixture(input = policy, managed) {
  const repository = new FakeRepository({ policy: input, policyRevision: 0, configuration, configurationRevision: 0,
    accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState() });
  const clock = { time: 100, now() { return this.time; } };
  const options = { repository, clock, configuration, ownerId: 'removal', ...(managed ? { managedBlacklist: () => managed } : {}) };
  const controller = createAtlasController(options); assert.equal((await controller.open()).status, 'READY');
  return { repository, clock, controller, options };
}
const without = (current, ...hosts) => ({ ...current, whitelist: current.whitelist.filter(h => !hosts.includes(h)) });
const command = (candidatePolicy, basePolicyRevision = 0) => ({ kind: 'REMOVE_WHITELIST', candidatePolicy, basePolicyRevision });
const check = hostname => ({ kind: 'CHECK_NAVIGATION', target: { hostname }, context: { contextId: 'retained', journeyId: null } });

test('only strict Whitelist/subdomain-root subtractions qualify; normalization does not invent aliases', () => {
  const before = structuredClone(policy);
  assert.equal(isWhitelistRemoval(policy, without(policy, 'a.example')), true);
  assert.equal(isWhitelistRemoval(policy, { ...policy, whitelistSubdomains: [] }), true);
  assert.equal(isWhitelistRemoval({ whitelist: ['a.example', 'www.a.example'], blacklist: [] }, { whitelist: ['www.a.example'], blacklist: [] }), true);
  assert.equal(isWhitelistRemoval({ whitelist: [' A.EXAMPLE ', 'b.example'], blacklist: [] }, { whitelist: ['b.example'], blacklist: [] }), true);
  for (const candidate of [policy, { ...policy, whitelist: [...policy.whitelist, 'new.example'] },
    { ...without(policy, 'a.example'), whitelistSubdomains: ['scoped.example', 'new.example'] },
    { ...without(policy, 'a.example'), blacklist: [] }, { ...without(policy, 'a.example'), blacklist: [...policy.blacklist, 'new.example'] },
    { ...policy, whitelistSubdomains: ['child.scoped.example'] }, { whitelist: [], blacklist: ['*.invalid.example'] },
    { whitelist: [], blacklist: [] }, null]) assert.equal(isWhitelistRemoval(policy, candidate), false);
  assert.equal(isWhitelistRemoval({ whitelist: ['a.example', 'a.example'], blacklist: [] }, { whitelist: ['a.example'], blacklist: [] }), false);
  assert.deepEqual(policy, before);
});

test('an immediate removal commits once without advancing time or fabricating Vault history', async () => {
  const f = await fixture(), before = f.controller.getView().snapshot;
  const result = await f.controller.handle(command(without(before.policy, 'a.example')));
  assert.equal(result.type, 'COMMITTED'); assert.equal(result.operation, 'REMOVE_WHITELIST'); assert.equal(result.referenceId, 1);
  const after = f.controller.getView().snapshot;
  assert.equal(after.policyRevision, 1); assert.equal(f.clock.time, 100);
  assert.equal(evaluate('a.example', after.policy).outcome, 'GREYLIST');
  assert.equal(evaluate('b.example', after.policy).reason, 'WHITELISTED');
  assert.deepEqual(after.policy.blacklist, before.policy.blacklist); assert.deepEqual(after.configuration, before.configuration);
  assert.equal(after.configurationRevision, before.configurationRevision);
  assert.deepEqual(after.vaultState, { ...before.vaultState, policyRevision: 1 });
  assert.ok(validateAtlasSnapshot(after).ok);
  assert.equal((await f.controller.handle(command(without(before.policy, 'a.example')))).reason, 'POLICY_CHANGED');
  assert.equal(f.controller.getView().snapshot.policyRevision, 1);
});

test('additions, mixed changes, new managed exceptions and malformed/stale commands cannot use removal', async () => {
  const f = await fixture(), before = f.controller.getView().snapshot;
  const candidates = [{ ...without(policy, 'a.example'), whitelist: ['new.example', 'b.example', 'both.example'] },
    { ...policy, whitelist: [...policy.whitelist, 'child.scoped.example'] },
    { ...policy, whitelistSubdomains: ['scoped.example', 'b.example'] },
    { ...without(policy, 'a.example'), blacklist: ['both.example'] }];
  for (const candidate of candidates) assert.equal((await f.controller.handle(command(candidate))).reason, 'NOT_WHITELIST_REMOVAL');
  assert.equal((await f.controller.handle(command(policy))).reason, 'NOT_WHITELIST_REMOVAL');
  assert.equal((await f.controller.handle(command(without(policy, 'a.example'), 1))).reason, 'POLICY_CHANGED');
  for (const value of [{ ...command(without(policy, 'a.example')), now: 0 }, { ...command(without(policy, 'a.example')), basePolicyRevision: -1 },
    { kind: 'REMOVE_WHITELIST', candidatePolicy: without(policy, 'a.example') }, command({ whitelist: ['*.example'], blacklist: [] })]) {
    assert.equal((await f.controller.handle(value)).type, 'REJECTED');
  }
  assert.deepEqual(f.controller.getView().snapshot, before);
});

test('candidate removal remains inactive until acknowledgement and failed persistence cannot publish it', async () => {
  const f = await fixture(), before = f.controller.getView().snapshot, began = deferred(), release = deferred();
  f.repository.steps.push(async (request, repo) => { began.resolve(); await release.promise; return repo.apply(request); });
  let published = false;
  const applying = f.controller.handle(command(without(policy, 'a.example'))).then(result => { published = true; return result; });
  await began.promise;
  assert.equal(f.controller.getView().status, 'COMMITTING'); assert.equal(published, false);
  assert.deepEqual(f.controller.getView().snapshot, before);
  release.resolve(); assert.equal((await applying).type, 'COMMITTED');
  const failed = await fixture(); failed.repository.steps.push((request, repo) => repo.fail(request));
  assert.equal((await failed.controller.handle(command(without(policy, 'a.example')))).reason, 'WRITE_FAILED');
  assert.equal(failed.repository.envelope.snapshot.policy.whitelist.includes('a.example'), true);
  assert.equal((await failed.controller.handle(check('a.example'))).type, 'BLOCKED');
});

test('unknown outcomes require resolution and never replay a removal', async () => {
  for (const applied of [false, true]) {
    const f = await fixture(); f.repository.steps.push((request, repo) => repo.unknown(request, applied));
    const result = await f.controller.handle(command(without(policy, 'a.example')));
    assert.equal(result.reason, 'COMMIT_UNKNOWN'); const id = f.controller.getView().pendingCommitId;
    assert.equal((await f.controller.open()).status, 'RECONCILING'); assert.equal(f.repository.commits.length, 2);
    // The first commit is open()'s observation checkpoint, not a policy command.
    f.repository.settle(id); assert.equal((await f.controller.open()).status, 'READY');
    assert.equal(f.controller.getView().snapshot.policy.whitelist.includes('a.example'), !applied);
    assert.equal(f.repository.commits.length, 2);
  }
});

test('a conflict or concurrent stale reduction cannot re-add another writer\'s removed host', async () => {
  const f = await fixture(), old = f.controller.getView().snapshot;
  f.repository.steps.push((request, repo) => {
    repo.replace({ ...old, policy: without(old.policy, 'b.example'), policyRevision: 1 });
    return repo.apply(request);
  });
  assert.equal((await f.controller.handle(command(without(policy, 'a.example')))).reason, 'STORAGE_CONFLICT');
  await f.controller.open();
  assert.equal((await f.controller.handle(command(without(policy, 'a.example')))).reason, 'POLICY_CHANGED');
  assert.deepEqual(f.controller.getView().snapshot.policy, without(policy, 'b.example'));
  const concurrent = await fixture();
  const results = await Promise.all([concurrent.controller.handle(command(without(policy, 'a.example'))),
    concurrent.controller.handle(command(without(policy, 'b.example')))]);
  assert.equal(results[0].type, 'COMMITTED'); assert.equal(results[1].reason, 'POLICY_CHANGED');
  assert.equal(concurrent.controller.getView().snapshot.policy.whitelist.includes('b.example'), true);
});

test('pending Vault contents stay frozen and cannot silently restore a removed permission', async () => {
  const f = await fixture();
  const access = await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'grey.example' } });
  f.clock.time += 10; await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: access.referenceId });
  const pending = await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'pending.example' } });
  await f.controller.handle({ kind: 'START_JOURNEY', root: { hostname: 'a.example' }, contextId: 'journey' });
  const proposal = await f.controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: { ...policy, whitelist: [...policy.whitelist, 'new.example'] } });
  const before = f.controller.getView().snapshot;
  assert.equal((await f.controller.handle(command(without(policy, 'a.example')))).type, 'COMMITTED');
  const after = f.controller.getView().snapshot;
  assert.deepEqual(after.vaultState.pendingProposal, before.vaultState.pendingProposal);
  assert.equal(after.vaultState.nextProposalId, before.vaultState.nextProposalId); assert.deepEqual(after.vaultState.lastApplied, before.vaultState.lastApplied);
  assert.deepEqual(after.accessState.grants, before.accessState.grants); assert.deepEqual(after.accessState.pendingRequests, before.accessState.pendingRequests);
  assert.equal(after.journeyState.journeys[0].endReason, 'POLICY_CHANGED');
  assert.equal((await f.controller.handle(check('grey.example'))).decision.outcome, 'GREYLIST');
  f.clock.time = before.vaultState.pendingProposal.readyAt;
  assert.equal((await f.controller.handle({ kind: 'CONFIRM_POLICY', proposalId: proposal.referenceId })).reason, 'POLICY_CHANGED');
  assert.equal((await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: pending.referenceId })).reason, 'POLICY_CHANGED');
  assert.equal(f.controller.getView().snapshot.policy.whitelist.includes('a.example'), false);
});

test('removal restores managed denial while manual Blacklist and independent parent scopes remain effective', async () => {
  const input = { whitelist: ['scoped.example', 'child.scoped.example', 'both.example'], blacklist: ['both.example'], whitelistSubdomains: ['scoped.example'] };
  const managed = compileManagedBlacklist(['child.scoped.example']); const f = await fixture(input, managed);
  assert.equal((await f.controller.handle(check('child.scoped.example'))).decision.reason, 'WHITELISTED');
  assert.equal((await f.controller.handle(command(without(input, 'child.scoped.example', 'both.example')))).type, 'COMMITTED');
  assert.equal((await f.controller.handle(check('child.scoped.example'))).decision.reason, 'MANAGED_BLACKLISTED');
  assert.equal((await f.controller.handle(check('both.example'))).decision.reason, 'BLACKLISTED');
  assert.equal((await f.controller.handle(check('other.scoped.example'))).decision.reason, 'WHITELISTED_SCOPE');
});

test('removing the last entry survives restart as a verified empty policy and cannot seed defaults', async () => {
  const f = await fixture({ whitelist: ['a.example'], blacklist: [] });
  assert.equal((await f.controller.handle(command({ whitelist: [], blacklist: [] }))).type, 'COMMITTED');
  const restarted = createAtlasController({ ...f.options, ownerId: 'restart' });
  assert.equal((await restarted.open()).status, 'READY');
  assert.deepEqual(restarted.getView().snapshot.policy, { whitelist: [], blacklist: [] });
  assert.equal((await restarted.handle(check('a.example'))).decision.outcome, 'GREYLIST');
});

test('pure removal plans are deterministic and do not mutate authority or bypass revision exhaustion', async () => {
  const f = await fixture(), snapshot = structuredClone(f.controller.getView().snapshot), original = structuredClone(snapshot);
  const context = { snapshot, now: 100, configuration }, operation = command(without(policy, 'a.example'));
  const first = planAtlasOperation(operation, context);
  assert.deepEqual(planAtlasOperation(operation, context), first); assert.deepEqual(snapshot, original);
  assert.equal(first.result.type, 'TRANSITION_PREPARED'); assert.ok(first.candidateSnapshot);
  assert.equal(planAtlasOperation(operation, { ...context, snapshot: { ...snapshot, accessState: {} } }).candidateSnapshot, null);
  const max = { ...snapshot, policyRevision: Number.MAX_SAFE_INTEGER };
  assert.equal(planAtlasOperation(command(without(policy, 'a.example'), max.policyRevision), { ...context, snapshot: max }).result.reason, 'REVISION_EXHAUSTED');
});
