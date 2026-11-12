import test from 'node:test';
import assert from 'node:assert/strict';
import { draftBaseline, newDestinationDraft, stageDestination, assessDraft } from '../dist/lib/ui/destination-draft.js';
import { openDraftRepository } from '../dist/lib/ui/draft-storage.js';
import { DestinationWorkspaceSession } from '../dist/lib/ui/destination-workspace.js';
import { fixture, deferred } from './support/fixture.mjs';

const editor = { id: null, name: 'Initial input', hostname: 'initial.example', category: 'Books', access: 'WHITELIST', www: false, extra: '', pinned: false };
const added = { metadata: { id: 'host:new.example', label: 'New destination', category: 'Books', primaryHostname: 'new.example', hostnames: ['new.example'] }, classification: 'WHITELIST', pinned: false };

async function model(t) {
  const f = await fixture(t), raw = await openDraftRepository(f.factory, 'editor-persistence'); t.after(() => raw.close());
  const writes = [], events = [], before = structuredClone(f.controller.getView().snapshot);
  const repository = { load: () => raw.load(), close: () => raw.close(),
    save: async (revision, value) => { writes.push(structuredClone(value)); return raw.save(revision, value); } };
  const session = new DestinationWorkspaceSession(repository, () => events.push({ unsaved: session.unsaved, failure: session.failure, conflict: session.conflict }));
  await session.load();
  const baseline = draftBaseline(before, { version: 1, destinations: [], pending: null }, []);
  await session.setDraft({ ...newDestinationDraft('editor_test', baseline), editor });
  writes.length = events.length = 0;
  return { ...f, raw, repository, session, writes, events, before };
}

test('140 raw input events persist the latest value in one queued write with no false early save', async t => {
  const f = await model(t);
  for (let i = 0; i < 140; i++) f.session.setEditor({ ...editor, name: `Input ${i}` });
  assert.equal(f.session.value.draft.editor.name, 'Input 139'); assert.equal(f.session.unsaved, true);
  assert.equal(f.writes.length, 0); assert.ok(f.events.every(event => event.unsaved));
  await f.session.idle();
  assert.equal(f.writes.length, 1); assert.equal((await f.raw.load()).value.draft.editor.name, 'Input 139');
  assert.equal(f.session.unsaved, false); assert.deepEqual(f.controller.getView().snapshot, f.before);
});

test('typing during an in-flight write retains just one latest pending editor and waits for its acknowledgement', async t => {
  const f = await model(t), began = deferred(), release = deferred(), save = f.repository.save;
  let calls = 0;
  f.repository.save = async (...args) => { if (++calls === 1) { began.resolve(); await release.promise; } return save(...args); };
  f.session.setEditor({ ...editor, name: 'First in flight' }); await began.promise;
  for (let i = 0; i < 140; i++) f.session.setEditor({ ...editor, name: `Later ${i}` });
  assert.equal(calls, 1); assert.equal(f.session.unsaved, true);
  const drained = f.session.idle(); release.resolve(); await drained;
  assert.equal(calls, 2); assert.equal(f.writes.length, 2);
  assert.equal((await f.raw.load()).value.draft.editor.name, 'Later 139'); assert.equal(f.session.unsaved, false);
});

test('stage and next-editor barriers preserve write order and cannot be overwritten by earlier typing', async t => {
  const f = await model(t), began = deferred(), release = deferred(), save = f.repository.save;
  let calls = 0;
  f.repository.save = async (...args) => { if (++calls === 1) { began.resolve(); await release.promise; } return save(...args); };
  f.session.setEditor({ ...editor, name: 'First' }); await began.promise;
  f.session.setEditor({ ...editor, name: 'Last before stage' });
  const staged = stageDestination(f.session.value.draft, added.metadata.id, added);
  const stage = f.session.setDraft(staged);
  f.session.setEditor({ ...editor, name: 'Stale input after stage' });
  assert.equal(f.session.value.draft.editor, null, 'late input must not reopen a staged editor');
  const nextEditor = { ...editor, id: added.metadata.id, name: 'Next editor' };
  const opened = f.session.setDraft({ ...f.session.value.draft, editor: nextEditor });
  f.session.setEditor({ ...nextEditor, name: 'Last after barrier' });
  release.resolve(); assert.equal(await stage, true); assert.equal(await opened, true); await f.session.idle();
  assert.equal(f.writes.length, 5);
  assert.equal(f.writes[0].draft.editor.name, 'First');
  assert.equal(f.writes[1].draft.editor.name, 'Last before stage');
  assert.equal(f.writes[2].draft.editor, null); assert.equal(f.writes[2].draft.changes.length, 1);
  assert.equal(f.writes[3].draft.editor.name, 'Next editor');
  assert.equal(f.writes[4].draft.editor.name, 'Last after barrier');
  const saved = (await f.raw.load()).value.draft;
  assert.equal(saved.changes[0].id, added.metadata.id); assert.equal(saved.editor.name, 'Last after barrier');
  assert.deepEqual(f.controller.getView().snapshot, f.before);
});

