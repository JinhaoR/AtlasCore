import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccessState, createJourneyState, createVaultState,
  planAtlasOperation, validateAtlasSnapshot,
} from "../dist/index.js";

const configuration = {
  accessTiming: { waitMs: 10, confirmationWindowMs: 20, grantDurationMs: 100 },
  vaultTiming: { waitMs: 10, confirmationWindowMs: 50 },
  journeyLimits: { lifetimeMs: 200, maxHops: 2 },
};
const target = (hostname) => ({ hostname });
const initial = () => ({
  policy: { whitelist: ["root.example"], blacklist: ["blocked.example"] },
  policyRevision: 0, configuration, configurationRevision: 0, accessState: createAccessState(),
  vaultState: createVaultState(), journeyState: createJourneyState(),
});
const plan = (snapshot, now, operation, config = configuration) =>
  planAtlasOperation(operation, { snapshot, now, configuration: config });
const command = (snapshot, now, operation) => {
  const result = plan(snapshot, now, operation);
  assert.notEqual(result.candidateSnapshot, null, JSON.stringify(result.result));
  assert.equal(validateAtlasSnapshot(result.candidateSnapshot).ok, true);
  return result.candidateSnapshot;
};
const navigate = (snapshot, now, hostname, contextId = "tab_a", journeyId = null, record = false) =>
  plan(snapshot, now, {
    kind: record ? "RECORD_JOURNEY_NAVIGATION" : "CHECK_NAVIGATION",
    target: target(hostname), context: { contextId, journeyId, ...(journeyId === null ? {} : {
      continuation: { kind: 'HTTP_REDIRECT', sourceHostname: snapshot.journeyState.journeys.find((j) => j.id === journeyId)?.currentHostname ?? 'root.example' },
    }) },
  });
const withGrant = (snapshot = initial(), hostname = "other.example", now = 0) => {
  snapshot = command(snapshot, now, { kind: "START_ACCESS", target: target(hostname) });
  const requestId = snapshot.accessState.pendingRequests.find((r) => r.hostname === hostname).id;
  return command(snapshot, now + 10, { kind: "CONFIRM_ACCESS", requestId });
};
const withJourney = (snapshot = initial(), now = 0, contextId = "tab_a") =>
  command(snapshot, now, { kind: "START_JOURNEY", root: target("root.example"), contextId });

test("snapshot validation copies and freezes complete data without changing caller input", () => {
  const input = structuredClone(initial());
  input.policy.whitelist = ["ROOT.EXAMPLE."];
  const before = structuredClone(input);
  const validated = validateAtlasSnapshot(input);
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.snapshot.policy.whitelist, ["root.example"]);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.policy.whitelist), false);
  assert.equal(Object.isFrozen(validated.snapshot), true);
  assert.equal(Object.isFrozen(validated.snapshot.accessState.grants), true);
  input.policy.whitelist.push("later.example");
  assert.deepEqual(validated.snapshot.policy.whitelist, ["root.example"]);
});

test("every aggregate component must be present and valid even for Whitelist or a grant", () => {
  const mutations = [
    (s) => { delete s.journeyState; },
    (s) => { s.policy.blacklist = ["https://bad.example"]; },
    (s) => { s.policyRevision = -1; },
    (s) => { s.accessState.nextRequestId = 0; },
    (s) => { s.vaultState.pendingProposal = {}; },
    (s) => { s.journeyState.journeys = [{}]; },
    (s) => { s.unsupported = true; },
  ];
  for (const mutate of mutations) {
    const snapshot = structuredClone(withGrant());
    mutate(snapshot);
    assert.equal(validateAtlasSnapshot(snapshot).ok, false);
    for (const host of ["root.example", "other.example"]) {
      const result = navigate(snapshot, 10, host);
      assert.equal(result.result.type, "REJECTED");
      assert.equal(result.candidateSnapshot, null);
      assert.equal(result.observationSnapshot, null);
    }
  }
});

