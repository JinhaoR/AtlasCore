/** Controllable test double. No filesystem or actual durability claims. */
export class FakeRepository {
  constructor(snapshot) {
    this.version = 0;
    this.envelope = snapshot === null ? null : {
      schemaVersion: 2, storageVersion: "v0", lastCommitId: null, snapshot: structuredClone(snapshot),
    };
    this.commits = [];
    this.loads = 0;
    this.resolutions = [];
    this.steps = [];
    this.outcomes = new Map();
    this.unsettled = new Set();
    this.inFlight = new Set();
    this.unavailable = false;
    this.loadHook = null;
  }

  async load() {
    this.loads++;
    if (this.loadHook) return this.loadHook();
    if (this.unavailable) return { type: "UNAVAILABLE" };
    if (this.inFlight.size) return { type: "UNRESOLVED", commitId: this.inFlight.values().next().value };
    if (this.unsettled.size) return { type: "UNRESOLVED", commitId: this.unsettled.values().next().value };
    return this.envelope === null ? { type: "UNINITIALIZED" }
      : { type: "READY", envelope: structuredClone(this.envelope) };
  }

  async commit(request) {
    if (this.outcomes.has(request.commitId)) throw new Error("Test attempted to reuse a commit ID");
    this.commits.push(structuredClone(request));
    const step = this.steps.shift();
    this.inFlight.add(request.commitId);
    try {
      return await (step ? step(request, this) : this.apply(request));
    } finally {
      this.inFlight.delete(request.commitId);
    }
  }

  apply(request) {
    if (request.expectedStorageVersion !== this.envelope?.storageVersion || this.unsettled.size) {
      this.outcomes.set(request.commitId, { type: "NOT_WRITTEN", commitId: request.commitId });
      return { type: "CONFLICT", commitId: request.commitId };
    }
    this.envelope = {
      ...structuredClone(request.next), storageVersion: `v${++this.version}`, lastCommitId: request.commitId,
    };
    const receipt = { type: "COMMITTED", commitId: request.commitId, storageVersion: this.envelope.storageVersion };
    this.outcomes.set(request.commitId, receipt);
    return receipt;
  }

  fail(request) {
    const receipt = { type: "NOT_WRITTEN", commitId: request.commitId };
    this.outcomes.set(request.commitId, receipt);
    return receipt;
  }

  unknown(request, applied, throws = false) {
    if (applied) this.apply(request);
    else this.fail(request);
    this.unsettled.add(request.commitId);
    if (throws) throw new Error("Synthetic lost acknowledgement");
    return { type: "UNKNOWN", commitId: request.commitId };
  }

  settle(commitId) { this.unsettled.delete(commitId); }

  async resolveCommit(commitId) {
    this.resolutions.push(commitId);
    return this.inFlight.has(commitId) || this.unsettled.has(commitId) || !this.outcomes.has(commitId)
      ? { type: "UNKNOWN", commitId } : structuredClone(this.outcomes.get(commitId));
  }

  /** Simulate a different writer, outside this owner's queue. */
  replace(snapshot) {
    this.envelope = { schemaVersion: 2, storageVersion: `v${++this.version}`,
      lastCommitId: `external:${this.version}`, snapshot: structuredClone(snapshot) };
  }
}

export function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
