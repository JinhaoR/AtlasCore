import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelPolicyProposal, confirmAccess, createAccessState, createPolicyProposal,
  createVaultState, evaluate, evaluateAccess, prepareVaultCommit,
  reviewPolicyProposal, startAccess,
} from '../dist/index.js';

const policy = { whitelist: ['mail.example'], blacklist: ['blocked.example'] };
const candidatePolicy = { whitelist: ['mail.example', 'new.example'], blacklist: ['blocked.example'] };
const timing = { waitMs: 1_000, confirmationWindowMs: 2_000 };
const accessTiming = { ...timing, grantDurationMs: 5_000 };

function context(state = createVaultState(), now = 10_000, overrides = {}) {
  return { policy, policyRevision: 0, state, accessState: createAccessState(), now, ...overrides };
}

function propose(candidate = candidatePolicy, input = context()) {
  const result = createPolicyProposal(candidate, input, timing);
  assert.equal(result.type, 'PROPOSED');
  return result;
}

function committedContext(candidate, now = candidate.preparedAt) {
  const snapshot = candidate.nextSnapshot;
  return {
    policy: snapshot.policy, policyRevision: snapshot.policyRevision,
    state: snapshot.vaultState, accessState: snapshot.accessState, now,
  };
}

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function assertFrozen(value) {
  if (value !== null && typeof value === 'object') {
    assert.equal(Object.isFrozen(value), true);
    Object.values(value).forEach(assertFrozen);
  }
}

test('A proposal freezes a normalized complete candidate without changing active policy', () => {
  const proposedInput = {
    whitelist: [' NEW.EXAMPLE. ', 'mail.example', 'new.example'],
    blacklist: ['BLOCKED.EXAMPLE.'],
  };
  const input = context();
  const before = structuredClone(input);
  const result = propose(proposedInput, input);
  assert.deepEqual(result.proposal, {
    id: 1, basePolicyRevision: 0, candidatePolicy,
    createdAt: 10_000, readyAt: 11_000, confirmBy: 13_000,
  });
  assert.deepEqual(result.nextState.pendingProposal, result.proposal);
  assert.equal(result.nextState.nextProposalId, 2);
  assert.equal(result.nextState.policyRevision, 0);
  assert.equal(result.nextState.lastApplied, null);
  assert.deepEqual(input, before);
  assert.equal(evaluate('new.example', input.policy).outcome, 'GREYLIST');
  proposedInput.whitelist.push('unreviewed.example');
  proposedInput.blacklist.length = 0;
  assert.deepEqual(result.proposal.candidatePolicy, candidatePolicy);
  assertFrozen(result.proposal);
  assertFrozen(result.nextState);
  assert.throws(() => result.proposal.candidatePolicy.whitelist.push('unreviewed.example'), TypeError);
  assert.throws(() => { result.proposal.readyAt = 10_000; }, TypeError);
});

test('Review derives waiting, ready, and expired phases without changing any state', () => {
  const started = propose();
  const before = structuredClone(started.nextState);
  for (const [now, phase] of [
    [10_000, 'WAITING'], [10_999, 'WAITING'], [11_000, 'READY'],
    [12_999, 'READY'], [13_000, 'EXPIRED'],
  ]) {
    const input = freeze(context(started.nextState, now));
    const result = reviewPolicyProposal(started.proposal.id, input);
    assert.equal(result.ok, true);
    assert.equal(result.review.phase, phase);
    assert.equal(result.review.proposalId, started.proposal.id);
    assert.equal(result.review.basePolicyRevision, 0);
    assert.equal(result.review.createdAt, 10_000);
    assert.equal(result.review.readyAt, 11_000);
    assert.equal(result.review.confirmBy, 13_000);
    assert.deepEqual(result.review.candidatePolicy, candidatePolicy);
    assert.equal(result.review.invalidatesAccess, true);
    assert.equal('nextState' in result, false);
    assertFrozen(result.review);
  }
  assert.deepEqual(started.nextState, before);
  assert.equal(started.nextState.lastObservedAt, 10_000);
});

