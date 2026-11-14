import test from 'node:test';
import assert from 'node:assert/strict';
import { compileManagedBlacklist, evaluate } from '@atlas/core';
import { assessDraft, destinationChangeSummary, draftBaseline, newDestinationDraft, readDestinationDraft,
  stageDestination, validateDraftCandidate } from '../dist/lib/ui/destination-draft.js';
import { fixture } from './support/fixture.mjs';
import { sitesFixture } from './support/ui-fixture.mjs';

const preferences = { version: 1, destinations: [], pending: null };
const entry = (hostname, extra = {}) => ({ metadata: { id: `host:${hostname}`, label: 'Stockholm University', category: 'University',
  primaryHostname: hostname, hostnames: [hostname] }, classification: 'WHITELIST', pinned: false, ...extra });
async function model(t, policy = { whitelist: ['root.example'], blacklist: [] }, metadata = preferences) {
  const f = await fixture(t, true, { policy }); const snapshot = f.controller.getView().snapshot;
  const baseline = draftBaseline(snapshot, metadata, []);
  return { ...f, snapshot, baseline, draft: newDestinationDraft('scope-draft', baseline) };
}
async function addScoped(f, hostname = 'su.se') {
  f.el('add-site').fire('click');
  f.el('site-name').value = 'Stockholm University'; f.el('site-hostname').value = hostname;
  f.el('site-category').value = 'University'; f.el('site-access').value = 'WHITELIST';
  f.el('site-hostname').fire('input'); f.el('site-subdomains').checked = true; f.el('site-subdomains').fire('input');
  await f.stage();
}

test('old editor and baseline records remain exact and preserve their legacy saved shape', async t => {
  const f = await model(t);
  const editor = { id: null, name: 'Old unfinished work', hostname: 'su.se', category: 'University',
    access: 'WHITELIST', www: false, extra: '', pinned: false };
  const saved = { ...f.draft, editor };
  assert.deepEqual(readDestinationDraft(saved), saved);
  assert.equal(Object.hasOwn(saved.baseline.policy, 'whitelistSubdomains'), false);
  assert.equal(saved.baseline.entries.some(item => item.includeSubdomains), false);
  const staged = stageDestination(f.draft, 'host:su.se', entry('su.se'));
  const candidate = assessDraft(staged, f.baseline).candidatePolicy;
  assert.equal(Object.hasOwn(candidate, 'whitelistSubdomains'), false);
  assert.equal(evaluate('indico.fysik.su.se', candidate).outcome, 'GREYLIST');
});

test('the scope checkbox applies only to the primary host while explicit aliases remain exact', async t => {
  const f = await model(t), item = entry('su.se', { includeSubdomains: true });
  item.metadata.hostnames = ['su.se', 'www.su.se', 'another-university.org'];
  const staged = stageDestination(f.draft, item.metadata.id, item);
  const assessed = validateDraftCandidate(staged, f.baseline, f.snapshot);
  assert.deepEqual(assessed.candidatePolicy.whitelistSubdomains, ['su.se']);
  assert.equal(evaluate('su.se', assessed.candidatePolicy).reason, 'WHITELISTED');
  assert.equal(evaluate('indico.fysik.su.se', assessed.candidatePolicy).reason, 'WHITELISTED_SCOPE');
  assert.equal(evaluate('another-university.org', assessed.candidatePolicy).reason, 'WHITELISTED');
  assert.equal(evaluate('child.another-university.org', assessed.candidatePolicy).outcome, 'GREYLIST');
  const summary = destinationChangeSummary(staged.changes[0], f.baseline.policy, assessed.candidatePolicy).join('\n');
  assert.match(summary, /Domain \+ all subdomains/); assert.match(summary, /su\.se/); assert.match(summary, /current\/future descendants/);
  assert.deepEqual(f.controller.getView().snapshot, f.snapshot, 'preparation is presentation only');
});

test('unrelated scopes and separately stored alias scopes survive a primary destination edit', async t => {
  const metadata = { version: 1, destinations: [{ id: 'host:su.se', label: 'Su', category: 'University',
    primaryHostname: 'su.se', hostnames: ['su.se', 'fysik.su.se'] }], pending: null };
  const f = await model(t, { whitelist: ['su.se', 'fysik.su.se'], blacklist: [], whitelistSubdomains: ['fysik.su.se', 'kth.se'] }, metadata);
  const before = f.baseline.entries.find(item => item.metadata.id === 'host:su.se');
  assert.equal(!!before.includeSubdomains, false);
  const after = { ...before, metadata: { ...before.metadata, label: 'Renamed Su' }, classification: 'WHITELIST', includeSubdomains: false };
  const candidate = assessDraft(stageDestination(f.draft, 'host:su.se', after), f.baseline).candidatePolicy;
  assert.deepEqual(candidate.whitelistSubdomains, ['fysik.su.se', 'kth.se']);
  assert.equal(evaluate('new.fysik.su.se', candidate).reason, 'WHITELISTED_SCOPE');
  assert.equal(evaluate('other.su.se', candidate).outcome, 'GREYLIST');
});

