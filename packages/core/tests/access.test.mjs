import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelAccess, confirmAccess, createAccessState, evaluate, evaluateAccess, startAccess,
} from '../dist/index.js';

const policy = { whitelist: ['mail.example'], blacklist: ['blocked.example'] };
const timing = { waitMs: 1_000, confirmationWindowMs: 2_000, grantDurationMs: 5_000 };
const host = 'grey.example';

function context(state, now = 10_000, currentPolicy = policy, policyRevision = 0) {
  return { state, now, policy: currentPolicy, policyRevision };
}

function begin(target = host) {
  const result = startAccess(target, context(createAccessState()), timing);
  assert.equal(result.type, 'STARTED');
  return result;
}

function authorize() {
  const started = begin();
  const result = confirmAccess(started.request.id, context(started.nextState, 11_500));
  assert.equal(result.type, 'CONFIRMED');
  return result;
}

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('Greylist evaluation and elapsed time never start a request or create permission', () => {
  let state = createAccessState();
  for (const now of [10_000, 20_000, 1_000_000]) {
    const result = evaluateAccess(host, context(state, now));
    assert.equal(result.decision.outcome, 'GREYLIST');
    state = result.nextState;
    assert.deepEqual(state.pendingRequests, []);
    assert.deepEqual(state.grants, []);
  }
});

test('Start creates a waiting request with frozen terms and no grant', () => {
  const result = begin(' HTTPS://GREY.EXAMPLE./visit ');
  assert.deepEqual(result.request, {
    id: 1, hostname: host, startedAt: 10_000, readyAt: 11_000,
    confirmBy: 13_000, grantDurationMs: 5_000, policyRevision: 0,
  });
  assert.deepEqual(result.nextState.pendingRequests, [result.request]);
  assert.deepEqual(result.nextState.grants, []);
  assert.equal(evaluateAccess(host, context(result.nextState)).decision.outcome, 'WAIT');
});

test('Starting again returns the existing request during waiting and readiness', () => {
  const original = begin();
  let state = original.nextState;
  for (const now of [10_500, 11_000, 12_999]) {
    const result = startAccess(host, context(state, now), {
      waitMs: 1, confirmationWindowMs: 1, grantDurationMs: 1,
    });
    assert.equal(result.type, 'EXISTING_REQUEST');
    assert.deepEqual(result.request, original.request);
    assert.equal(result.nextState.nextRequestId, original.nextState.nextRequestId);
    assert.deepEqual(result.nextState.grants, []);
    state = result.nextState;
  }
});

test('Waiting cannot be bypassed and readiness alone is never ALLOW', () => {
  const started = begin();
  let state = started.nextState;
  for (const [now, outcome] of [
    [10_999, 'WAIT'], [11_000, 'REQUIRE_CONFIRMATION'], [12_999, 'REQUIRE_CONFIRMATION'],
  ]) {
    const result = evaluateAccess(host, context(state, now));
    assert.equal(result.decision.outcome, outcome);
    assert.deepEqual(result.nextState.pendingRequests, [started.request]);
    assert.deepEqual(result.nextState.grants, []);
    state = result.nextState;
  }
});

test('Confirmation before readiness fails without consuming the request', () => {
  const started = begin();
  const result = confirmAccess(started.request.id, context(started.nextState, 10_999));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_READY');
  assert.deepEqual(result.nextState.pendingRequests, [started.request]);
  assert.deepEqual(result.nextState.grants, []);
  assert.equal(result.nextState.lastObservedAt, 10_999);
});

test('Confirmation at or after the confirmation deadline fails', () => {
  const started = begin();
  for (const now of [13_000, 13_001, 20_000]) {
    const result = confirmAccess(started.request.id, context(started.nextState, now));
    assert.equal(result.reason, 'REQUEST_EXPIRED');
    assert.deepEqual(result.nextState.grants, []);
    const observed = evaluateAccess(host, context(result.nextState, now));
    assert.equal(observed.decision.outcome, 'GREYLIST');
    assert.equal(observed.decision.reason, 'REQUEST_EXPIRED');
  }
});

test('Explicit confirmation consumes the request and creates one grant in one next state', () => {
  const started = begin();
  const before = structuredClone(started.nextState);
  const result = confirmAccess(started.request.id, context(freeze(started.nextState), 11_000));
  assert.equal(result.ok, true);
  assert.equal(result.type, 'CONFIRMED');
  assert.deepEqual(result.grant, {
    requestId: started.request.id, hostname: host, issuedAt: 11_000,
    expiresAt: 16_000, policyRevision: 0,
  });
  assert.deepEqual(result.nextState.pendingRequests, []);
  assert.deepEqual(result.nextState.grants, [result.grant]);
  assert.deepEqual(started.nextState, before);
  assert.equal(evaluateAccess(host, context(started.nextState, 11_000)).decision.outcome,
    'REQUIRE_CONFIRMATION');
  assert.equal(evaluateAccess(host, context(result.nextState, 11_000)).decision.outcome, 'ALLOW');
});