test("module revision, record, and timestamp relationships are validated", () => {
  for (const component of ["accessState", "vaultState", "journeyState"]) {
    const snapshot = structuredClone(initial());
    snapshot[component].policyRevision = 1;
    assert.deepEqual(validateAtlasSnapshot(snapshot), {
      ok: false, reason: "POLICY_ROLLBACK", component,
    });
  }
  const grant = structuredClone(withGrant());
  grant.accessState.lastObservedAt = 9;
  assert.equal(validateAtlasSnapshot(grant).reason, "INVALID_ACCESS_STATE");
  const journey = structuredClone(withJourney());
  journey.journeyState.journeys.push(journey.journeyState.journeys[0]);
  assert.equal(validateAtlasSnapshot(journey).reason, "INVALID_JOURNEY_STATE");
  const proposal = structuredClone(command(initial(), 0, {
    kind: "PROPOSE_POLICY", candidatePolicy: { whitelist: ["new.example"], blacklist: [] },
  }));
  proposal.policy = structuredClone(proposal.vaultState.pendingProposal.candidatePolicy);
  assert.equal(validateAtlasSnapshot(proposal).reason, "INVALID_VAULT_STATE");
});

test("snapshot validation does not observe or silently repair stale Journeys", () => {
  const snapshot = { ...withJourney(), policyRevision: 1 };
  const validated = validateAtlasSnapshot(snapshot);
  assert.equal(validated.ok, true);
  assert.equal(validated.snapshot.journeyState.journeys[0].phase, "STARTED");
  const observed = plan(snapshot, 10, { kind: "OBSERVE_TIME" });
  assert.equal(observed.observationSnapshot.journeyState.journeys[0].endReason, "POLICY_CHANGED");
  assert.equal(observed.candidateSnapshot, null);
});

test("navigation returns policy decisions and never starts a workflow", () => {
  for (const [host, outcome, reason] of [
    ["root.example", "ALLOW", "WHITELISTED"],
    ["blocked.example", "DENY", "BLACKLISTED"],
    ["unknown.example", "GREYLIST", "UNLISTED"],
  ]) {
    const result = navigate(initial(), 1, host);
    assert.equal(result.result.type, "ASSESSMENT");
    assert.equal(result.result.decision.outcome, outcome);
    assert.equal(result.result.decision.reason, reason);
    assert.equal(result.candidateSnapshot, null);
    assert.deepEqual(result.observationSnapshot.accessState.pendingRequests, []);
    assert.deepEqual(result.observationSnapshot.journeyState.journeys, []);
  }
});

test("Blacklist overrides Whitelist, grants, and bound Journeys", () => {
  let snapshot = withJourney(withGrant(), 10);
  snapshot = { ...snapshot, policy: {
    whitelist: ["root.example", "other.example"], blacklist: ["other.example"],
  } };
  const result = navigate(snapshot, 10, "other.example", "tab_a", 1, true);
  assert.equal(result.result.decision.reason, "BLACKLISTED");
  assert.equal(result.candidateSnapshot, null);
  assert.equal(result.observationSnapshot.journeyState.journeys[0].hopCount, 0);
});

test("Whitelist then grant then Journey determine the ALLOW explanation", () => {
  const snapshot = withJourney(withGrant(), 10);
  assert.equal(navigate(snapshot, 11, "root.example", "tab_a", 1).result.decision.reason, "WHITELISTED");
  assert.equal(navigate(snapshot, 11, "other.example", "tab_a", 1).result.decision.reason, "ACTIVE_GRANT");
  assert.equal(navigate(snapshot, 11, "intermediate.example", "tab_a", 1).result.decision.reason, "ACTIVE_JOURNEY");
});

test("Journey may authorize while Greylist is waiting or ready without creating a grant", () => {
  let snapshot = command(withJourney(), 0, { kind: "START_ACCESS", target: target("other.example") });
  for (const now of [1, 10]) {
    const result = navigate(snapshot, now, "other.example", "tab_a", 1);
    assert.equal(result.result.decision.reason, "ACTIVE_JOURNEY");
    snapshot = result.observationSnapshot;
    assert.deepEqual(snapshot.accessState.grants, []);
    assert.equal(snapshot.accessState.pendingRequests.length, 1);
  }
});