test('removing a destination removes its owned scope without dropping unrelated policy', async t => {
  const f = await model(t, { whitelist: ['su.se', 'custom.example'], blacklist: ['blocked.example'],
    whitelistSubdomains: ['su.se', 'kth.se'] });
  const item = f.baseline.entries.find(item => item.metadata.primaryHostname === 'su.se');
  const candidate = assessDraft(stageDestination(f.draft, item.metadata.id, null), f.baseline).candidatePolicy;
  assert.deepEqual(candidate.whitelistSubdomains, ['kth.se']);
  assert.ok(candidate.whitelist.includes('custom.example'));
  assert.deepEqual(candidate.blacklist, ['blocked.example']);
  assert.equal(evaluate('child.su.se', candidate).outcome, 'GREYLIST');
});

test('PRESERVE display changes cannot enable or disable the protected scope flag', async t => {
  for (const active of [false, true]) await t.test(active ? 'disable' : 'enable', async child => {
    const f = await model(child, { whitelist: ['su.se'], blacklist: [], ...(active ? { whitelistSubdomains: ['su.se'] } : {}) });
    const before = f.baseline.entries.find(item => item.metadata.primaryHostname === 'su.se');
    const after = { ...before, classification: 'PRESERVE', includeSubdomains: !active };
    const assessed = assessDraft(stageDestination(f.draft, before.metadata.id, after), f.baseline);
    assert.equal(assessed.candidatePolicy, null);
    assert.ok(assessed.conflicts.some(conflict => /display-only edits cannot change permission/.test(conflict.message)));
  });
});

test('a display-only rename preserves the scope and metadata never stores authorization flags', async t => {
  const f = await model(t, { whitelist: ['su.se'], blacklist: [], whitelistSubdomains: ['su.se'] });
  const before = f.baseline.entries.find(item => item.metadata.primaryHostname === 'su.se');
  const after = { ...before, metadata: { ...before.metadata, label: 'Renamed' } };
  const assessed = assessDraft(stageDestination(f.draft, before.metadata.id, after), f.baseline);
  assert.equal(assessed.policyChanged, false);
  assert.deepEqual(assessed.candidatePolicy.whitelistSubdomains, ['su.se']);
  assert.equal(Object.hasOwn(after.metadata, 'includeSubdomains'), false);
});

test('whole public or hosting suffixes and non-Whitelist scope changes cannot form candidates', async t => {
  const f = await model(t);
  for (const hostname of ['com', 'co.uk', 'github.io']) {
    const item = entry(hostname, { includeSubdomains: true });
    const assessed = assessDraft(stageDestination(f.draft, item.metadata.id, item), f.baseline);
    assert.equal(assessed.candidatePolicy, null, hostname);
    assert.ok(assessed.conflicts.some(conflict => /registered hostname/.test(conflict.message)));
  }
  const blacklisted = entry('su.se', { classification: 'BLACKLIST', includeSubdomains: true });
  assert.equal(assessDraft(stageDestination(f.draft, blacklisted.metadata.id, blacklisted), f.baseline).candidatePolicy, null);
});

test('scope flags survive editable draft serialization and reject malformed flag types', async t => {
  const f = await model(t), item = entry('su.se', { includeSubdomains: true });
  const staged = stageDestination(f.draft, item.metadata.id, item);
  assert.deepEqual(readDestinationDraft(JSON.parse(JSON.stringify(staged))), staged);
  for (const includeSubdomains of ['yes', 1, null]) {
    const malformed = structuredClone(staged); malformed.changes[0].after.includeSubdomains = includeSubdomains;
    assert.equal(readDestinationDraft(malformed), null);
  }
});

test('UI opt-in is off by default and reaches authority only through the existing Vault cycle', async t => {
  const managed = compileManagedBlacklist(['su.se', 'tracking.su.se']);
  const f = await sitesFixture(t, { managedBlacklist: () => managed });
  const before = structuredClone(f.controller.getView().snapshot);
  assert.equal(f.el('site-subdomains').checked, false);
  await addScoped(f);
  assert.equal(f.sites.session().value.draft.changes[0].after.includeSubdomains, true);
  const compact = f.el('destination-draft-items').children[0].children[0].children.map(node => node.textContent).join('\n');
  assert.match(compact, /Domain \+ all subdomains:.*su\.se/, 'broad terms stay visible even before expanded review');
  assert.deepEqual(f.controller.getView().snapshot, before);
  await f.submit();
  const pending = f.controller.getView().snapshot.vaultState.pendingProposal;
  assert.ok(pending); assert.deepEqual(pending.candidatePolicy.whitelistSubdomains, ['su.se']);
  assert.equal(evaluate('child.su.se', f.controller.getView().snapshot.policy).outcome, 'GREYLIST');
  assert.equal((await f.firefox.send({ kind: 'CONFIRM_POLICY', proposalId: pending.id })).result.reason, 'NOT_READY');
  await f.confirm();
  const active = f.controller.getView().snapshot.policy;
  assert.equal(evaluate('child.su.se', active).reason, 'WHITELISTED_SCOPE');
  assert.equal((await f.controller.handle({ kind: 'CHECK_NAVIGATION', target: { hostname: 'su.se' },
    context: { contextId: 'scope-check', journeyId: null } })).decision.reason, 'WHITELISTED', 'explicit primary retains its existing managed exception');
  assert.equal((await f.controller.handle({ kind: 'CHECK_NAVIGATION', target: { hostname: 'tracking.su.se' },
    context: { contextId: 'scope-check', journeyId: null } })).decision.reason, 'MANAGED_BLACKLISTED');
  assert.equal(f.sites.metadata().some(item => Object.hasOwn(item, 'includeSubdomains')), false);
  f.edit('host:su.se'); f.sites.render(true);
  assert.match(f.el('site-detail-hosts').children.map(node => node.textContent).join('\n'), /all current and future subdomains/);
  assert.equal(f.proposals(), 1);
});

