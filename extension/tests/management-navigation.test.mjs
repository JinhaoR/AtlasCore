import test from 'node:test';
import assert from 'node:assert/strict';
import { sitesFixture, original, dom, Node } from './support/ui-fixture.mjs';
import { initializeSettingsNavigation, settingsSection, settingsSections } from '../dist/lib/ui/settings-navigation.js';
import { destinationChangeView } from '../dist/lib/ui/destination-change-view.js';
import { initializeSites } from '../dist/lib/ui/sites.js';

test('All Sites opens through the ordinary Firefox gate and cannot bypass blocked or unavailable authority', async t => {
  const f=await sitesFixture(t),before=structuredClone(f.controller.getView().snapshot),launches=[];
  const send=f.settings.propose;
  f.settings.propose=async command=>{const response=await send(command);launches.push({command,response});return response;};
  const select=id=>{f.el('sites-list').children.find(n=>n.dataset.destinationId===id).click();f.sites.render(true);};
  select(original.id);f.el('open-site').click();await f.flush();
  assert.deepEqual(launches[0].command,{kind:'OPEN_DESTINATION',url:'https://root.example/'});
  assert.equal(launches[0].response.opened,true);
  assert.deepEqual(await f.firefox.request(launches[0].response.tabId,'https://root.example/'),{});
  select('host:blocked.example');f.el('open-site').click();await f.flush();
  assert.equal((await f.firefox.visit(launches[1].response.tabId,'https://blocked.example/')).cancel,true);
  f.available(false);f.sites.render(false);assert.equal(f.el('open-site').disabled,true);
  f.el('open-site').fire('click');await f.flush();assert.equal(launches.length,2);
  assert.deepEqual(f.controller.getView().snapshot.policy,before.policy);
  assert.deepEqual(f.controller.getView().snapshot.accessState.grants,[]);assert.equal(f.proposals(),0);
});

test('Pin to Home is an acknowledged presentation save; failure keeps the previous choice and retry', async t => {
  const f=await sitesFixture(t),before=structuredClone(f.controller.getView().snapshot.policy);
  f.el('sites-list').children.find(n=>n.dataset.destinationId===original.id).click();f.sites.render(true);
  const hostRow=f.el('site-detail-hosts').children[0];
  f.failPin(true);f.el('pin-site').click();await f.flush();f.sites.render(true);
  assert.deepEqual(f.settings.pins(),[]);assert.equal(f.el('pin-site').textContent,'Pin to Home');
  assert.equal(f.el('site-save-feedback').dataset.tone,'error');
  f.failPin(false);f.el('pin-site').click();await f.flush();f.sites.render(true);
  assert.deepEqual(f.settings.pins(),[original.id]);assert.equal(f.el('pin-site').textContent,'Unpin from Home');
  assert.equal(f.el('site-detail-hosts').children[0],hostRow,'pin saves retain the existing address row');
  assert.equal(f.el('site-save-feedback').hidden,true);
  f.el('pin-site').click();await f.flush();f.sites.render(true);assert.deepEqual(f.settings.pins(),[]);
  assert.deepEqual(f.controller.getView().snapshot.policy,before);assert.equal(f.proposals(),0);
});

test('discard feedback waits for acknowledgement and opening details retains save failures', async t => {
  const f=await sitesFixture(t);f.edit();f.el('site-name').value='Unsaved draft';f.el('site-name').fire('input');await f.flush();f.sites.render(true);
  const saved=structuredClone((await f.raw.load()).value);
  f.draftMode('FAILED');f.el('discard-destination-draft').click();await f.flush();f.sites.render(true);
  assert.deepEqual((await f.raw.load()).value,saved);
  assert.equal(f.el('site-save-feedback').dataset.tone,'uncertain');
  assert.doesNotMatch(f.el('site-save-feedback').textContent,/^Draft discarded/);
  f.el('sites-list').children[0].click();assert.equal(f.el('site-save-feedback').hidden,false);
  f.draftMode('OK');f.el('retry-destination-draft').click();await f.flush();f.sites.render(true);
  assert.equal((await f.raw.load()).value.draft,null);
  assert.notEqual(f.el('site-save-feedback').dataset.tone,'uncertain');
  f.el('sites-list').children[0].click();assert.equal(f.el('site-save-feedback').hidden,true);
});

test('Home startup defers hidden directory rows while retaining draft ownership and later selection', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot), writes = f.writes(), count = f.el('sites-list').children.length;
  f.el('sites-section').hidden = true; f.el('vault-section').hidden = true;
  f.el('sites-list').replaceChildren();
  // A fresh owner has no directory nodes until that view is actually opened.
  f.clearHandlers(); const deferred = initializeSites(f.settings); await deferred.initialized;
  deferred.render(true); assert.equal(f.el('sites-list').children.length, 0);
  assert.equal(f.writes(), writes); assert.deepEqual(f.controller.getView().snapshot, before);
  f.el('sites-section').hidden = false; deferred.render(true);
  assert.equal(f.el('sites-list').children.length, count);
});

test('history review survives asynchronous workspace loading without changing its saved draft', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'History label'; await f.stage();
  const persisted = structuredClone((await f.raw.load()).value); f.clearHandlers();
  const restored = initializeSites({ ...f.settings, initialView: 'review', initialSelection: original.id });
  restored.render(true); assert.equal(restored.view(), 'review');
  await restored.initialized; restored.render(true); assert.equal(restored.view(), 'review');
  assert.equal(f.el('destination-draft-items').children.length, 1);
  assert.deepEqual((await f.raw.load()).value, persisted);
});