test("waiting and confirmation remain explicit and grant consumption is one aggregate candidate", () => {
  let snapshot = command(initial(), 0, { kind: "START_ACCESS", target: target("other.example") });
  assert.equal(navigate(snapshot, 9, "other.example").result.decision.outcome, "WAIT");
  assert.equal(navigate(snapshot, 10, "other.example").result.decision.outcome, "REQUIRE_CONFIRMATION");
  const early = plan(snapshot, 9, { kind: "CONFIRM_ACCESS", requestId: 1 });
  assert.equal(early.result.reason, "NOT_READY");
  assert.equal(early.candidateSnapshot, null);
  assert.equal(early.observationSnapshot.accessState.lastObservedAt, 9);
  const confirmation = plan(snapshot, 10, { kind: "CONFIRM_ACCESS", requestId: 1 });
  assert.equal(confirmation.observationSnapshot.accessState.pendingRequests.length, 1);
  assert.deepEqual(confirmation.observationSnapshot.accessState.grants, []);
  snapshot = confirmation.candidateSnapshot;
  assert.deepEqual(snapshot.accessState.pendingRequests, []);
  assert.equal(snapshot.accessState.grants.length, 1);
  assert.equal(navigate(snapshot, 109, "other.example").result.decision.reason, "ACTIVE_GRANT");
  assert.equal(navigate(snapshot, 110, "other.example").result.decision.outcome, "GREYLIST");
  assert.equal(plan(snapshot, 11, { kind: "CONFIRM_ACCESS", requestId: 1 }).result.reason, "REQUEST_NOT_FOUND");
});

test("repeated Start preserves terms and cancellation cannot confirm", () => {
  const snapshot = command(initial(), 0, { kind: "START_ACCESS", target: target("other.example") });
  const again = command(snapshot, 5, { kind: "START_ACCESS", target: target("other.example") });
  assert.deepEqual(again.accessState.pendingRequests, snapshot.accessState.pendingRequests);
  const cancelled = command(again, 6, { kind: "CANCEL_ACCESS", requestId: 1 });
  assert.equal(plan(cancelled, 10, { kind: "CONFIRM_ACCESS", requestId: 1 }).result.reason, "REQUEST_NOT_FOUND");
  assert.equal(plan(snapshot, 30, { kind: "CONFIRM_ACCESS", requestId: 1 }).result.reason, "REQUEST_EXPIRED");
});

test("checks do not move Journeys; recording maintains budget even under an independent grant", () => {
  let snapshot = withJourney(withGrant(), 10);
  const checked = navigate(snapshot, 11, "other.example", "tab_a", 1);
  assert.equal(checked.candidateSnapshot, null);
  assert.equal(checked.observationSnapshot.journeyState.journeys[0].hopCount, 0);
  const recorded = navigate(snapshot, 11, "other.example", "tab_a", 1, true);
  assert.equal(recorded.result.decision.reason, "ACTIVE_GRANT");
  snapshot = recorded.candidateSnapshot;
  assert.equal(snapshot.journeyState.journeys[0].hopCount, 1);
  assert.equal(snapshot.journeyState.journeys[0].expiresAt, 210);
  const returning = navigate(snapshot, 12, "root.example", "tab_a", 1);
  assert.equal(returning.observationSnapshot.journeyState.journeys[0].phase, "IN_TRANSIT");
  const arrived = navigate(snapshot, 12, "root.example", "tab_a", 1, true);
  assert.equal(arrived.result.decision.reason, "WHITELISTED");
  assert.equal(arrived.candidateSnapshot.journeyState.journeys[0].endReason, "RETURNED");
  assert.deepEqual(arrived.candidateSnapshot.policy, snapshot.policy);
  assert.deepEqual(arrived.candidateSnapshot.accessState.grants, snapshot.accessState.grants);
});

