import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateMany } from '../dist/index.js';

test('batch evaluation exactly matches individual decisions, including invalid policy and targets', () => {
  const targets = ['example.org', 'EXAMPLE.org/path', 'https://www.example.org/x', 'child.example.org',
    'deep.child.example.org', 'bad.example.org', 'notexample.org', 'unknown.test', '*', null, {}, { hostname: 'example.org' }];
  for (const policy of [null, {}, { whitelist: ['*'], blacklist: [] },
    { whitelist: ['example.org', 'bad.example.org'], blacklist: ['bad.example.org'] },
    { whitelist: [], blacklist: ['bad.example.org'], whitelistSubdomains: ['example.org', 'child.example.org'] }]) {
    const before = structuredClone({ policy, targets });
    assert.deepEqual(evaluateMany(targets, policy), targets.map(target => evaluate(target, policy)));
    assert.deepEqual({ policy, targets }, before);
  }
});

test('batch results retain no policy authority across edits and do not share mutable decisions', () => {
  const policy = { whitelist: ['example.org'], blacklist: [] };
  const first = evaluateMany(['example.org', 'example.org'], policy);
  first[0].target.hostname = 'changed.test';
  assert.equal(first[1].target.hostname, 'example.org');
  policy.blacklist.push('example.org');
  assert.equal(evaluateMany(['example.org'], policy)[0].reason, 'BLACKLISTED');
  assert.deepEqual(evaluateMany([], null), []);
});
