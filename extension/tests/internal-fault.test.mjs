import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/fixture.mjs';
import { authorityInterruptionCopy } from '../dist/lib/ui/presentation.js';

async function loaded(t) {
  const f = await fixture(t);
  for (const tab of [1, 2, 3]) await f.firefox.visit(tab, 'https://root.example/');
  return f;
}

function interruptOnce(f) {
  const load = f.repository.load.bind(f.repository); let armed = true, loads = 0;
  f.repository.load = async (...args) => {
    loads++; const result = await load(...args);
    if (!armed) return result;
    armed = false;
    return { type: 'READY', get envelope() { throw new TypeError('https://private.example/?password=do-not-export'); } };
  };
  return () => loads;
}

test('an idle internal fault is retained with zero failed commits, removes content and never auto-recovers', async t => {
  const f = await loaded(t), before = f.controller.getView().snapshot, loads = interruptOnce(f);
  f.clock.time++; await f.adapter.refresh(); await f.firefox.flush();
  const view = f.adapter.view(), fault = view.authorityInterruption.internalFault;
  assert.equal(view.controller.status, 'UNAVAILABLE'); assert.equal(view.controller.reason, 'INTERNAL_ERROR');
  assert.equal(view.storage.failedCommits, 0); assert.equal(view.storage.lastFailure, null);
  assert.equal(fault.operation, 'OBSERVE_TIME'); assert.equal(fault.stage, 'VALIDATE_LOAD'); assert.equal(fault.error, 'TYPE_ERROR');
  assert.ok(view.contexts.every(context => context.latest.type === 'BLOCKED' && context.latest.reason === 'INTERNAL_ERROR'));
  assert.ok(view.contexts.every(context => context.effect === 'REMOVED'));
  const count = loads();
  for (let i = 0; i < 4; i++) { f.clock.time++; await f.adapter.refresh(); }
  assert.equal(loads(), count, 'unexplained faults must not create an automatic recovery loop');
  const diagnostics = await f.firefox.send({ kind: 'GET_DIAGNOSTICS', tabId: null });
  assert.deepEqual(diagnostics.authorityInterruption, view.authorityInterruption);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private|password|do-not-export/);
  assert.deepEqual(f.controller.getView().snapshot, before);
  await f.firefox.send({ kind: 'RECOVER' });
  assert.equal(f.controller.getView().status, 'READY');
  assert.deepEqual(f.adapter.view().authorityInterruption, view.authorityInterruption);
  assert.deepEqual(f.controller.getView().snapshot.policy, before.policy);
  f.firefox.documents.set(4, { id: 4, url: 'about:blank', incognito: false });
  assert.equal((await f.firefox.visit(4, 'https://blocked.example/')).cancel, true);
  assert.equal(f.adapter.view().contexts.find(context => context.tabId === 4).latest.decision.reason, 'BLACKLISTED');
});

test('recovery after an internal fault does not consume pending confirmation or alter frozen terms', async t => {
  const f = await loaded(t);
  await f.controller.handle({ kind: 'START_ACCESS', target: { hostname: 'grey.example' } });
  await f.controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: ['root.example', 'new.example'], blacklist: ['blocked.example'] } });
  const before = f.controller.getView().snapshot;
  interruptOnce(f); f.clock.time++; await f.adapter.refresh();
  const request = before.accessState.pendingRequests[0], proposal = before.vaultState.pendingProposal;
  assert.equal((await f.controller.handle({ kind: 'CONFIRM_ACCESS', requestId: request.id })).reason, 'INTERNAL_ERROR');
  assert.equal((await f.controller.handle({ kind: 'CONFIRM_POLICY', proposalId: proposal.id })).reason, 'INTERNAL_ERROR');
  await f.firefox.send({ kind: 'RECOVER' });
  const after = f.controller.getView().snapshot;
  assert.deepEqual(after.policy, before.policy); assert.deepEqual(after.accessState.pendingRequests, before.accessState.pendingRequests);
  assert.deepEqual(after.accessState.grants, before.accessState.grants); assert.deepEqual(after.vaultState.pendingProposal, before.vaultState.pendingProposal);
});

test('a historical internal fault is not attributed to a subsequent unrelated commit outage', async t => {
  const f = await loaded(t); interruptOnce(f); f.clock.time++; await f.adapter.refresh();
  const previous = f.adapter.view().authorityInterruption.internalFault;
  await f.firefox.send({ kind: 'RECOVER' });
  f.repository.commit = async request => ({ type: 'UNKNOWN', commitId: request.commitId });
  f.clock.time++; await f.adapter.refresh();
  const issue = f.adapter.view().authorityInterruption;
  assert.equal(issue.reason, 'COMMIT_UNKNOWN'); assert.equal(issue.internalFault, undefined);
  assert.deepEqual(f.controller.getView().internalFault, previous, 'history is retained but not claimed to cause a different interruption');
});

test('visible diagnostic copy names operation, stage and error class without implying recovery or permission', () => {
  const issue = { reason: 'INTERNAL_ERROR', status: 'UNAVAILABLE', observedAt: 100, checkpointAt: 99, latestStorageFailure: null,
    internalFault: { sequence: 1, operation: 'OBSERVE_TIME', stage: 'PLAN', error: 'RANGE_ERROR', pendingCommitId: null,
      stateCounts: { journeys: 23, requests: 2, grants: 1 } } };
  const before = structuredClone(issue), copy = authorityInterruptionCopy(issue);
  for (const term of ['INTERNAL_ERROR', 'OBSERVE_TIME', 'PLAN', 'RANGE_ERROR', '23 Journeys', 'retained across recovery']) assert.ok(copy.includes(term));
  assert.deepEqual(issue, before); assert.doesNotMatch(copy, /restored|allowed|retrying/i);
});
