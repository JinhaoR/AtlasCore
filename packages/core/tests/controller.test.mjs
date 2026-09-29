import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccessState, createJourneyState, createVaultState, createAtlasController,
  planAtlasOperation, validateAtlasSnapshot,
} from "../dist/index.js";
import { FakeRepository, deferred } from "./support/fake-repository.mjs";

const configuration = {
  accessTiming: { waitMs: 10, confirmationWindowMs: 20, grantDurationMs: 100 },
  vaultTiming: { waitMs: 10, confirmationWindowMs: 50 },
  journeyLimits: { lifetimeMs: 200, maxHops: 2 },
};
const initial = () => ({
  policy: { whitelist: ["root.example"], blacklist: ["blocked.example"] }, policyRevision: 0,
  accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState(),
});
const start = (hostname = "other.example") => ({ kind: "START_ACCESS", target: { hostname } });
const check = (hostname = "other.example", journeyId = null) => ({ kind: "CHECK_NAVIGATION",
  target: { hostname }, context: { contextId: "surface_a", journeyId } });
const confirm = { kind: "CONFIRM_ACCESS", requestId: 1 };
const propose = { kind: "PROPOSE_POLICY", candidatePolicy: { whitelist: ["new.example"], blacklist: ["other.example"] } };
let nextOwner = 0;
function create(repository = new FakeRepository(initial()), clock = { time: 0, now() { return this.time; } }, config = configuration) {
  const controller = createAtlasController({ repository, clock, configuration: config, ownerId: `owner_${++nextOwner}` });
  return { controller, repository, clock };
}
async function ready() {
  const fixture = create();
  assert.equal((await fixture.controller.open()).status, "READY");
  return fixture;
}
async function pendingRequest() {
  const fixture = await ready();
  assert.equal((await fixture.controller.handle(start())).type, "COMMITTED");
  fixture.clock.time = 10;
  return fixture;
}
function prepare(snapshot, now, operation) {
  const plan = planAtlasOperation(operation, { snapshot, now, configuration });
  assert.notEqual(plan.candidateSnapshot, null);
  return plan.candidateSnapshot;
}

test("controller requires open and never initializes missing or corrupt repository state", async () => {
  const { controller, repository } = create();
  assert.equal((await controller.handle(check("root.example"))).reason, "NOT_OPEN");
  assert.equal(repository.loads, 0);
  const missing = create(new FakeRepository(null));
  assert.equal((await missing.controller.open()).status, "UNINITIALIZED");
  assert.equal(missing.repository.commits.length, 0);
  for (const mutate of [
    (e) => { e.schemaVersion = 2; },
    (e) => { e.snapshot.vaultState = {}; },
    (e) => { delete e.snapshot.journeyState; },
  ]) {
    const invalid = create(); mutate(invalid.repository.envelope);
    assert.equal((await invalid.controller.open()).reason, "CORRUPT_STATE");
    assert.equal((await invalid.controller.handle(check("root.example"))).type, "BLOCKED");
    assert.equal(invalid.repository.commits.length, 0);
  }
});

test("successful confirmation publishes consumption and grant only after commit acknowledgement", async () => {
  const { controller, repository } = await pendingRequest();
  const entered = deferred(), release = deferred();
  repository.steps.push(async (request, repo) => {
    entered.resolve(); await release.promise; return repo.apply(request);
  });
  let published = false;
  const confirming = controller.handle(confirm).then((result) => { published = true; return result; });
  await entered.promise;
  assert.equal(published, false);
  assert.equal(controller.getView().status, "COMMITTING");
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  assert.equal(controller.getView().snapshot.accessState.pendingRequests.length, 1);
  release.resolve();
  const result = await confirming;
  assert.equal(result.type, "COMMITTED");
  assert.equal(result.referenceId, 1);
  const view = controller.getView();
  assert.deepEqual(view.snapshot.accessState.pendingRequests, []);
  assert.equal(view.snapshot.accessState.grants.length, 1);
  assert.deepEqual(view.snapshot, repository.envelope.snapshot);
  assert.equal((await controller.handle(check())).decision.reason, "ACTIVE_GRANT");
});

