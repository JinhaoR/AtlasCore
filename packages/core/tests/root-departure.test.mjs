import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileManagedBlacklist, createAccessState, createAtlasController, createJourneyState,
  createVaultState, planAtlasOperation, validateAtlasSnapshot,
} from '../dist/index.js';
import { FakeRepository, deferred } from './support/fake-repository.mjs';

const configuration = {
  accessTiming: { waitMs: 10, confirmationWindowMs: 20, grantDurationMs: 100 },
  vaultTiming: { waitMs: 10, confirmationWindowMs: 20 },
  journeyLimits: { lifetimeMs: 200, maxHops: 2 },
};
const initial = () => ({
  policy: { whitelist: ['root.example', 'other-root.example'], blacklist: ['blocked.example'] },
  policyRevision: 0, configuration, configurationRevision: 0,
  accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState(),
});
const fact = (sourceHostname = 'root.example') => ({ kind: 'ROOT_DEPARTURE', sourceHostname });
const op = (kind = 'BEGIN_NAVIGATION', hostname = 'login.example', journeyId = null,
  continuation = fact(), contextId = 'tab_a') => ({ kind, target: { hostname },
  context: { contextId, journeyId, ...(continuation == null ? {} : { continuation }) } });
const plan = (snapshot, now, operation, extra = {}) => planAtlasOperation(operation, {
  snapshot, now, configuration, ...extra,
});
const adopt = result => result.candidateSnapshot ?? result.observationSnapshot;
const departure = () => adopt(plan(initial(), 10, op()));
const transit = () => adopt(plan(departure(), 11, op('RECORD_JOURNEY_NAVIGATION', 'login.example', 1)));

test('one trusted root departure begins a bounded Journey without changing policy or grants', () => {
  const snapshot = initial(); const before = structuredClone(snapshot);
  const result = plan(snapshot, 10, op());
  assert.equal(result.result.decision.reason, 'ACTIVE_JOURNEY');
  assert.equal(result.result.decision.target.hostname, 'login.example');
  const candidate = result.candidateSnapshot;
  assert.equal(candidate.journeyState.journeys[0].rootHostname, 'root.example');
  assert.equal(candidate.journeyState.journeys[0].currentHostname, 'root.example');
  assert.equal(candidate.journeyState.journeys[0].phase, 'STARTED');
  assert.equal(candidate.journeyState.journeys[0].expiresAt, 210);
  assert.equal(candidate.journeyState.journeys[0].hopCount, 0);
  assert.equal(candidate.journeyState.journeys[0].maxHops, 2);
  assert.deepEqual(candidate.policy, snapshot.policy);
  assert.deepEqual(candidate.accessState.grants, []);
  assert.equal(result.observationSnapshot.journeyState.journeys.length, 0);
  assert.deepEqual(snapshot, before);
  assert.equal(validateAtlasSnapshot(candidate).ok, true);
});

test('adopting the first departure consumes one hop and preserves its ID and deadline', () => {
  const started = departure(); const terms = started.journeyState.journeys[0];
  const result = plan(started, 11, op('RECORD_JOURNEY_NAVIGATION', 'login.example', terms.id));
  assert.equal(result.result.decision.reason, 'ACTIVE_JOURNEY');
  const journey = result.candidateSnapshot.journeyState.journeys[0];
  assert.equal(journey.id, terms.id);
  assert.equal(journey.phase, 'IN_TRANSIT');
  assert.equal(journey.currentHostname, 'login.example');
  assert.equal(journey.hopCount, 1);
  assert.equal(journey.expiresAt, terms.expiresAt);
});

test('an existing STARTED attempt may use its first departure without renewing frozen terms', () => {
  const root = adopt(plan(initial(), 0, op('BEGIN_NAVIGATION', 'root.example', null, null)));
  const result = plan(root, 80, op('BEGIN_NAVIGATION', 'login.example', 1));
  const checked = adopt(result).journeyState.journeys[0];
  assert.equal(result.result.decision.reason, 'ACTIVE_JOURNEY');
  assert.equal(checked.id, 1); assert.equal(checked.startedAt, 0); assert.equal(checked.expiresAt, 200);
  assert.equal(checked.phase, 'STARTED'); assert.equal(checked.hopCount, 0);
  const repeated = adopt(plan(adopt(result), 90, op('BEGIN_NAVIGATION', 'login.example', 1)));
  assert.equal(repeated.journeyState.journeys[0].expiresAt, 200);
  assert.equal(repeated.journeyState.nextJourneyId, 2);
});