test('browse/detail/review navigation keeps dirty editor, staged changes, filters and authority', async t => {
  const f = await sitesFixture(t), before = structuredClone(f.controller.getView().snapshot);
  f.edit(); f.el('site-name').value = 'Prepared label'; await f.stage();
  f.el('add-site').click(); f.el('site-name').value = 'Unfinished'; f.el('site-name').fire('input'); await f.flush();
  f.el('sites-search').value = 'Original'; f.el('sites-list').scrollTop = 234;
  const saved = structuredClone((await f.raw.load()).value), writes = f.writes();
  f.el('sites-back').click(); f.sites.render(true); assert.equal(f.sites.view(), 'browse');
  f.el('review-destination-draft').click(); f.sites.render(true); assert.equal(f.sites.view(), 'review');
  assert.equal(f.el('submit-destination-draft').disabled, true, 'unfinished editor cannot be implicitly staged');
  f.sites.focusSelection(); assert.equal(document.activeElement, f.el('draft-review-title'));
  f.el('continue-destination-editing').click(); f.sites.render(true);
  assert.equal(f.sites.view(), 'detail'); assert.equal(f.el('site-name').value, 'Unfinished');
  f.sites.restoreView('browse', original.id); f.sites.render(true);
  assert.equal(f.el('sites-search').value, 'Original'); assert.equal(f.sites.navigation().scroll, 234);
  assert.deepEqual((await f.raw.load()).value, saved); assert.equal(f.writes(), writes);
  assert.deepEqual(f.controller.getView().snapshot, before); assert.equal(f.proposals(), 0);
});

test('failed saves stay visible outside review and explicit retry retains values', async t => {
  const f = await sitesFixture(t); f.edit(); await f.flush(); f.draftMode('FAILED');
  f.el('site-name').value = 'Retained'; f.el('site-name').fire('input'); await f.flush(); f.sites.render(true);
  f.el('sites-back').click(); f.sites.render(true);
  assert.equal(f.el('draft-problem').hidden, false); assert.match(f.el('draft-problem-title').textContent, /could not be saved/);
  assert.equal(f.el('retry-destination-draft').hidden, false);
  f.draftMode('OK'); f.el('retry-destination-draft').click(); await f.flush(); f.sites.render(true);
  assert.equal(f.el('draft-problem').hidden, true); assert.equal((await f.raw.load()).value.draft.editor.name, 'Retained');
});

test('acknowledged display completion returns focus from review to the selected destination', async t => {
  const f = await sitesFixture(t); f.edit(); f.el('site-name').value = 'Renamed'; await f.stage();
  f.el('review-destination-draft').click(); f.sites.render(true); f.sites.focusSelection();
  await f.submit();
  assert.equal(f.sites.session().value.receipt.phase, 'DONE');
  assert.equal(document.activeElement.dataset.destinationId, original.id);
  assert.equal(f.proposals(), 0);
});

test('Settings selection uses existing nodes, restores known sections and writes no preferences', t => {
  const f = dom(t), buttons = settingsSections.map(id => { f.el(id).id = id; const b = new Node(); b.dataset.settingsPanel = id; return b; });
  document.querySelectorAll = () => buttons;
  for (const id of settingsSections) f.el(id).querySelector = () => f.el(id + '-heading');
  const selected = [], nav = initializeSettingsNavigation({ initial: 'recovery-section', remember: value => selected.push(value) });
  nav.render(true); assert.equal(f.el('recovery-section').hidden, false);
  assert.equal(f.el('timing-settings').hidden, true); buttons.find(b => b.dataset.settingsPanel === 'diagnostics').click();
  assert.equal(nav.value(), 'diagnostics'); assert.deepEqual(selected, ['diagnostics']);
  assert.equal(document.activeElement, f.el('diagnostics-heading'));
  nav.restore('timing-settings'); nav.render(true); nav.render(true);
  assert.equal(f.el('timing-settings').open, true); assert.equal(f.el('diagnostics').hidden, true);
  assert.equal(f.writes(), 0); assert.equal(settingsSection('invalid'), 'timing-settings');
  nav.choose('home-settings'); assert.equal(f.el('home-settings').hidden, false);
});

test('an unknown draft-save outcome does not claim either failure or acknowledgement', async t => {
  const f = await sitesFixture(t); f.edit(); await f.flush(); f.draftMode('UNCERTAIN');
  f.el('site-name').value = 'Unknown outcome'; f.el('site-name').fire('input'); await f.flush(); f.sites.render(true);
  assert.match(f.el('draft-problem-title').textContent, /could not be verified/);
  assert.match(f.el('draft-problem-copy').textContent, /outcome is uncertain/);
  assert.equal(f.el('draft-problem-detail').textContent, 'UNCERTAIN');
  assert.equal(f.proposals(), 0);
});

test('before/after review retains exact scopes, classification and parent-coverage caveat', () => {
  const before = { metadata: original, pinned: true }, after = { metadata: { ...original, label: 'New label' }, pinned: false };
  const policy = { whitelist: ['root.example'], blacklist: [] };
  const result = destinationChangeView({ id: original.id, before, after }, policy, { ...policy, whitelistSubdomains: ['root.example'] });
  assert.deepEqual(result.rows.find(row => row[0] === 'Subdomain bases'), ['Subdomain bases', 'Not included', 'root.example']);
  assert.deepEqual(result.rows.find(row => row[0] === 'Home pin'), ['Home pin', 'Pinned', 'Not pinned']);
  const child = { ...before, metadata: { ...original, primaryHostname: 'lab.root.example', hostnames: ['lab.root.example'] } };
  const removal = destinationChangeView({ id: original.id, before: child, after: null }, { whitelist: ['lab.root.example'], blacklist: [], whitelistSubdomains: ['root.example'] }, { whitelist: [], blacklist: [], whitelistSubdomains: ['root.example'] });
  assert.ok(removal.warnings.some(line => line.startsWith('Still allowed by another saved scope:')));
});