test("definite failed confirmation preserves authority and needs explicit recovery and fresh confirmation", async () => {
  const { controller, repository, clock } = await pendingRequest();
  repository.steps.push((request, repo) => repo.fail(request));
  const failed = await controller.handle(confirm);
  assert.equal(failed.reason, "WRITE_FAILED");
  assert.equal(controller.getView().snapshot.accessState.pendingRequests.length, 1);
  assert.deepEqual(repository.envelope.snapshot.accessState.grants, []);
  assert.equal((await controller.handle(confirm)).type, "BLOCKED");
  const attempts = repository.commits.length;
  assert.equal((await controller.open()).status, "READY");
  assert.equal(repository.envelope.snapshot.accessState.pendingRequests[0].confirmBy, 30);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  clock.time = 11;
  assert.equal((await controller.handle(confirm)).type, "COMMITTED");
  assert.equal(controller.getView().snapshot.accessState.grants[0].expiresAt, 111);
  assert.ok(repository.commits.length > attempts);
  assert.equal(new Set(repository.commits.map((r) => r.commitId)).size, repository.commits.length);
});

test("failed observation persistence blocks even Whitelist assessments and retains the time floor", async () => {
  const { controller, repository, clock } = await ready();
  clock.time = 20;
  repository.steps.push((request, repo) => repo.fail(request));
  assert.equal((await controller.handle(check("root.example"))).reason, "WRITE_FAILED");
  assert.equal(controller.getView().snapshot.accessState.lastObservedAt, 0);
  clock.time = 19;
  assert.equal((await controller.open()).reason, "CLOCK_ROLLBACK");
  clock.time = 20;
  assert.equal((await controller.open()).status, "READY");
  assert.equal(repository.envelope.snapshot.accessState.lastObservedAt, 20);
});

test("storage conflict reloads newer policy without replaying confirmation or overwriting changes", async () => {
  const { controller, repository } = await pendingRequest();
  repository.steps.push((request, repo) => {
    repo.replace({ ...repo.envelope.snapshot, policyRevision: 1,
      policy: { whitelist: ["root.example"], blacklist: ["other.example"] } });
    return repo.apply(request);
  });
  assert.equal((await controller.handle(confirm)).reason, "STORAGE_CONFLICT");
  assert.equal(controller.getView().snapshot.policyRevision, 1);
  assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
  assert.equal((await controller.handle(confirm)).type, "BLOCKED");
  assert.equal((await controller.open()).status, "READY");
  assert.equal((await controller.handle(confirm)).reason, "POLICY_CHANGED");
  assert.equal((await controller.handle(check())).decision.reason, "BLACKLISTED");
});

test("unknown applied and not-written outcomes block until settled and never replay the operation", async () => {
  for (const applied of [true, false]) {
    const { controller, repository } = await pendingRequest();
    repository.steps.push((request, repo) => repo.unknown(request, applied));
    const result = await controller.handle(confirm);
    assert.equal(result.reason, "COMMIT_UNKNOWN");
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
    const writes = repository.commits.length;
    assert.equal((await controller.handle(check("root.example"))).type, "BLOCKED");
    assert.equal((await controller.open()).status, "RECONCILING");
    assert.equal(repository.commits.length, writes);
    repository.settle(result.pendingCommitId);
    const recovered = await controller.open();
    assert.equal(recovered.status, "READY");
    assert.equal(recovered.snapshot.accessState.grants.length, applied ? 1 : 0);
    assert.equal((await controller.handle(check())).decision.outcome, applied ? "ALLOW" : "REQUIRE_CONFIRMATION");
    if (applied) assert.equal((await controller.handle(confirm)).reason, "REQUEST_NOT_FOUND");
  }
});

test("thrown and malformed commit receipts are uncertain rather than proof of no write", async () => {
  for (const mode of ["throw", "malformed", "wrong-id", "old-version"]) {
    const { controller, repository } = await pendingRequest();
    repository.steps.push((request, repo) => {
      if (mode === "throw") return repo.unknown(request, true, true);
      const receipt = repo.apply(request);
      repo.unsettled.add(request.commitId);
      if (mode === "wrong-id") return { ...receipt, commitId: "wrong" };
      if (mode === "old-version") return { ...receipt, storageVersion: request.expectedStorageVersion };
      return { type: "COMMITTED" };
    });
    const result = await controller.handle(confirm);
    assert.equal(result.reason, "COMMIT_UNKNOWN");
    assert.deepEqual(controller.getView().snapshot.accessState.grants, []);
    repository.settle(result.pendingCommitId);
    assert.equal((await controller.open()).snapshot.accessState.grants.length, 1);
  }
});