test('A grant allows only during its lifetime and expiry returns to Greylist', () => {
  const granted = authorize();
  let state = granted.nextState;
  for (const [now, outcome] of [
    [11_500, 'ALLOW'], [16_499, 'ALLOW'], [16_500, 'GREYLIST'], [20_000, 'GREYLIST'],
  ]) {
    const result = evaluateAccess(host, context(state, now));
    assert.equal(result.decision.outcome, outcome);
    if (outcome === 'GREYLIST') assert.equal(result.decision.reason, 'GRANT_EXPIRED');
    assert.deepEqual(result.nextState.grants, [granted.grant]);
    state = result.nextState;
  }
  assert.equal(evaluateAccess(host, context(granted.nextState, 11_499)).decision.outcome, 'DENY');
});

test('Grants overlay authorization without reclassifying or widening the hostname', () => {
  const granted = authorize();
  assert.equal(evaluate(host, policy).outcome, 'GREYLIST');
  assert.equal(evaluateAccess(host, context(granted.nextState, 12_000)).decision.reason, 'ACTIVE_GRANT');
  for (const target of ['www.grey.example', 'child.grey.example', 'grey.example.other.example']) {
    assert.equal(evaluateAccess(target, context(granted.nextState, 12_000)).decision.outcome, 'GREYLIST');
  }
  assert.equal(evaluateAccess('https://GREY.EXAMPLE.:8443/page', context(granted.nextState, 12_000))
    .decision.outcome, 'ALLOW');
  assert.deepEqual(policy, { whitelist: ['mail.example'], blacklist: ['blocked.example'] });
});

test('Reloading pending state preserves deadlines before readiness and after timeout', () => {
  const started = begin();
  for (const [now, outcome] of [
    [10_500, 'WAIT'], [11_000, 'REQUIRE_CONFIRMATION'], [13_000, 'GREYLIST'],
  ]) {
    const reloaded = JSON.parse(JSON.stringify(started.nextState));
    const result = evaluateAccess(host, context(reloaded, now));
    assert.equal(result.decision.outcome, outcome);
    assert.deepEqual(result.nextState.pendingRequests, [started.request]);
    assert.deepEqual(result.nextState.grants, []);
    assert.equal(result.nextState.nextRequestId, 2);
  }
});

test('Reloading active and expired grants preserves their original expiry', () => {
  const granted = authorize();
  for (const [now, outcome] of [[12_000, 'ALLOW'], [16_500, 'GREYLIST']]) {
    const reloaded = JSON.parse(JSON.stringify(granted.nextState));
    const result = evaluateAccess(host, context(reloaded, now));
    assert.equal(result.decision.outcome, outcome);
    assert.deepEqual(result.nextState.grants, [granted.grant]);
    assert.deepEqual(result.nextState.pendingRequests, []);
  }
});

test('Cancelled requests cannot confirm after reload; a new Start gets a new full wait', () => {
  const started = begin();
  const cancelled = cancelAccess(started.request.id, context(started.nextState, 10_500));
  assert.equal(cancelled.type, 'CANCELLED');
  assert.deepEqual(cancelled.nextState.pendingRequests, []);
  const reloaded = JSON.parse(JSON.stringify(cancelled.nextState));
  const replay = confirmAccess(started.request.id, context(reloaded, 11_000));
  assert.equal(replay.reason, 'REQUEST_NOT_FOUND');
  assert.deepEqual(replay.nextState.grants, []);
  const restarted = startAccess(host, context(replay.nextState, 11_000), timing);
  assert.equal(restarted.type, 'STARTED');
  assert.notEqual(restarted.request.id, started.request.id);
  assert.equal(restarted.request.readyAt, 12_000);
  assert.equal(confirmAccess(started.request.id, context(restarted.nextState, 12_000)).reason,
    'REQUEST_NOT_FOUND');
});

