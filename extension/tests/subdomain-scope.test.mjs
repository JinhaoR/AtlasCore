import test from 'node:test';
import assert from 'node:assert/strict';
import { compileManagedBlacklist, evaluate } from '@atlas/core';
import { canUseSubdomainScope, subdomainScopeDescription } from '../dist/lib/ui/subdomain-scope.js';
import { destinationIndex, policyDestinationIndex, searchDestinationTargets } from '../dist/lib/ui/destinations.js';
import { destinationId, pinnedDestinations } from '../dist/lib/ui/home-model.js';
import { fixture } from './support/fixture.mjs';
import { saveDestinationLaunch } from '../dist/lib/background/destination-usage.js';
import { usagePreferencesKey } from '../dist/lib/ui/destination-usage.js';

test('scope presentation rejects public/private suffixes and malformed hosts, but accepts registered and deeper bases', () => {
  for (const host of ['com', 'se', 'co.uk', 'github.io', 'blogspot.com', 's3.amazonaws.com', 'localhost', '*.su.se',
    'https://su.se', '127.0.0.1', 'su.se/path', 'not a domain']) assert.equal(canUseSubdomainScope(host), false, host);
  for (const host of ['su.se', 'courses.su.se', 'deep.courses.su.se', 'example.co.uk', 'alice.github.io', 'alice.blogspot.com',
    'bucket.s3.amazonaws.com', ' SU.SE. ']) assert.equal(canUseSubdomainScope(host), true, host);
});

test('scope description discloses every current/future child without creating a permission', () => {
  const copy = subdomainScopeDescription('SU.SE');
  assert.match(copy, /su\.se/); assert.match(copy, /every current or future subdomain at any depth/);
  assert.match(copy, /Manual and managed blocking/);
  assert.match(subdomainScopeDescription('co.uk'), /co\.uk is a public suffix/);
  assert.match(subdomainScopeDescription('github.io'), /github\.io is a shared hosting suffix/);
  assert.match(subdomainScopeDescription('github.io'), /your-site\.github\.io/);
  assert.match(subdomainScopeDescription('https://su.se'), /without https:\/\/ or a path/);
  assert.equal(evaluate('child.su.se', { whitelist: [], blacklist: [] }).outcome, 'GREYLIST');
});

test('Home indexes only declared scope bases, retains pins and exact search targets, and never invents children', () => {
  const policy = { whitelist: ['github.com'], blacklist: [], whitelistSubdomains: ['su.se', 'courses.example.org'] };
  const before = structuredClone(policy), entries = destinationIndex(policy);
  const su = entries.find(entry => entry.hostnames.includes('su.se'));
  assert.ok(su); assert.equal(su.hostname, 'su.se');
  assert.ok(entries.some(entry => entry.hostname === 'courses.example.org'));
  assert.equal(entries.some(entry => entry.hostnames.includes('fysik.su.se')), false);
  assert.equal(searchDestinationTargets(entries, 'fysik.su.se').length, 0, 'a child needs its ordinary navigation, not a fabricated card');
  assert.equal(searchDestinationTargets(entries, 'su.se')[0].hostname, 'su.se');
  assert.deepEqual(pinnedDestinations(entries, [destinationId(su)]), [su]);
  assert.deepEqual(pinnedDestinations(entries, ['host:su.se']), [su]);
  assert.deepEqual(policy, before);
});

test('all-terms policy index exposes denied scope bases; Home never displays a manually denied base as allowed', () => {
  const policy = { whitelist: [], blacklist: ['su.se'], whitelistSubdomains: ['su.se'] };
  assert.equal(destinationIndex(policy).length, 0);
  assert.ok(policyDestinationIndex(policy).some(entry => entry.hostnames.includes('su.se')));
  assert.equal(evaluate('su.se', policy).reason, 'BLACKLISTED');
  assert.equal(policyDestinationIndex({ ...policy, whitelistSubdomains: ['*.su.se'] }).length, 0);
});