test('ROOT_DEPARTURE cannot renew, rebase, or authorize another unfamiliar hop in transit', () => {
  const snapshot = transit(); const old = snapshot.journeyState.journeys[0];
  for (const source of ['root.example', 'other-root.example']) {
    const result = plan(snapshot, 50, op('BEGIN_NAVIGATION', 'unrelated.example', old.id, fact(source)));
    assert.equal(result.result.decision.outcome, 'GREYLIST');
    assert.equal(result.candidateSnapshot, null);
    const retained = adopt(result).journeyState.journeys[0];
    assert.equal(retained.id, old.id); assert.equal(retained.rootHostname, old.rootHostname);
    assert.equal(retained.expiresAt, old.expiresAt);
    assert.equal(retained.endReason, 'UNRELATED_NAVIGATION');
    assert.equal(adopt(result).journeyState.nextJourneyId, snapshot.journeyState.nextJourneyId);
  }
});

test('a different STARTED root cannot be replaced by a departure fact', () => {
  const snapshot = adopt(plan(initial(), 0, op('BEGIN_NAVIGATION', 'other-root.example', null, null)));
  const result = plan(snapshot, 10, op('BEGIN_NAVIGATION', 'login.example', 1));
  assert.equal(result.result.decision.outcome, 'GREYLIST');
  assert.equal(adopt(result).journeyState.journeys[0].id, 1);
  assert.equal(adopt(result).journeyState.journeys[0].rootHostname, 'other-root.example');
  assert.equal(adopt(result).journeyState.nextJourneyId, 2);
});

test('an independently Whitelisted target keeps ordinary navigation rooted at that requested destination', () => {
  for (const snapshot of [initial(), departure(), transit()]) {
    const previous = snapshot.journeyState.journeys[0];
    const result = plan(snapshot, 20, op('BEGIN_NAVIGATION', 'other-root.example', previous?.id ?? null));
    assert.equal(result.result.decision.reason, 'WHITELISTED');
    const journey = result.candidateSnapshot.journeyState.journeys[0];
    assert.equal(journey.rootHostname, 'other-root.example');
    assert.equal(journey.currentHostname, 'other-root.example');
    assert.equal(journey.id, previous === undefined ? 1 : previous.id + 1);
    assert.equal(journey.phase, 'STARTED'); assert.equal(journey.hopCount, 0);
    assert.equal(journey.startedAt, 20); assert.equal(journey.expiresAt, 220);
  }
});

test('correlated HTTP redirects can continue the adopted first departure and a real root return ends it', () => {
  let snapshot = transit();
  const redirect = { kind: 'HTTP_REDIRECT', sourceHostname: 'login.example' };
  snapshot = adopt(plan(snapshot, 20, op('RECORD_JOURNEY_NAVIGATION', 'identity.example', 1, redirect)));
  assert.equal(snapshot.journeyState.journeys[0].hopCount, 2);
  assert.equal(snapshot.journeyState.journeys[0].expiresAt, 210);
  snapshot = adopt(plan(snapshot, 30, op('RECORD_JOURNEY_NAVIGATION', 'root.example', 1,
    { kind: 'ARRIVAL', sourceHostname: 'identity.example' })));
  assert.equal(snapshot.journeyState.journeys[0].endReason, 'RETURNED');
  assert.equal(snapshot.journeyState.journeys[0].expiresAt, 210);
  assert.deepEqual(snapshot.policy, initial().policy);
  assert.deepEqual(snapshot.accessState.grants, []);
});

