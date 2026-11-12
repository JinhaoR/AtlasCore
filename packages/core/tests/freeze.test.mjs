import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeVaultData } from '../dist/vault-state.js';
import { validateAtlasSnapshot, createAccessState, createVaultState, createJourneyState } from '../dist/index.js';

test('freezing a shared owned graph preserves identity and freezes every descendant', () => {
  const child = { values: [1, { name: 'a' }] }, first = freezeVaultData({ child });
  assert.equal(freezeVaultData(first), first);
  const second = freezeVaultData({ first, child });
  assert.equal(second.child, first.child);
  for (const value of [second, first, child, child.values, child.values[1]]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { child.values[1].name = 'changed'; }, TypeError);
});

test('a shallow external freeze never substitutes for a complete owned freeze', () => {
  const child = { values: [1, 2] }, parent = Object.freeze({ child });
  freezeVaultData(parent);
  assert.ok(Object.isFrozen(child)); assert.ok(Object.isFrozen(child.values));
});

test('deep freezing is not validation: previously frozen invalid snapshots still fail', () => {
  const configuration = { accessTiming: { waitMs: 10, confirmationWindowMs: 20, grantDurationMs: 30 },
    vaultTiming: { waitMs: 10, confirmationWindowMs: 20 }, journeyLimits: { lifetimeMs: 30, maxHops: 3 } };
  const snapshot = { policy: { whitelist: ['root.example'], blacklist: [] }, policyRevision: 0, configuration,
    configurationRevision: 0, accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState() };
  assert.equal(validateAtlasSnapshot(freezeVaultData(snapshot)).ok, true);
  const invalid = freezeVaultData({ ...snapshot, accessState: { ...snapshot.accessState, nextRequestId: 0 } });
  assert.equal(validateAtlasSnapshot(invalid).ok, false);
  const copy = structuredClone(snapshot); copy.policy.whitelist.push('bad/host');
  assert.equal(validateAtlasSnapshot(copy).ok, false);
  assert.deepEqual(snapshot.policy.whitelist, ['root.example']);
});
