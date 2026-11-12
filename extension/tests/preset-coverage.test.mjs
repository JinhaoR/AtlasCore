import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresetCoverage } from '../dist/lib/ui/settings-model.js';

test('preset summary follows exact rules, manual denial and deliberate scopes without modifying policy', () => {
  const summary = createPresetCoverage(['su.se', 'child.su.se', 'blocked.su.se', 'unlisted.example']);
  const policy = { whitelist: ['su.se'], blacklist: ['blocked.su.se'] }, before = structuredClone(policy);
  assert.deepEqual(summary(undefined), ['su.se', 'child.su.se', 'blocked.su.se', 'unlisted.example']);
  assert.deepEqual(summary(policy), ['child.su.se', 'blocked.su.se', 'unlisted.example']);
  assert.deepEqual(policy, before);
  policy.whitelistSubdomains = ['su.se'];
  assert.deepEqual(summary(policy), ['blocked.su.se', 'unlisted.example']);
  policy.blacklist.push('su.se');
  assert.deepEqual(summary(policy), ['su.se', 'blocked.su.se', 'unlisted.example']);
  assert.deepEqual(summary({ whitelist: ['*.invalid.example'], blacklist: [] }), ['su.se', 'child.su.se', 'blocked.su.se', 'unlisted.example']);
});

test('unchanged policy contents reuse display coverage across repeated observations without reevaluating every host', () => {
  const hosts = Array.from({ length: 100 }, (_, i) => `service-${i}.example`);
  let reads = 0;
  const policy = { get whitelist() { reads++; return [hosts[0]]; }, blacklist: [] };
  const summary = createPresetCoverage(hosts), first = summary(policy), initialReads = reads;
  assert.equal(first.length, 99); assert.ok(Object.isFrozen(first));
  for (let i = 0; i < 40; i++) assert.equal(summary(policy), first);
  assert.equal(reads - initialReads, 40, 'only serialize once per render; do not validate 100 whole policies again');
  assert.equal(summary({ whitelist: [hosts[0]], blacklist: [] }), first, 'a new observation object with identical terms stays cheap');
  assert.notEqual(summary({ whitelist: [hosts[1]], blacklist: [] }), first, 'changed terms must refresh the display');
});

test('missing authority restores a missing-coverage label and cached terms carry no mutable authority', () => {
  const hosts = ['su.se'], summary = createPresetCoverage(hosts);
  hosts.push('outside.example');
  assert.deepEqual(summary({ whitelist: ['su.se'], blacklist: [] }), []);
  assert.deepEqual(summary(undefined), ['su.se']);
  assert.throws(() => summary(undefined).push('injected.example'), TypeError);
  assert.deepEqual(summary({ whitelist: [], blacklist: [] }), ['su.se']);
});