test('Review reports both list edits and actual classifications with Blacklist precedence', () => {
  const active = {
    whitelist: ['mail.example', 'both.example'],
    blacklist: ['blocked.example', 'both.example'],
  };
  const replacement = {
    whitelist: ['blocked.example', 'new.example'],
    blacklist: ['blocked.example', 'mail.example'],
  };
  const started = propose(replacement, context(undefined, 10_000, { policy: active }));
  const result = reviewPolicyProposal(started.proposal.id,
    context(started.nextState, 11_000, { policy: active }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.review.whitelist, {
    added: ['blocked.example', 'new.example'], removed: ['both.example', 'mail.example'],
  });
  assert.deepEqual(result.review.blacklist, { added: ['mail.example'], removed: ['both.example'] });
  assert.deepEqual(result.review.classifications, [
    { hostname: 'both.example', before: 'BLACKLIST', after: 'GREYLIST' },
    { hostname: 'mail.example', before: 'WHITELIST', after: 'BLACKLIST' },
    { hostname: 'new.example', before: 'GREYLIST', after: 'WHITELIST' },
  ]);
  assert.equal(evaluate('blocked.example', result.review.candidatePolicy).reason, 'BLACKLISTED');
});

test('A second proposal cannot replace or edit a waiting, ready, or expired proposal', () => {
  const started = propose();
  for (const now of [10_500, 11_000, 13_000]) {
    const result = createPolicyProposal({ whitelist: [], blacklist: [] },
      context(started.nextState, now), { waitMs: 1, confirmationWindowMs: 1 });
    assert.equal(result.reason, 'PROPOSAL_PENDING');
    assert.deepEqual(result.nextState.pendingProposal, started.proposal);
    assert.equal(result.nextState.nextProposalId, 2);
    assert.equal(result.nextState.policyRevision, 0);
  }
});

test('Cancellation consumes the proposal and an edited replacement starts a full new wait', () => {
  const started = propose();
  const cancelled = cancelPolicyProposal(started.proposal.id, context(started.nextState, 10_500));
  assert.equal(cancelled.type, 'CANCELLED');
  assert.equal(cancelled.proposalId, started.proposal.id);
  assert.equal(cancelled.nextState.pendingProposal, null);
  assert.equal(cancelled.nextState.policyRevision, 0);
  assert.equal(cancelled.nextState.lastApplied, null);
  const reloaded = JSON.parse(JSON.stringify(cancelled.nextState));
  assert.equal(prepareVaultCommit(started.proposal.id, context(reloaded, 11_000)).reason,
    'PROPOSAL_NOT_FOUND');
  const fresh = propose({ whitelist: [], blacklist: [] }, context(reloaded, 11_000));
  assert.equal(fresh.proposal.id, 2);
  assert.equal(fresh.proposal.createdAt, 11_000);
  assert.equal(fresh.proposal.readyAt, 12_000);
  assert.equal(fresh.proposal.confirmBy, 14_000);
  assert.equal(prepareVaultCommit(fresh.proposal.id, context(fresh.nextState, 11_999)).reason,
    'NOT_READY');
});

test('Expired and stale proposals can be explicitly cancelled without changing policy', () => {
  const started = propose();
  for (const input of [
    context(started.nextState, 13_000),
    context(started.nextState, 11_000, { policyRevision: 1 }),
  ]) {
    const before = structuredClone(input);
    const cancelled = cancelPolicyProposal(started.proposal.id, input);
    assert.equal(cancelled.type, 'CANCELLED');
    assert.equal(cancelled.nextState.pendingProposal, null);
    assert.equal(cancelled.nextState.policyRevision, input.policyRevision);
    assert.deepEqual(input, before);
  }
});

test('Confirmation is rejected before readiness and at or after timeout', () => {
  const started = propose();
  for (const [now, reason] of [
    [10_999, 'NOT_READY'], [13_000, 'PROPOSAL_EXPIRED'], [20_000, 'PROPOSAL_EXPIRED'],
  ]) {
    const result = prepareVaultCommit(started.proposal.id, context(started.nextState, now));
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal('candidate' in result, false);
    assert.deepEqual(result.nextState.pendingProposal, started.proposal);
    assert.equal(result.nextState.lastObservedAt, now);
    assert.equal(result.nextState.policyRevision, 0);
    assert.equal(result.nextState.lastApplied, null);
    assert.equal(evaluate('new.example', policy).outcome, 'GREYLIST');
  }
  for (const now of [11_000, 12_999]) {
    assert.equal(prepareVaultCommit(started.proposal.id, context(started.nextState, now)).type,
      'COMMIT_PREPARED');
  }
});

test('An observed confirmation timeout cannot be reopened by supplying earlier time', () => {
  const started = propose();
  const expired = prepareVaultCommit(started.proposal.id, context(started.nextState, 13_000));
  const reloaded = JSON.parse(JSON.stringify(expired.nextState));
  const rollback = prepareVaultCommit(started.proposal.id, context(reloaded, 12_999));
  assert.equal(rollback.reason, 'CLOCK_ROLLBACK');
  assert.equal(rollback.nextState, null);
});

test('Any policy revision change stales a proposal and cannot silently rebase it', () => {
  const started = propose();
  const input = context(started.nextState, 11_000, { policyRevision: 1 });
  assert.equal(reviewPolicyProposal(started.proposal.id, input).reason, 'POLICY_CHANGED');
  const stale = prepareVaultCommit(started.proposal.id, input);
  assert.equal(stale.reason, 'POLICY_CHANGED');
  assert.equal('candidate' in stale, false);
  assert.equal(stale.nextState.policyRevision, 1);
  assert.deepEqual(stale.nextState.pendingProposal, started.proposal);
  assert.equal(prepareVaultCommit(started.proposal.id, context(stale.nextState, 11_000)).reason,
    'POLICY_ROLLBACK');
});

test('Confirmation prepares one complete frozen commit candidate without publishing policy', () => {
  const started = propose();
  const input = freeze(context(started.nextState, 11_000));
  const before = structuredClone(input);
  const result = prepareVaultCommit(started.proposal.id, input);
  assert.equal(result.type, 'COMMIT_PREPARED');
  assert.equal(result.candidate.proposalId, started.proposal.id);
  assert.equal(result.candidate.expectedPolicyRevision, 0);
  assert.equal(result.candidate.preparedAt, 11_000);
  const snapshot = result.candidate.nextSnapshot;
  assert.deepEqual(snapshot.policy, candidatePolicy);
  assert.equal(snapshot.policyRevision, 1);
  assert.equal(snapshot.vaultState.pendingProposal, null);
  assert.equal(snapshot.vaultState.policyRevision, 1);
  assert.equal(snapshot.vaultState.nextProposalId, 2);
  assert.deepEqual(snapshot.vaultState.lastApplied, { proposalId: started.proposal.id, policyRevision: 1 });
  assert.equal(snapshot.accessState.policyRevision, 1);
  assert.deepEqual(snapshot.accessState.pendingRequests, []);
  assert.deepEqual(snapshot.accessState.grants, []);
  assert.deepEqual(result.nextState.pendingProposal, started.proposal);
  assert.equal(result.nextState.policyRevision, 0);
  assert.equal(result.nextState.lastApplied, null);
  assert.equal(result.nextState.lastObservedAt, 11_000);
  assertFrozen(result.candidate);
  assertFrozen(result.nextState);
  assert.deepEqual(input, before);
  assert.equal(evaluate('new.example', input.policy).outcome, 'GREYLIST');
});

test('Only adopting a successful commit candidate applies blacklist and whitelist edits together', () => {
  const replacement = { whitelist: ['blocked.example'], blacklist: ['mail.example', 'new.example'] };
  const started = propose(replacement);
  const result = prepareVaultCommit(started.proposal.id, context(started.nextState, 11_000));
  assert.equal(result.type, 'COMMIT_PREPARED');
  for (const [host, before, after] of [
    ['mail.example', 'ALLOW', 'DENY'],
    ['blocked.example', 'DENY', 'ALLOW'],
    ['new.example', 'GREYLIST', 'DENY'],
  ]) {
    assert.equal(evaluate(host, policy).outcome, before);
    assert.equal(evaluate(host, result.candidate.nextSnapshot.policy).outcome, after);
  }
  assert.equal(result.candidate.nextSnapshot.policyRevision, 1);
  assert.deepEqual(policy, { whitelist: ['mail.example'], blacklist: ['blocked.example'] });
});

test('Committed proposals cannot confirm twice, including after reload or a newer proposal', () => {
  const started = propose();
  const prepared = prepareVaultCommit(started.proposal.id, context(started.nextState, 11_000));
  const input = JSON.parse(JSON.stringify(committedContext(prepared.candidate, 11_500)));
  const replay = prepareVaultCommit(started.proposal.id, input);
  assert.equal(replay.reason, 'ALREADY_COMMITTED');
  assert.equal('candidate' in replay, false);
  assert.equal(replay.nextState.policyRevision, 1);
  assert.equal(replay.nextState.pendingProposal, null);
  assert.deepEqual(replay.nextState.lastApplied, { proposalId: started.proposal.id, policyRevision: 1 });
  const next = propose({ whitelist: [], blacklist: [] }, { ...input, state: replay.nextState });
  assert.equal(next.proposal.id, 2);
  assert.equal(prepareVaultCommit(started.proposal.id, { ...input, state: next.nextState }).reason,
    'ALREADY_COMMITTED');
  const second = prepareVaultCommit(next.proposal.id, { ...input, state: next.nextState, now: 12_500 });
  assert.equal(second.type, 'COMMIT_PREPARED');
  const afterSecond = committedContext(second.candidate);
  assert.equal(afterSecond.policyRevision, 2);
  assert.equal(prepareVaultCommit(started.proposal.id, afterSecond).reason, 'PROPOSAL_NOT_FOUND');
  assert.equal(prepareVaultCommit(next.proposal.id, afterSecond).reason, 'ALREADY_COMMITTED');
});

test('Discarding a candidate models a definite failed save without applying any policy change', () => {
  const started = propose();
  const authoritative = freeze(context(started.nextState, 11_000));
  const before = structuredClone(authoritative);
  const abandoned = prepareVaultCommit(started.proposal.id, authoritative);
  assert.equal(abandoned.type, 'COMMIT_PREPARED');
  // No backend is implemented: not adopting the candidate models a known not-written result.
  assert.deepEqual(authoritative, before);
  assert.equal(evaluate('new.example', authoritative.policy).outcome, 'GREYLIST');
  assert.deepEqual(authoritative.state.pendingProposal, started.proposal);
  assert.equal(authoritative.state.lastApplied, null);
  const retry = prepareVaultCommit(started.proposal.id, { ...authoritative, now: 11_500 });
  assert.equal(retry.type, 'COMMIT_PREPARED');
  assert.equal(retry.candidate.nextSnapshot.policyRevision, 1);
  assert.equal(retry.nextState.pendingProposal.confirmBy, 13_000);
  const tooLate = prepareVaultCommit(started.proposal.id, { ...authoritative, now: 13_000 });
  assert.equal(tooLate.reason, 'PROPOSAL_EXPIRED');
});

test('Commit candidates preserve latest access activity and invalidate its old policy revision', () => {
  const started = propose();
  const request = startAccess('grant.example', {
    policy, policyRevision: 0, state: createAccessState(), now: 10_000,
  }, { waitMs: 100, confirmationWindowMs: 2_000, grantDurationMs: 5_000 });
  const granted = confirmAccess(request.request.id, {
    policy, policyRevision: 0, state: request.nextState, now: 10_100,
  });
  const pending = startAccess('waiting.example', {
    policy, policyRevision: 0, state: granted.nextState, now: 10_500,
  }, accessTiming);
  const latest = freeze(pending.nextState);
  const prepared = prepareVaultCommit(started.proposal.id,
    context(started.nextState, 11_000, { accessState: latest }));
  assert.equal(prepared.type, 'COMMIT_PREPARED');
  const committed = committedContext(prepared.candidate);
  assert.equal(committed.accessState.nextRequestId, latest.nextRequestId);
  assert.deepEqual(committed.accessState.pendingRequests, latest.pendingRequests);
  assert.deepEqual(committed.accessState.grants, latest.grants);
  assert.equal(committed.accessState.policyRevision, 1);
  assert.equal(committed.accessState.lastObservedAt, 11_000);
  assert.equal(committed.accessState.grants[0].issuedAt, 10_100);
  assert.equal(committed.accessState.grants[0].expiresAt, 15_100);
  const accessInput = {
    policy: committed.policy, policyRevision: committed.policyRevision,
    state: committed.accessState, now: 11_000,
  };
  assert.equal(evaluateAccess('grant.example', accessInput).decision.reason, 'POLICY_CHANGED');
  assert.equal(confirmAccess(pending.request.id, accessInput).reason, 'POLICY_CHANGED');
  assert.equal(evaluateAccess('grant.example', {
    policy, policyRevision: 0, state: latest, now: 11_000,
  }).decision.reason, 'ACTIVE_GRANT');
  assertFrozen(committed.accessState);
});

test('Reload preserves frozen contents, IDs, deadlines, and explicit confirmation requirements', () => {
  const started = propose();
  for (const [now, phase] of [[10_500, 'WAITING'], [11_000, 'READY'], [13_000, 'EXPIRED']]) {
    const reloaded = JSON.parse(JSON.stringify(started.nextState));
    const review = reviewPolicyProposal(started.proposal.id, context(reloaded, now));
    assert.equal(review.review.phase, phase);
    assert.deepEqual(reloaded.pendingProposal, started.proposal);
    assert.equal(reloaded.nextProposalId, 2);
    assert.equal(reloaded.policyRevision, 0);
    assert.equal(reloaded.lastApplied, null);
    assert.equal(evaluate('new.example', policy).outcome, 'GREYLIST');
  }
});

test('Invalid candidate batches and unsupported policy fields are rejected in full', () => {
  for (const candidate of [
    null, {}, { whitelist: ['new.example'] },
    { whitelist: ['new.example'], blacklist: ['*.example'] },
    { whitelist: ['https://new.example'], blacklist: [] },
    { ...candidatePolicy, waitMs: 1 },
  ]) {
    const result = createPolicyProposal(candidate, context(), timing);
    assert.equal(result.reason, 'INVALID_CANDIDATE_POLICY');
    assert.equal(result.nextState.pendingProposal, null);
    assert.equal(result.nextState.nextProposalId, 1);
    assert.equal(result.nextState.policyRevision, 0);
  }
});

test('List reordering, duplicates, and normalized spelling do not create a policy change', () => {
  const active = { whitelist: ['two.example', 'one.example'], blacklist: ['blocked.example'] };
  const equivalent = {
    whitelist: [' ONE.EXAMPLE. ', 'two.example', 'one.example'],
    blacklist: ['blocked.example', 'BLOCKED.EXAMPLE.'],
  };
  const result = createPolicyProposal(equivalent,
    context(undefined, 10_000, { policy: active }), timing);
  assert.equal(result.reason, 'NO_POLICY_CHANGE');
  assert.equal(result.nextState.pendingProposal, null);
  assert.equal(result.nextState.nextProposalId, 1);
});

test('Invalid timing, deadline overflow, exhausted IDs, and exhausted revisions fail closed', () => {
  for (const invalid of [
    undefined, null, {}, { ...timing, extra: true },
    ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].flatMap((value) =>
      Object.keys(timing).map((field) => ({ ...timing, [field]: value }))),
  ]) {
    assert.equal(createPolicyProposal(candidatePolicy, context(), invalid).reason, 'INVALID_TIMING');
  }
  const max = Number.MAX_SAFE_INTEGER;
  assert.equal(createPolicyProposal(candidatePolicy, context(undefined, max - 1), timing).reason,
    'TIME_OVERFLOW');
  assert.equal(createPolicyProposal(candidatePolicy,
    context({ ...createVaultState(), nextProposalId: max }), timing).reason, 'ID_EXHAUSTED');
  const started = propose(candidatePolicy, context(undefined, 10_000, { policyRevision: max }));
  const exhausted = prepareVaultCommit(started.proposal.id,
    context(started.nextState, 11_000, { policyRevision: max }));
  assert.equal(exhausted.reason, 'REVISION_EXHAUSTED');
  assert.equal('candidate' in exhausted, false);
  assert.deepEqual(exhausted.nextState.pendingProposal, started.proposal);
});