test('a frozen receipt is an ordinary acknowledged barrier, never an editor-coalescing target', async t => {
  const f = await model(t);
  f.session.setEditor({ ...editor, name: 'Input before frozen submission' });
  const draft = stageDestination(f.session.value.draft, added.metadata.id, added);
  const receipt = { kind: 'POLICY', draft, candidatePolicy: assessDraft(draft, draft.baseline).candidatePolicy,
    expectedProposalId: 1, proposalId: null, baseConfigurationRevision: 0, phase: 'PREPARED', owner: null };
  const frozen = f.session.set({ version: 1, draft: null, receipt });
  f.session.setEditor({ ...editor, name: 'Late input cannot recreate draft' });
  assert.equal(await frozen, true); await f.session.idle();
  assert.equal(f.writes.length, 2); assert.deepEqual((await f.raw.load()).value.receipt, receipt);
  assert.equal(f.session.value.draft, null); assert.deepEqual(f.controller.getView().snapshot, f.before);
});

test('failed editor persistence retains newest input, stops automatic writes and explicitly retries current work', async t => {
  const f = await model(t), save = f.repository.save; let failures = 0;
  f.repository.save = async () => { failures++; return { type: 'FAILED' }; };
  for (let i = 0; i < 140; i++) f.session.setEditor({ ...editor, name: `Unacknowledged ${i}` });
  await f.session.idle();
  assert.equal(failures, 1); assert.equal(f.session.failure, 'FAILED'); assert.equal(f.session.unsaved, true);
  assert.equal((await f.raw.load()).value.draft.editor.name, editor.name);
  f.session.setEditor({ ...editor, name: 'Newest after failure' }); await f.session.idle(); assert.equal(failures, 1);
  f.repository.save = save; assert.equal(await f.session.retry(), true);
  assert.equal((await f.raw.load()).value.draft.editor.name, 'Newest after failure');
  assert.equal(f.session.unsaved, false); assert.equal(f.session.failure, null);
});

test('an unknown editor write outcome stays unsaved and a retry cannot overwrite a newer durable revision', async t => {
  const f = await model(t), save = f.repository.save;
  f.repository.save = async (...args) => { await save(...args); return { type: 'UNCERTAIN' }; };
  f.session.setEditor({ ...editor, name: 'Possibly committed' }); await f.session.idle();
  assert.equal(f.session.failure, 'UNCERTAIN'); assert.equal(f.session.unsaved, true);
  f.session.setEditor({ ...editor, name: 'Newest unresolved input' });
  f.repository.save = save; assert.equal(await f.session.retry(), false);
  assert.equal(f.session.conflict, true); assert.equal(f.session.value.draft.editor.name, 'Newest unresolved input');
  assert.equal((await f.raw.load()).value.draft.editor.name, 'Possibly committed');
});

test('a concurrent writer wins once while the local editor retains newest unsaved work without a retry loop', async t => {
  const f = await model(t), other = await openDraftRepository(f.factory, 'editor-persistence'); t.after(() => other.close());
  const began = deferred(), release = deferred(), save = f.repository.save; let attempts = 0;
  f.repository.save = async (...args) => { attempts++; began.resolve(); await release.promise; return save(...args); };
  f.session.setEditor({ ...editor, name: 'Local in flight' }); await began.promise;
  f.session.setEditor({ ...editor, name: 'Newest local input' });
  const envelope = await other.load(), remote = structuredClone(envelope.value); remote.draft.editor.name = 'Other page';
  assert.equal((await other.save(envelope.revision, remote)).type, 'SAVED');
  release.resolve(); await f.session.idle();
  assert.equal(attempts, 1); assert.equal(f.session.conflict, true); assert.equal(f.session.unsaved, true);
  assert.equal(f.session.value.draft.editor.name, 'Newest local input');
  assert.equal((await f.raw.load()).value.draft.editor.name, 'Other page');
});

test('a raw editor update cannot target a different destination or revive a closed editor', async t => {
  const f = await model(t);
  f.session.setEditor({ ...editor, id: 'host:another.example', name: 'Wrong target' }); await f.session.idle();
  assert.equal(f.writes.length, 0); assert.equal(f.session.value.draft.editor.name, editor.name);
  f.session.setEditor(null); await f.session.idle(); assert.equal(f.session.value.draft.editor, null);
  f.session.setEditor({ ...editor, name: 'Stale event' }); await f.session.idle();
  assert.equal(f.writes.length, 1); assert.equal((await f.raw.load()).value.draft.editor, null);
});
