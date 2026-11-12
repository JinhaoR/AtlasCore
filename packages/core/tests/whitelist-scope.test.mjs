import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileManagedBlacklist, createAccessState, createAtlasController, createJourneyState, createVaultState,
  createPolicyProposal, evaluate, planAtlasOperation, prepareVaultCommit, reviewPolicyProposal,
  startAccess, validateAtlasSnapshot,
} from '../dist/index.js';
import { FakeRepository } from './support/fake-repository.mjs';

const configuration = {
  accessTiming: { waitMs: 10, confirmationWindowMs: 20, grantDurationMs: 100 },
  vaultTiming: { waitMs: 10, confirmationWindowMs: 30 },
  journeyLimits: { lifetimeMs: 200, maxHops: 3 },
};
const exact = () => ({ whitelist: ['su.se'], blacklist: ['blocked.su.se'] });
const scoped = () => ({ whitelist: [], blacklist: ['blocked.su.se'], whitelistSubdomains: ['su.se'] });
const initial = (policy = scoped()) => ({ policy, policyRevision: 0, configuration, configurationRevision: 0,
  accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState() });
const target = hostname => ({ hostname });
const plan = (snapshot, operation, now = 0, managedBlacklist) => planAtlasOperation(operation,
  { snapshot, now, configuration, ...(managedBlacklist === undefined ? {} : { managedBlacklist }) });
const check = (snapshot, hostname, managedBlacklist, context = { contextId: 'scope-tab', journeyId: null }) =>
  plan(snapshot, { kind: 'CHECK_NAVIGATION', target: target(hostname), context }, 0, managedBlacklist);
function step(snapshot, operation, now = 0, managedBlacklist) {
  const result = plan(snapshot, operation, now, managedBlacklist);
  assert.ok(result.candidateSnapshot, JSON.stringify(result.result)); return result.candidateSnapshot;
}
const vaultContext = (state = createVaultState(), now = 0, policy = exact(), revision = 0) => ({ policy,
  policyRevision: revision, state, accessState: createAccessState(), now });

test('legacy policies remain exact and retain their existing serialized shape', () => {
  const input = exact(), before = structuredClone(input);
  assert.deepEqual(evaluate('su.se', input), { outcome: 'ALLOW', reason: 'WHITELISTED', target: target('su.se') });
  assert.deepEqual(evaluate('indico.fysik.su.se', input), { outcome: 'GREYLIST', reason: 'UNLISTED', target: target('indico.fysik.su.se') });
  assert.deepEqual(validateAtlasSnapshot(initial(input)).snapshot.policy, input);
  assert.deepEqual(input, before); assert.equal(Object.isFrozen(input), false);
});

test('an explicit scope allows its base and every DNS-label descendant with its scope root', () => {
  const policy = scoped(), before = structuredClone(policy);
  for (const hostname of ['su.se', 'fysik.su.se', 'indico.fysik.su.se', 'one.two.three.su.se']) {
    const expected = { outcome: 'ALLOW', reason: 'WHITELISTED_SCOPE', target: target(hostname), scopeRoot: 'su.se' };
    assert.deepEqual(evaluate(hostname, policy), expected);
    assert.deepEqual(evaluate(hostname, policy), expected);
  }
  assert.deepEqual(policy, before); assert.equal(Object.isFrozen(policy.whitelistSubdomains), false);
});

test('suffix lookalikes and sibling hostnames do not inherit a scope', () => {
  for (const hostname of ['evil-su.se', 'evilsu.se', 'su.se.evil', 'su.seevil', 'fysik.se', 'se']) {
    assert.equal(evaluate(hostname, scoped()).outcome, 'GREYLIST', hostname);
  }
});

test('overlapping scopes choose the most specific root deterministically regardless of list order', () => {
  const roots = ['su.se', 'fysik.su.se', 'su.se'];
  for (const whitelistSubdomains of [roots, [...roots].reverse()]) {
    assert.equal(evaluate('indico.fysik.su.se', { ...scoped(), whitelistSubdomains }).scopeRoot, 'fysik.su.se');
  }
});