test('an absent or empty scope collection leaves legacy exact policy indexes unchanged', () => {
  const legacy = { whitelist: ['github.com', 'www.github.com', 'su.se'], blacklist: ['blocked.example'] };
  assert.deepEqual(destinationIndex({ ...legacy, whitelistSubdomains: [] }), destinationIndex(legacy));
  assert.deepEqual(policyDestinationIndex({ ...legacy, whitelistSubdomains: [] }), policyDestinationIndex(legacy));
});

test('a scoped child launch updates only its declared base usage without manufacturing destinations', () => {
  const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const policy = { whitelist: [], blacklist: ['denied.su.se'], whitelistSubdomains: ['su.se'] };
  const entry = destinationIndex(policy).find(entry => entry.hostnames.includes('su.se'));
  saveDestinationLaunch(storage, policy, 'courses.su.se', 1000);
  const usage = JSON.parse(saved.get(usagePreferencesKey));
  assert.equal(usage[destinationId(entry)].count, 1);
  assert.deepEqual(Object.keys(usage), [destinationId(entry)]);
  saveDestinationLaunch(storage, policy, 'denied.su.se', 2000);
  assert.equal(saved.get(usagePreferencesKey), JSON.stringify(usage));
});

test('fresh Core scope authority supports one bounded departure from the actual loaded child destination', async t => {
  const f = await fixture(t, true, { policy: { whitelist: [], blacklist: [], whitelistSubdomains: ['su.se'] } });
  await f.firefox.visit(1, 'https://courses.su.se/');
  assert.equal(f.adapter.view().contexts.find(c => c.tabId === 1).latest.decision.reason, 'WHITELISTED_SCOPE');
  const departure = await f.firefox.request(1, 'https://identity.example/login', { originUrl: 'https://courses.su.se/' });
  assert.equal(departure.cancel, undefined);
  const context = f.adapter.view().contexts.find(c => c.tabId === 1);
  assert.equal(context.latest.decision.reason, 'ACTIVE_JOURNEY');
  assert.equal(context.journey.rootHostname, 'courses.su.se', 'the actual destination, not the broader scope root, owns the Journey');
  assert.equal((await f.firefox.request(2, 'https://identity.example/')).cancel, true, 'no authorization inheritance into an unrelated tab');
  await f.firefox.send({ kind: 'CANCEL_JOURNEY', tabId: 1 });
  const ended = f.adapter.view().contexts.find(c => c.tabId === 1);
  assert.equal(ended.retry?.rootHostname, 'courses.su.se', 'scope roots retain the existing explicit restart path');
});

test('a removed scope cannot use stale loaded-page provenance to start an unfamiliar Journey', async t => {
  const f = await fixture(t, true, { policy: { whitelist: [], blacklist: [], whitelistSubdomains: ['su.se'] } });
  await f.firefox.visit(1, 'https://courses.su.se/');
  const proposal = await f.controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: [], blacklist: [] } });
  f.clock.time += 30;
  assert.equal((await f.controller.handle({ kind: 'CONFIRM_POLICY', proposalId: proposal.referenceId })).type, 'COMMITTED');
  assert.equal((await f.firefox.request(1, 'https://identity.example/', { originUrl: 'https://courses.su.se/' })).cancel, true);
  const denied = f.adapter.view().contexts.find(c => c.tabId === 1).latest;
  assert.equal(denied.type, 'REJECTED'); assert.equal(denied.reason, 'NOT_WHITELISTED');
  assert.equal(f.controller.getView().snapshot.journeyState.journeys.some(j => j.phase !== 'ENDED'), false);
});

