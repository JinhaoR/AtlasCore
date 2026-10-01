import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessState, createJourneyState, createVaultState, planAtlasOperation, validateAtlasSnapshot,
  createAtlasController, migrateAtlasSnapshotV1 } from '../dist/index.js';
import { FakeRepository } from './support/fake-repository.mjs';

const configuration = { accessTiming: { waitMs: 10, confirmationWindowMs: 20, grantDurationMs: 100 },
  vaultTiming: { waitMs: 30, confirmationWindowMs: 50 }, journeyLimits: { lifetimeMs: 200, maxHops: 3 } };
const candidateConfiguration = { accessTiming: { waitMs: 2, confirmationWindowMs: 8, grantDurationMs: 40 },
  vaultTiming: { waitMs: 1, confirmationWindowMs: 10 }, journeyLimits: { lifetimeMs: 50, maxHops: 1 } };
const initial = () => ({ policy: { whitelist: ['root.example'], blacklist: ['blocked.example'] }, policyRevision: 0,
  configuration, configurationRevision: 0, accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState() });
const propose = { kind: 'PROPOSE_SETTINGS', candidateConfiguration };
const confirm = { kind: 'CONFIRM_POLICY', proposalId: 1 };
const plan = (snapshot, now, operation, external = configuration) => planAtlasOperation(operation, { snapshot, now, configuration: external });
const adopt = (snapshot, now, operation) => {
  const result = plan(snapshot, now, operation);
  assert.ok(result.candidateSnapshot, JSON.stringify(result.result));
  assert.equal(validateAtlasSnapshot(result.candidateSnapshot).ok, true);
  return result.candidateSnapshot;
};

test('settings proposal freezes contents and old Vault terms; elapsed time and review never commit', () => {
  const original = initial(); original.policy.whitelist = ['z.example', 'root.example'];
  const before = structuredClone(original); const input = structuredClone(candidateConfiguration);
  const proposed = plan(original, 10, { kind: 'PROPOSE_SETTINGS', candidateConfiguration: input });
  const snapshot = proposed.candidateSnapshot;
  input.vaultTiming.waitMs = 500;
  assert.deepEqual(snapshot.configuration, configuration);
  assert.equal(snapshot.vaultState.pendingProposal.readyAt, 40);
  assert.equal(snapshot.vaultState.pendingProposal.confirmBy, 90);
  assert.deepEqual(snapshot.vaultState.pendingProposal.candidateConfiguration, candidateConfiguration);
  assert.equal(Object.isFrozen(input), false);
  assert.deepEqual(original, before);
  assert.equal(plan(snapshot, 39, confirm).result.reason, 'NOT_READY');
  const reviewed = plan(snapshot, 40, { kind: 'REVIEW_POLICY', proposalId: 1 });
  assert.equal(reviewed.result.review.phase, 'READY');
  assert.equal(reviewed.result.review.invalidatesAccess, false);
  assert.equal(reviewed.candidateSnapshot, null);
  assert.deepEqual(plan(snapshot, 40, { kind: 'OBSERVE_TIME' }).observationSnapshot.configuration, configuration);
  const committed = adopt(snapshot, 40, confirm);
  assert.deepEqual(committed.configuration, candidateConfiguration);
  assert.equal(committed.configurationRevision, 1);
  assert.equal(committed.policyRevision, 0);
  assert.deepEqual(committed.policy, original.policy, 'settings-only commit preserves original policy order and contents');
  assert.equal(committed.vaultState.pendingProposal, null);
  assert.equal(plan(committed, 41, confirm).result.reason, 'ALREADY_COMMITTED');
  assert.equal(plan(snapshot, 90, confirm).result.reason, 'PROPOSAL_EXPIRED');
});

test('policy and settings share a single pending slot and cancellation restarts full current protection', () => {
  const snapshot = adopt(initial(), 0, propose);
  assert.equal(plan(snapshot, 1, propose).result.reason, 'PROPOSAL_PENDING');
  assert.equal(plan(snapshot, 1, { kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: [], blacklist: [] } }).result.reason, 'PROPOSAL_PENDING');
  const cancelled = adopt(snapshot, 1, { kind: 'CANCEL_POLICY', proposalId: 1 });
  const restarted = adopt(cancelled, 2, propose);
  assert.equal(restarted.vaultState.pendingProposal.readyAt, 32);
  assert.equal(plan(restarted, 32, confirm).result.reason, 'PROPOSAL_NOT_FOUND');
});

test('legacy caller configuration cannot shorten a protected policy proposal and no-op settings do not occupy Vault', () => {
  const external = structuredClone(configuration); external.vaultTiming.waitMs = 1;
  const proposed = plan(initial(), 0, { kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: ['new.example'], blacklist: [] } }, external);
  assert.equal(proposed.candidateSnapshot.vaultState.pendingProposal.readyAt, 30);
  const unchanged = plan(initial(), 0, { kind: 'PROPOSE_SETTINGS', candidateConfiguration: configuration });
  assert.equal(unchanged.result.reason, 'NO_POLICY_CHANGE');
  assert.equal(unchanged.candidateSnapshot, null);
});

