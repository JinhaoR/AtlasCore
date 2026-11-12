import test from 'node:test';
import assert from 'node:assert/strict';
import { pinAccessStatus } from '../dist/lib/ui/pin-status.js';
import { fixture } from './support/fixture.mjs';

test('pin labels retain acknowledged access during housekeeping, but never during unavailable authority', async t => {
  const f = await fixture(t), controller = f.controller.getView();
  const view = { controller, temporaryAccess: [], pendingAccess: [] };
  const hostname = controller.snapshot.policy.whitelist[0];
  assert.ok(hostname);
  assert.equal(pinAccessStatus(view, `https://${hostname}/`, 100), 'Allowed');
  for (const status of ['LOADING', 'COMMITTING']) {
    assert.equal(pinAccessStatus({ ...view, controller: { ...controller, status } }, `https://${hostname}/`, 100), 'Allowed');
    assert.equal(pinAccessStatus({ ...view, controller: { ...controller, status, snapshot: null } }, `https://${hostname}/`, 100), 'Access unverified');
  }
  for (const status of ['UNAVAILABLE', 'RECONCILING', 'UNINITIALIZED'])
    assert.equal(pinAccessStatus({ ...view, controller: { ...controller, status } }, `https://${hostname}/`, 100), 'Access unverified');
});

test('pin presentation retains exact temporary deadlines, current policy precedence and no automatic permission', async t => {
  const f = await fixture(t), controller = f.controller.getView(), before = structuredClone(controller);
  const view = { controller, temporaryAccess: [{ hostnames: ['unknown.example'], expiresAt: 200 }], pendingAccess: [] };
  assert.equal(pinAccessStatus(view, 'https://unknown.example/path', 199), 'Temporary access');
  assert.equal(pinAccessStatus(view, 'https://unknown.example/path', 200), 'No saved access rule · checked when opened');
  assert.equal(pinAccessStatus(view, 'https://other.unknown.example/path', 199), 'No saved access rule · checked when opened');
  const blocked = { ...view, controller: { ...controller, snapshot: { ...controller.snapshot, policy: { whitelist: [], blacklist: ['unknown.example'] } } } };
  assert.equal(pinAccessStatus(blocked, 'https://unknown.example/path', 199), 'Blocked');
  assert.deepEqual(controller, before);
});