test('manual and managed target denial create no Journey', () => {
  for (const extra of [{}, { managedBlacklist: compileManagedBlacklist(['login.example']) }]) {
    const target = extra.managedBlacklist ? 'login.example' : 'blocked.example';
    const result = plan(initial(), 10, op('BEGIN_NAVIGATION', target), extra);
    assert.equal(result.result.decision.outcome, 'DENY');
    assert.equal(result.result.decision.reason, extra.managedBlacklist ? 'MANAGED_BLACKLISTED' : 'BLACKLISTED');
    assert.equal(result.candidateSnapshot, null);
    assert.deepEqual(adopt(result).journeyState.journeys, []);
    assert.equal(adopt(result).journeyState.nextJourneyId, 1);
  }
});

test('a departure source needs current Whitelist classification and cannot borrow an Access Grant', () => {
  for (const source of ['unlisted.example', 'blocked.example', 'root.example']) {
    const snapshot = initial();
    if (source === 'root.example') snapshot.policy.blacklist.push(source);
    const result = plan(snapshot, 10, op('BEGIN_NAVIGATION', 'login.example', null, fact(source)));
    assert.equal(result.result.reason, 'NOT_WHITELISTED');
    assert.equal(result.candidateSnapshot, null);
    assert.deepEqual(adopt(result).journeyState.journeys, []);
  }
  let snapshot = initial();
  snapshot = adopt(plan(snapshot, 0, { kind: 'START_ACCESS', target: { hostname: 'unlisted.example' } }));
  snapshot = adopt(plan(snapshot, 10, { kind: 'CONFIRM_ACCESS', requestId: 1 }));
  const result = plan(snapshot, 11, op('BEGIN_NAVIGATION', 'login.example', null, fact('unlisted.example')));
  assert.equal(result.result.reason, 'NOT_WHITELISTED');
  assert.equal(adopt(result).accessState.grants.length, 1);
  assert.deepEqual(adopt(result).journeyState.journeys, []);
});

test('departure facts are closed and canonical; missing evidence never starts an unfamiliar attempt', () => {
  for (const continuation of [
    { kind: 'ROOT_DEPARTURE', sourceHostname: 'ROOT.EXAMPLE' },
    { kind: 'ROOT_DEPARTURE', sourceHostname: 'https://root.example/' },
    { kind: 'ROOT_DEPARTURE', sourceHostname: 'root.example', approved: true },
    { kind: 'ROOT_DEPARTURE' },
  ]) {
    const result = plan(initial(), 10, op('BEGIN_NAVIGATION', 'login.example', null, continuation));
    assert.equal(result.result.reason, 'INVALID_NAVIGATION');
    assert.equal(result.candidateSnapshot, null);
  }
  const noFact = plan(initial(), 10, op('BEGIN_NAVIGATION', 'login.example', null, null));
  assert.equal(noFact.result.decision.outcome, 'GREYLIST');
  assert.equal(noFact.candidateSnapshot, null);
  assert.equal(plan(initial(), 10, op('BEGIN_NAVIGATION', 'root.example')).result.reason, 'INVALID_NAVIGATION');
});

test('CHECK and RECORD cannot create a Journey from a departure fact', () => {
  for (const kind of ['CHECK_NAVIGATION', 'RECORD_JOURNEY_NAVIGATION']) {
    const result = plan(initial(), 10, op(kind));
    assert.equal(result.candidateSnapshot, null);
    assert.deepEqual(adopt(result).journeyState.journeys, []);
    if (kind === 'CHECK_NAVIGATION') assert.equal(result.result.decision.outcome, 'GREYLIST');
    else assert.equal(result.result.reason, 'INVALID_JOURNEY_ID');
  }
});

test('context mismatches and invalid aggregate state cannot disappear behind root departure permission', () => {
  const started = departure();
  assert.equal(plan(started, 11, op('BEGIN_NAVIGATION', 'login.example', 1, fact(), 'tab_b')).result.reason, 'CONTEXT_MISMATCH');
  assert.equal(plan(started, 11, op('BEGIN_NAVIGATION', 'login.example', null)).result.reason, 'CONTEXT_MISMATCH');
  const corrupt = structuredClone(initial()); corrupt.accessState = {};
  const result = plan(corrupt, 10, op());
  assert.equal(result.result.reason, 'INVALID_ACCESS_STATE');
  assert.equal(result.candidateSnapshot, null);
});

