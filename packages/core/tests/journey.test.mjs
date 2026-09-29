import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelJourney, closeJourneyContext, createAccessState, createJourneyState,
  evaluate, evaluateAccess, evaluateJourneyNavigation, observeJourneys,
  recordJourneyNavigation, startJourney,
} from '../dist/index.js';

const policy = { whitelist: ['student.example', 'mail.example'], blacklist: ['blocked.example'] };
const limits = { lifetimeMs: 5_000, maxHops: 3 };
const clone = (value) => JSON.parse(JSON.stringify(value));

function context(state = createJourneyState(), now = 1_000, overrides = {}) {
  return { policy, policyRevision: 0, state, now, ...overrides };
}

function start(input = context(), contextId = 'main', options = limits) {
  const result = startJourney('https://STUDENT.EXAMPLE/home', contextId, input, options);
  assert.equal(result.type, 'STARTED');
  return result;
}

function navigation(target, journeyId = 1, contextId = 'main') {
  return { target, journeyId, contextId };
}

function record(state, target, now = 2_000, id = 1, contextId = 'main') {
  return recordJourneyNavigation(navigation(target, id, contextId), context(state, now));
}

function frozen(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

test('Start creates a bounded Journey only for Pure Whitelist with frozen limits', () => {
  const result = start();
  assert.deepEqual(result.journey, {
    id: 1, contextId: 'main', rootHostname: 'student.example', currentHostname: 'student.example',
    phase: 'STARTED', startedAt: 1_000, expiresAt: 6_000, hopCount: 0, maxHops: 3,
    policyRevision: 0, endedAt: null, endReason: null,
  });
  assert.equal(result.nextState.nextJourneyId, 2);
  assert.equal(Object.isFrozen(result.journey), true);
  assert.equal(Object.isFrozen(result.nextState.journeys), true);
  assert.throws(() => { result.journey.expiresAt = 99_000; }, TypeError);
  for (const root of ['unknown.example', 'blocked.example']) {
    assert.equal(startJourney(root, 'main', context(), limits).reason, 'NOT_WHITELISTED');
  }
});

test('Initial root arrival and reloads keep the Journey open for a later login', () => {
  let state = start().nextState;
  for (const now of [1_000, 2_000, 3_000]) {
    const result = record(state, 'student.example', now);
    assert.equal(result.decision.reason, 'WHITELISTED');
    state = result.nextState;
    assert.equal(state.journeys[0].phase, 'STARTED');
    assert.equal(state.journeys[0].hopCount, 0);
    assert.equal(state.journeys[0].expiresAt, 6_000);
  }
});

test('Unfamiliar intermediates are allowed without policy classification or grant changes', () => {
  const input = context();
  const before = clone(input);
  const accessState = createAccessState();
  const accessBefore = clone(accessState);
  const result = start(input);
  const checked = evaluateJourneyNavigation(navigation('login.example'), context(result.nextState, 2_000));
  assert.deepEqual(checked.decision, {
    outcome: 'ALLOW', reason: 'ACTIVE_JOURNEY', target: { hostname: 'login.example' },
    journeyId: 1, expiresAt: 6_000,
  });
  assert.deepEqual(checked.nextState.journeys[0], result.journey);
  const moved = record(checked.nextState, 'login.example');
  assert.equal(moved.nextState.journeys[0].phase, 'IN_TRANSIT');
  assert.equal(moved.nextState.journeys[0].currentHostname, 'login.example');
  assert.equal(moved.nextState.journeys[0].hopCount, 1);
  assert.equal(evaluate('login.example', policy).outcome, 'GREYLIST');
  assert.equal(evaluateAccess('login.example', {
    policy, policyRevision: 0, state: accessState, now: 2_000,
  }).decision.outcome, 'GREYLIST');
  assert.deepEqual(input, before);
  assert.deepEqual(accessState, accessBefore);
  assert.deepEqual(Object.keys(moved.nextState).sort(),
    ['journeys', 'lastObservedAt', 'nextJourneyId', 'policyRevision']);
});

test('One deadline applies to host changes, paths, reloads, and repeated Start', () => {
  let state = start().nextState;
  for (const [target, now, hops] of [
    ['login.example', 2_000, 1], ['https://login.example/choose', 3_000, 1],
    ['identity.example', 4_000, 2], ['identity.example', 5_999, 2],
  ]) {
    const result = record(state, target, now);
    assert.equal(result.decision.outcome, 'ALLOW');
    state = result.nextState;
    assert.equal(state.journeys[0].expiresAt, 6_000);
    assert.equal(state.journeys[0].startedAt, 1_000);
    assert.equal(state.journeys[0].hopCount, hops);
  }
  const repeat = startJourney('student.example', 'main', context(state, 5_999),
    { lifetimeMs: 50_000, maxHops: 99 });
  assert.equal(repeat.reason, 'JOURNEY_ACTIVE');
  assert.deepEqual(repeat.nextState.journeys[0], state.journeys[0]);
  assert.equal(repeat.nextState.nextJourneyId, 2);
});

test('Evaluating a possible root return does not complete the Journey', () => {
  const state = record(start().nextState, 'login.example').nextState;
  const result = evaluateJourneyNavigation(navigation('student.example'), context(state, 3_000));
  assert.equal(result.decision.outcome, 'ALLOW');
  assert.deepEqual(result.nextState.journeys[0], state.journeys[0]);
  assert.equal(record(result.nextState, 'identity.example', 3_001).decision.reason, 'ACTIVE_JOURNEY');
});

test('Recording return to the root ends intermediate authorization without changing policy', () => {
  const state = record(start().nextState, 'login.example').nextState;
  const returned = record(state, 'https://student.example/result', 3_000);
  assert.equal(returned.decision.reason, 'WHITELISTED');
  assert.equal(returned.nextState.journeys[0].phase, 'ENDED');
  assert.equal(returned.nextState.journeys[0].endReason, 'RETURNED');
  assert.equal(returned.nextState.journeys[0].endedAt, 3_000);
  assert.equal(returned.nextState.journeys[0].hopCount, 1);
  const replay = record(returned.nextState, 'login.example', 3_000);
  assert.equal(replay.decision.outcome, 'GREYLIST');
  assert.equal(replay.decision.endReason, 'RETURNED');
  assert.equal(record(replay.nextState, 'student.example', 3_000).decision.reason, 'WHITELISTED');
  assert.equal(record(replay.nextState, 'mail.example', 3_000).decision.reason, 'WHITELISTED');
  assert.equal(evaluate('login.example', policy).outcome, 'GREYLIST');
});

test('Only the exact root hostname completes the Journey', () => {
  let state = record(start().nextState, 'login.example').nextState;
  for (const target of ['www.student.example', 'sub.student.example']) {
    const result = record(state, target);
    assert.equal(result.decision.reason, 'ACTIVE_JOURNEY');
    state = result.nextState;
    assert.equal(state.journeys[0].phase, 'IN_TRANSIT');
  }
  assert.equal(record(state, 'STUDENT.EXAMPLE.').nextState.journeys[0].endReason, 'RETURNED');
});

test('Expiry is exclusive and ends authorization for the current intermediate too', () => {
  const state = record(start().nextState, 'login.example').nextState;
  assert.equal(record(state, 'login.example', 5_999).decision.reason, 'ACTIVE_JOURNEY');
  for (const now of [6_000, 7_000]) {
    const result = evaluateJourneyNavigation(navigation('login.example'), context(state, now));
    assert.equal(result.decision.outcome, 'GREYLIST');
    assert.equal(result.decision.endReason, 'EXPIRED');
    assert.equal(result.nextState.journeys[0].endedAt, now);
    assert.equal(record(result.nextState, 'student.example', now).decision.reason, 'WHITELISTED');
  }
});

test('Observation ends idle or in-transit Journeys without a navigation or a real clock', () => {
  for (const state of [start().nextState, record(start().nextState, 'login.example').nextState]) {
    const result = observeJourneys(context(state, 6_000));
    assert.equal(result.type, 'OBSERVED');
    assert.equal(result.nextState.journeys[0].endReason, 'EXPIRED');
  }
});

test('Hop limit allows residence and root return but ends an attempted extra host change', () => {
  const started = start(context(), 'main', { lifetimeMs: 5_000, maxHops: 1 });
  const state = record(started.nextState, 'login.example').nextState;
  assert.equal(record(state, 'https://login.example/choose').decision.outcome, 'ALLOW');
  assert.equal(record(state, 'student.example').nextState.journeys[0].endReason, 'RETURNED');
  const limited = evaluateJourneyNavigation(navigation('identity.example'), context(state, 2_000));
  assert.equal(limited.decision.outcome, 'GREYLIST');
  assert.equal(limited.decision.endReason, 'HOP_LIMIT');
  assert.equal(limited.nextState.journeys[0].hopCount, 1);
  assert.equal(limited.nextState.journeys[0].currentHostname, 'login.example');
  assert.equal(record(limited.nextState, 'login.example').decision.outcome, 'GREYLIST');
  const independent = record(state, 'mail.example');
  assert.equal(independent.decision.reason, 'WHITELISTED');
  assert.equal(independent.nextState.journeys[0].endReason, 'HOP_LIMIT');
});

test('Repeated crossings count again and cannot evade the hop limit', () => {
  let state = start().nextState;
  for (const host of ['one.example', 'two.example', 'one.example']) {
    state = record(state, host).nextState;
  }
  assert.equal(state.journeys[0].hopCount, 3);
  assert.equal(record(state, 'two.example').decision.endReason, 'HOP_LIMIT');
});

test('Cancelled and closed contexts cannot revive their Journeys', () => {
  const state = record(start().nextState, 'login.example').nextState;
  for (const [operation, reason] of [[cancelJourney, 'CANCELLED'], [closeJourneyContext, 'CONTEXT_CLOSED']]) {
    const ended = operation(1, 'main', context(state, 2_500));
    assert.equal(ended.type, 'ENDED');
    assert.equal(ended.journey.endReason, reason);
    const reloaded = clone(ended.nextState);
    assert.equal(record(reloaded, 'login.example', 3_000).decision.endReason, reason);
    assert.equal(operation(1, 'main', context(reloaded, 3_000)).reason, 'JOURNEY_ENDED');
    const restarted = start(context(reloaded, 3_000));
    assert.equal(restarted.journey.id, 2);
    assert.equal(restarted.journey.expiresAt, 8_000);
    assert.equal(restarted.journey.hopCount, 0);
    assert.equal(record(restarted.nextState, 'login.example', 3_000).decision.reason, 'JOURNEY_NOT_FOUND');
  }
});

test('Newer policy revisions end Journeys and retained checkpoints reject policy rollback', () => {
  const state = record(start().nextState, 'login.example').nextState;
  const result = evaluateJourneyNavigation(navigation('login.example'),
    context(state, 2_500, { policyRevision: 1 }));
  assert.equal(result.decision.endReason, 'POLICY_CHANGED');
  assert.equal(result.nextState.policyRevision, 1);
  assert.equal(result.nextState.journeys[0].policyRevision, 0);
  const rollback = evaluateJourneyNavigation(navigation('login.example'), context(result.nextState, 2_500));
  assert.equal(rollback.decision.reason, 'POLICY_ROLLBACK');
  assert.equal(rollback.nextState, null);
});

test('Removing or blacklisting the root invalidates the Journey even without a revision bump', () => {
  const state = start().nextState;
  for (const replacement of [
    { whitelist: [], blacklist: [] },
    { whitelist: ['student.example'], blacklist: ['student.example'] },
  ]) {
    const result = evaluateJourneyNavigation(navigation('login.example'), context(state, 2_000, { policy: replacement }));
    assert.equal(result.decision.endReason, 'ROOT_NOT_WHITELISTED');
  }
});

test('Blacklist overrides both Journey access and Whitelist without advancing navigation', () => {
  const both = { whitelist: ['student.example', 'blocked.example'], blacklist: ['blocked.example'] };
  assert.equal(startJourney('blocked.example', 'main', context(undefined, 1_000, { policy: both }), limits).reason,
    'NOT_WHITELISTED');
  const state = start().nextState;
  const denied = recordJourneyNavigation(navigation('blocked.example'), context(state, 2_000, { policy: both }));
  assert.equal(denied.decision.reason, 'BLACKLISTED');
  assert.deepEqual(denied.nextState.journeys, state.journeys);
  const ended = cancelJourney(1, 'main', context(state, 2_000));
  assert.equal(record(ended.nextState, 'blocked.example').decision.reason, 'BLACKLISTED');
});

test('Malformed policy denies and consumes active authorization; repairing it does not revive the Journey', () => {
  const state = record(start().nextState, 'login.example').nextState;
  const result = evaluateJourneyNavigation(navigation('student.example'), context(state, 2_500, {
    policy: { whitelist: ['student.example'], blacklist: ['*.example'] },
  }));
  assert.equal(result.decision.reason, 'INVALID_POLICY');
  assert.equal(result.nextState.journeys[0].endReason, 'INVALID_POLICY');
  assert.equal(record(result.nextState, 'login.example', 2_500).decision.endReason, 'INVALID_POLICY');
});

test('Contexts do not share authorization and commands must bind both context and Journey ID', () => {
  const first = start();
  const second = start(context(first.nextState, 1_500), 'second');
  for (const operation of [evaluateJourneyNavigation, recordJourneyNavigation]) {
    assert.equal(operation(navigation('login.example', 1, 'second'), context(second.nextState, 2_000)).decision.reason,
      'CONTEXT_MISMATCH');
  }
  for (const operation of [cancelJourney, closeJourneyContext]) {
    assert.equal(operation(1, 'second', context(second.nextState, 2_000)).reason, 'CONTEXT_MISMATCH');
  }
  const moved = record(second.nextState, 'login.example');
  assert.equal(moved.nextState.journeys[0].hopCount, 1);
  assert.equal(moved.nextState.journeys[1].hopCount, 0);
  const cancelled = cancelJourney(1, 'main', context(moved.nextState, 2_000));
  assert.equal(record(cancelled.nextState, 'login.example').decision.outcome, 'GREYLIST');
  assert.equal(record(cancelled.nextState, 'login.example', 2_000, 2, 'second').decision.reason, 'ACTIVE_JOURNEY');
  const observed = observeJourneys(context(cancelled.nextState, 6_000));
  assert.equal(observed.nextState.journeys[1].phase, 'STARTED');
  assert.equal(observed.nextState.journeys[1].expiresAt, 6_500);
});

test('Serialized state retains deadlines, limits, IDs, and terminal status', () => {
  const state = record(start().nextState, 'login.example').nextState;
  const reloaded = clone(state);
  assert.equal(record(reloaded, 'identity.example', 5_999).decision.reason, 'ACTIVE_JOURNEY');
  const expired = record(reloaded, 'identity.example', 6_000);
  assert.equal(expired.decision.endReason, 'EXPIRED');
  const rollback = evaluateJourneyNavigation(navigation('login.example'), context(clone(expired.nextState), 5_999));
  assert.equal(rollback.decision.reason, 'CLOCK_ROLLBACK');
  assert.equal(rollback.nextState, null);
  const completed = record(reloaded, 'student.example', 3_000);
  assert.equal(record(clone(completed.nextState), 'login.example', 3_001).decision.endReason, 'RETURNED');
});

test('Recording rechecks current time and policy instead of trusting an earlier evaluation', () => {
  const state = start().nextState;
  const allowed = evaluateJourneyNavigation(navigation('login.example'), context(state, 5_999));
  assert.equal(allowed.decision.outcome, 'ALLOW');
  assert.equal(record(allowed.nextState, 'login.example', 6_000).decision.endReason, 'EXPIRED');
  const blocked = recordJourneyNavigation(navigation('login.example'), context(allowed.nextState, 5_999, {
    policy: { ...policy, blacklist: ['login.example'] }, policyRevision: 1,
  }));
  assert.equal(blocked.decision.reason, 'BLACKLISTED');
  assert.equal(blocked.nextState.journeys[0].endReason, 'POLICY_CHANGED');
});

test('Invalid limits and unsafe deadline or ID arithmetic cannot start a Journey', () => {
  for (const invalid of [null, {}, { ...limits, extra: true },
    ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].flatMap((value) =>
      Object.keys(limits).map((field) => ({ ...limits, [field]: value })))]) {
    const result = startJourney('student.example', 'main', context(), invalid);
    assert.equal(result.reason, 'INVALID_LIMITS');
    assert.deepEqual(result.nextState.journeys, []);
  }
  assert.equal(startJourney('student.example', 'main', context(undefined, Number.MAX_SAFE_INTEGER), limits).reason,
    'TIME_OVERFLOW');
  assert.equal(startJourney('student.example', 'main',
    context({ ...createJourneyState(), nextJourneyId: Number.MAX_SAFE_INTEGER }), limits).reason, 'ID_EXHAUSTED');
});