test("Whitelist intermediate steps still count and an ended Journey does not revoke a grant", () => {
  let snapshot = withJourney(withGrant(), 10);
  snapshot = { ...snapshot, policy: { ...snapshot.policy, whitelist: ["root.example", "second.example"] } };
  snapshot = navigate(snapshot, 11, "second.example", "tab_a", 1, true).candidateSnapshot;
  assert.equal(snapshot.journeyState.journeys[0].hopCount, 1);
  snapshot = navigate(snapshot, 12, "third.example", "tab_a", 1, true).candidateSnapshot;
  const exhausted = navigate(snapshot, 13, "other.example", "tab_a", 1, true);
  assert.equal(exhausted.result.decision.reason, "ACTIVE_GRANT");
  assert.equal(exhausted.observationSnapshot.journeyState.journeys[0].endReason, "HOP_LIMIT");
  assert.equal(exhausted.candidateSnapshot.journeyState.journeys[0].hopCount, 2);
  assert.equal(navigate(exhausted.candidateSnapshot, 14, "fourth.example", "tab_a", 1).result.decision.outcome, "GREYLIST");
});

test("expired Journeys fall back to pending access without automatically confirming", () => {
  let snapshot = withJourney();
  snapshot = command(snapshot, 195, { kind: "START_ACCESS", target: target("other.example") });
  const expired = navigate(snapshot, 200, "other.example", "tab_a", 1);
  assert.equal(expired.result.decision.outcome, "WAIT");
  assert.equal(expired.observationSnapshot.journeyState.journeys[0].endReason, "EXPIRED");
  assert.deepEqual(expired.observationSnapshot.accessState.grants, []);
});

test("Journey scopes cannot be borrowed or omitted but grants remain hostname-wide", () => {
  const snapshot = withJourney(withGrant(), 10);
  assert.equal(navigate(snapshot, 10, "other.example", "tab_b").result.decision.reason, "ACTIVE_GRANT");
  assert.equal(navigate(snapshot, 10, "unknown.example", "tab_b").result.decision.outcome, "GREYLIST");
  for (const [contextId, id] of [["tab_b", 1], ["tab_a", 2], ["tab_a", null]]) {
    const result = navigate(snapshot, 10, "root.example", contextId, id);
    assert.equal(result.result.type, "REJECTED");
    assert.equal(result.candidateSnapshot, null);
  }
});

test("cancellation, closure and repeated Journey Start preserve existing rules", () => {
  for (const kind of ["CANCEL_JOURNEY", "CLOSE_JOURNEY_CONTEXT"]) {
    const snapshot = withJourney();
    assert.equal(plan(snapshot, 1, {
      kind: "START_JOURNEY", root: target("root.example"), contextId: "tab_a",
    }).result.reason, "JOURNEY_ACTIVE");
    const ended = command(snapshot, 1, { kind, journeyId: 1, contextId: "tab_a" });
    assert.equal(navigate(ended, 2, "other.example", "tab_a", 1).result.decision.outcome, "GREYLIST");
    assert.equal(ended.journeyState.journeys[0].expiresAt, 200);
  }
});

test("every module is observed even when policy immediately allows or denies", () => {
  for (const host of ["root.example", "blocked.example"]) {
    const result = navigate(withJourney(), 200, host, "tab_a", 1);
    for (const field of ["accessState", "vaultState", "journeyState"]) {
      assert.equal(result.observationSnapshot[field].lastObservedAt, 200);
    }
    assert.equal(result.observationSnapshot.journeyState.journeys[0].endReason, "EXPIRED");
  }
});

test("new policy revision invalidates all overlays without changing frozen records", () => {
  const snapshot = { ...withJourney(withGrant(), 10), policyRevision: 1 };
  const result = navigate(snapshot, 11, "other.example", "tab_a", 1);
  assert.equal(result.result.decision.outcome, "GREYLIST");
  assert.equal(result.result.decision.reason, "POLICY_CHANGED");
  assert.equal(result.observationSnapshot.journeyState.journeys[0].endReason, "POLICY_CHANGED");
  assert.deepEqual(result.observationSnapshot.accessState.grants, snapshot.accessState.grants);
});