test('malformed scope terms fail the whole policy closed, even for a valid exact Whitelist host', () => {
  const invalid = [undefined, null, 'su.se', {}, ['*.su.se'], ['https://su.se'], ['se'], ['localhost'],
    ['su.se..'], ['su..se'], [''], [{ hostname: 'su.se' }], ['127.0.0.1']];
  for (const whitelistSubdomains of invalid) {
    const policy = { whitelist: ['exact.example'], blacklist: [], whitelistSubdomains };
    assert.deepEqual(evaluate('exact.example', policy), { outcome: 'DENY', reason: 'INVALID_POLICY' });
    assert.equal(validateAtlasSnapshot(initial(policy)).ok, false);
  }
  assert.equal(evaluate('su.se', { ...scoped(), wildcard: true }).reason, 'INVALID_POLICY');
});

test('manual Blacklist beats exact and scoped permission; exact permission keeps its existing reason', () => {
  const policy = { ...scoped(), whitelist: ['su.se', 'exact.su.se', 'blocked.su.se'] };
  assert.equal(evaluate('blocked.su.se', policy).reason, 'BLACKLISTED');
  assert.equal(evaluate('su.se', policy).reason, 'WHITELISTED');
  assert.equal(evaluate('exact.su.se', policy).reason, 'WHITELISTED');
  assert.equal(evaluate('other.su.se', policy).reason, 'WHITELISTED_SCOPE');
});

test('managed denial beats a broad match at base or descendant, with only separate exact exceptions', () => {
  const managed = compileManagedBlacklist(['su.se', 'tracking.su.se', 'blocked.su.se']);
  for (const hostname of ['su.se', 'tracking.su.se']) {
    assert.equal(check(initial(), hostname, managed).result.decision.reason, 'MANAGED_BLACKLISTED');
  }
  assert.equal(check(initial(), 'blocked.su.se', managed).result.decision.reason, 'BLACKLISTED');
  assert.equal(check(initial(), 'indico.fysik.su.se', managed).result.decision.reason, 'WHITELISTED_SCOPE');
  const exactException = initial({ ...scoped(), whitelist: ['tracking.su.se'] });
  assert.equal(check(exactException, 'tracking.su.se', managed).result.decision.reason, 'WHITELISTED');
  assert.equal(check(exactException, 'su.se', managed).result.decision.reason, 'MANAGED_BLACKLISTED');
});

test('scope permission does not create requests, grants or a Journey during a read-only navigation check', () => {
  const snapshot = initial(), before = structuredClone(snapshot);
  const result = check(snapshot, 'indico.fysik.su.se');
  assert.equal(result.result.decision.reason, 'WHITELISTED_SCOPE'); assert.equal(result.candidateSnapshot, null);
  assert.deepEqual(result.observationSnapshot.accessState.grants, []);
  assert.deepEqual(result.observationSnapshot.accessState.pendingRequests, []);
  assert.deepEqual(result.observationSnapshot.journeyState.journeys, []);
  assert.equal(startAccess('indico.fysik.su.se', { policy: snapshot.policy, policyRevision: 0,
    state: snapshot.accessState, now: 0 }, configuration.accessTiming).reason, 'NOT_GREYLIST');
  assert.deepEqual(snapshot, before);
});

