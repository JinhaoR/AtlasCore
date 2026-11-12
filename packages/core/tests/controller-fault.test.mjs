import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessState, createAtlasController, createJourneyState, createVaultState } from '../dist/index.js';
import { FakeRepository } from './support/fake-repository.mjs';

const configuration = { accessTiming: { waitMs: 10, confirmationWindowMs: 100, grantDurationMs: 200 },
  vaultTiming: { waitMs: 20, confirmationWindowMs: 100 }, journeyLimits: { lifetimeMs: 200, maxHops: 3 } };
const check = { kind: 'CHECK_NAVIGATION', target: { hostname: 'root.example' }, context: { contextId: 'tab', journeyId: null } };
async function fixture(options = {}) {
  const repository = new FakeRepository({ policy: { whitelist: ['root.example'], blacklist: ['blocked.example'] },
    policyRevision: 0, configuration, configurationRevision: 0, accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState() });
  const clock = { time: 100, now() { return this.time; } };
  const controller = createAtlasController({ repository, clock, configuration, ownerId: 'fault_test', ...options });
  assert.equal((await controller.open()).status, 'READY');
  return { repository, clock, controller };
}

function badLoad(f, thrown) {
  f.repository.loadHook = () => ({ type: 'READY', get envelope() { throw thrown; } });
}

test('unexpected load validation faults record only closed fields and stay blocked until explicit recovery', async () => {
  const f = await fixture(), before = f.controller.getView().snapshot, writes = f.repository.commits.length;
  badLoad(f, new TypeError('https://private.example/?token=do-not-record'));
  assert.equal((await f.controller.handle(check)).reason, 'INTERNAL_ERROR');
  const view = f.controller.getView(), fault = view.internalFault;
  assert.equal(view.status, 'UNAVAILABLE');
  assert.deepEqual(fault, { sequence: 1, operation: 'CHECK_NAVIGATION', stage: 'VALIDATE_LOAD', error: 'TYPE_ERROR',
    pendingCommitId: null, stateCounts: { journeys: 0, requests: 0, grants: 0 } });
  assert.ok(Object.isFrozen(fault)); assert.ok(Object.isFrozen(fault.stateCounts));
  assert.deepEqual(view.snapshot, before); assert.equal(f.repository.commits.length, writes);
  assert.equal(JSON.stringify(fault).includes('private'), false); assert.equal(JSON.stringify(fault).includes('token'), false);
  const loads = f.repository.loads;
  for (let i = 0; i < 5; i++) assert.equal((await f.controller.handle(check)).reason, 'INTERNAL_ERROR');
  assert.equal(f.repository.loads, loads, 'blocked commands cannot automatically retry a failed owner');
  assert.deepEqual(f.controller.getView().internalFault, fault);
  f.repository.loadHook = null;
  assert.equal((await f.controller.open()).status, 'READY');
  assert.deepEqual(f.controller.getView().internalFault, fault, 'diagnosis survives explicit recovery');
  assert.equal((await f.controller.handle(check)).decision.reason, 'WHITELISTED');
  assert.deepEqual(f.controller.getView().snapshot.policy, before.policy);
});

test('a throwing fault observer cannot replace the closed outcome or replay an operation', async () => {
  let observed;
  const f = await fixture({ onInternalFault(error, fault) { observed = { error, fault }; throw Error('observer failed'); } });
  const exception = new TypeError('private'); badLoad(f, exception);
  assert.equal((await f.controller.handle(check)).reason, 'INTERNAL_ERROR');
  assert.equal(observed.error, exception); assert.equal(observed.fault.stage, 'VALIDATE_LOAD');
  assert.equal(f.controller.getActivity().active, false);
  f.repository.loadHook = null; assert.equal((await f.controller.open()).status, 'READY');
});

test('queue diagnostics remain readable during held storage and preserve ordered completion', async () => {
  const f = await fixture(); let release, entered;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const original = f.repository.load.bind(f.repository);
  f.repository.load = async () => { entered(); await blocked; return original(); };
  const first = f.controller.handle(check), second = f.controller.handle({ kind: 'OBSERVE_TIME' });
  await started;
  const progress = f.controller.getActivity();
  assert.equal(progress.stage, 'LOAD'); assert.equal(progress.active, true); assert.equal(progress.queued, 1);
  assert.equal(f.controller.getView().status, 'LOADING');
  assert.ok(Object.isFrozen(progress));
  release();
  assert.equal((await first).decision.reason, 'WHITELISTED'); assert.equal((await second).type, 'OBSERVED');
  assert.equal(f.controller.getActivity().completed, progress.completed + 2);
  assert.equal(f.controller.getActivity().queued, 0); assert.equal(f.controller.getActivity().active, false);
});

test('a periodic planner exception has a distinct stage and creates no persisted candidate', async t => {
  const f = await fixture(), before = f.controller.getView().snapshot, writes = f.repository.commits.length;
  const values = Object.values;
  t.after(() => { Object.values = values; });
  Object.values = function (value) {
    if (value?.result?.type === 'OBSERVED' && Object.hasOwn(value, 'observationSnapshot')) {
      Object.values = values;
      throw new RangeError('Synthetic confidential runtime detail');
    }
    return values(value);
  };
  f.clock.time++;
  assert.equal((await f.controller.handle({ kind: 'OBSERVE_TIME' })).reason, 'INTERNAL_ERROR');
  const fault = f.controller.getView().internalFault;
  assert.equal(fault.operation, 'OBSERVE_TIME'); assert.equal(fault.stage, 'PLAN'); assert.equal(fault.error, 'RANGE_ERROR');
  assert.equal(f.repository.commits.length, writes); assert.deepEqual(f.controller.getView().snapshot, before);
});