test("rollback is checked against all module observations including on read-only review", () => {
  for (const field of ["accessState", "vaultState", "journeyState"]) {
    const snapshot = structuredClone(initial());
    snapshot[field].lastObservedAt = 50;
    for (const operation of [
      { kind: "CHECK_NAVIGATION", target: target("root.example"), context: { contextId: "tab_a", journeyId: null } },
      { kind: "REVIEW_POLICY", proposalId: 1 },
    ]) {
      const result = plan(snapshot, 49, operation);
      assert.equal(result.result.reason, "CLOCK_ROLLBACK");
      assert.equal(result.observationSnapshot, null);
      assert.equal(result.candidateSnapshot, null);
    }
  }
});

test("Vault review remains read-only and proposal contents remain frozen", () => {
  const candidatePolicy = { whitelist: ["new.example"], blacklist: [] };
  const creation = plan(initial(), 0, { kind: "PROPOSE_POLICY", candidatePolicy });
  assert.deepEqual(creation.observationSnapshot.policy, initial().policy);
  assert.equal(creation.observationSnapshot.vaultState.pendingProposal, null);
  candidatePolicy.whitelist.push("later.example");
  const snapshot = creation.candidateSnapshot;
  const before = structuredClone(snapshot);
  const review = plan(snapshot, 10, { kind: "REVIEW_POLICY", proposalId: 1 });
  assert.equal(review.result.type, "REVIEW");
  assert.deepEqual(review.result.review.candidatePolicy.whitelist, ["new.example"]);
  assert.equal(review.observationSnapshot, null);
  assert.equal(review.candidateSnapshot, null);
  assert.deepEqual(snapshot, before);
});

test("Vault confirmation wraps latest Access and Journey activity into one aggregate candidate", () => {
  let snapshot = command(initial(), 0, {
    kind: "PROPOSE_POLICY", candidatePolicy: { whitelist: ["root.example", "new.example"], blacklist: ["other.example"] },
  });
  snapshot = withJourney(withGrant(snapshot, "other.example", 1), 12);
  snapshot = navigate(snapshot, 13, "intermediate.example", "tab_a", 1, true).candidateSnapshot;
  snapshot = command(snapshot, 14, { kind: "START_ACCESS", target: target("pending.example") });
  const before = structuredClone(snapshot);
  const result = plan(snapshot, 15, { kind: "CONFIRM_POLICY", proposalId: 1 });
  assert.equal(result.result.type, "POLICY_COMMIT_PREPARED");
  assert.equal(result.result.expectedPolicyRevision, 0);
  assert.deepEqual(snapshot, before);
  assert.equal(result.observationSnapshot.policyRevision, 0);
  assert.equal(result.observationSnapshot.vaultState.pendingProposal.id, 1);
  assert.equal(result.observationSnapshot.journeyState.journeys[0].phase, "IN_TRANSIT");
  const candidate = result.candidateSnapshot;
  assert.equal(validateAtlasSnapshot(candidate).ok, true);
  assert.equal(candidate.policyRevision, 1);
  assert.equal(candidate.vaultState.pendingProposal, null);
  assert.equal(candidate.accessState.policyRevision, 1);
  assert.deepEqual(candidate.accessState.grants, snapshot.accessState.grants);
  assert.deepEqual(candidate.accessState.pendingRequests, snapshot.accessState.pendingRequests);
  assert.equal(candidate.accessState.nextRequestId, snapshot.accessState.nextRequestId);
  assert.equal(candidate.journeyState.nextJourneyId, snapshot.journeyState.nextJourneyId);
  assert.equal(candidate.journeyState.journeys[0].hopCount, 1);
  assert.equal(candidate.journeyState.journeys[0].endReason, "POLICY_CHANGED");
  assert.equal(navigate(candidate, 15, "other.example", "tab_b").result.decision.reason, "BLACKLISTED");
  assert.equal(navigate(candidate, 15, "new.example", "tab_b").result.decision.reason, "WHITELISTED");
  assert.equal(navigate(candidate, 15, "pending.example", "tab_b").result.decision.reason, "POLICY_CHANGED");
  assert.equal(plan(candidate, 16, { kind: "CONFIRM_POLICY", proposalId: 1 }).result.reason, "ALREADY_COMMITTED");
  // Discarding a candidate models an unsuccessful save; nothing was applied to old authority.
  assert.equal(navigate(result.observationSnapshot, 16, "new.example", "tab_b").result.decision.outcome, "GREYLIST");
});