test('scope-only Vault changes are frozen, explicitly reviewed, timed and atomic before adoption', () => {
  const candidatePolicy = { whitelist: [], blacklist: ['blocked.su.se'], whitelistSubdomains: [' SU.SE. ', 'su.se'] };
  const context = vaultContext(), before = structuredClone(context);
  const proposed = createPolicyProposal(candidatePolicy, context, configuration.vaultTiming);
  assert.equal(proposed.type, 'PROPOSED');
  candidatePolicy.whitelistSubdomains.push('unexpected.example');
  assert.deepEqual(proposed.proposal.candidatePolicy, scoped());
  assert.equal(Object.isFrozen(proposed.proposal.candidatePolicy.whitelistSubdomains), true);
  const reviewing = vaultContext(proposed.nextState, 5), frozen = structuredClone(proposed.nextState);
  const review = reviewPolicyProposal(proposed.proposal.id, reviewing);
  assert.deepEqual(review.review.whitelistSubdomains, { added: ['su.se'], removed: [] });
  assert.deepEqual(review.review.whitelist, { added: [], removed: ['su.se'] });
  assert.equal(review.review.invalidatesAccess, true); assert.deepEqual(proposed.nextState, frozen);
  assert.equal(prepareVaultCommit(proposed.proposal.id, vaultContext(proposed.nextState, 9)).reason, 'NOT_READY');
  const prepared = prepareVaultCommit(proposed.proposal.id, vaultContext(proposed.nextState, 10));
  assert.equal(prepared.type, 'COMMIT_PREPARED'); assert.deepEqual(context, before);
  assert.equal(evaluate('indico.fysik.su.se', context.policy).outcome, 'GREYLIST');
  assert.equal(evaluate('indico.fysik.su.se', prepared.candidate.nextSnapshot.policy).reason, 'WHITELISTED_SCOPE');
  assert.equal(prepared.candidate.nextSnapshot.policyRevision, 1);
  const next = prepared.candidate.nextSnapshot;
  assert.equal(prepareVaultCommit(proposed.proposal.id, { ...vaultContext(next.vaultState, 10, next.policy, 1),
    accessState: next.accessState }).reason, 'ALREADY_COMMITTED');
});

test('stored scope proposals require canonical roots and preserve new fields across snapshot serialization', () => {
  let snapshot = step(initial(exact()), { kind: 'PROPOSE_POLICY', candidatePolicy: scoped() });
  const restored = JSON.parse(JSON.stringify(snapshot));
  assert.equal(validateAtlasSnapshot(restored).ok, true);
  assert.deepEqual(restored.vaultState.pendingProposal.candidatePolicy.whitelistSubdomains, ['su.se']);
  for (const values of [['SU.SE'], ['su.se', 'su.se'], ['su.se', 'a.example']]) {
    const damaged = structuredClone(snapshot); damaged.vaultState.pendingProposal.candidatePolicy.whitelistSubdomains = values;
    // A canonical extra term is a changed but valid frozen proposal; stale callers
    // cannot supply it to confirmation, whose closed shape accepts only the ID.
    if (values.length === 2 && values[1] === 'a.example') {
      assert.equal(validateAtlasSnapshot(damaged).ok, false, 'stored proposal roots must be sorted');
    } else assert.equal(validateAtlasSnapshot(damaged).ok, false);
  }
  snapshot = step(snapshot, { kind: 'CONFIRM_POLICY', proposalId: 1 }, 10);
  assert.deepEqual(validateAtlasSnapshot(JSON.parse(JSON.stringify(snapshot))).snapshot.policy.whitelistSubdomains, ['su.se']);
});

test('scope removal needs the same Vault cycle and returns descendants to Greylist only after commit', () => {
  let snapshot = initial();
  snapshot = step(snapshot, { kind: 'PROPOSE_POLICY', candidatePolicy: exact() });
  const review = plan(snapshot, { kind: 'REVIEW_POLICY', proposalId: 1 }, 5).result.review;
  assert.deepEqual(review.whitelistSubdomains, { added: [], removed: ['su.se'] });
  assert.equal(evaluate('deep.su.se', snapshot.policy).outcome, 'ALLOW');
  assert.equal(plan(snapshot, { kind: 'CONFIRM_POLICY', proposalId: 1 }, 9).result.reason, 'NOT_READY');
  snapshot = step(snapshot, { kind: 'CONFIRM_POLICY', proposalId: 1 }, 10);
  assert.equal(evaluate('deep.su.se', snapshot.policy).outcome, 'GREYLIST');
  assert.equal(evaluate('su.se', snapshot.policy).reason, 'WHITELISTED');
});

