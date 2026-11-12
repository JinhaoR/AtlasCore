import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { evaluate, planAtlasOperation, createAccessState, createJourneyState, createVaultState } from '@atlas/core';
import { curatedWhitelist, legacyCuratedWhitelist, compileCuratedWhitelist, serviceHostnames } from '../dist/lib/presets/curated-whitelist.js';
import { validateFeed } from '../dist/lib/managed/hosts-feed.js';
import { configuration } from './support/fixture.mjs';
import { curatedUpgradeId, curatedUpgradeHosts } from '../dist/lib/presets/curated-upgrade.js';
import { legacyCuratedUpgradeHosts } from '../dist/lib/presets/curated-upgrade-v2.js';

const policy = compileCuratedWhitelist();
const approved = ['chatgpt.com', 'claude.ai', 'mail.google.com', 'webmail.kth.se', 'outlook.com', 'www.outlook.com', 'outlook.live.com',
  'outlook.office.com', 'outlook.office365.com', 'microsoft365.com', 'www.microsoft365.com', 'youtube.com', 'www.youtube.com',
  'scholar.google.com', 'arxiv.org', 'inspirehep.net', 'doi.org', 'crossref.org', 'orcid.org', 'semanticscholar.org', 'www.semanticscholar.org',
  'journals.aps.org', 'link.aps.org', 'pubs.aip.org', 'iopscience.iop.org', 'nature.com', 'www.nature.com', 'science.org', 'www.science.org',
  'sciencedirect.com', 'www.sciencedirect.com', 'springer.com', 'link.springer.com', 'onlinelibrary.wiley.com', 'academic.oup.com',
  'cambridge.org', 'www.cambridge.org', 'jstor.org', 'www.jstor.org', 'ieeexplore.ieee.org', 'dl.acm.org', 'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov', 'overleaf.com', 'www.overleaf.com', 'student.ladok.se', 'canvas.kth.se', 'canvas.instructure.com', 'learn.canvas.net', 'github.com', 'www.github.com'];

test('all requested curated destinations and explicit aliases expand to exact allowed policy entries', () => {
  const retained = approved.filter(host => !['youtube.com', 'www.youtube.com'].includes(host));
  assert.deepEqual(new Set(compileCuratedWhitelist(legacyCuratedWhitelist).whitelist), new Set(retained));
  assert.ok(policy.whitelist.length >= 250 && policy.whitelist.length <= 310);
  assert.equal(new Set(policy.whitelist).size, policy.whitelist.length);
  for (const hostname of retained) assert.equal(evaluate(hostname, policy).outcome, 'ALLOW', hostname);
  assert.deepEqual(curatedWhitelist.slice(0, 6).map((group) => group.label), ['AI', 'Mail', 'Scholar / Research', 'Writing', 'University', 'Development']);
});

test('academic catalog keeps frozen exact terms and adds approved descendant coverage', () => {
  assert.equal(curatedUpgradeId, 'research-infrastructure-2026-10-v3');
  assert.equal(createHash('sha256').update(JSON.stringify(curatedUpgradeHosts)).digest('hex'),
    'cac0bc1d6ef4fd0fda77d2bfec15e8088f75d1c3e770bd0c12cf8f3c089b5169');
  assert.equal(legacyCuratedUpgradeHosts.length, 298);
  assert.equal(createHash('sha256').update(JSON.stringify(legacyCuratedUpgradeHosts)).digest('hex'),
    '34691e8fa4724d5f87e8fac6306fbabcc953258afbfccd9315ec0352a113a5e2');
  for (const host of ['zotero.org', 'www.zotero.org', 'drive.google.com', 'onedrive.live.com', 'onedrive.cloud.microsoft',
    'kth.se', 'intra.kth.se', 'su.se', 'ki.se', 'nordita.org', 'uu.se', 'lu.se', 'chalmers.se', 'gu.se', 'liu.se', 'umu.se', 'ltu.se',
    'ku.dk', 'nbi.ku.dk', 'uio.no', 'helsinki.fi', 'aalto.fi', 'dtu.dk', 'ox.ac.uk', 'cam.ac.uk', 'ethz.ch', 'epfl.ch',
    'imperial.ac.uk', 'ed.ac.uk', 'tum.de', 'mit.edu', 'harvard.edu', 'stanford.edu', 'princeton.edu', 'cornell.edu', 'berkeley.edu', 'caltech.edu', 'ucsb.edu',
    'perimeterinstitute.ca', 'kitp.ucsb.edu', 'ictp.it', 'home.cern', 'desy.de', 'www.damtp.cam.ac.uk', 'ocw.mit.edu',
    'online.kitp.ucsb.edu', 'pirsa.org', 'sethna.lassp.cornell.edu', 'edu.itp.phys.ethz.ch', 'people.maths.ox.ac.uk',
    'www.feynmanlectures.caltech.edu', 'numpy.org', 'docs.scipy.org', 'docs.julialang.org', 'dlmf.nist.gov']) {
    assert.equal(evaluate(host, policy).outcome, 'ALLOW', host);
    assert.equal(evaluate(`unlisted.${host}`, policy).outcome, 'ALLOW', host);
  }
});

