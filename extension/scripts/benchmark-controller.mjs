// Synthetic, in-memory measurement. Never opens Firefox or production storage.
// node extension/scripts/benchmark-controller.mjs packages/core/dist output.json
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

if (process.argv.length !== 4) throw Error('Expected Core dist directory and result path');
const core = await import(pathToFileURL(resolve(process.argv[2], 'index.js')));
const configuration = {
  accessTiming: { waitMs: 10, confirmationWindowMs: 100, grantDurationMs: 200 },
  vaultTiming: { waitMs: 20, confirmationWindowMs: 100 }, journeyLimits: { lifetimeMs: 200, maxHops: 12 },
};
const results = [];
for (const count of [0, 2500]) {
  let time = 100000, version = 0;
  const snapshot = {
    policy: { whitelist: ['root.example'], blacklist: ['black.example'] }, policyRevision: 1,
    configuration, configurationRevision: 0, accessState: core.createAccessState(), vaultState: core.createVaultState(),
    journeyState: { journeys: Array.from({ length: count }, (_, i) => ({
      id: i + 1, contextId: `history_${i}`, rootHostname: 'root.example', currentHostname: 'root.example',
      startedAt: 1, expiresAt: 100, hopCount: 0, maxHops: 12, policyRevision: 0,
      phase: 'ENDED', endedAt: 2, endReason: 'REACHED',
    })), nextJourneyId: count + 1, lastObservedAt: 1000, policyRevision: 1 },
  };
  let envelope = { schemaVersion: 2, storageVersion: 'v0', lastCommitId: null, snapshot };
  const repository = {
    async load() { return { type: 'READY', envelope: structuredClone(envelope) }; },
    async commit(request) {
      envelope = { ...structuredClone(request.next), storageVersion: `v${++version}`, lastCommitId: request.commitId };
      return { type: 'COMMITTED', commitId: request.commitId, storageVersion: envelope.storageVersion };
    },
    async resolveCommit() { throw Error('Unexpected reconciliation in benchmark'); },
  };
  const controller = core.createAtlasController({ repository, clock: { now: () => time }, configuration, ownerId: 'benchmark' });
  await controller.open();
  const samples = [], views = [], values = Object.values;
  let visits = 0;
  // Counts repeated Object.values traversals, not all processing or allocations.
  Object.values = function (value) { visits++; return values(value); };
  try {
    for (let i = 0; i < 25; i++) {
      time++;
      const start = performance.now();
      const result = await controller.handle({ kind: 'CHECK_NAVIGATION', target: { hostname: 'root.example' }, context: { contextId: 'tab', journeyId: null } });
      if (result.decision?.outcome !== 'ALLOW') throw Error('Benchmark permission failed');
      if (i >= 5) samples.push(performance.now() - start);
    }
    const handleVisits = visits; visits = 0;
    for (let i = 0; i < 100; i++) {
      const start = performance.now(); controller.getView(); views.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b); views.sort((a, b) => a - b);
    results.push({ history: count, handleMedianMs: samples[10], handleObjectWalks: handleVisits / 25,
      viewMedianMs: views[50], viewObjectWalks: visits / 100 });
  } finally { Object.values = values; }
}
writeFileSync(process.argv[3], JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