test('recording after expiry, policy change, or hop exhaustion cannot continue the first departure', () => {
  const expired = plan(departure(), 210, op('RECORD_JOURNEY_NAVIGATION', 'login.example', 1));
  assert.equal(expired.result.decision.outcome, 'GREYLIST');
  assert.equal(adopt(expired).journeyState.journeys[0].endReason, 'EXPIRED');
  const changed = structuredClone(departure()); changed.policyRevision = 1;
  const stale = plan(changed, 20, op('RECORD_JOURNEY_NAVIGATION', 'login.example', 1));
  assert.equal(stale.result.decision.outcome, 'GREYLIST');
  assert.equal(adopt(stale).journeyState.journeys[0].endReason, 'POLICY_CHANGED');
  let full = transit();
  full = adopt(plan(full, 20, op('RECORD_JOURNEY_NAVIGATION', 'identity.example', 1,
    { kind: 'HTTP_REDIRECT', sourceHostname: 'login.example' })));
  const exhausted = plan(full, 30, op('RECORD_JOURNEY_NAVIGATION', 'extra.example', 1,
    { kind: 'HTTP_REDIRECT', sourceHostname: 'identity.example' }));
  assert.equal(exhausted.result.decision.outcome, 'GREYLIST');
  assert.equal(adopt(exhausted).journeyState.journeys[0].endReason, 'HOP_LIMIT');
});

test('a genuinely new departure after a completed attempt uses a fresh ID and committed configuration', () => {
  let snapshot = adopt(plan(initial(), 0, op('BEGIN_NAVIGATION', 'root.example', null, null)));
  snapshot = adopt(plan(snapshot, 1, op('RECORD_JOURNEY_NAVIGATION', 'root.example', 1,
    { kind: 'ARRIVAL', sourceHostname: 'root.example' })));
  const changed = structuredClone(snapshot);
  changed.configuration.journeyLimits = { lifetimeMs: 70, maxHops: 1 }; changed.configurationRevision = 1;
  const result = plan(changed, 50, op('BEGIN_NAVIGATION', 'login.example', 1));
  const fresh = result.candidateSnapshot.journeyState.journeys[0];
  assert.equal(fresh.id, 2); assert.equal(fresh.rootHostname, 'root.example');
  assert.equal(fresh.startedAt, 50); assert.equal(fresh.expiresAt, 120); assert.equal(fresh.maxHops, 1);
  assert.equal(snapshot.journeyState.journeys[0].expiresAt, 200);
});

test('failed or unknown departure persistence publishes no Journey permission', async () => {
  for (const outcome of ['failed', 'unknown']) {
    const repository = new FakeRepository(initial());
    const controller = createAtlasController({ repository, clock: { now: () => 10 }, configuration,
      ownerId: `departure_${outcome}` });
    await controller.open();
    repository.steps.push((request, repo) => outcome === 'failed' ? repo.fail(request) : repo.unknown(request, true));
    const result = await controller.handle(op());
    assert.equal(result.type, 'BLOCKED');
    assert.deepEqual(controller.getView().snapshot.journeyState.journeys, []);
    assert.notEqual((await controller.handle(op())).type, 'ASSESSMENT');
  }
});

test('controller reports departure authorization only after its candidate is successfully committed', async () => {
  const repository = new FakeRepository(initial());
  const controller = createAtlasController({ repository, clock: { now: () => 10 }, configuration, ownerId: 'departure' });
  await controller.open();
  const entered = deferred(), release = deferred();
  repository.steps.push(async (request, repo) => { entered.resolve(); await release.promise; return repo.apply(request); });
  let published = false;
  const pending = controller.handle(op()).then(result => { published = true; return result; });
  await entered.promise;
  assert.equal(published, false); assert.deepEqual(controller.getView().snapshot.journeyState.journeys, []);
  release.resolve();
  assert.equal((await pending).decision.reason, 'ACTIVE_JOURNEY');
  assert.equal(controller.getView().snapshot.journeyState.journeys[0].rootHostname, 'root.example');
});