test('Malformed stored proposal or state cannot produce a commit candidate', () => {
  const started = propose();
  const malformed = [
    null, {}, { ...started.nextState, extra: true },
    { ...started.nextState, nextProposalId: 1 },
    { ...started.nextState, lastObservedAt: 9_999 },
    { ...started.nextState, pendingProposal: { ...started.proposal, readyAt: 10_000 } },
    { ...started.nextState, pendingProposal: { ...started.proposal, confirmBy: 11_000 } },
    { ...started.nextState, pendingProposal: { ...started.proposal, basePolicyRevision: 1 } },
    { ...started.nextState, pendingProposal: { ...started.proposal, candidatePolicy: {
      whitelist: ['new.example'], blacklist: ['*.example'],
    } } },
    ...[
      { ...candidatePolicy, whitelist: ['MAIL.EXAMPLE', 'new.example'] },
      { ...candidatePolicy, whitelist: ['mail.example', 'new.example', 'new.example'] },
      { ...candidatePolicy, whitelist: ['new.example', 'mail.example'] },
      policy,
    ].map((candidatePolicy) => ({
      ...started.nextState, pendingProposal: { ...started.proposal, candidatePolicy },
    })),
    { ...started.nextState, lastApplied: { proposalId: 1, policyRevision: 1 } },
  ];
  for (const state of malformed) {
    const input = context(state, 11_000);
    const result = prepareVaultCommit(started.proposal.id, input);
    assert.equal(result.reason, 'INVALID_STATE');
    assert.equal(result.nextState, null);
    assert.equal('candidate' in result, false);
    assert.equal(reviewPolicyProposal(started.proposal.id, input).reason, 'INVALID_STATE');
  }
});

