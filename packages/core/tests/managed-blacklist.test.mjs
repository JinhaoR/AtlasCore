import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  compileManagedBlacklist, managedBlacklistContains, createAccessState, createVaultState,
  createJourneyState, planAtlasOperation, createAtlasController,
} from '../dist/index.js';
import { FakeRepository, deferred } from './support/fake-repository.mjs';

const configuration = { accessTiming: { waitMs: 10, confirmationWindowMs: 20, grantDurationMs: 100 },
  vaultTiming: { waitMs: 10, confirmationWindowMs: 20 }, journeyLimits: { lifetimeMs: 200, maxHops: 3 } };
const initial = () => ({ policy: { whitelist: ['root.example', 'exception.example', 'blocked.example'], blacklist: ['blocked.example'] },
  policyRevision: 0, configuration, configurationRevision: 0, accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState() });
const list = compileManagedBlacklist(['managed.example', 'exception.example', 'blocked.example', 'root.example']);
const check = (hostname, journeyId = null) => ({ kind: 'CHECK_NAVIGATION', target: { hostname }, context: { contextId: 'tab_a', journeyId } });
const plan = (snapshot, operation, now = 0, managedBlacklist = list) => planAtlasOperation(operation, { snapshot, now, configuration, managedBlacklist });

test('manual Blacklist, explicit Whitelist, managed deny, then Greylist have distinct precedence', () => {
  const snapshot = initial();
  for (const [hostname, outcome, reason] of [
    ['blocked.example', 'DENY', 'BLACKLISTED'], ['exception.example', 'ALLOW', 'WHITELISTED'],
    ['managed.example', 'DENY', 'MANAGED_BLACKLISTED'], ['other.example', 'GREYLIST', 'UNLISTED'],
  ]) {
    const result = plan(snapshot, check(hostname)).result;
    assert.equal(result.type, 'ASSESSMENT');
    assert.equal(result.decision.outcome, outcome); assert.equal(result.decision.reason, reason);
  }
  assert.deepEqual(snapshot, initial());
});

test('managed denial prevents Access start and confirmation, including pending requests from before an update', () => {
  let snapshot = initial();
  const start = { kind: 'START_ACCESS', target: { hostname: 'managed.example' } };
  assert.equal(plan(snapshot, start).result.reason, 'MANAGED_BLACKLISTED');
  snapshot = plan(snapshot, start, 0, compileManagedBlacklist([])).candidateSnapshot;
  const blocked = plan(snapshot, { kind: 'CONFIRM_ACCESS', requestId: 1 }, 10);
  assert.equal(blocked.result.reason, 'MANAGED_BLACKLISTED');
  assert.equal(blocked.candidateSnapshot, null);
  assert.deepEqual(snapshot.accessState.grants, []);
  assert.ok(plan(snapshot, { kind: 'CANCEL_ACCESS', requestId: 1 }, 10).candidateSnapshot);
});

test('managed denial overrides an existing grant without modifying user policy', () => {
  const empty = compileManagedBlacklist([]);
  let snapshot = plan(initial(), { kind: 'START_ACCESS', target: { hostname: 'managed.example' } }, 0, empty).candidateSnapshot;
  snapshot = plan(snapshot, { kind: 'CONFIRM_ACCESS', requestId: 1 }, 10, empty).candidateSnapshot;
  assert.equal(plan(snapshot, check('managed.example'), 11).result.decision.reason, 'MANAGED_BLACKLISTED');
  assert.equal(snapshot.accessState.grants.length, 1);
  assert.deepEqual(snapshot.policy, initial().policy);
});

