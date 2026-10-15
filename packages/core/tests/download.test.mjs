import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessState, createVaultState, createJourneyState, createAtlasController,
  planAtlasOperation, compileManagedBlacklist, DOWNLOAD_LIFETIME_MS, DOWNLOAD_MAX_REDIRECTS } from '../dist/index.js';
import { FakeRepository } from './support/fake-repository.mjs';

const configuration = { accessTiming: { waitMs: 10, confirmationWindowMs: 20, grantDurationMs: 100 },
  vaultTiming: { waitMs: 10, confirmationWindowMs: 20 }, journeyLimits: { lifetimeMs: 200, maxHops: 3 } };
const initial = () => ({ policy: { whitelist: ['root.example'], blacklist: ['blocked.example'] }, policyRevision: 0,
  configuration, configurationRevision: 0, accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState() });
const op = (stage = 'PREPARE', intent = null, hostname = 'file.example') => ({ kind: 'CHECK_DOWNLOAD', stage,
  source: { target: { hostname: 'root.example' }, context: { contextId: 'source', journeyId: null } },
  target: { hostname }, binding: { operationId: 'operation', contextId: 'child' }, intent });
const plan = (operation, now = 1000, snapshot = initial(), managedBlacklist = compileManagedBlacklist([])) =>
  planAtlasOperation(operation, { snapshot, now, configuration, managedBlacklist });
const intent = () => plan(op()).result.intent;
const requested = () => plan(op('REQUEST', intent())).result.intent;

test('preparation fixes terms, request permits only fetching, and attachment consumes without changing policy or grants', () => {
  const snapshot = initial();
  const before = structuredClone(snapshot);
  const prepared = plan(op(), 1000, snapshot);
  assert.equal(prepared.result.outcome, 'PREPARED');
  assert.equal(prepared.candidateSnapshot, null);
  assert.equal(prepared.result.intent.expiresAt, 1000 + DOWNLOAD_LIFETIME_MS);
  const request = plan(op('REQUEST', prepared.result.intent), 1001, snapshot);
  assert.equal(request.result.outcome, 'FETCH');
  const complete = plan(op('ATTACHMENT', request.result.intent), 1002, snapshot);
  assert.equal(complete.result.outcome, 'FILE');
  assert.equal(complete.result.intent.phase, 'FINISHED');
  assert.deepEqual(snapshot, before);
  assert.deepEqual(complete.observationSnapshot.policy, snapshot.policy);
  assert.deepEqual(complete.observationSnapshot.accessState.grants, []);
  assert.deepEqual(complete.observationSnapshot.journeyState.journeys, []);
  assert.equal(Object.isFrozen(complete.result.intent), true);
});

test('redirects count every request including same-host redirects and never renew the deadline', () => {
  let current = requested();
  for (let n = 0; n < DOWNLOAD_MAX_REDIRECTS; n++) {
    const next = plan(op('REDIRECT', current), 1001 + n).result;
    assert.equal(next.outcome, 'FETCH');
    assert.equal(next.intent.redirects, n + 1);
    assert.equal(next.intent.expiresAt, current.expiresAt);
    current = next.intent;
  }
  assert.equal(plan(op('REDIRECT', current), 1010).result.reason, 'DOWNLOAD_REDIRECT_LIMIT');
  assert.equal(plan(op('ATTACHMENT', current), 1010).result.outcome, 'FILE');
});

test('prepared requests cannot complete and finished intents cannot be reused', () => {
  assert.equal(plan(op('ATTACHMENT', intent())).result.reason, 'INVALID_DOWNLOAD');
  assert.equal(plan(op('REQUEST', requested())).result.reason, 'INVALID_DOWNLOAD');
  const done = plan(op('ATTACHMENT', requested())).result.intent;
  assert.equal(plan(op('ATTACHMENT', done)).result.reason, 'DOWNLOAD_CONSUMED');
  assert.equal(plan(op('REDIRECT', done)).result.reason, 'DOWNLOAD_CONSUMED');
});

test('expiry is exclusive and a newer observed time cannot roll back', () => {
  const current = requested();
  assert.equal(plan(op('ATTACHMENT', current), current.expiresAt - 1).result.outcome, 'FILE');
  assert.equal(plan(op('ATTACHMENT', current), current.expiresAt).result.reason, 'DOWNLOAD_EXPIRED');
  const checked = plan(op('CHECK', current), 1005).result.intent;
  assert.equal(plan(op('CHECK', checked), 1004).result.reason, 'INVALID_DOWNLOAD');
});

