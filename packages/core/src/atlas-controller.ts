import { nonnegativeInteger, positiveInteger } from "./access-state.js";
import type { AtlasPlanResult, AtlasSnapshot } from "./atlas-models.js";
import { planAtlasOperation, readConfiguration } from "./atlas-planner.js";
import type {
  AtlasController, AtlasControllerError, AtlasControllerOptions, AtlasControllerResponse,
  AtlasControllerStatus, AtlasControllerView,
} from "./atlas-controller-models.js";
import type { AtlasCommitResult, AtlasEnvelope } from "./atlas-ports.js";
import { validateAtlasSnapshot } from "./atlas-state.js";
import { hasJourneyFields, validContextId } from "./journey-state.js";
import { freezeVaultData } from "./vault-state.js";
import { isManagedBlacklist, type ManagedBlacklist } from "./managed-blacklist.js";

function token(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
}

function readEnvelope(value: unknown): AtlasEnvelope | null {
  if (!hasJourneyFields(value, ["schemaVersion", "storageVersion", "lastCommitId", "snapshot"])
    || value.schemaVersion !== 1 || !token(value.storageVersion)
    || (value.lastCommitId !== null && !token(value.lastCommitId))) return null;
  const validated = validateAtlasSnapshot(value.snapshot);
  return validated.ok ? freezeVaultData({ schemaVersion: 1, storageVersion: value.storageVersion,
    lastCommitId: value.lastCommitId, snapshot: validated.snapshot }) : null;
}

function readReceipt(input: unknown, commitId: string, resolving = false): AtlasCommitResult | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.type === "COMMITTED") {
    if (!hasJourneyFields(value, ["type", "commitId", "storageVersion"])
      || value.commitId !== commitId || !token(value.storageVersion)) return null;
    return { type: "COMMITTED", commitId, storageVersion: value.storageVersion };
  }
  if (value.type !== "NOT_WRITTEN" && value.type !== "UNKNOWN"
    && !(value.type === "CONFLICT" && !resolving)) return null;
  return hasJourneyFields(value, ["type", "commitId"]) && value.commitId === commitId
    ? { type: value.type, commitId } : null;
}

// Values have fixed validated shapes and contain only domain data.
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameEnvelope(left: AtlasEnvelope, right: AtlasEnvelope): boolean {
  return left.storageVersion === right.storageVersion && left.lastCommitId === right.lastCommitId
    && same(left.snapshot, right.snapshot);
}

function rolledBack(next: AtlasSnapshot, prior: AtlasSnapshot): boolean {
  return next.policyRevision < prior.policyRevision
    || next.accessState.nextRequestId < prior.accessState.nextRequestId
    || next.vaultState.nextProposalId < prior.vaultState.nextProposalId
    || next.journeyState.nextJourneyId < prior.journeyState.nextJourneyId
    || (["accessState", "vaultState", "journeyState"] as const).some((key) =>
      next[key].lastObservedAt < prior[key].lastObservedAt || next[key].policyRevision < prior[key].policyRevision);
}