test('Journey cannot bypass a managed entry and denied recording consumes no hop', () => {
  const snapshot = plan(initial(), { kind: 'START_JOURNEY', root: { hostname: 'root.example' }, contextId: 'tab_a' }).candidateSnapshot;
  for (const kind of ['CHECK_NAVIGATION', 'RECORD_JOURNEY_NAVIGATION']) {
    const result = plan(snapshot, { ...check('managed.example', 1), kind });
    assert.equal(result.result.decision.reason, 'MANAGED_BLACKLISTED');
    assert.equal(result.candidateSnapshot, null);
  }
  assert.equal(snapshot.journeyState.journeys[0].hopCount, 0);
  assert.ok(plan(snapshot, { kind: 'CANCEL_JOURNEY', journeyId: 1, contextId: 'tab_a' }).candidateSnapshot);
});

test('invalid, copied or forged compiled data fails closed even for a whitelisted root', () => {
  for (const invalid of [null, undefined, [], { size: 0 }, structuredClone(list)]) {
    assert.equal(planAtlasOperation(check('root.example'), { snapshot: initial(), now: 0, configuration, managedBlacklist: invalid }).result.reason, 'INVALID_MANAGED_BLACKLIST');
  }
  assert.equal(compileManagedBlacklist(['*.example']), null);
  assert.equal(managedBlacklistContains({ size: 0 }, 'managed.example'), null);
  const source = ['CASE.example.', 'case.example'];
  const compiled = compileManagedBlacklist(source);
  source.push('later.example');
  assert.equal(compiled.size, 1);
  assert.equal(managedBlacklistContains(compiled, 'later.example'), false);
});

test('200,000-domain compilation is one-time; hot checks never touch source arrays again', (t) => {
  let sealed = false; let reads = 0;
  const source = new Proxy(Array.from({ length: 200_000 }, (_, i) => `domain${i}.synthetic`), {
    get(target, key, receiver) { if (sealed) throw new Error('Hot path touched the source list'); reads++; return Reflect.get(target, key, receiver); },
  });
  const begin = performance.now(); const compiled = compileManagedBlacklist(source);
  const compiledAt = performance.now();
  sealed = true; const before = reads;
  const snapshot = initial();
  for (let i = 0; i < 1000; i++) {
    assert.equal(plan(snapshot, check('domain199999.synthetic'), 0, compiled).result.decision.reason, 'MANAGED_BLACKLISTED');
    assert.equal(plan(snapshot, check('absent.synthetic'), 0, compiled).result.decision.outcome, 'GREYLIST');
  }
  assert.equal(reads, before); assert.equal(compiled.size, 200_000);
  t.diagnostic(`Compile ${Math.round(compiledAt - begin)}ms; 2,000 complete plans ${Math.round(performance.now() - compiledAt)}ms; zero source reads after compilation`);
});

test('controller fences a managed list changed while persistence was pending', async () => {
  const repository = new FakeRepository(initial()); const clock = { time: 0, now() { return this.time; } };
  let managed = compileManagedBlacklist([]);
  const controller = createAtlasController({ repository, clock, configuration, ownerId: 'managed_test', managedBlacklist: () => managed });
  await controller.open();
  const entered = deferred(); const release = deferred();
  repository.steps.push(async (request, repo) => { entered.resolve(); await release.promise; return repo.apply(request); });
  clock.time = 1;
  const pending = controller.handle(check('exception.example'));
  await entered.promise; managed = list; release.resolve();
  assert.equal((await pending).reason, 'REEVALUATION_REQUIRED');
  assert.equal((await controller.handle(check('managed.example'))).decision.reason, 'MANAGED_BLACKLISTED');
});

test('controller rejects unavailable managed authority and recovers with a valid compiled list', async () => {
  let managed = null;
  const controller = createAtlasController({ repository: new FakeRepository(initial()), clock: { now: () => 0 }, configuration,
    ownerId: 'managed_recovery', managedBlacklist: () => managed });
  assert.equal((await controller.open()).reason, 'MANAGED_BLACKLIST_UNAVAILABLE');
  assert.equal((await controller.handle(check('root.example'))).type, 'BLOCKED');
  managed = list;
  assert.equal((await controller.open()).status, 'READY');
  assert.equal((await controller.handle(check('root.example'))).decision.reason, 'WHITELISTED');
});