test('Duplicate confirmation cannot renew a grant, including after reload and expiry', () => {
  const granted = authorize();
  let state = JSON.parse(JSON.stringify(granted.nextState));
  for (const now of [12_000, 16_500]) {
    const result = confirmAccess(granted.grant.requestId, context(state, now));
    assert.equal(result.reason, 'REQUEST_NOT_FOUND');
    assert.deepEqual(result.nextState.grants, [granted.grant]);
    assert.deepEqual(result.nextState.pendingRequests, []);
    state = result.nextState;
  }
});

test('A fresh request after grant or request expiry starts a full new wait', () => {
  for (const [state, now] of [[begin().nextState, 13_000], [authorize().nextState, 16_500]]) {
    const result = startAccess(host, context(state, now), timing);
    assert.equal(result.type, 'STARTED');
    assert.equal(result.request.id, 2);
    assert.equal(result.request.startedAt, now);
    assert.equal(result.request.readyAt, now + timing.waitMs);
    assert.equal(result.nextState.pendingRequests.length, 1);
    assert.deepEqual(result.nextState.grants, []);
  }
});

test('Start while a grant is active and Cancel after consumption cannot alter the grant', () => {
  const granted = authorize();
  const restarted = startAccess(host, context(granted.nextState, 12_000), timing);
  assert.equal(restarted.reason, 'GRANT_ACTIVE');
  const cancelled = cancelAccess(granted.grant.requestId, context(restarted.nextState, 12_000));
  assert.equal(cancelled.reason, 'REQUEST_NOT_FOUND');
  assert.deepEqual(cancelled.nextState.grants, [granted.grant]);
  assert.deepEqual(cancelled.nextState.pendingRequests, []);
});

test('Current Blacklist overrides grants, Whitelist, and pending confirmation', () => {
  const blockedPolicy = { whitelist: [host], blacklist: [host] };
  const granted = authorize();
  const result = evaluateAccess(host, context(granted.nextState, 12_000, blockedPolicy));
  assert.equal(result.decision.outcome, 'DENY');
  assert.equal(result.decision.reason, 'BLACKLISTED');
  const started = begin();
  assert.equal(confirmAccess(started.request.id, context(started.nextState, 11_000, blockedPolicy))
    .reason, 'NOT_GREYLIST');
  for (const target of ['mail.example', 'blocked.example']) {
    assert.equal(startAccess(target, context(createAccessState()), timing).reason, 'NOT_GREYLIST');
  }
});

test('Any policy revision change invalidates pending requests and grants', () => {
  const started = begin();
  const stale = confirmAccess(started.request.id, context(started.nextState, 11_000, policy, 1));
  assert.equal(stale.reason, 'POLICY_CHANGED');
  const fresh = startAccess(host, context(stale.nextState, 11_000, policy, 1), timing);
  assert.equal(fresh.type, 'STARTED');
  assert.equal(fresh.request.policyRevision, 1);
  assert.equal(fresh.request.readyAt, 12_000);
  const granted = authorize();
  const observed = evaluateAccess(host, context(granted.nextState, 12_000, policy, 1));
  assert.equal(observed.decision.reason, 'POLICY_CHANGED');
  assert.equal(evaluateAccess(host, context(observed.nextState, 12_000, policy, 0))
    .decision.reason, 'POLICY_ROLLBACK');
});

test('Observing grant expiry prevents rollback from reviving it in the threaded state', () => {
  const granted = authorize();
  const expired = evaluateAccess(host, context(granted.nextState, 16_500));
  assert.equal(expired.decision.reason, 'GRANT_EXPIRED');
  const reloaded = JSON.parse(JSON.stringify(expired.nextState));
  const result = evaluateAccess(host, context(reloaded, 16_499));
  assert.equal(result.decision.reason, 'CLOCK_ROLLBACK');
  assert.equal(result.nextState, null);
});

test('Rejected late confirmation records time so rollback cannot reopen its window', () => {
  const started = begin();
  const late = confirmAccess(started.request.id, context(started.nextState, 13_000));
  assert.equal(late.reason, 'REQUEST_EXPIRED');
  const earlier = confirmAccess(started.request.id, context(late.nextState, 12_999));
  assert.equal(earlier.reason, 'CLOCK_ROLLBACK');
  assert.equal(earlier.nextState, null);
  assert.deepEqual(late.nextState.grants, []);
});

test('Independent hosts keep independent requests; confirming one consumes only its request', () => {
  const first = begin();
  const second = startAccess('other.example', context(first.nextState, 10_500), timing);
  assert.equal(second.type, 'STARTED');
  const confirmed = confirmAccess(first.request.id, context(second.nextState, 11_000));
  assert.equal(confirmed.type, 'CONFIRMED');
  assert.deepEqual(confirmed.nextState.pendingRequests, [second.request]);
  assert.equal(evaluateAccess('other.example', context(confirmed.nextState, 11_000))
    .decision.outcome, 'WAIT');
});