test('Invalid navigation, context identifiers, targets, and times fail closed', () => {
  const state = start().nextState;
  for (const invalid of [null, {}, { ...navigation('login.example'), extra: true }]) {
    assert.equal(evaluateJourneyNavigation(invalid, context(state)).decision.reason, 'INVALID_NAVIGATION');
  }
  for (const id of [null, '1', 0, -1, 0.5, NaN, Infinity]) {
    assert.equal(evaluateJourneyNavigation(navigation('login.example', id), context(state)).decision.reason,
      'INVALID_JOURNEY_ID');
  }
  for (const id of ['', ' main ', 'https://example.com', 'a'.repeat(129), null]) {
    assert.equal(startJourney('student.example', id, context(), limits).reason, 'INVALID_CONTEXT_ID');
  }
  for (const target of ['', null, 'https://', 'javascript:void(0)']) {
    assert.equal(evaluateJourneyNavigation(navigation(target), context(state)).decision.reason, 'INVALID_TARGET');
  }
  for (const now of [-1, 1.5, NaN, Infinity]) {
    const result = observeJourneys(context(state, now));
    assert.equal(result.reason, 'INVALID_TIME');
    assert.equal(result.nextState, null);
  }
  assert.equal(observeJourneys(context(state, 999)).reason, 'CLOCK_ROLLBACK');
  assert.equal(observeJourneys(context(state, 1_000, { policyRevision: -1 })).reason, 'INVALID_POLICY_REVISION');
});