test('protected configuration revision exhaustion and deadline overflow never produce a commit candidate', () => {
  const exhausted = initial(); exhausted.configurationRevision = Number.MAX_SAFE_INTEGER;
  const pending = adopt(exhausted, 0, propose);
  assert.equal(plan(pending, 30, confirm).result.reason, 'REVISION_EXHAUSTED');
  const invalidTime = initial(); invalidTime.configuration = structuredClone(configuration);
  invalidTime.configuration.vaultTiming.waitMs = Number.MAX_SAFE_INTEGER;
  assert.equal(plan(invalidTime, 1, propose).result.reason, 'TIME_OVERFLOW');
});

test('existing pending requests, grants and Journeys retain frozen terms; new activity uses committed configuration', () => {
  let snapshot = adopt(initial(), 0, { kind: 'START_ACCESS', target: { hostname: 'grant.example' } });
  snapshot = adopt(snapshot, 10, { kind: 'CONFIRM_ACCESS', requestId: 1 });
  snapshot = adopt(snapshot, 10, { kind: 'START_ACCESS', target: { hostname: 'pending.example' } });
  snapshot = adopt(snapshot, 10, { kind: 'START_JOURNEY', root: { hostname: 'root.example' }, contextId: 'old_tab' });
  snapshot = adopt(snapshot, 10, propose);
  const oldGrant = snapshot.accessState.grants[0]; const oldRequest = snapshot.accessState.pendingRequests[0]; const oldJourney = snapshot.journeyState.journeys[0];
  snapshot = adopt(snapshot, 40, confirm);
  assert.deepEqual(snapshot.accessState.grants[0], oldGrant);
  // Existing request expires at 40 by its own original terms; confirmation cannot reopen it.
  assert.equal(plan(snapshot, 40, { kind: 'CONFIRM_ACCESS', requestId: oldRequest.id }).result.reason, 'REQUEST_EXPIRED');
  assert.equal(snapshot.journeyState.journeys[0].expiresAt, oldJourney.expiresAt);
  assert.equal(snapshot.journeyState.journeys[0].maxHops, 3);
  snapshot = adopt(snapshot, 41, { kind: 'START_ACCESS', target: { hostname: 'new.example' } });
  assert.equal(snapshot.accessState.pendingRequests.find((r) => r.hostname === 'new.example').readyAt, 43);
  assert.equal(snapshot.accessState.pendingRequests.find((r) => r.hostname === 'new.example').grantDurationMs, 40);
  snapshot = adopt(snapshot, 41, { kind: 'START_JOURNEY', root: { hostname: 'root.example' }, contextId: 'new_tab' });
  assert.equal(snapshot.journeyState.journeys[1].expiresAt, 91);
  assert.equal(snapshot.journeyState.journeys[1].maxHops, 1);
  // A caller's bootstrap preferences cannot override protected snapshot configuration.
  const alternate = structuredClone(configuration); alternate.accessTiming.waitMs = 999;
  assert.equal(plan(snapshot, 42, { kind: 'START_ACCESS', target: { hostname: 'another.example' } }, alternate).candidateSnapshot.accessState.pendingRequests.find((r) => r.hostname === 'another.example').readyAt, 44);
});

test('configuration validation and stale revisions, replacement content and clock rollback fail closed', () => {
  const pending = adopt(initial(), 10, propose);
  assert.equal(plan({ ...pending, configurationRevision: 1 }, 40, confirm).result.reason, 'CONFIGURATION_CHANGED');
  assert.equal(plan({ ...pending, policyRevision: 1 }, 40, confirm).result.reason, 'POLICY_CHANGED');
  assert.equal(plan(pending, 40, { ...confirm, candidateConfiguration }).result.reason, 'INVALID_OPERATION');
  const observed = plan(pending, 40, { kind: 'OBSERVE_TIME' }).observationSnapshot;
  assert.equal(plan(observed, 39, confirm).result.reason, 'CLOCK_ROLLBACK');
  for (const mutate of [(s) => { delete s.configuration; }, (s) => { s.configuration.accessTiming.waitMs = 0; },
    (s) => { s.configuration.journeyLimits.maxHops = 1.5; }, (s) => { s.configuration.extra = true; },
    (s) => { s.configurationRevision = -1; }, (s) => { delete s.vaultState.pendingProposal.candidateConfiguration; }]) {
    const invalid = structuredClone(pending); mutate(invalid);
    assert.equal(validateAtlasSnapshot(invalid).ok, false);
    assert.equal(plan(invalid, 40, confirm).candidateSnapshot, null);
  }
  assert.equal(plan(initial(), 0, { ...propose, candidateConfiguration: {} }).result.reason, 'INVALID_CONFIGURATION');
});

