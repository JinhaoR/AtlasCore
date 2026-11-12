import test from 'node:test';
import assert from 'node:assert/strict';
import { viewportScrollSurface } from '../dist/lib/ui/viewport-scroll.js';

test('scroll ownership follows visible desktop panes and document-flow fallback', t => {
  const previous = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  const nodes = new Map(), documentScroll = {};
  globalThis.document = { getElementById: id => nodes.get(id), scrollingElement: documentScroll };
  globalThis.getComputedStyle = node => ({ overflowY: node.overflow });
  t.after(() => Object.assign(globalThis, previous));
  const add = (id, overflow = 'auto', hidden = false) => {
    const n = { clientHeight: 400, overflow, closest: () => hidden ? {} : null }; nodes.set(id, n); return n;
  };
  const main = add('main-content'), categories = add('sites-categories');
  assert.equal(viewportScrollSurface('home', 'browse'), main);
  assert.equal(viewportScrollSurface('sites', 'browse'), categories);
  add('sites-categories', 'auto', true); const list = add('sites-list');
  assert.equal(viewportScrollSurface('sites', 'browse'), list);
  const editor = add('sites-editor'), review = add('destination-draft-items');
  assert.equal(viewportScrollSurface('sites', 'detail'), editor);
  assert.equal(viewportScrollSurface('sites', 'review'), review);
  for (const [page, id] of [['settings', 'settings-workspace'], ['vault', 'vault-contents'], ['access', 'pending-access-list']]) {
    const n = add(id); assert.equal(viewportScrollSurface(page, 'browse'), n);
  }
  for (const n of nodes.values()) n.overflow = 'visible';
  assert.equal(viewportScrollSurface('home', 'browse'), documentScroll);
  assert.equal(viewportScrollSurface('sites', 'review'), documentScroll);
});