test('an opening fault without verified authority records no state counts and cannot initialize defaults', async () => {
  const f = await fixture(), writes = f.repository.commits.length;
  badLoad(f, new Error('private first-load detail'));
  const fresh = createAtlasController({ repository: f.repository, clock: f.clock, configuration, ownerId: 'new_owner' });
  const view = await fresh.open();
  assert.equal(view.status, 'UNAVAILABLE'); assert.equal(view.snapshot, null);
  assert.equal(view.internalFault.operation, 'OPEN'); assert.equal(view.internalFault.stage, 'VALIDATE_LOAD');
  assert.equal(view.internalFault.stateCounts, null); assert.equal(f.repository.commits.length, writes);
});

test('unknown exception names and hostile diagnostic getters never leak or replace conservative failure', async () => {
  for (const thrown of [{ name: 'https://private.example/?secret=yes', message: 'private' },
    { get name() { throw Error('private name getter'); }, get message() { throw Error('must not read message'); }, get stack() { throw Error('must not read stack'); } },
    'https://private.example/?secret=yes']) {
    const f = await fixture(); badLoad(f, thrown);
    assert.equal((await f.controller.handle(check)).reason, 'INTERNAL_ERROR');
    assert.equal(f.controller.getView().internalFault.error, 'OTHER');
    assert.doesNotMatch(JSON.stringify(f.controller.getView().internalFault), /private|secret|message|stack/);
  }
});

test('queued confirmations are never replayed after a fault and retain their original terms through recovery', async () => {
  const f = await fixture();
  const request = await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'grey.example' } });
  const proposal = await f.controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: ['new.example'], blacklist: [] } });
  const before = f.controller.getView().snapshot;
  f.clock.time = 125;
  badLoad(f, new Error('private'));
  const results = await Promise.all([f.controller.handle({ kind: 'OBSERVE_TIME' }),
    f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: request.referenceId }),
    f.controller.handle({ kind: 'CONFIRM_POLICY', proposalId: proposal.referenceId })]);
  assert.ok(results.every(result => result.type === 'BLOCKED' && result.reason === 'INTERNAL_ERROR'));
  assert.equal(f.controller.getView().internalFault.operation, 'OBSERVE_TIME');
  f.repository.loadHook = null; assert.equal((await f.controller.open()).status, 'READY');
  const after = f.controller.getView().snapshot;
  assert.deepEqual(after.policy, before.policy); assert.deepEqual(after.accessState.pendingRequests, before.accessState.pendingRequests);
  assert.deepEqual(after.accessState.grants, before.accessState.grants); assert.deepEqual(after.vaultState.pendingProposal, before.vaultState.pendingProposal);
  assert.equal((await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: request.referenceId })).type, 'COMMITTED', 'only a fresh explicit confirmation may create the original grant');
});

test('faults during unresolved commit recovery retain pending identity and never claim a write failed', async t => {
  const f = await fixture();
  f.repository.steps.push((request, repo) => repo.unknown(request, true));
  f.clock.time++;
  assert.equal((await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'grey.example' } })).reason, 'COMMIT_UNKNOWN');
  const pending = f.controller.getView().pendingCommitId, writes = f.repository.commits.length;
  const freeze = Object.freeze; t.after(() => { Object.freeze = freeze; });
  Object.freeze = function (value) {
    if (value?.status === 'RECONCILING' && value.pendingCommitId === pending) {
      Object.freeze = freeze; throw new Error('private unresolved-outcome detail');
    }
    return freeze(value);
  };
  const view = await f.controller.open();
  assert.equal(view.status, 'RECONCILING'); assert.equal(view.reason, 'COMMIT_UNKNOWN');
  assert.equal(view.internalFault.stage, 'RESOLVE_COMMIT'); assert.equal(view.internalFault.operation, 'OPEN');
  assert.equal(view.internalFault.pendingCommitId, pending); assert.equal(f.repository.commits.length, writes);
  assert.equal((await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: 1 })).reason, 'COMMIT_UNKNOWN');
});

test('subsequent incidents replace the fault record but expected storage/clock failures do not invent one', async () => {
  const f = await fixture();
  assert.equal(f.controller.getView().internalFault, undefined);
  f.repository.unavailable = true;
  assert.equal((await f.controller.handle(check)).reason, 'STORAGE_UNAVAILABLE');
  assert.equal(f.controller.getView().internalFault, undefined);
  f.repository.unavailable = false; await f.controller.open();
  badLoad(f, new TypeError('private')); await f.controller.handle(check);
  f.repository.loadHook = null; await f.controller.open();
  badLoad(f, new SyntaxError('private')); await f.controller.handle({ kind: 'OBSERVE_TIME' });
  const fault = f.controller.getView().internalFault;
  assert.equal(fault.sequence, 2); assert.equal(fault.operation, 'OBSERVE_TIME'); assert.equal(fault.error, 'SYNTAX_ERROR');
});
