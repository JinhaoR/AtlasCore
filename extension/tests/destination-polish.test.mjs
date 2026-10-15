import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '@atlas/core';
import { commonWwwCounterpart, explicitDestinationHosts, destinationPolicyCandidate } from '../dist/lib/ui/destination-policy.js';
import { readDestinationPreferences, reconcileDestinationPreferences, replaceDestinationMetadata } from '../dist/lib/ui/destination-metadata.js';
import { destinationIndex, policyDestinationIndex } from '../dist/lib/ui/destinations.js';
import { destinationId, pinnedDestinations, updateDestinationPin } from '../dist/lib/ui/home-model.js';
import { rankDestinations, recordDestinationLaunch, readDestinationUsage, usageHalfLifeMs } from '../dist/lib/ui/destination-usage.js';
import { saveDestinationLaunch } from '../dist/lib/background/destination-usage.js';

test('PSL-aware optional www scope names exact terms without parent or wildcard inference', () => {
  for (const [input, counterpart] of [['example.com', 'www.example.com'], ['www.example.com', 'example.com'],
    ['example.co.uk', 'www.example.co.uk'], ['www.example.co.uk', 'example.co.uk'], ['student.ladok.se', null],
    ['www.student.ladok.se', null], ['co.uk', null], ['localhost', null], ['192.0.2.1', null],
    ['sub.example.co.uk', null], ['github.io', null], ['person.github.io', 'www.person.github.io']])
    assert.equal(commonWwwCounterpart(input), counterpart, input);
  assert.deepEqual(explicitDestinationHosts('example.com', true, ''), ['example.com', 'www.example.com']);
  assert.deepEqual(explicitDestinationHosts('www.example.com', false, ''), ['www.example.com']);
  assert.deepEqual(explicitDestinationHosts('student.ladok.se', true, ''), ['student.ladok.se']);
  assert.equal(explicitDestinationHosts('google.com', false, '*.google.com'), null);
  const policy = { whitelist: explicitDestinationHosts('google.com', true, ''), blacklist: [] };
  assert.equal(evaluate('mail.google.com', policy).outcome, 'GREYLIST');
});

test('destination proposals change only explicitly selected terms and never mutate active policy', () => {
  const policy = { whitelist: ['old.example', 'retained.example'], blacklist: ['blocked.example'] };
  const before = structuredClone(policy);
  const candidate = destinationPolicyCandidate(policy, ['old.example'], ['example.com', 'www.example.com'], 'WHITELIST');
  assert.deepEqual(policy, before);
  assert.deepEqual(candidate, { whitelist: ['retained.example', 'example.com', 'www.example.com'], blacklist: ['blocked.example'] });
  assert.equal(evaluate('example.com', policy).outcome, 'GREYLIST');
  const removal = destinationPolicyCandidate(policy, ['old.example'], [], 'WHITELIST');
  assert.deepEqual(removal.whitelist, ['retained.example']);
  const mixed = { whitelist: ['example.com', 'www.example.com'], blacklist: ['www.example.com'] };
  assert.equal(destinationPolicyCandidate(mixed, mixed.whitelist, [...mixed.whitelist].reverse(), 'PRESERVE'), mixed);
  assert.equal(destinationPolicyCandidate(mixed, ['example.com'], ['example.com', 'www.example.com'], 'PRESERVE'), null);
  assert.equal(destinationPolicyCandidate(mixed, ['example.com'], ['example.com'], 'UNSUPPORTED'), null);
});

const custom = { id: 'host:example.com', label: 'Example research', category: 'Scholar / Research',
  primaryHostname: 'example.com', hostnames: ['example.com', 'www.example.com'] };
const policy = { whitelist: custom.hostnames, blacklist: [] };
const preferences = { version: 1, destinations: [], pending: { proposalId: 7, basePolicyRevision: 1, candidatePolicy: policy,
  destination: custom, removedId: null, pin: true } };

test('metadata and pins activate only after a matching committed Vault policy; cancellation and stale commits do not apply', () => {
  const pending = { policy, policyRevision: 1, vaultState: { pendingProposal: { id: 7 }, lastApplied: null } };
  assert.equal(reconcileDestinationPreferences(preferences, pending).preferences, preferences);
  for (const [revision, lastApplied, candidate] of [[2, { proposalId: 8 }, policy], [3, { proposalId: 7 }, policy],
    [2, { proposalId: 7 }, { whitelist: [], blacklist: [] }], [1, null, policy]]) {
    const result = reconcileDestinationPreferences(preferences, { policy: candidate, policyRevision: revision, vaultState: { pendingProposal: null, lastApplied } });
    assert.equal(result.preferences.pending, null);
    assert.deepEqual(result.preferences.destinations, []);
    assert.equal(result.pinChange, null);
  }
  const committed = reconcileDestinationPreferences(preferences, { policy, policyRevision: 2,
    vaultState: { pendingProposal: null, lastApplied: { proposalId: 7 } } });
  assert.deepEqual(committed.preferences.destinations, [custom]);
  assert.deepEqual(committed.pinChange, { id: custom.id, pinned: true });
  const renamed = reconcileDestinationPreferences(preferences, { policy, policyRevision: 1,
    vaultState: { pendingProposal: null, lastApplied: { proposalId: 7 } } });
  assert.deepEqual(renamed.preferences.destinations, [custom], 'metadata-only Vault commit need not change exact policy revision');
});

