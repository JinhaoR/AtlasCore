import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileManagedBlacklist, createAccessState, createJourneyState, createVaultState, planAtlasOperation,
} from '../dist/index.js';

const configuration = {
  accessTiming: { waitMs: 10, confirmationWindowMs: 20, grantDurationMs: 100 },
  vaultTiming: { waitMs: 10, confirmationWindowMs: 20 },
  journeyLimits: { lifetimeMs: 200, maxHops: 2 },
};
const initial = () => ({
  policy: { whitelist: ['root.example'], blacklist: ['blocked.example'] },
  policyRevision: 0, configuration, configurationRevision: 0,
  accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState(),
});
const op = (kind, hostname, journeyId = 1, continuation = { kind: 'FORM_POST', sourceHostname: 'login.example' }, contextId = 'tab_a') =>
  ({ kind, target: { hostname }, context: { contextId, journeyId, ...(continuation === null ? {} : { continuation }) } });
const plan = (snapshot, operation, now = 20, extra = {}) => planAtlasOperation(operation, { snapshot, now, configuration, ...extra });
const saved = result => result.candidateSnapshot ?? result.observationSnapshot;
const started = () => saved(plan(initial(), op('BEGIN_NAVIGATION', 'root.example', null, null), 10));
const transit = () => saved(plan(started(), op('RECORD_JOURNEY_NAVIGATION', 'login.example', 1,
  { kind: 'HTTP_REDIRECT', sourceHostname: 'root.example' }), 11));

test('a trusted FORM_POST checks and adopts an intermediate without renewing or mutating its snapshot', () => {
  const snapshot = transit(); const before = structuredClone(snapshot);
  const checked = plan(snapshot, op('CHECK_NAVIGATION', 'callback.example'));
  assert.equal(checked.result.decision.reason, 'ACTIVE_JOURNEY');
  assert.equal(saved(checked).journeyState.journeys[0].currentHostname, 'login.example');
  const recorded = plan(saved(checked), op('RECORD_JOURNEY_NAVIGATION', 'callback.example'));
  const journey = recorded.candidateSnapshot.journeyState.journeys[0];
  assert.equal(journey.id, 1);
  assert.equal(journey.currentHostname, 'callback.example');
  assert.equal(journey.hopCount, 2);
  assert.equal(journey.startedAt, 10);
  assert.equal(journey.expiresAt, 210);
  assert.deepEqual(recorded.candidateSnapshot.policy, snapshot.policy);
  assert.deepEqual(recorded.candidateSnapshot.accessState.grants, []);
  assert.deepEqual(snapshot, before);
});

test('FORM_POST never starts a Journey and cannot use a STARTED root as an intermediate source', () => {
  const absent = plan(initial(), op('BEGIN_NAVIGATION', 'callback.example', null));
  assert.equal(absent.result.decision.outcome, 'GREYLIST');
  assert.equal(saved(absent).journeyState.journeys.length, 0);
  const root = plan(started(), op('BEGIN_NAVIGATION', 'callback.example', 1, { kind: 'FORM_POST', sourceHostname: 'root.example' }));
  assert.equal(root.result.decision.outcome, 'GREYLIST');
  assert.equal(saved(root).journeyState.journeys[0].endReason, 'UNRELATED_NAVIGATION');
});

test('FORM_POST requires the current cursor and context; malformed evidence fails closed', () => {
  const snapshot = transit();
  const mismatch = plan(snapshot, op('CHECK_NAVIGATION', 'callback.example', 1, undefined, 'tab_b'));
  assert.equal(mismatch.result.reason, 'CONTEXT_MISMATCH');
  const wrongSource = plan(snapshot, op('CHECK_NAVIGATION', 'callback.example', 1, { kind: 'FORM_POST', sourceHostname: 'stale.example' }));
  assert.equal(wrongSource.result.decision.outcome, 'GREYLIST');
  assert.equal(saved(wrongSource).journeyState.journeys[0].endReason, 'UNRELATED_NAVIGATION');
  for (const continuation of [
    { kind: 'FORM_POST', sourceHostname: 'LOGIN.EXAMPLE' },
    { kind: 'FORM_POST', sourceHostname: 'https://login.example/' },
    { kind: 'FORM_POST', sourceHostname: 'login.example', authenticated: true },
    { kind: 'FORM_POST' },
  ]) assert.equal(plan(snapshot, op('CHECK_NAVIGATION', 'callback.example', 1, continuation)).result.type, 'REJECTED');
});

test('expired, cancelled, stale and invalid authority cannot supply POST permission', () => {
  const snapshot = transit();
  const expired = plan(snapshot, op('BEGIN_NAVIGATION', 'callback.example'), 210);
  assert.equal(expired.result.decision.outcome, 'GREYLIST');
  assert.equal(saved(expired).journeyState.journeys[0].endReason, 'EXPIRED');
  const cancelled = saved(plan(snapshot, { kind: 'CANCEL_JOURNEY', contextId: 'tab_a', journeyId: 1 }));
  assert.equal(plan(cancelled, op('BEGIN_NAVIGATION', 'callback.example'), 21).result.decision.outcome, 'GREYLIST');
  const stale = { ...snapshot, policyRevision: 1 };
  assert.equal(plan(stale, op('BEGIN_NAVIGATION', 'callback.example')).result.decision.outcome, 'GREYLIST');
  assert.equal(saved(plan(stale, op('BEGIN_NAVIGATION', 'callback.example'))).journeyState.journeys[0].endReason, 'POLICY_CHANGED');
  const invalid = structuredClone(snapshot); invalid.journeyState.journeys[0].expiresAt = 0;
  assert.equal(plan(invalid, op('BEGIN_NAVIGATION', 'callback.example')).result.type, 'REJECTED');
});

test('POST cannot exceed hop budget, and a request of the root completes only after recorded arrival', () => {
  const callback = saved(plan(transit(), op('RECORD_JOURNEY_NAVIGATION', 'callback.example')));
  const exceeded = plan(callback, op('CHECK_NAVIGATION', 'third.example', 1, { kind: 'FORM_POST', sourceHostname: 'callback.example' }), 21);
  assert.equal(exceeded.result.decision.outcome, 'GREYLIST');
  assert.equal(saved(exceeded).journeyState.journeys[0].endReason, 'HOP_LIMIT');
  const checked = plan(callback, op('BEGIN_NAVIGATION', 'root.example', 1, { kind: 'FORM_POST', sourceHostname: 'callback.example' }), 21);
  assert.equal(checked.result.decision.reason, 'WHITELISTED');
  assert.equal(saved(checked).journeyState.journeys[0].phase, 'IN_TRANSIT');
  const arrived = plan(saved(checked), op('RECORD_JOURNEY_NAVIGATION', 'root.example', 1, { kind: 'ARRIVAL', sourceHostname: 'callback.example' }), 22);
  assert.equal(saved(arrived).journeyState.journeys[0].endReason, 'RETURNED');
  assert.equal(saved(arrived).journeyState.journeys[0].expiresAt, 210);
});

test('manual and managed denial still override valid POST continuation', () => {
  const snapshot = transit();
  assert.equal(plan(snapshot, op('CHECK_NAVIGATION', 'blocked.example')).result.decision.reason, 'BLACKLISTED');
  assert.equal(plan(snapshot, op('CHECK_NAVIGATION', 'managed.example'), 20,
    { managedBlacklist: compileManagedBlacklist(['managed.example']) }).result.decision.reason, 'MANAGED_BLACKLISTED');
});