test('Malformed Journey state denies even Whitelisted targets and never silently initializes', () => {
  const started = start();
  const state = started.nextState;
  const change = (patch) => ({ ...state, journeys: [{ ...started.journey, ...patch }] });
  const malformed = [
    null, {}, { ...state, extra: true }, { ...state, nextJourneyId: 1 },
    { ...state, journeys: [started.journey, started.journey] },
    { ...state, journeys: [started.journey, { ...started.journey, id: 2 }], nextJourneyId: 3 },
    { ...state, journeys: [started.journey, { ...started.journey, contextId: 'second' }] },
    { ...state, lastObservedAt: 999 }, { ...state, lastObservedAt: 6_000 },
    change({ rootHostname: 'STUDENT.EXAMPLE' }), change({ expiresAt: 1_000 }),
    change({ currentHostname: 'login.example' }), change({ phase: 'IN_TRANSIT' }),
    change({ hopCount: -1 }), change({ hopCount: 4 }), change({ policyRevision: 1 }),
    change({ endedAt: 1_000 }), change({ phase: 'ENDED', endReason: 'RETURNED', endedAt: 1_000 }),
    change({ phase: 'ENDED', endReason: 'EXPIRED', endedAt: 1_000 }),
    change({ phase: 'ENDED', endReason: 'CANCELLED', endedAt: 2_000 }),
  ];
  for (const invalid of malformed) {
    const result = evaluateJourneyNavigation(navigation('student.example'), context(invalid, 7_000));
    assert.equal(result.decision.reason, 'INVALID_STATE');
    assert.equal(result.nextState, null);
  }
});

test('All operations are deterministic, do not mutate inputs, and do not expose mutable state aliases', () => {
  const started = start();
  const input = frozen(context(started.nextState, 2_000));
  const before = clone(input);
  const operations = [
    () => startJourney('mail.example', 'other', input, limits),
    () => evaluateJourneyNavigation(navigation('login.example'), input),
    () => recordJourneyNavigation(navigation('login.example'), input),
    () => observeJourneys(input),
    () => cancelJourney(1, 'main', input),
    () => closeJourneyContext(1, 'main', input),
  ];
  for (const call of operations) assert.deepEqual(call(), call());
  assert.deepEqual(input, before);
  const mutable = clone(input);
  const result = recordJourneyNavigation(navigation('login.example'), mutable);
  assert.equal(Object.isFrozen(mutable.state.journeys[0]), false);
  mutable.state.journeys[0].expiresAt = 99_000;
  mutable.policy.whitelist.push('login.example');
  assert.equal(result.nextState.journeys[0].expiresAt, 6_000);
  assert.equal(evaluate('login.example', policy).outcome, 'GREYLIST');
});
