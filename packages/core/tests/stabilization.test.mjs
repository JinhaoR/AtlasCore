import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccessState, createJourneyState, createVaultState, evaluate, evaluateAccess,
  startAccess, confirmAccess, planAtlasOperation, validateAtlasSnapshot, compileManagedBlacklist,
} from '../dist/index.js';

const configuration = { accessTiming: { waitMs: 10, confirmationWindowMs: 20, grantDurationMs: 100 },
  vaultTiming: { waitMs: 10, confirmationWindowMs: 20 }, journeyLimits: { lifetimeMs: 200, maxHops: 2 } };
const initial = () => ({ policy: { whitelist: ['root.example'], blacklist: ['blocked.example'] },
  policyRevision: 0, configuration, configurationRevision: 0, accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState() });
const operation = (kind, hostname, journeyId = null, continuation) => ({ kind, target: { hostname },
  context: { contextId: 'tab_a', journeyId, ...(continuation ? { continuation } : {}) } });
const plan = (snapshot, now, op, extra = {}) => planAtlasOperation(op, { snapshot, now, configuration, ...extra });
const adopt = (p) => p.candidateSnapshot ?? p.observationSnapshot;
const redirect = (sourceHostname) => ({ kind: 'HTTP_REDIRECT', sourceHostname });

test('BEGIN uses policy authority to start Whitelist Journeys; CHECK never creates them', () => {
  const snapshot = initial();
  assert.equal(plan(snapshot, 0, operation('CHECK_NAVIGATION', 'root.example')).candidateSnapshot, null);
  const began = plan(snapshot, 0, operation('BEGIN_NAVIGATION', 'root.example'));
  assert.equal(began.result.decision.reason, 'WHITELISTED');
  assert.equal(began.candidateSnapshot.journeyState.journeys[0].expiresAt, 200);
  assert.deepEqual(snapshot, initial());
  for (const host of ['unknown.example', 'blocked.example']) {
    assert.equal(plan(snapshot, 0, operation('BEGIN_NAVIGATION', host)).candidateSnapshot, null);
  }
});

test('only attested continuations borrow Journey; unrelated typed hosts use normal policy and end it', () => {
  const snapshot = adopt(plan(initial(), 0, operation('BEGIN_NAVIGATION', 'root.example')));
  const accepted = plan(snapshot, 1, operation('BEGIN_NAVIGATION', 'login.example', 1, redirect('root.example')));
  assert.equal(accepted.result.decision.reason, 'ACTIVE_JOURNEY');
  for (const evidence of [undefined, redirect('wrong.example'), { kind: 'SAME_HOST', sourceHostname: 'root.example' },
    { kind: 'RETAINED', sourceHostname: 'root.example' }]) {
    const denied = plan(snapshot, 1, operation('BEGIN_NAVIGATION', 'www.google.com', 1, evidence));
    assert.equal(denied.result.decision.outcome, 'GREYLIST');
    assert.equal(adopt(denied).journeyState.journeys[0].endReason, 'UNRELATED_NAVIGATION');
  }
  assert.equal(plan(snapshot, 1, operation('BEGIN_NAVIGATION', 'blocked.example', 1, redirect('root.example'))).result.decision.reason, 'BLACKLISTED');
  const forged = plan(snapshot, 1, operation('BEGIN_NAVIGATION', 'login.example', 1, { kind: 'ANY', sourceHostname: 'root.example' }));
  assert.equal(forged.result.reason, 'INVALID_NAVIGATION');
});

test('actual destination arrival consumes Journey; root redirect checks preserve the fixed deadline', () => {
  let snapshot = adopt(plan(initial(), 0, operation('BEGIN_NAVIGATION', 'root.example')));
  snapshot = adopt(plan(snapshot, 1, operation('RECORD_JOURNEY_NAVIGATION', 'login.example', 1, redirect('root.example'))));
  const root = plan(snapshot, 2, operation('BEGIN_NAVIGATION', 'root.example', 1, redirect('login.example')));
  assert.equal(adopt(root).journeyState.journeys[0].phase, 'IN_TRANSIT');
  assert.equal(adopt(root).journeyState.journeys[0].expiresAt, 200);
  snapshot = adopt(plan(adopt(root), 3, operation('RECORD_JOURNEY_NAVIGATION', 'root.example', 1,
    { kind: 'ARRIVAL', sourceHostname: 'login.example' })));
  assert.equal(snapshot.journeyState.journeys[0].endReason, 'RETURNED');
  assert.equal(plan(snapshot, 4, operation('BEGIN_NAVIGATION', 'login.example', 1, redirect('root.example'))).result.decision.outcome, 'GREYLIST');
  const first = adopt(plan(initial(), 0, operation('BEGIN_NAVIGATION', 'root.example')));
  const reached = adopt(plan(first, 1, operation('RECORD_JOURNEY_NAVIGATION', 'root.example', 1, { kind: 'ARRIVAL', sourceHostname: 'root.example' })));
  assert.equal(reached.journeyState.journeys[0].endReason, 'REACHED');
  assert.equal(validateAtlasSnapshot(reached).ok, true);
  const canonical = initial();
  canonical.policy.whitelist.push('www.root.example');
  let changed = adopt(plan(canonical, 0, operation('BEGIN_NAVIGATION', 'root.example')));
  changed = adopt(plan(changed, 1, operation('RECORD_JOURNEY_NAVIGATION', 'www.root.example', 1, redirect('root.example'))));
  changed = adopt(plan(changed, 2, operation('RECORD_JOURNEY_NAVIGATION', 'www.root.example', 1,
    { kind: 'ARRIVAL', sourceHostname: 'www.root.example' })));
  assert.equal(changed.journeyState.journeys[0].endReason, 'DESTINATION_CHANGED');
  assert.equal(validateAtlasSnapshot(changed).ok, true);
  const malformed = structuredClone(changed);
  malformed.journeyState.journeys[0].currentHostname = 'root.example';
  malformed.journeyState.journeys[0].hopCount = 0;
  assert.equal(validateAtlasSnapshot(malformed).ok, false);
});