test('Invalid context fails closed even when a proposal is otherwise ready', () => {
  const started = propose();
  const base = context(started.nextState, 11_000);
  for (const [patch, reason] of [
    [{ policy: { whitelist: ['new.example'], blacklist: ['*.example'] } }, 'INVALID_POLICY'],
    [{ accessState: null }, 'INVALID_ACCESS_STATE'],
    [{ policyRevision: -1 }, 'INVALID_POLICY_REVISION'],
    [{ now: -1 }, 'INVALID_TIME'],
    [{ now: NaN }, 'INVALID_TIME'],
    [{ now: Infinity }, 'INVALID_TIME'],
    [{ now: 11_000.5 }, 'INVALID_TIME'],
    [{ accessState: { ...createAccessState(), lastObservedAt: 11_001 } }, 'CLOCK_ROLLBACK'],
    [{ accessState: { ...createAccessState(), policyRevision: 1 } }, 'POLICY_ROLLBACK'],
  ]) {
    const input = { ...base, ...patch };
    const result = prepareVaultCommit(started.proposal.id, input);
    assert.equal(result.reason, reason);
    assert.equal(result.nextState, null);
    assert.equal('candidate' in result, false);
    assert.equal(reviewPolicyProposal(started.proposal.id, input).reason, reason);
  }
});