test("restart encounters unresolved writes before it can load old authority", async () => {
  const { controller, repository, clock } = await pendingRequest();
  repository.steps.push((request, repo) => repo.unknown(request, true));
  const result = await controller.handle(confirm);
  const restarted = create(repository, clock).controller;
  assert.equal((await restarted.open()).status, "RECONCILING");
  assert.equal(restarted.getView().snapshot, null);
  assert.equal((await restarted.handle(check("root.example"))).type, "BLOCKED");
  repository.settle(result.pendingCommitId);
  assert.equal((await restarted.open()).status, "READY");
  assert.equal((await restarted.handle(confirm)).reason, "REQUEST_NOT_FOUND");
  assert.equal((await restarted.handle(check())).decision.expiresAt, 110);
});

test("a later commit marker does not prove an uncertain confirmation failed", async () => {
  const { controller, repository } = await pendingRequest();
  repository.steps.push((request, repo) => repo.unknown(request, true));
  const result = await controller.handle(confirm);
  // Simulate later data that has overwritten lastCommitId, while resolution is unavailable.
  repository.replace(repository.envelope.snapshot);
  assert.notEqual(repository.envelope.lastCommitId, result.pendingCommitId);
  assert.equal((await controller.open()).status, "RECONCILING");
  repository.settle(result.pendingCommitId);
  assert.equal((await controller.open()).snapshot.accessState.grants.length, 1);
});

test("repeated Starts retain terms and queued duplicate confirmation cannot renew a grant", async () => {
  const { controller, clock } = await ready();
  await controller.handle(start());
  const first = controller.getView().snapshot.accessState.pendingRequests[0];
  clock.time = 5;
  await controller.handle(start());
  assert.deepEqual(controller.getView().snapshot.accessState.pendingRequests[0], first);
  clock.time = 10;
  const [one, two] = await Promise.all([controller.handle(confirm), controller.handle(confirm)]);
  assert.equal(one.type, "COMMITTED");
  assert.equal(two.reason, "REQUEST_NOT_FOUND");
  assert.equal(controller.getView().snapshot.accessState.grants.length, 1);
  assert.equal(controller.getView().snapshot.accessState.grants[0].expiresAt, 110);
});

test("concurrent operations execute in call order against the latest committed state", async () => {
  const { controller, repository } = await ready();
  const entered = deferred(), release = deferred();
  repository.steps.push(async (request, repo) => {
    entered.resolve(); await release.promise; return repo.apply(request);
  });
  const first = controller.handle(start("one.example"));
  await entered.promise;
  const loads = repository.loads;
  const second = controller.handle(start("two.example"));
  const third = controller.handle({ kind: "CANCEL_ACCESS", requestId: 1 });
  await Promise.resolve();
  assert.equal(repository.loads, loads);
  assert.equal(repository.commits.length, 1);
  release.resolve();
  assert.deepEqual((await Promise.all([first, second, third])).map((r) => r.type), ["COMMITTED", "COMMITTED", "COMMITTED"]);
  const state = controller.getView().snapshot.accessState;
  assert.equal(state.nextRequestId, 3);
  assert.deepEqual(state.pendingRequests.map((r) => r.hostname), ["two.example"]);
  assert.deepEqual(repository.commits.map((r) => r.expectedStorageVersion), ["v0", "v1", "v2"]);
});

test("failure blocks already queued work instead of treating it as a retry", async () => {
  const { controller, repository } = await pendingRequest();
  const entered = deferred(), release = deferred();
  repository.steps.push(async (request, repo) => {
    entered.resolve(); await release.promise; return repo.fail(request);
  });
  const first = controller.handle(confirm);
  await entered.promise;
  const second = controller.handle(confirm);
  release.resolve();
  assert.equal((await first).reason, "WRITE_FAILED");
  assert.equal((await second).type, "BLOCKED");
  assert.equal(repository.commits.length, 2);
});