test('expired and stale scope proposals fail closed without broadening policy', () => {
  const snapshot = step(initial(exact()), { kind: 'PROPOSE_POLICY', candidatePolicy: scoped() });
  const expired = plan(snapshot, { kind: 'CONFIRM_POLICY', proposalId: 1 }, 40);
  assert.equal(expired.result.reason, 'PROPOSAL_EXPIRED'); assert.equal(expired.candidateSnapshot, null);
  const stale = structuredClone(snapshot); stale.policyRevision++;
  assert.equal(plan(stale, { kind: 'CONFIRM_POLICY', proposalId: 1 }, 10).result.reason, 'POLICY_CHANGED');
  assert.equal(evaluate('child.su.se', stale.policy).outcome, 'GREYLIST');
});

test('a scope-only commit invalidates existing temporary grants through the ordinary policy revision', () => {
  let snapshot = initial(exact());
  snapshot = step(snapshot, { kind: 'START_ACCESS', target: target('temporary.example') });
  snapshot = step(snapshot, { kind: 'CONFIRM_ACCESS', requestId: 1 }, 10);
  const grant = structuredClone(snapshot.accessState.grants[0]);
  snapshot = step(snapshot, { kind: 'PROPOSE_POLICY', candidatePolicy: scoped() }, 10);
  snapshot = step(snapshot, { kind: 'CONFIRM_POLICY', proposalId: 1 }, 20);
  const result = plan(snapshot, { kind: 'CHECK_NAVIGATION', target: target('temporary.example'),
    context: { contextId: 'other-tab', journeyId: null } }, 20);
  assert.equal(result.result.decision.reason, 'POLICY_CHANGED');
  assert.deepEqual(snapshot.accessState.grants[0], grant);
});

test('scope-authorized navigation can own a bounded Journey without managed-root bypass', () => {
  const begin = { kind: 'BEGIN_NAVIGATION', target: target('indico.fysik.su.se'), context: { contextId: 'scope-tab', journeyId: null } };
  const started = plan(initial(), begin);
  assert.equal(started.result.decision.reason, 'WHITELISTED_SCOPE');
  const journey = started.candidateSnapshot.journeyState.journeys[0];
  assert.equal(journey.rootHostname, 'indico.fysik.su.se'); assert.equal(journey.expiresAt, 200);
  const managed = compileManagedBlacklist(['indico.fysik.su.se']);
  const denied = plan(initial(), begin, 0, managed);
  assert.equal(denied.result.decision.reason, 'MANAGED_BLACKLISTED'); assert.equal(denied.candidateSnapshot, null);
  const explicit = plan(initial(), { kind: 'START_JOURNEY', root: target('indico.fysik.su.se'), contextId: 'scope-tab' }, 0, managed);
  assert.equal(explicit.result.reason, 'MANAGED_BLACKLISTED'); assert.equal(explicit.candidateSnapshot, null);
  const checked = check(started.candidateSnapshot, 'provider.example', managed, { contextId: 'scope-tab', journeyId: journey.id,
    continuation: { kind: 'HTTP_REDIRECT', sourceHostname: journey.rootHostname } });
  assert.equal(checked.result.decision.outcome, 'GREYLIST');
  assert.equal(checked.observationSnapshot.journeyState.journeys[0].endReason, 'ROOT_NOT_WHITELISTED');
});