/** One trusted owner. All domain decisions still come from the pure planner. */
export function createAtlasController(options: AtlasControllerOptions): AtlasController {
  const configuration = readConfiguration(options.configuration);
  if (configuration === null || !validContextId(options.ownerId)
    || typeof options.repository?.load !== "function" || typeof options.repository?.commit !== "function"
    || typeof options.repository?.resolveCommit !== "function" || typeof options.clock?.now !== "function"
    || (options.managedBlacklist !== undefined && typeof options.managedBlacklist !== "function")) {
    throw new TypeError("Invalid Atlas controller dependencies");
  }
  const { repository, clock, ownerId } = options;
  freezeVaultData(configuration);
  let authority: AtlasEnvelope | null = null;
  let status: AtlasControllerStatus = "UNINITIALIZED";
  let reason: AtlasControllerError | null = "NOT_OPEN";
  let timeFloor = 0;
  let sequence = 0;
  let pending: { commitId: string; expectedStorageVersion: string | null; snapshot: AtlasSnapshot | null } | null = null;
  let resolvedCommit: { commitId: string; storageVersion: string;
    priorVersion: string | null; snapshot: AtlasSnapshot | null } | null = null;
  let queue: Promise<void> = Promise.resolve();

  function setStatus(next: AtlasControllerStatus, issue: AtlasControllerError | null = null): void {
    status = next;
    reason = issue;
  }

  function getView(): AtlasControllerView {
    return freezeVaultData({ status, reason, snapshot: authority?.snapshot ?? null,
      storageVersion: authority?.storageVersion ?? null, pendingCommitId: pending?.commitId ?? null });
  }

  function blocked(issue = reason ?? "NOT_READY"): AtlasControllerResponse {
    return Object.freeze({ type: "BLOCKED", reason: issue, status, pendingCommitId: pending?.commitId ?? null });
  }

  function fault(): void {
    setStatus(pending ? "RECONCILING" : "UNAVAILABLE", pending ? "COMMIT_UNKNOWN" : "INTERNAL_ERROR");
  }

  function sampleManaged(): ManagedBlacklist | undefined | null {
    if (options.managedBlacklist === undefined) return undefined;
    try {
      const value = options.managedBlacklist();
      if (isManagedBlacklist(value)) return value;
    } catch { /* Unavailable managed authority fails closed. */ }
    setStatus("UNAVAILABLE", "MANAGED_BLACKLIST_UNAVAILABLE");
    return null;
  }

  function context(snapshot: AtlasSnapshot, now: number, managed: ManagedBlacklist | undefined) {
    return { snapshot, now, configuration, ...(managed === undefined ? {} : { managedBlacklist: managed }) };
  }

  function enqueue<T>(work: () => Promise<T>, failed: () => T): Promise<T> {
    const next = queue.then(work).catch(() => { fault(); return failed(); });
    queue = next.then(() => undefined);
    return next;
  }

  function sampleTime(): number | null {
    let now: unknown;
    try { now = clock.now(); } catch {
      setStatus("UNAVAILABLE", "CLOCK_UNAVAILABLE");
      return null;
    }
    if (!nonnegativeInteger(now)) { setStatus("UNAVAILABLE", "INVALID_TIME"); return null; }
    const snapshot = authority?.snapshot;
    const minimum = Math.max(timeFloor, snapshot?.accessState.lastObservedAt ?? 0,
      snapshot?.vaultState.lastObservedAt ?? 0, snapshot?.journeyState.lastObservedAt ?? 0);
    if (now < minimum) { setStatus("UNAVAILABLE", "CLOCK_ROLLBACK"); return null; }
    timeFloor = now;
    return now;
  }

  async function loadAuthority(expected?: AtlasEnvelope): Promise<boolean> {
    let loaded: unknown;
    try { loaded = await repository.load(); } catch {
      setStatus("UNAVAILABLE", "STORAGE_UNAVAILABLE"); return false;
    }
    if (hasJourneyFields(loaded, ["type", "commitId"]) && loaded.type === "UNRESOLVED" && token(loaded.commitId)) {
      pending = { commitId: loaded.commitId, expectedStorageVersion: null, snapshot: null };
      setStatus("RECONCILING", "COMMIT_UNKNOWN"); return false;
    }
    if (hasJourneyFields(loaded, ["type"]) && loaded.type === "UNINITIALIZED") {
      setStatus(authority === null ? "UNINITIALIZED" : "UNAVAILABLE",
        authority === null ? "UNINITIALIZED" : "CORRUPT_STATE"); return false;
    }
    if (hasJourneyFields(loaded, ["type"]) && loaded.type === "UNAVAILABLE") {
      setStatus("UNAVAILABLE", "STORAGE_UNAVAILABLE"); return false;
    }
    const envelope = hasJourneyFields(loaded, ["type", "envelope"]) && loaded.type === "READY"
      ? readEnvelope(loaded.envelope) : null;
    if (envelope === null) { setStatus("UNAVAILABLE", "CORRUPT_STATE"); return false; }
    if (resolvedCommit !== null) {
      const proof = resolvedCommit;
      if (envelope.storageVersion === proof.priorVersion
        || (envelope.storageVersion === proof.storageVersion
          && (envelope.lastCommitId !== proof.commitId
            || (proof.snapshot !== null && !same(envelope.snapshot, proof.snapshot))))) {
        setStatus("UNAVAILABLE", "CORRUPT_STATE"); return false;
      }
    }
    if (authority !== null) {
      if (rolledBack(envelope.snapshot, authority.snapshot)) {
        setStatus("UNAVAILABLE", "STORAGE_ROLLBACK"); return false;
      }
      if (envelope.storageVersion === authority.storageVersion && !sameEnvelope(envelope, authority)) {
        setStatus("UNAVAILABLE", "CORRUPT_STATE"); return false;
      }
    }
    authority = envelope;
    if (expected !== undefined && !sameEnvelope(envelope, expected)) {
      setStatus("RECONCILING", "AUTHORITY_CHANGED"); return false;
    }
    resolvedCommit = null;
    return true;
  }

  async function resolvePending(): Promise<boolean> {
    if (pending === null) return true;
    const attempt = pending;
    setStatus("RECONCILING", "COMMIT_UNKNOWN");
    let receipt: AtlasCommitResult | null;
    try { receipt = readReceipt(await repository.resolveCommit(attempt.commitId), attempt.commitId, true); }
    catch { return false; }
    if (receipt === null || receipt.type === "UNKNOWN"
      || (receipt.type === "COMMITTED" && receipt.storageVersion === attempt.expectedStorageVersion)) return false;
    if (receipt.type === "COMMITTED") {
      resolvedCommit = { commitId: attempt.commitId, storageVersion: receipt.storageVersion,
        priorVersion: attempt.expectedStorageVersion, snapshot: attempt.snapshot };
    }
    pending = null;
    return true;
  }

  async function save(snapshot: AtlasSnapshot): Promise<boolean> {
    if (authority === null) { setStatus("UNAVAILABLE", "INTERNAL_ERROR"); return false; }
    if (!positiveInteger(sequence + 1)) { setStatus("UNAVAILABLE", "ID_EXHAUSTED"); return false; }
    const validated = validateAtlasSnapshot(snapshot);
    if (!validated.ok) { setStatus("UNAVAILABLE", "CORRUPT_STATE"); return false; }
    const expectedStorageVersion = authority.storageVersion;
    const commitId = `${ownerId}:${++sequence}`;
    const next = freezeVaultData({ schemaVersion: 1 as const, snapshot: validated.snapshot });
    pending = { commitId, expectedStorageVersion, snapshot: validated.snapshot };
    setStatus("COMMITTING");
    let receipt: AtlasCommitResult | null;
    try { receipt = readReceipt(await repository.commit({ expectedStorageVersion, commitId, next }), commitId); }
    catch { receipt = null; }
    if (receipt === null || receipt.type === "UNKNOWN"
      || (receipt.type === "COMMITTED" && receipt.storageVersion === expectedStorageVersion)) {
      setStatus("RECONCILING", "COMMIT_UNKNOWN"); return false;
    }
    pending = null;
    if (receipt.type === "NOT_WRITTEN") { setStatus("UNAVAILABLE", "WRITE_FAILED"); return false; }
    if (receipt.type === "CONFLICT") {
      setStatus("RECONCILING", "STORAGE_CONFLICT");
      await loadAuthority(); // Refresh for recovery; never replay this operation.
      return false;
    }
    const committed = freezeVaultData({ ...next, storageVersion: receipt.storageVersion, lastCommitId: commitId });
    authority = committed; // The receipt confirms this complete write; no candidate was published earlier.
    return loadAuthority(committed);
  }

  async function open(): Promise<AtlasControllerView> {
    if (status === "READY") return getView();
    if (!await resolvePending()) return getView();
    setStatus("LOADING");
    if (!await loadAuthority() || authority === null) return getView();
    const now = sampleTime();
    if (now === null) return getView();
    const managed = sampleManaged();
    if (managed === null) return getView();
    const observed = planAtlasOperation({ kind: "OBSERVE_TIME" }, context(authority.snapshot, now, managed));
    let recovery = observed.observationSnapshot;
    if (recovery === null) { setStatus("UNAVAILABLE", "CORRUPT_STATE"); return getView(); }
    for (const journey of recovery.journeyState.journeys) {
      if (journey.phase === "ENDED") continue;
      const closed = planAtlasOperation({ kind: "CLOSE_JOURNEY_CONTEXT", journeyId: journey.id,
        contextId: journey.contextId }, context(recovery, now, managed));
      if (closed.candidateSnapshot === null) { setStatus("UNAVAILABLE", "CORRUPT_STATE"); return getView(); }
      recovery = closed.candidateSnapshot;
    }
    if (!same(recovery, authority.snapshot) && !await save(recovery)) return getView();
    if (sampleTime() === null) return getView();
    setStatus("READY");
    return getView();
  }

  function publish(result: AtlasPlanResult, now: number): AtlasControllerResponse {
    if (authority === null) return blocked("NOT_READY");
    const version = { policyRevision: authority.snapshot.policyRevision,
      storageVersion: authority.storageVersion, observedAt: now };
    switch (result.type) {
      case "TRANSITION_PREPARED":
        return freezeVaultData({ type: "COMMITTED", operation: result.operation, referenceId: result.id, ...version });
      case "POLICY_COMMIT_PREPARED":
        return freezeVaultData({ type: "COMMITTED", operation: "CONFIRM_POLICY", referenceId: result.proposalId, ...version });
      default:
        return freezeVaultData({ ...result, ...version });
    }
  }

  async function handle(operation: unknown): Promise<AtlasControllerResponse> {
    if (status !== "READY") return blocked();
    setStatus("LOADING");
    if (!await loadAuthority() || authority === null) return blocked();
    const now = sampleTime();
    if (now === null) return blocked();
    const managed = sampleManaged();
    if (managed === null) return blocked();
    const plan = planAtlasOperation(operation, context(authority.snapshot, now, managed));
    const next = plan.candidateSnapshot ?? plan.observationSnapshot;
    if (next !== null && (plan.candidateSnapshot !== null || !same(next, authority.snapshot))) {
      if (!await save(next)) return blocked();
    }
    const finalTime = sampleTime();
    if (finalTime === null) return blocked();
    setStatus("READY");
    const currentManaged = sampleManaged();
    if (currentManaged === null) return blocked();
    if (currentManaged !== managed) return blocked("REEVALUATION_REQUIRED");
    if (plan.result.type === "ASSESSMENT" && plan.result.decision.outcome === "ALLOW"
      && "expiresAt" in plan.result.decision && finalTime >= plan.result.decision.expiresAt) {
      return blocked("REEVALUATION_REQUIRED");
    }
    return publish(plan.result, now);
  }

  return Object.freeze({
    open: () => enqueue(open, getView),
    handle: (operation: unknown) => {
      let captured: unknown;
      try { captured = structuredClone(operation); } catch { captured = null; }
      return enqueue(() => handle(captured), () => blocked());
    },
    getView,
  });
}