test('changing a checked scope to a public suffix gives a field error without staging authority', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  f.el('add-site').fire('click');
  f.el('site-name').value = 'Research'; f.el('site-hostname').value = 'su.se';
  f.el('site-hostname').fire('input'); f.el('site-subdomains').checked = true; f.el('site-subdomains').fire('input');
  f.el('site-hostname').value = 'co.uk'; f.el('site-hostname').fire('input'); await f.stage();
  assert.equal(f.el('site-subdomains').disabled, true);
  assert.equal(f.el('site-hostname').getAttribute('aria-invalid'), 'true');
  assert.equal(document.activeElement, f.el('site-hostname'));
  assert.equal(f.sites.session().value.draft.changes.length, 0);
  assert.equal(f.sites.session().value.draft.editor.hostname, 'co.uk', 'raw input is preserved');
  assert.deepEqual(f.controller.getView().snapshot, before); assert.equal(f.proposals(), 0);
});

test('Add Site explains shared hosting suffixes and allows a specific tenant scope', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  f.el('add-site').fire('click');
  f.el('site-name').value = 'Research'; f.el('site-name').fire('input');
  f.el('site-hostname').value = 'github.io'; f.el('site-hostname').fire('input');
  assert.equal(f.el('site-subdomains').disabled, true);
  assert.equal(f.el('site-subdomains-help').hidden, false);
  assert.match(f.el('site-subdomains-help').textContent, /github\.io is a shared hosting suffix/);
  assert.match(f.el('site-subdomains-help').textContent, /your-site\.github\.io/);
  f.el('site-hostname').value = 'research.github.io'; f.el('site-hostname').fire('input');
  assert.equal(f.el('site-subdomains').disabled, false);
  f.el('site-subdomains').checked = true; f.el('site-subdomains').fire('input');
  await f.sites.idle();
  await f.sites.session().load(); f.sites.render(true);
  assert.equal(f.el('site-subdomains').checked, true);
  await f.stage();
  assert.equal(f.sites.session().value.draft.changes[0].after.includeSubdomains, true);
  assert.deepEqual(f.controller.getView().snapshot, before);
  assert.equal(f.proposals(), 0);
});

test('selecting Blacklist does not advertise the previously checked broad allow scope', async t => {
  const f = await sitesFixture(t);
  f.el('add-site').fire('click'); f.el('site-hostname').value = 'su.se'; f.el('site-hostname').fire('input');
  f.el('site-subdomains').checked = true; f.el('site-subdomains').fire('input');
  f.el('site-access').value = 'BLACKLIST'; f.el('site-access').fire('input');
  assert.equal(f.el('site-subdomains').disabled, true);
  assert.doesNotMatch(f.el('site-scope-preview').textContent, /Additional scope|all current/);
  assert.match(f.el('site-scope-preview').textContent, /exact hosts: su\.se/i);
});

test('turning off an existing scope applies as an immediate removal and leaves exact access intact', async t => {
  const f = await sitesFixture(t); await addScoped(f); await f.submit(); await f.confirm();
  f.edit('host:su.se'); f.el('site-access').value = 'WHITELIST'; f.el('site-access').fire('input');
  assert.equal(f.el('site-subdomains').checked, true);
  f.el('site-subdomains').checked = false; f.el('site-subdomains').fire('input'); await f.stage();
  const before = f.controller.getView().snapshot.policy;
  assert.equal(evaluate('child.su.se', before).reason, 'WHITELISTED_SCOPE');
  await f.submit();
  assert.equal(evaluate('child.su.se', f.controller.getView().snapshot.policy).outcome, 'GREYLIST');
  assert.equal(evaluate('su.se', f.controller.getView().snapshot.policy).reason, 'WHITELISTED');
  assert.equal(f.proposals(), 1); assert.equal(f.removals(), 1);
});