test('Invalid and unknown proposal IDs cannot confirm, review, or cancel', () => {
  const started = propose();
  const input = context(started.nextState, 11_000);
  for (const operation of [prepareVaultCommit, reviewPolicyProposal, cancelPolicyProposal]) {
    for (const id of [null, '1', 0, -1, 1.5, NaN, Infinity, { id: 1, confirmed: true }]) {
      assert.equal(operation(id, input).reason, 'INVALID_PROPOSAL_ID');
    }
    assert.equal(operation(99, input).reason, 'PROPOSAL_NOT_FOUND');
  }
});

test('Vault commands are deterministic and never mutate or freeze caller-owned inputs', () => {
  const started = propose();
  const input = structuredClone(context(started.nextState, 11_000));
  const before = structuredClone(input);
  const operations = [
    () => createPolicyProposal(candidatePolicy, context(), timing),
    () => reviewPolicyProposal(started.proposal.id, input),
    () => prepareVaultCommit(started.proposal.id, input),
    () => cancelPolicyProposal(started.proposal.id, input),
  ];
  for (const call of operations) assert.deepEqual(call(), call());
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.state.pendingProposal.candidatePolicy), false);
  const prepared = prepareVaultCommit(started.proposal.id, input);
  input.state.pendingProposal.candidatePolicy.whitelist.push('unreviewed.example');
  input.policy.blacklist.length = 0;
  input.accessState.nextRequestId = 99;
  assert.deepEqual(prepared.candidate.nextSnapshot.policy, candidatePolicy);
  assert.deepEqual(prepared.nextState.pendingProposal.candidatePolicy, candidatePolicy);
  assert.equal(prepared.candidate.nextSnapshot.accessState.nextRequestId, 1);
});