const scope = ['overleaf.com', 'www.overleaf.com'];
const accessContext = (state, now = 0, policy = { whitelist: [], blacklist: [] }) => ({ policy, policyRevision: 0, state, now });
test('one frozen alias request waits once, confirms once, grants exact hosts and expires together', () => {
  const supplied = [...scope];
  const started = startAccess(scope[0], accessContext(createAccessState()), configuration.accessTiming, supplied);
  supplied.push('unrelated.example');
  assert.deepEqual(started.request.scopeHostnames, scope);
  const repeated = startAccess(scope[1], accessContext(started.nextState, 5), configuration.accessTiming, [...scope, 'extra.example']);
  assert.equal(repeated.type, 'EXISTING_REQUEST');
  assert.equal(repeated.request.id, started.request.id);
  assert.deepEqual(repeated.request.scopeHostnames, scope);
  assert.equal(evaluateAccess(scope[1], accessContext(repeated.nextState, 10)).decision.outcome, 'REQUIRE_CONFIRMATION');
  const confirmed = confirmAccess(started.request.id, accessContext(JSON.parse(JSON.stringify(repeated.nextState)), 10));
  assert.equal(confirmed.nextState.pendingRequests.length, 0);
  assert.equal(confirmed.nextState.grants.length, 1);
  for (const host of scope) {
    assert.equal(evaluateAccess(host, accessContext(confirmed.nextState, 109)).decision.reason, 'ACTIVE_GRANT');
    assert.equal(evaluateAccess(host, accessContext(confirmed.nextState, 110)).decision.outcome, 'GREYLIST');
    assert.equal(evaluate(host, { whitelist: [], blacklist: [] }).outcome, 'GREYLIST');
  }
  for (const host of ['api.overleaf.com', 'unrelated.example']) assert.equal(evaluateAccess(host, accessContext(confirmed.nextState, 11)).decision.outcome, 'GREYLIST');
  assert.equal(confirmAccess(started.request.id, accessContext(confirmed.nextState, 11)).reason, 'REQUEST_NOT_FOUND');
  const blacklisted = { whitelist: [], blacklist: ['www.overleaf.com'] };
  assert.equal(evaluateAccess(scope[1], accessContext(confirmed.nextState, 11, blacklisted)).decision.reason, 'BLACKLISTED');
  assert.equal(confirmAccess(started.request.id, accessContext(started.nextState, 10, blacklisted)).reason, 'NOT_GREYLIST');
});

test('invalid or overlapping alias scopes and managed blacklist members fail closed', () => {
  for (const bad of [[], ['unrelated.example'], [scope[0], scope[0]], [scope[0], '*.example'], [scope[0], ,]]) {
    assert.equal(startAccess(scope[0], accessContext(createAccessState()), configuration.accessTiming, bad).reason, 'INVALID_SCOPE');
  }
  let snapshot = initial();
  const op = { kind: 'START_ACCESS', target: { hostname: scope[0] }, scopeHostnames: scope };
  const managedBlacklist = compileManagedBlacklist([scope[1]]);
  assert.equal(plan(snapshot, 0, op, { managedBlacklist }).result.reason, 'MANAGED_BLACKLISTED');
  snapshot = adopt(plan(snapshot, 0, op));
  assert.equal(plan(snapshot, 10, { kind: 'CONFIRM_ACCESS', requestId: 1 }, { managedBlacklist }).result.reason, 'MANAGED_BLACKLISTED');
  snapshot = structuredClone(snapshot);
  snapshot.accessState.pendingRequests.push({ ...snapshot.accessState.pendingRequests[0], id: 2, hostname: scope[1] });
  snapshot.accessState.nextRequestId = 3;
  assert.equal(validateAtlasSnapshot(snapshot).reason, 'INVALID_ACCESS_STATE');
});

test('legacy requests and grants retain single-host scope; live overlays cannot be silently widened', () => {
  const legacy = startAccess(scope[0], accessContext(createAccessState()), configuration.accessTiming);
  const repeat = startAccess(scope[0], accessContext(legacy.nextState, 1), configuration.accessTiming, scope);
  assert.equal(repeat.request.id, legacy.request.id);
  assert.equal(repeat.request.scopeHostnames, undefined);
  const grant = confirmAccess(legacy.request.id, accessContext(repeat.nextState, 10));
  assert.equal(evaluateAccess(scope[1], accessContext(grant.nextState, 11)).decision.outcome, 'GREYLIST');
  assert.equal(startAccess(scope[1], accessContext(grant.nextState, 11), configuration.accessTiming, scope).reason, 'SCOPE_CONFLICT');
  const fresh = startAccess(scope[1], accessContext(grant.nextState, 110), configuration.accessTiming, scope);
  assert.equal(fresh.request.readyAt, 120);
  assert.deepEqual(fresh.request.scopeHostnames, scope);
});