test('current curated defaults omit YouTube and Wikipedia without widening other hosts', () => {
  assert.equal(policy.whitelist.length, 294);
  assert.equal(curatedWhitelist.reduce((count, group) => count + group.services.length, 0), 122);
  for (const host of ['youtube.com', 'www.youtube.com', 'wikipedia.org', 'www.wikipedia.org', 'en.wikipedia.org', 'sv.wikipedia.org']) {
    assert.equal(policy.whitelist.includes(host), false);
    assert.equal(curatedUpgradeHosts.includes(host), false);
    assert.equal(evaluate(host, policy).outcome, 'GREYLIST');
  }
  assert.deepEqual(curatedUpgradeHosts, legacyCuratedUpgradeHosts.filter(host => !['wikipedia.org', 'www.wikipedia.org', 'en.wikipedia.org', 'sv.wikipedia.org'].includes(host)));
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
  assert.equal(small.whitelist.includes('www.example.org'), false, 'no extra exact alias is manufactured');
  assert.equal(evaluate('www.example.org', small).reason, 'WHITELISTED_SCOPE');
  assert.equal(evaluate('sub.example.org', small).reason, 'WHITELISTED_SCOPE');
});

test('Search, unlisted Canvas roots and authentication infrastructure are not curated destinations', () => {
  for (const hostname of ['youtube.com', 'www.youtube.com', 'google.com', 'www.google.com', 'accounts.google.com', 'login.microsoftonline.com',
    'service.seamlessaccess.org', 'another-university.instructure.com'])
    assert.equal(evaluate(hostname, policy).outcome, 'GREYLIST', hostname);
  for (const hostname of ['login.ug.kth.se', 'www.arxiv.org']) assert.equal(evaluate(hostname, policy).reason, 'WHITELISTED_SCOPE');
});

test('bundled official managed data validates, denies representative entries, and preserves curated exceptions', () => {
  const text = readFileSync(new URL('../data/stevenblack/hosts', import.meta.url), 'utf8');
  const feed = validateFeed(text);
  assert.ok(feed); assert.ok(feed.compiled.size > 100_000); assert.equal(feed.parsed.ignoredNames, 6);
  const snapshot = { policy, policyRevision: 0, configuration, configurationRevision: 0, accessState: createAccessState(), vaultState: createVaultState(), journeyState: createJourneyState() };
  const check = (hostname) => planAtlasOperation({ kind: 'CHECK_NAVIGATION', target: { hostname },
    context: { contextId: 'fixture', journeyId: null } }, { snapshot, now: 0, configuration, managedBlacklist: feed.compiled }).result.decision;
  for (const hostname of ['doubleclick.net', 'facebook.com', 'pornhub.com', 'bet365.com', 'infowars.com'])
    assert.equal(check(hostname).reason, 'MANAGED_BLACKLISTED', hostname);
  for (const hostname of policy.whitelist) assert.equal(check(hostname).reason, 'WHITELISTED', hostname);
  for (const hostname of ['google.com', 'www.google.com']) assert.equal(check(hostname).outcome, 'GREYLIST', hostname);
});
