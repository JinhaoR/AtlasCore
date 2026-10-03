import test from 'node:test';
import assert from 'node:assert/strict';
import { accessCopy, canQueueOperation, countdown, journeyEndCopy, selectedContext } from '../dist/lib/ui/presentation.js';

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