async function owner(repository, clock, id) {
  const controller = createAtlasController({ repository, clock, ownerId: id, configuration });
  assert.equal((await controller.open()).status, 'READY'); return controller;
}
test('successful persisted settings and pending proposals survive restart; policy remains unchanged', async () => {
  const repository = new FakeRepository(initial()); const clock = { time: 0, now() { return this.time; } };
  let controller = await owner(repository, clock, 'first');
  assert.equal((await controller.handle(propose)).type, 'COMMITTED');
  controller = await owner(repository, clock, 'second');
  assert.equal(controller.getView().snapshot.vaultState.pendingProposal.readyAt, 30);
  assert.deepEqual(controller.getView().snapshot.configuration, configuration);
  clock.time = 30;
  assert.equal((await controller.handle(confirm)).type, 'COMMITTED');
  controller = await owner(repository, clock, 'third');
  assert.deepEqual(controller.getView().snapshot.configuration, candidateConfiguration);
  assert.deepEqual(controller.getView().snapshot.policy, initial().policy);
});

test('failed and conflicted settings saves leave active values unchanged and publish no success', async () => {
  for (const failure of ['failed', 'conflict']) {
    const repository = new FakeRepository(initial()); const clock = { time: 0, now() { return this.time; } };
    const controller = await owner(repository, clock, failure);
    await controller.handle(propose); clock.time = 30;
    repository.steps.push((r, repo) => failure === 'failed' ? repo.fail(r)
      : (repo.replace(repo.envelope.snapshot), repo.apply(r)));
    const result = await controller.handle(confirm);
    assert.equal(result.type, 'BLOCKED');
    assert.deepEqual(controller.getView().snapshot.configuration, configuration);
    assert.deepEqual(repository.envelope.snapshot.configuration, configuration);
    assert.notEqual(repository.envelope.snapshot.vaultState.pendingProposal, null);
  }
});

test('unknown settings save publishes no permission until fenced reconciliation; never retries automatically', async () => {
  const repository = new FakeRepository(initial()); const clock = { time: 0, now() { return this.time; } };
  const controller = await owner(repository, clock, 'uncertain');
  await controller.handle(propose); clock.time = 30;
  repository.steps.push((r, repo) => repo.unknown(r, true));
  assert.equal((await controller.handle(confirm)).type, 'BLOCKED');
  assert.equal(controller.getView().status, 'RECONCILING');
  assert.deepEqual(controller.getView().snapshot.configuration, configuration);
  const attempts = repository.commits.length;
  assert.equal((await controller.handle(confirm)).type, 'BLOCKED');
  assert.equal(repository.commits.length, attempts);
  repository.settle(controller.getView().pendingCommitId);
  assert.equal((await controller.open()).status, 'READY');
  assert.deepEqual(controller.getView().snapshot.configuration, candidateConfiguration);
  assert.equal((await controller.handle(confirm)).reason, 'ALREADY_COMMITTED');
});

test('configuration revision rollback across authoritative loads blocks the controller', async () => {
  const repository = new FakeRepository(initial()); const clock = { time: 0, now() { return this.time; } };
  const controller = await owner(repository, clock, 'rollback');
  await controller.handle(propose); clock.time = 30; await controller.handle(confirm);
  const old = structuredClone(repository.envelope.snapshot); old.configurationRevision = 0; old.vaultState.lastApplied = null;
  repository.replace(old);
  assert.equal((await controller.handle({ kind: 'OBSERVE_TIME' })).type, 'BLOCKED');
});

test('legacy migration preserves frozen policy proposal and runtime timestamps; damaged v1 never falls back', () => {
  let snapshot = adopt(initial(), 10, { kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: ['root.example', 'new.example'], blacklist: ['blocked.example'] } });
  snapshot = adopt(snapshot, 11, { kind: 'START_ACCESS', target: { hostname: 'other.example' } });
  const legacy = structuredClone(snapshot); delete legacy.configuration; delete legacy.configurationRevision;
  delete legacy.vaultState.pendingProposal.candidateConfiguration; delete legacy.vaultState.pendingProposal.baseConfigurationRevision;
  const migrated = migrateAtlasSnapshotV1(legacy, configuration);
  assert.equal(migrated.ok, true);
  assert.equal(migrated.snapshot.vaultState.pendingProposal.readyAt, 40);
  assert.deepEqual(migrated.snapshot.accessState, legacy.accessState);
  assert.deepEqual(migrated.snapshot.policy, legacy.policy);
  assert.equal(plan(migrated.snapshot, 39, confirm).result.reason, 'NOT_READY');
  assert.equal(migrateAtlasSnapshotV1({ ...legacy, accessState: {} }, configuration).ok, false);
  assert.equal(migrateAtlasSnapshotV1(snapshot, configuration).ok, false);
});