test('a loaded scoped root may depart under the existing evidence contract but a managed-denied source cannot', () => {
  const departure = { kind: 'BEGIN_NAVIGATION', target: target('provider.example'), context: { contextId: 'scope-tab', journeyId: null,
    continuation: { kind: 'ROOT_DEPARTURE', sourceHostname: 'indico.fysik.su.se' } } };
  const allowed = plan(initial(), departure);
  assert.equal(allowed.result.decision.reason, 'ACTIVE_JOURNEY');
  assert.equal(allowed.candidateSnapshot.journeyState.journeys[0].rootHostname, 'indico.fysik.su.se');
  const denied = plan(initial(), departure, 0, compileManagedBlacklist(['indico.fysik.su.se']));
  assert.equal(denied.result.reason, 'MANAGED_BLACKLISTED'); assert.equal(denied.candidateSnapshot, null);
});

test('a managed-denied descendant cannot acquire a Download Intent through an allowed scope', () => {
  const download = { kind: 'CHECK_DOWNLOAD', stage: 'PREPARE', source: { target: target('indico.fysik.su.se'),
    context: { contextId: 'source-tab', journeyId: null } }, target: target('files.su.se'),
    binding: { operationId: 'file-operation', contextId: 'file-tab' }, intent: null };
  assert.equal(plan(initial(), download).result.outcome, 'PREPARED');
  assert.equal(plan(initial(), download, 0, compileManagedBlacklist(['files.su.se'])).result.reason, 'MANAGED_BLACKLISTED');
});

test('controller publishes a scope only after acknowledged commit and never retries failed confirmation', async () => {
  const repository = new FakeRepository(initial(exact())), clock = { time: 0, now() { return this.time; } };
  const controller = createAtlasController({ repository, clock, configuration, ownerId: 'scope-owner' });
  await controller.open();
  assert.equal((await controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: scoped() })).type, 'COMMITTED');
  assert.equal(evaluate('child.su.se', controller.getView().snapshot.policy).outcome, 'GREYLIST');
  clock.time = 10; repository.steps.push((request, repo) => repo.fail(request));
  assert.equal((await controller.handle({ kind: 'CONFIRM_POLICY', proposalId: 1 })).reason, 'WRITE_FAILED');
  assert.equal(evaluate('child.su.se', repository.envelope.snapshot.policy).outcome, 'GREYLIST');
  await controller.open();
  assert.equal(evaluate('child.su.se', controller.getView().snapshot.policy).outcome, 'GREYLIST');
  assert.equal((await controller.handle({ kind: 'CONFIRM_POLICY', proposalId: 1 })).type, 'COMMITTED');
  assert.equal(evaluate('child.su.se', controller.getView().snapshot.policy).reason, 'WHITELISTED_SCOPE');
  assert.equal((await controller.handle({ kind: 'CONFIRM_POLICY', proposalId: 1 })).reason, 'ALREADY_COMMITTED');
});

test('unknown scope commit outcomes stay unavailable until explicit reconciliation', async () => {
  const repository = new FakeRepository(initial(exact())), clock = { time: 0, now() { return this.time; } };
  const controller = createAtlasController({ repository, clock, configuration, ownerId: 'unknown-scope-owner' });
  await controller.open(); await controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: scoped() });
  clock.time = 10; repository.steps.push((request, repo) => repo.unknown(request, true));
  assert.equal((await controller.handle({ kind: 'CONFIRM_POLICY', proposalId: 1 })).reason, 'COMMIT_UNKNOWN');
  assert.equal(controller.getView().status, 'RECONCILING');
  assert.equal(evaluate('child.su.se', controller.getView().snapshot.policy).outcome, 'GREYLIST');
  const pending = controller.getView().pendingCommitId;
  assert.equal((await controller.handle({ kind: 'CHECK_NAVIGATION', target: target('child.su.se'),
    context: { contextId: 'tab', journeyId: null } })).type, 'BLOCKED');
  repository.settle(pending); await controller.open();
  assert.equal(controller.getView().status, 'READY');
  assert.equal(evaluate('child.su.se', controller.getView().snapshot.policy).reason, 'WHITELISTED_SCOPE');
});