test('legacy host pins resolve to the destination without changing explicit pin order', () => {
  const entries = destinationIndex({ whitelist: [...custom.hostnames, 'arxiv.org', 'github.com'], blacklist: [] }, [custom]);
  const old = ['service:arxiv.org', 'host:www.example.com', 'service:github.com'];
  assert.deepEqual(pinnedDestinations(entries, old).map(destinationId), ['service:arxiv.org', custom.id, 'service:github.com']);
  assert.deepEqual(updateDestinationPin(old, custom.id, true, custom.hostnames), ['service:arxiv.org', custom.id, 'service:github.com']);
  assert.deepEqual(updateDestinationPin(old, custom.id, false, custom.hostnames), ['service:arxiv.org', 'service:github.com']);
});

test('malformed metadata remains presentation-only and existing exact policy entries stay visible', () => {
  for (const input of [null, {}, { version: 9, destinations: [custom] }, { version: 1, destinations: [{ ...custom, hostnames: ['*.example.com'] }] }])
    assert.deepEqual(readDestinationPreferences(input), { version: 1, destinations: [], pending: null });
  const overlapping = { ...custom, id: 'host:alias.example', primaryHostname: 'www.example.com', hostnames: ['www.example.com'] };
  assert.deepEqual(readDestinationPreferences({ version: 1, destinations: [custom, overlapping], pending: null }), { version: 1, destinations: [], pending: null });
  assert.equal(readDestinationPreferences({ version: 1, destinations: [custom], pending: null }).destinations.length, 1);
  const saved = { whitelist: ['github.com', 'orphan.example'], blacklist: ['blocked.example', 'www.example.com'] };
  assert.ok(policyDestinationIndex(saved, [custom]).some(entry => entry.hostnames.includes('orphan.example')));
  assert.equal(destinationIndex({ whitelist: [], blacklist: [] }, [custom]).length, 0, 'metadata never supplies access');
  const retired = { ...custom, id: 'host:retired.example', primaryHostname: 'www.example.com', hostnames: ['www.example.com', 'retained.example'] };
  const reassigned = replaceDestinationMetadata([retired], custom, null);
  assert.deepEqual(reassigned[0].hostnames, ['retained.example']);
  assert.equal(reassigned[0].primaryHostname, 'retained.example');
  assert.deepEqual(retired.hostnames, ['www.example.com', 'retained.example']);
  assert.equal(readDestinationPreferences({ version: 1, destinations: reassigned, pending: null }).destinations.length, 2);
  assert.deepEqual(destinationIndex(saved, [custom]).find(entry => entry.id === custom.id), undefined, 'denied custom alias cannot appear on Home');
});

test('usage decays deterministically, aliases share an identity, and explicit pins keep their order', () => {
  const entries = destinationIndex({ whitelist: ['github.com', 'www.github.com', 'arxiv.org', 'example.com', 'www.example.com'], blacklist: [] }, [custom]);
  assert.deepEqual(rankDestinations(entries, {}, 0), entries);
  const customEntry = entries.find(entry => entry.id === custom.id);
  let usage = recordDestinationLaunch({}, destinationId(customEntry), 0);
  assert.equal(rankDestinations(entries, usage, 0)[0].id, custom.id);
  assert.equal(destinationId(destinationIndex({ whitelist: ['www.example.com'], blacklist: [] }, [custom])[0]), custom.id);
  usage = recordDestinationLaunch(usage, 'service:github.com', usageHalfLifeMs * 4);
  assert.equal(rankDestinations(entries, usage, usageHalfLifeMs * 4)[0].label, 'GitHub');
  const pins = ['service:arxiv.org', custom.id, 'service:github.com'];
  assert.deepEqual(pinnedDestinations(rankDestinations(entries, usage, usageHalfLifeMs * 4), pins).map(destinationId), pins);
  assert.deepEqual(readDestinationUsage({ [custom.id]: { count: -1, score: 1, lastOpenedAt: 0 } }), {});
  assert.deepEqual(rankDestinations(entries, usage, usageHalfLifeMs * 4), rankDestinations(entries, usage, usageHalfLifeMs * 4));
});

test('local usage persistence groups reviewed aliases and ignores unknown and denied terms', () => {
  const saved = new Map([['atlas-destinations-v1', JSON.stringify({ version: 1, destinations: [custom], pending: null })]]);
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  saveDestinationLaunch(storage, policy, 'example.com', 1000);
  saveDestinationLaunch(storage, policy, 'www.example.com', 2000);
  saveDestinationLaunch(storage, policy, 'intermediate.example', 3000);
  saveDestinationLaunch(storage, { ...policy, blacklist: ['example.com'] }, 'example.com', 4000);
  const usage = JSON.parse(saved.get('atlas-destination-usage-v1'));
  assert.equal(usage[custom.id].count, 2);
  assert.equal(Object.keys(usage).length, 1);
});