test('different source, operation, context and uncorrelated hostname cannot borrow a request', () => {
  for (const mutate of [x => x.binding.contextId = 'other', x => x.binding.operationId = 'other',
    x => x.source.context.contextId = 'other', x => x.source.target.hostname = 'another.example',
    x => x.target.hostname = 'another.example']) {
    const operation = op('ATTACHMENT', requested()); mutate(operation);
    assert.equal(plan(operation).result.outcome, 'DENY');
  }
});

test('policy revision and current source access are checked at every stage', () => {
  const changed = initial(); changed.policyRevision++;
  assert.equal(plan(op('ATTACHMENT', requested()), 1001, changed).result.reason, 'DOWNLOAD_POLICY_CHANGED');
  changed.policy.whitelist = [];
  assert.equal(plan(op('ATTACHMENT', requested()), 1001, changed).result.outcome, 'DENY');
  assert.equal(plan({ ...op(), source: { target: { hostname:'unknown.example' }, context: { contextId:'source', journeyId:null } } }).result.reason,
    'DOWNLOAD_SOURCE_UNAUTHORIZED');
});

test('manual and managed blocking remain above download authority, with existing explicit Whitelist exceptions', () => {
  for (const stage of ['PREPARE','REDIRECT']) {
    const current = stage === 'PREPARE' ? null : requested();
    assert.equal(plan(op(stage, current, 'blocked.example')).result.reason, 'BLACKLISTED');
    assert.equal(plan(op(stage, current), 1000, initial(), compileManagedBlacklist(['file.example'])).result.reason, 'MANAGED_BLACKLISTED');
  }
  const snapshot = initial(); snapshot.policy.whitelist.push('file.example');
  assert.equal(plan(op(), 1000, snapshot, compileManagedBlacklist(['file.example'])).result.outcome, 'PREPARED');
  snapshot.policy.blacklist.push('file.example');
  assert.equal(plan(op(), 1000, snapshot).result.reason, 'BLACKLISTED');
});

test('grant source lifetime caps the intent without creating or renewing a grant', () => {
  let snapshot = initial();
  snapshot = planAtlasOperation({ kind:'START_ACCESS', target:{hostname:'granted.example'} }, { snapshot, configuration, now:1000 }).candidateSnapshot;
  snapshot = planAtlasOperation({ kind:'CONFIRM_ACCESS', requestId:1 }, { snapshot, configuration, now:1010 }).candidateSnapshot;
  const operation = op(); operation.source.target.hostname = 'granted.example';
  const prepared = plan(operation, 1010, snapshot);
  assert.equal(prepared.result.intent.expiresAt, 1110);
  assert.deepEqual(prepared.observationSnapshot.accessState.grants, snapshot.accessState.grants);
});

test('invalid complete snapshots or malformed intent fields fail closed', () => {
  const invalid = initial(); invalid.vaultState = null;
  assert.equal(plan(op(), 1000, invalid).result.type, 'REJECTED');
  for (const field of ['phase','expiresAt','policyRevision','sourceJourneyId','currentHostname','redirects']) {
    const bad = { ...requested(), [field]: field === 'sourceJourneyId' ? -1 : null };
    assert.equal(plan(op('ATTACHMENT', bad)).result.type, 'REJECTED');
  }
  assert.equal(plan({ ...op(), extraPermission:true }).result.type, 'REJECTED');
  assert.equal(plan(op('PREPARE', requested())).result.type, 'REJECTED');
  assert.equal(plan(op('REQUEST', null)).result.type, 'REJECTED');
});

for (const outcome of ['NOT_WRITTEN','CONFLICT','UNKNOWN']) test(`controller cannot publish preparation after ${outcome}`, async () => {
  const repository = new FakeRepository(initial());
  const clock = { time:1000, now() { return this.time; } };
  const controller = createAtlasController({ repository, clock, configuration, ownerId:'owner' });
  await controller.open();
  clock.time++;
  repository.steps.push(request => ({type:outcome,commitId:request.commitId}));
  const result = await controller.handle(op());
  assert.equal(result.type, 'BLOCKED');
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
});

test('slow saved checkpoint cannot publish an expired file authorization', async () => {
  const repository = new FakeRepository(initial());
  const clock = { time:1000, now() { return this.time; } };
  const controller = createAtlasController({ repository, clock, configuration, ownerId:'owner' });
  await controller.open();
  const prepared = await controller.handle(op());
  const fetch = await controller.handle(op('REQUEST', prepared.intent));
  clock.time++;
  repository.steps.push((request, repo) => { clock.time = fetch.intent.expiresAt; return repo.apply(request); });
  assert.equal((await controller.handle(op('ATTACHMENT', fetch.intent))).reason, 'REEVALUATION_REQUIRED');
});