test('manual and managed denials override broad scope at the adapter gate while exact managed exceptions remain explicit', async t => {
  const managed = compileManagedBlacklist(['managed.su.se', 'exact.su.se']);
  const f = await fixture(t, true, { policy: { whitelist: ['exact.su.se'], blacklist: ['manual.su.se'], whitelistSubdomains: ['su.se'] },
    managedBlacklist: () => managed });
  assert.equal((await f.firefox.request(1, 'https://manual.su.se/')).cancel, true);
  assert.equal(f.adapter.view().contexts.find(c => c.tabId === 1).latest.decision.reason, 'BLACKLISTED');
  assert.equal((await f.firefox.request(2, 'https://managed.su.se/')).cancel, true);
  assert.equal(f.adapter.view().contexts.find(c => c.tabId === 2).latest.decision.reason, 'MANAGED_BLACKLISTED');
  assert.equal((await f.firefox.request(3, 'https://exact.su.se/')).cancel, undefined);
  assert.equal(f.adapter.view().contexts.find(c => c.tabId === 3).latest.decision.reason, 'WHITELISTED');
});

test('Greylist preparation excludes an already scope-authorized alias without widening the remaining frozen request', async t => {
  const f = await fixture(t, true, { policy: { whitelist: [], blacklist: [], whitelistSubdomains: ['www.amazon.se'] } });
  await f.firefox.tabs.create({ url: 'about:blank' });
  await f.firefox.visit(1, 'https://amazon.se/');
  const prepared = await f.firefox.send({ kind: 'PREPARE_ACCESS', tabId: 1 });
  const scope = prepared.view.contexts.find(c => c.tabId === 1).accessScope;
  assert.deepEqual(scope.hostnames, ['amazon.se']);
  const started = await f.firefox.send({ kind: 'START_ACCESS', tabId: 1, scopeId: scope.id });
  assert.equal(started.result.type, 'COMMITTED');
  assert.deepEqual(f.controller.getView().snapshot.accessState.pendingRequests[0].scopeHostnames, ['amazon.se']);
  assert.deepEqual(f.controller.getView().snapshot.policy.whitelistSubdomains, ['www.amazon.se']);
});

test('a manually denied alias is not silently removed from Greylist request terms by a broader scope', async t => {
  const f = await fixture(t, true, { policy: { whitelist: [], blacklist: ['www.amazon.se'], whitelistSubdomains: ['www.amazon.se'] } });
  await f.firefox.tabs.create({ url: 'about:blank' });
  await f.firefox.visit(1, 'https://amazon.se/');
  const prepared = await f.firefox.send({ kind: 'PREPARE_ACCESS', tabId: 1 });
  const scope = prepared.view.contexts.find(c => c.tabId === 1).accessScope;
  assert.deepEqual(scope.hostnames, ['amazon.se', 'www.amazon.se']);
  const started = await f.firefox.send({ kind: 'START_ACCESS', tabId: 1, scopeId: scope.id });
  assert.notEqual(started.result.type, 'COMMITTED');
  assert.equal(f.controller.getView().snapshot.accessState.pendingRequests.length, 0);
});

test('proposing curated defaults preserves scopes without turning covered hosts into exact managed exceptions', async t => {
  const managed = compileManagedBlacklist(['fysik.su.se']);
  const f = await fixture(t, true, { policy: { whitelist: [], blacklist: [], whitelistSubdomains: ['su.se'] }, managedBlacklist: () => managed });
  const before = structuredClone(f.controller.getView().snapshot.policy);
  const response = await f.firefox.send({ kind: 'PROPOSE_CURATED_DEFAULTS' });
  assert.equal(response.result.type, 'COMMITTED');
  const proposal = f.controller.getView().snapshot.vaultState.pendingProposal;
  assert.ok(proposal.candidatePolicy.whitelistSubdomains.includes('su.se'));
  assert.ok(proposal.candidatePolicy.whitelistSubdomains.includes('kth.se'));
  assert.equal(evaluate('www.google.com', proposal.candidatePolicy).outcome, 'GREYLIST');
  for (const host of ['su.se', 'www.su.se', 'fysik.su.se']) assert.equal(proposal.candidatePolicy.whitelist.includes(host), false, host);
  assert.deepEqual(f.controller.getView().snapshot.policy, before, 'preparation does not modify current authority');
});
