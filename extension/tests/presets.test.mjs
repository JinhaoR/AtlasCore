import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, planAtlasOperation, createAccessState, createJourneyState, createVaultState } from '@atlas/core';
import { curatedWhitelist, compileCuratedWhitelist, serviceHostnames } from '../dist/lib/presets/curated-whitelist.js';
import { validateFeed } from '../dist/lib/managed/hosts-feed.js';
import { configuration } from './support/fixture.mjs';

const policy = compileCuratedWhitelist();
const approved = ['chatgpt.com', 'claude.ai', 'mail.google.com', 'outlook.com', 'www.outlook.com', 'outlook.live.com',
  'outlook.office.com', 'outlook.office365.com', 'microsoft365.com', 'www.microsoft365.com', 'youtube.com', 'www.youtube.com',
  'scholar.google.com', 'arxiv.org', 'inspirehep.net', 'doi.org', 'crossref.org', 'orcid.org', 'semanticscholar.org', 'www.semanticscholar.org',
  'journals.aps.org', 'link.aps.org', 'pubs.aip.org', 'iopscience.iop.org', 'nature.com', 'www.nature.com', 'science.org', 'www.science.org',
  'sciencedirect.com', 'www.sciencedirect.com', 'springer.com', 'link.springer.com', 'onlinelibrary.wiley.com', 'academic.oup.com',
  'cambridge.org', 'www.cambridge.org', 'jstor.org', 'www.jstor.org', 'ieeexplore.ieee.org', 'dl.acm.org', 'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov', 'overleaf.com', 'www.overleaf.com', 'student.ladok.se', 'canvas.kth.se', 'canvas.instructure.com', 'learn.canvas.net', 'github.com', 'www.github.com'];

test('all requested curated destinations and explicit aliases expand to exact allowed policy entries', () => {
  assert.deepEqual(new Set(policy.whitelist), new Set(approved));
  for (const hostname of approved) assert.equal(evaluate(hostname, policy).outcome, 'ALLOW', hostname);
  assert.deepEqual(curatedWhitelist.map((group) => group.label), ['AI', 'Mail', 'Video', 'Scholar / Research', 'Writing', 'University', 'Development']);
});

test('services occur once; aliases are declared, distinct entry points stay distinct, and no www is inferred', () => {
  const services = curatedWhitelist.flatMap((group) => group.services);
  assert.equal(new Set(services.map((service) => service.label)).size, services.length);
  const github = services.find((service) => service.label === 'GitHub');
  assert.deepEqual(serviceHostnames(github), ['github.com', 'www.github.com']);
  const outlook = services.find((service) => service.label === 'Outlook');
  assert.deepEqual(outlook.aliases, ['www.outlook.com']);
  assert.ok(outlook.destinations.includes('outlook.office.com'));
  const small = compileCuratedWhitelist([{ label: 'Test', services: [{ label: 'A', hostname: 'example.org' }] }]);
  assert.equal(evaluate('www.example.org', small).outcome, 'GREYLIST');
  assert.equal(evaluate('sub.example.org', small).outcome, 'GREYLIST');
});

test('Search, unlisted Canvas roots and authentication infrastructure are not curated destinations', () => {
  for (const hostname of ['google.com', 'www.google.com', 'accounts.google.com', 'login.microsoftonline.com',
    'service.seamlessaccess.org', 'login.ug.kth.se', 'another-university.instructure.com', 'www.arxiv.org'])
    assert.equal(evaluate(hostname, policy).outcome, 'GREYLIST', hostname);
});

test('bundled official managed data validates, denies representative entries, and preserves curated exceptions', () => {
  const text = readFileSync(new URL('../data/stevenblack/hosts', import.meta.url), 'utf8');
  const feed = validateFeed(text);
  assert.ok(feed); assert.ok(feed.compiled.size > 100_000); assert.equal(feed.parsed.ignoredNames, 6);
  const snapshot = { policy, policyRevision: 0, accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState() };
  const check = (hostname) => planAtlasOperation({ kind: 'CHECK_NAVIGATION', target: { hostname },
    context: { contextId: 'fixture', journeyId: null } }, { snapshot, now: 0, configuration, managedBlacklist: feed.compiled }).result.decision;
  for (const hostname of ['doubleclick.net', 'facebook.com', 'pornhub.com', 'bet365.com', 'infowars.com'])
    assert.equal(check(hostname).reason, 'MANAGED_BLACKLISTED', hostname);
  for (const hostname of approved) assert.equal(check(hostname).reason, 'WHITELISTED', hostname);
  for (const hostname of ['google.com', 'www.google.com']) assert.equal(check(hostname).outcome, 'GREYLIST', hostname);
});
