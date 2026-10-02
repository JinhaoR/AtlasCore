import test from 'node:test';
import assert from 'node:assert/strict';
import { destinationIndex } from '../dist/lib/ui/destinations.js';
import { destinationEntryPoints, destinationId, pinnedDestinations, readPins } from '../dist/lib/ui/home-model.js';

test('pins organize only effective active destinations and cannot resurrect Blacklist or removed hosts', () => {
  const policy = { whitelist: ['github.com', 'www.github.com', 'canvas.kth.se', 'custom.example'], blacklist: ['canvas.kth.se'] };
  const before = structuredClone(policy);
  const pins = ['service:canvas.kth.se', 'host:missing.example', 'host:custom.example', 'service:github.com'];
  assert.deepEqual(pinnedDestinations(destinationIndex(policy), pins).map((entry) => entry.label), ['custom.example', 'GitHub']);
  const aliasOnly = destinationIndex({ whitelist: ['www.github.com'], blacklist: [] });
  assert.equal(destinationId(aliasOnly[0]), 'service:github.com');
  assert.equal(pinnedDestinations(aliasOnly, pins)[0].hostname, 'www.github.com');
  assert.deepEqual(pinnedDestinations([], pins), []);
  assert.deepEqual(policy, before);
});

test('destination cards retain distinct active entry points without treating aliases as new services', () => {
  const policy = { whitelist: ['outlook.com', 'www.outlook.com', 'outlook.live.com', 'outlook.office.com'], blacklist: ['outlook.office.com'] };
  const entries = destinationIndex(policy);
  assert.equal(entries.length, 1);
  assert.deepEqual(destinationEntryPoints(entries[0]), ['outlook.com', 'outlook.live.com']);
  assert.deepEqual(destinationEntryPoints(destinationIndex({ whitelist: ['www.outlook.com'], blacklist: [] })[0]), ['www.outlook.com']);
  assert.deepEqual(destinationEntryPoints(destinationIndex({ whitelist: ['only.example'], blacklist: [] })[0]), ['only.example']);
});

test('damaged pin preferences produce an empty presentation list without initializing authorization', () => {
  for (const value of [null, {}, 'service:github.com', ['https://example.com/private'], [12], ['host:UPPER.example'], Array(201).fill('host:a.example')])
    assert.deepEqual(readPins(value), []);
  const valid = ['service:github.com', 'host:custom.example', 'service:github.com'];
  assert.deepEqual(readPins(valid), ['service:github.com', 'host:custom.example']);
  assert.equal(valid.length, 3);
});