test("restart keeps pending, grant and proposal deadlines but ends old Journeys before READY", async () => {
  let snapshot = prepare(initial(), 0, start());
  snapshot = prepare(snapshot, 10, confirm);
  snapshot = prepare(snapshot, 11, start("pending.example"));
  snapshot = prepare(snapshot, 12, propose);
  snapshot = prepare(snapshot, 13, { kind: "START_JOURNEY", root: { hostname: "root.example" }, contextId: "surface_a" });
  const repository = new FakeRepository(snapshot);
  const clock = { time: 20, now() { return this.time; } };
  const { controller } = create(repository, clock);
  const entered = deferred(), release = deferred();
  repository.steps.push(async (request, repo) => {
    entered.resolve(); await release.promise; return repo.apply(request);
  });
  const opening = controller.open();
  await entered.promise;
  assert.equal(controller.getView().status, "COMMITTING");
  release.resolve();
  const view = await opening;
  assert.equal(view.status, "READY");
  assert.equal(view.snapshot.journeyState.journeys[0].endReason, "CONTEXT_CLOSED");
  assert.deepEqual(view.snapshot.accessState.grants, snapshot.accessState.grants);
  assert.deepEqual(view.snapshot.accessState.pendingRequests, snapshot.accessState.pendingRequests);
  assert.deepEqual(view.snapshot.vaultState.pendingProposal, snapshot.vaultState.pendingProposal);
  assert.equal(validateAtlasSnapshot(view.snapshot).ok, true);
  assert.equal((await controller.handle(check("unfamiliar.example", 1))).decision.outcome, "GREYLIST");
  clock.time = 110;
  assert.equal((await controller.handle(check())).decision.reason, "GRANT_EXPIRED");
});

test("repeated open on the same ready owner leaves its new Journey active", async () => {
  const { controller, repository } = await ready();
  await controller.handle({ kind: "START_JOURNEY", root: { hostname: "root.example" }, contextId: "surface_a" });
  const writes = repository.commits.length;
  assert.equal((await controller.open()).snapshot.journeyState.journeys[0].phase, "STARTED");
  assert.equal(repository.commits.length, writes);
});

test("failed startup housekeeping never exposes READY and can recover without resetting deadlines", async () => {
  const snapshot = prepare(initial(), 0, { kind: "START_JOURNEY", root: { hostname: "root.example" }, contextId: "surface_a" });
  const { controller, repository } = create(new FakeRepository(snapshot));
  repository.steps.push((request, repo) => repo.fail(request));
  assert.equal((await controller.open()).reason, "WRITE_FAILED");
  assert.equal((await controller.handle(check("other.example", 1))).type, "BLOCKED");
  const recovered = await controller.open();
  assert.equal(recovered.status, "READY");
  assert.equal(recovered.snapshot.journeyState.journeys[0].expiresAt, 200);
  assert.equal(recovered.snapshot.journeyState.journeys[0].endReason, "CONTEXT_CLOSED");
});

test("slow checkpoint saves cannot publish an expired grant or Journey ALLOW", async () => {
  for (const basis of ["grant", "journey"]) {
    const { controller, repository, clock } = await ready();
    if (basis === "grant") { await controller.handle(start()); clock.time = 10; await controller.handle(confirm); }
    else await controller.handle({ kind: "START_JOURNEY", root: { hostname: "root.example" }, contextId: "surface_a" });
    clock.time = 20;
    repository.steps.push((request, repo) => { clock.time = basis === "grant" ? 110 : 200; return repo.apply(request); });
    const operation = check("other.example", basis === "grant" ? null : 1);
    assert.equal((await controller.handle(operation)).reason, "REEVALUATION_REQUIRED");
    assert.equal((await controller.handle(operation)).decision.outcome, "GREYLIST");
  }
});

test("late confirmation acknowledgement reports the commit without extending grant lifetime", async () => {
  const { controller, repository, clock } = await pendingRequest();
  repository.steps.push((request, repo) => { clock.time = 200; return repo.apply(request); });
  assert.equal((await controller.handle(confirm)).type, "COMMITTED");
  assert.equal(controller.getView().snapshot.accessState.grants[0].expiresAt, 110);
  assert.equal((await controller.handle(check())).decision.outcome, "GREYLIST");
});