test('Invalid timing has no defaults and cannot create a request', () => {
  for (const invalid of [undefined, null, {}, { ...timing, extra: 1 },
    ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].flatMap((value) =>
      Object.keys(timing).map((field) => ({ ...timing, [field]: value })))]) {
    const result = startAccess(host, context(createAccessState()), invalid);
    assert.equal(result.reason, 'INVALID_TIMING');
    assert.deepEqual(result.nextState.pendingRequests, []);
    assert.deepEqual(result.nextState.grants, []);
  }
});

test('Deadline overflow and exhausted request IDs fail closed', () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.equal(startAccess(host, context(createAccessState(), max - 1), timing).reason, 'TIME_OVERFLOW');
  const started = startAccess(host, context(createAccessState(), max - 10), {
    waitMs: 1, confirmationWindowMs: 2, grantDurationMs: 20,
  });
  assert.equal(started.type, 'STARTED');
  const confirmed = confirmAccess(started.request.id, context(started.nextState, max - 9));
  assert.equal(confirmed.reason, 'TIME_OVERFLOW');
  assert.deepEqual(confirmed.nextState.grants, []);
  const exhausted = { ...createAccessState(), nextRequestId: max };
  assert.equal(startAccess(host, context(exhausted), timing).reason, 'ID_EXHAUSTED');
});

test('Malformed access state fails closed even for a whitelisted destination', () => {
  const started = begin();
  const granted = authorize();
  const malformed = [
    null, {}, { ...createAccessState(), grants: null },
    { ...createAccessState(), extra: true },
    { ...started.nextState, nextRequestId: 1 },
    { ...started.nextState, pendingRequests: [started.request, started.request] },
    { ...started.nextState, pendingRequests: [{ ...started.request, readyAt: 10_000 }] },
    { ...started.nextState, pendingRequests: [{ ...started.request, hostname: 'GREY.EXAMPLE' }] },
    { ...started.nextState, pendingRequests: [{ ...started.request, policyRevision: 1 }] },
    { ...granted.nextState, grants: [{ ...granted.grant, expiresAt: 11_000 }] },
    { ...granted.nextState, lastObservedAt: 10_000 },
    { ...granted.nextState, pendingRequests: [started.request] },
  ];
  for (const state of malformed) {
    const result = evaluateAccess('mail.example', context(state, 20_000));
    assert.deepEqual(result.decision, { outcome: 'DENY', reason: 'INVALID_STATE' });
    assert.equal(result.nextState, null);
    assert.equal(confirmAccess(1, context(state, 20_000)).reason, 'INVALID_STATE');
  }
});

test('Invalid current policy, time, revisions, targets, and request IDs fail closed', () => {
  const state = createAccessState();
  for (const now of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(evaluateAccess('mail.example', context(state, now)).decision.reason, 'INVALID_TIME');
  }
  const invalidPolicy = { whitelist: [host], blacklist: ['*.example'] };
  assert.equal(evaluateAccess(host, context(state, 10_000, invalidPolicy)).decision.reason, 'INVALID_POLICY');
  assert.equal(startAccess(host, context(state, 10_000, policy, -1), timing).reason,
    'INVALID_POLICY_REVISION');
  assert.equal(startAccess('https://', context(state), timing).reason, 'INVALID_TARGET');
  assert.equal(evaluateAccess('https://', context(state)).decision.reason, 'INVALID_TARGET');
  for (const id of [null, '1', 0, -1, 1.5, NaN, Infinity]) {
    assert.equal(confirmAccess(id, context(state)).reason, 'INVALID_REQUEST_ID');
  }
  assert.equal(confirmAccess(99, context(state)).reason, 'REQUEST_NOT_FOUND');
});

test('All access operations are deterministic and do not mutate input state or policy', () => {
  const started = begin();
  const input = freeze(context(structuredClone(started.nextState), 11_000, structuredClone(policy)));
  const before = structuredClone(input);
  const calls = [
    () => evaluateAccess(host, input),
    () => startAccess(host, input, freeze(structuredClone(timing))),
    () => confirmAccess(started.request.id, input),
    () => cancelAccess(started.request.id, input),
  ];
  for (const call of calls) assert.deepEqual(call(), call());
  assert.deepEqual(input, before);
  const result = evaluateAccess(host, input);
  result.nextState.pendingRequests[0].hostname = 'changed.example';
  assert.deepEqual(input, before);
});