test("failed Vault confirmations prepare no policy and cancellation consumes only the proposal", () => {
  const snapshot = command(initial(), 0, {
    kind: "PROPOSE_POLICY", candidatePolicy: { whitelist: [], blacklist: [] },
  });
  for (const [state, now, reason] of [
    [snapshot, 9, "NOT_READY"], [snapshot, 60, "PROPOSAL_EXPIRED"],
    [{ ...snapshot, policyRevision: 1 }, 10, "POLICY_CHANGED"],
  ]) {
    const rejected = plan(state, now, { kind: "CONFIRM_POLICY", proposalId: 1 });
    assert.equal(rejected.result.reason, reason);
    assert.equal(rejected.candidateSnapshot, null);
    assert.deepEqual(rejected.observationSnapshot.policy, snapshot.policy);
  }
  const cancelled = command(snapshot, 10, { kind: "CANCEL_POLICY", proposalId: 1 });
  assert.equal(cancelled.vaultState.pendingProposal, null);
  assert.deepEqual(cancelled.policy, snapshot.policy);
  assert.equal(plan(cancelled, 11, { kind: "CONFIRM_POLICY", proposalId: 1 }).result.reason, "PROPOSAL_NOT_FOUND");
});

test("malformed operations cannot inject state, timing, confirmation contents or browser fields", () => {
  const operations = [
    null, {}, { kind: "UNSUPPORTED" },
    { kind: "OBSERVE_TIME", now: 0 },
    { kind: "CONFIRM_ACCESS", requestId: 1, grantDurationMs: 999 },
    { kind: "CONFIRM_POLICY", proposalId: 1, candidatePolicy: initial().policy },
    { kind: "START_JOURNEY", root: target("root.example"), contextId: "tab_a", trusted: true },
    { kind: "CHECK_NAVIGATION", target: target("root.example"), context: { contextId: "tab_a", journeyId: null, browserTab: 1 } },
    { kind: "START_ACCESS", target: "https://other.example" },
    { kind: "START_ACCESS", target: { hostname: "bad hostname" } },
  ];
  for (const operation of operations) {
    const result = plan(initial(), 1, operation);
    assert.equal(result.result.type, "REJECTED");
    assert.equal(result.candidateSnapshot, null);
    assert.deepEqual(result.observationSnapshot.accessState.grants, []);
  }
});

test("invalid planner context, configuration and time fail closed without replacement state", () => {
  for (const now of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    const result = navigate(initial(), now, "root.example");
    assert.equal(result.result.reason, "INVALID_TIME");
    assert.equal(result.observationSnapshot, null);
  }
  for (const config of [null, {}, { ...configuration, journeyLimits: { lifetimeMs: 0, maxHops: 1 } }]) {
    const result = plan(initial(), 0, { kind: "OBSERVE_TIME" }, config);
    assert.equal(result.result.reason, "INVALID_CONFIGURATION");
    assert.equal(result.observationSnapshot, null);
  }
  assert.equal(planAtlasOperation({ kind: "OBSERVE_TIME" }, null).result.reason, "INVALID_CONTEXT");
});