test("Vault changes are atomically published only after successful save", async () => {
  const { controller, repository, clock } = await ready();
  await controller.handle(propose);
  const policy = controller.getView().snapshot.policy;
  const writes = repository.commits.length;
  clock.time = 10;
  const reviewed = await controller.handle({ kind: "REVIEW_POLICY", proposalId: 1 });
  assert.equal(reviewed.type, "REVIEW");
  assert.equal(repository.commits.length, writes);
  repository.steps.push((request, repo) => repo.fail(request));
  assert.equal((await controller.handle({ kind: "CONFIRM_POLICY", proposalId: 1 })).reason, "WRITE_FAILED");
  assert.deepEqual(repository.envelope.snapshot.policy, policy);
  assert.equal(repository.envelope.snapshot.vaultState.pendingProposal.id, 1);
  await controller.open();
  const committed = await controller.handle({ kind: "CONFIRM_POLICY", proposalId: 1 });
  assert.equal(committed.type, "COMMITTED");
  assert.equal(committed.policyRevision, 1);
  assert.equal(repository.envelope.snapshot.vaultState.pendingProposal, null);
  assert.deepEqual(repository.envelope.snapshot.policy, propose.candidatePolicy);
  assert.equal((await controller.handle({ kind: "CONFIRM_POLICY", proposalId: 1 })).reason, "ALREADY_COMMITTED");
});

test("configuration, queued operations, and returned views cannot mutate controller authority", async () => {
  const config = structuredClone(configuration);
  const { controller, repository } = create(undefined, undefined, config);
  config.accessTiming.waitMs = 1;
  await controller.open();
  const entered = deferred(), release = deferred();
  repository.steps.push(async (request, repo) => { entered.resolve(); await release.promise; return repo.apply(request); });
  const first = controller.handle(start("one.example"));
  await entered.promise;
  const operation = start("two.example");
  const second = controller.handle(operation);
  operation.target.hostname = "changed.example";
  release.resolve(); await first; await second;
  const view = controller.getView();
  assert.deepEqual(view.snapshot.accessState.pendingRequests.map((r) => [r.hostname, r.readyAt]), [
    ["one.example", 10], ["two.example", 10],
  ]);
  assert.equal(Object.isFrozen(view.snapshot.accessState.pendingRequests[0]), true);
  assert.throws(() => { view.snapshot.policy.whitelist.push("added.example"); }, TypeError);
  assert.equal(Object.isFrozen(operation), false);
  assert.equal(Object.isFrozen(config), false);
});

test("load/clock exceptions fail closed and the operation queue survives explicit recovery", async () => {
  const { controller, repository, clock } = await ready();
  repository.loadHook = () => { throw new Error("Synthetic load failure"); };
  assert.equal((await controller.handle(check("root.example"))).reason, "STORAGE_UNAVAILABLE");
  repository.loadHook = null;
  clock.now = () => { throw new Error("Synthetic clock failure"); };
  assert.equal((await controller.open()).reason, "CLOCK_UNAVAILABLE");
  clock.now = () => NaN;
  assert.equal((await controller.open()).reason, "INVALID_TIME");
  clock.now = () => 0;
  assert.equal((await controller.open()).status, "READY");
  assert.equal((await controller.handle(check("root.example"))).decision.reason, "WHITELISTED");
});

test("a policy change during post-commit verification withholds the original assessment", async () => {
  const { controller, repository, clock } = await ready();
  clock.time = 1;
  repository.steps.push((request, repo) => {
    const receipt = repo.apply(request);
    repo.replace({ ...repo.envelope.snapshot, policyRevision: 1,
      policy: { whitelist: [], blacklist: ["root.example"] } });
    return receipt;
  });
  assert.equal((await controller.handle(check("root.example"))).reason, "AUTHORITY_CHANGED");
  await controller.open();
  assert.equal((await controller.handle(check("root.example"))).decision.reason, "BLACKLISTED");
});

test("fresh operations reload authority and reject corrupted state despite a cached Whitelist", async () => {
  const { controller, repository } = await ready();
  repository.envelope.snapshot.accessState = {};
  assert.equal((await controller.handle(check("root.example"))).reason, "CORRUPT_STATE");
  assert.equal(repository.commits.length, 0);
});

