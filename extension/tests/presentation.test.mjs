import test from 'node:test';
import assert from 'node:assert/strict';
import { accessCopy, canQueueOperation, countdown, journeyEndCopy, selectedAccessRecord, selectedContext } from '../dist/lib/ui/presentation.js';

test('Journey termination copy distinguishes an uncorrelated navigation from expiry and cancellation', () => {
  assert.match(journeyEndCopy('UNRELATED_NAVIGATION'), /could not be linked/);
  assert.match(journeyEndCopy('EXPIRED'), /fixed time limit/);
  assert.match(journeyEndCopy('HOP_LIMIT'), /navigation limit/);
  assert.match(journeyEndCopy('CANCELLED'), /You ended/);
  const decision = { outcome: 'GREYLIST', reason: 'UNLISTED', target: { hostname: 'saml.example' } };
  journeyEndCopy('UNRELATED_NAVIGATION');
  assert.equal(accessCopy(decision).tone, 'wait');
  assert.equal(decision.outcome, 'GREYLIST');
});

test('housekeeping keeps verified UI intents available; startup, failure and uncertainty stay unavailable', () => {
  for (const status of ['READY', 'LOADING', 'COMMITTING']) assert.equal(canQueueOperation({ status, snapshot: {} }), true);
  for (const status of ['LOADING', 'COMMITTING', 'UNINITIALIZED']) assert.equal(canQueueOperation({ status, snapshot: null }), false);
  for (const status of ['UNAVAILABLE', 'RECONCILING', 'UNINITIALIZED']) assert.equal(canQueueOperation({ status, snapshot: {} }), false);
  assert.equal(canQueueOperation(null), false);
});

test('a countdown reaching zero does not turn a WAIT view into confirmation or permission', () => {
  const decision = { outcome: 'WAIT', reason: 'COOLDOWN', hostname: 'unknown.example', requestId: 1, readyAt: 1000, confirmBy: 2000 };
  assert.equal(countdown(1000, 999), '0:01');
  assert.equal(countdown(1000, 1001), '0:00');
  assert.equal(accessCopy(decision).title, 'Your waiting period is running');
  assert.equal(decision.outcome, 'WAIT');
});

test('a closed selected tab never falls back to another available context', () => {
  const contexts = [{ tabId: 7 }, { tabId: 9 }];
  assert.equal(selectedContext(contexts, '8'), undefined);
  assert.equal(selectedContext(contexts, '9'), contexts[1]);
});

const hostname = 'entry.example';
const pending = Object.freeze({ id: 7, hostname, startedAt: 0, readyAt: 10, confirmBy: 20,
  grantDurationMs: 100, policyRevision: 0 });
const grant = Object.freeze({ requestId: 8, hostname, scopeHostnames: Object.freeze([hostname, 'www.entry.example']),
  issuedAt: 10, expiresAt: 110, policyRevision: 0 });
const accessState = Object.freeze({ pendingRequests: Object.freeze([pending]), grants: Object.freeze([grant]),
  nextRequestId: 9, lastObservedAt: 10, policyRevision: 0 });
const noRecord = { pending: undefined, grant: undefined };

test('a fresh or expired Greylist decision never displays a retained pending or grant scope', () => {
  for (const reason of ['UNLISTED', 'REQUEST_EXPIRED', 'GRANT_EXPIRED', 'POLICY_CHANGED']) {
    assert.deepEqual(selectedAccessRecord({ outcome: 'GREYLIST', reason, target: { hostname } }, accessState, hostname), noRecord);
  }
});

test('waiting and ready decisions select only their exact request and preserve legacy singleton scope', () => {
  for (const [outcome, reason] of [['WAIT', 'COOLDOWN'], ['REQUIRE_CONFIRMATION', 'CONFIRMATION_REQUIRED']]) {
    const decision = { outcome, reason, target: { hostname }, requestId: 7, readyAt: 10, confirmBy: 20 };
    assert.equal(selectedAccessRecord(decision, accessState, hostname).pending, pending);
    assert.equal(selectedAccessRecord(decision, accessState, hostname).grant, undefined);
    assert.equal(pending.scopeHostnames, undefined);
    assert.deepEqual(selectedAccessRecord({ ...decision, requestId: 6 }, accessState, hostname), noRecord);
    assert.deepEqual(selectedAccessRecord({ ...decision, target: { hostname: 'www.entry.example' } }, accessState,
      'www.entry.example'), noRecord, 'a legacy singleton request does not cover the www hostname');
  }
});

test('active grant display selects the decision request ID and its declared exact hostname', () => {
  const decision = { outcome: 'ALLOW', reason: 'ACTIVE_GRANT', target: { hostname: 'www.entry.example' },
    requestId: 8, expiresAt: 110 };
  assert.equal(selectedAccessRecord(decision, accessState, 'www.entry.example').grant, grant);
  assert.equal(selectedAccessRecord(decision, accessState, 'www.entry.example').pending, undefined);
  assert.deepEqual(selectedAccessRecord({ ...decision, requestId: 7 }, accessState, 'www.entry.example'), noRecord);
  assert.deepEqual(selectedAccessRecord({ ...decision, target: { hostname: 'api.entry.example' } }, accessState,
    'api.entry.example'), noRecord, 'undeclared subdomains receive no display record');
});

test('missing context and other authorization outcomes do not select access records', () => {
  const decision = { outcome: 'WAIT', reason: 'COOLDOWN', target: { hostname }, requestId: 7, readyAt: 10, confirmBy: 20 };
  assert.deepEqual(selectedAccessRecord(decision, accessState, null), noRecord);
  assert.deepEqual(selectedAccessRecord(decision, accessState, undefined), noRecord);
  assert.deepEqual(selectedAccessRecord(decision, accessState, 'other.example'), noRecord);
  assert.deepEqual(selectedAccessRecord(decision, null, hostname), noRecord);
  assert.deepEqual(selectedAccessRecord(null, accessState, hostname), noRecord);
  for (const [outcome, reason] of [['ALLOW', 'WHITELISTED'], ['ALLOW', 'ACTIVE_JOURNEY'], ['DENY', 'BLACKLISTED']]) {
    assert.deepEqual(selectedAccessRecord({ outcome, reason, target: { hostname } }, accessState, hostname), noRecord);
  }
});