test("planner is deterministic, leaves inputs unfrozen, and returns detached frozen plans", () => {
  const snapshot = structuredClone(withJourney(withGrant(), 10));
  const config = structuredClone(configuration);
  const operation = { kind: "RECORD_JOURNEY_NAVIGATION", target: target("other.example"), context: { contextId: "tab_a", journeyId: 1 } };
  const before = structuredClone({ snapshot, config, operation });
  const first = plan(snapshot, 11, operation, config);
  assert.deepEqual(first, plan(snapshot, 11, operation, config));
  assert.deepEqual({ snapshot, config, operation }, before);
  assert.equal(Object.isFrozen(snapshot), false);
  assert.equal(Object.isFrozen(snapshot.journeyState.journeys[0]), false);
  assert.equal(Object.isFrozen(operation.target), false);
  assert.equal(Object.isFrozen(config), false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.candidateSnapshot.journeyState.journeys[0]), true);
  assert.equal(Object.isFrozen(first.result.decision.target), true);
  operation.target.hostname = "different.example";
  assert.equal(first.result.decision.target.hostname, "other.example");
});

test("serialized aggregate snapshots preserve frozen deadlines and consumed requests", () => {
  const snapshot = JSON.parse(JSON.stringify(withJourney(withGrant(), 10)));
  const result = navigate(snapshot, 110, "other.example", "tab_b");
  assert.equal(result.result.decision.reason, "GRANT_EXPIRED");
  assert.equal(result.observationSnapshot.accessState.grants[0].expiresAt, 110);
  assert.equal(result.observationSnapshot.journeyState.journeys[0].expiresAt, 210);
  assert.equal(plan(snapshot, 110, { kind: "CONFIRM_ACCESS", requestId: 1 }).result.reason, "REQUEST_NOT_FOUND");
});

test("invalid Journey state also blocks otherwise ready Access and Vault confirmations", () => {
  let snapshot = command(initial(), 0, { kind: "START_ACCESS", target: target("other.example") });
  snapshot = structuredClone(command(snapshot, 0, {
    kind: "PROPOSE_POLICY", candidatePolicy: { whitelist: ["new.example"], blacklist: [] },
  }));
  snapshot.journeyState.nextJourneyId = 0;
  for (const operation of [
    { kind: "CONFIRM_ACCESS", requestId: 1 },
    { kind: "CONFIRM_POLICY", proposalId: 1 },
    { kind: "REVIEW_POLICY", proposalId: 1 },
  ]) {
    const result = plan(snapshot, 10, operation);
    assert.equal(result.result.reason, "INVALID_JOURNEY_STATE");
    assert.equal(result.observationSnapshot, null);
    assert.equal(result.candidateSnapshot, null);
  }
});

test("an expired grant yields to a live Journey without renewing or reclassifying it", () => {
  const snapshot = withJourney(withGrant(), 10);
  const result = navigate(snapshot, 110, "other.example", "tab_a", 1, true);
  assert.equal(result.result.decision.reason, "ACTIVE_JOURNEY");
  assert.equal(result.result.decision.expiresAt, 210);
  assert.deepEqual(result.candidateSnapshot.accessState.grants, snapshot.accessState.grants);
  assert.deepEqual(result.candidateSnapshot.policy, snapshot.policy);
  assert.equal(result.candidateSnapshot.journeyState.journeys[0].hopCount, 1);
});

test("two active contexts keep independent Journey lifetimes, records and cancellation", () => {
  let snapshot = withJourney(withJourney(), 50, "tab_b");
  assert.equal(navigate(snapshot, 51, "other.example", "tab_b", 1).result.reason, "CONTEXT_MISMATCH");
  snapshot = navigate(snapshot, 51, "other.example", "tab_b", 2, true).candidateSnapshot;
  snapshot = command(snapshot, 52, { kind: "CANCEL_JOURNEY", journeyId: 1, contextId: "tab_a" });
  const result = navigate(snapshot, 200, "other.example", "tab_b", 2);
  assert.equal(result.result.decision.reason, "ACTIVE_JOURNEY");
  assert.equal(result.result.decision.expiresAt, 250);
  assert.equal(result.observationSnapshot.journeyState.journeys[0].endReason, "CANCELLED");
  assert.equal(result.observationSnapshot.journeyState.journeys[1].hopCount, 1);
});