test("a new owner is fenced while an earlier owner's commit is still in flight", async () => {
  const { controller, repository, clock } = await pendingRequest();
  const entered = deferred(), release = deferred();
  repository.steps.push(async (request, repo) => {
    entered.resolve(); await release.promise; return repo.apply(request);
  });
  const confirming = controller.handle(confirm);
  await entered.promise;
  const restarted = create(repository, clock).controller;
  assert.equal((await restarted.open()).status, "RECONCILING");
  assert.equal(restarted.getView().snapshot, null);
  assert.equal((await restarted.open()).status, "RECONCILING");
  release.resolve();
  assert.equal((await confirming).type, "COMMITTED");
  assert.equal((await restarted.open()).status, "READY");
  assert.equal((await restarted.handle(confirm)).reason, "REQUEST_NOT_FOUND");
});

test("unknown resolution exceptions and contradictory receipts remain blocked until proven", async () => {
  const { controller, repository } = await pendingRequest();
  repository.steps.push((request, repo) => repo.unknown(request, true));
  const result = await controller.handle(confirm);
  const resolve = repository.resolveCommit.bind(repository);
  repository.resolveCommit = () => { throw new Error("Synthetic resolution failure"); };
  assert.equal((await controller.open()).status, "RECONCILING");
  repository.resolveCommit = async () => ({ type: "NOT_WRITTEN", commitId: "different_attempt" });
  assert.equal((await controller.open()).status, "RECONCILING");
  assert.equal((await controller.handle(check("root.example"))).type, "BLOCKED");
  repository.resolveCommit = resolve;
  repository.settle(result.pendingCommitId);
  assert.equal((await controller.open()).snapshot.accessState.grants.length, 1);
});

test("two owners racing one storage version cannot silently lose a committed request", async () => {
  const { controller: first, repository, clock } = await ready();
  const second = create(repository, clock).controller;
  await second.open();
  const gate = deferred();
  let reads = 0;
  const captured = structuredClone(repository.envelope);
  repository.loadHook = async () => {
    if (++reads === 2) { repository.loadHook = null; gate.resolve(); }
    await gate.promise;
    return { type: "READY", envelope: structuredClone(captured) };
  };
  const responses = await Promise.all([first.handle(start("one.example")), second.handle(start("two.example"))]);
  assert.equal(responses.filter((r) => r.type === "COMMITTED").length, 1);
  assert.equal(responses.filter((r) => r.reason === "STORAGE_CONFLICT").length, 1);
  assert.equal(repository.envelope.snapshot.accessState.pendingRequests.length, 1);
  const loser = responses[0].type === "BLOCKED" ? first : second;
  const missing = responses[0].type === "BLOCKED" ? "one.example" : "two.example";
  assert.equal((await loser.open()).status, "READY");
  assert.equal((await loser.handle(start(missing))).type, "COMMITTED");
  assert.deepEqual(repository.envelope.snapshot.accessState.pendingRequests.map((r) => r.hostname).sort(),
    ["one.example", "two.example"]);
});

test("clock rollback after a successful write withholds the response without undoing the commit", async () => {
  const { controller, repository, clock } = await pendingRequest();
  repository.steps.push((request, repo) => { clock.time = 9; return repo.apply(request); });
  assert.equal((await controller.handle(confirm)).reason, "CLOCK_ROLLBACK");
  assert.equal(repository.envelope.snapshot.accessState.grants.length, 1);
  assert.equal((await controller.handle(check())).type, "BLOCKED");
  clock.time = 10;
  assert.equal((await controller.open()).status, "READY");
  assert.equal((await controller.handle(confirm)).reason, "REQUEST_NOT_FOUND");
  assert.equal((await controller.handle(check())).decision.expiresAt, 110);
});

test("a resolved commit cannot recover through contradictory old data or different contents at its version", async () => {
  for (const mode of ["old-version", "changed-contents"]) {
    const { controller, repository } = await pendingRequest();
    const oldEnvelope = structuredClone(repository.envelope);
    repository.steps.push((request, repo) => repo.unknown(request, true));
    const result = await controller.handle(confirm);
    repository.settle(result.pendingCommitId);
    const wrong = mode === "old-version" ? oldEnvelope : {
      ...structuredClone(repository.envelope), snapshot: oldEnvelope.snapshot,
    };
    repository.loadHook = () => ({ type: "READY", envelope: wrong });
    assert.equal((await controller.open()).reason, "CORRUPT_STATE");
    assert.equal((await controller.handle(confirm)).type, "BLOCKED");
    repository.loadHook = null;
    assert.equal((await controller.open()).status, "READY");
    assert.equal((await controller.handle(confirm)).reason, "REQUEST_NOT_FOUND");
  }
});
