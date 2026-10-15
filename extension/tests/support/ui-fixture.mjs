import assert from 'node:assert/strict';
import { initializeSites } from '../../dist/lib/ui/sites.js';
import { openDraftRepository } from '../../dist/lib/ui/draft-storage.js';
import { fixture } from './fixture.mjs';

export const metadataKey = 'atlas-destinations-v1';
export const original = { id: 'host:root.example', label: 'Original', category: 'Your destinations', primaryHostname: 'root.example', hostnames: ['root.example'] };
export class Node {
  value = ''; checked = false; hidden = false; disabled = false; textContent = ''; dataset = {}; children = []; attrs = {}; listeners = {};
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  closest() { return null; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  fire(type) { for (const listener of this.listeners[type] ?? []) listener({ preventDefault() {} }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelectorAll(selector) { return selector === '.site-row' ? this.children : []; }
  focus() { globalThis.document.activeElement = this; }
}
export function dom(t, saved = new Map([[metadataKey, JSON.stringify({ version: 1, destinations: [original], pending: null })]])) {
  const previous = Object.fromEntries(['document', 'window', 'localStorage', 'matchMedia'].map(name => [name, globalThis[name]]));
  const nodes = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  globalThis.document = { getElementById: el, createElement: () => new Node() };
  globalThis.window = { confirm: () => true, listeners: {}, addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); } };
  globalThis.matchMedia = () => ({ matches: false });
  let mode = 'OK', writes = 0;
  const storage = { getItem(k) { if (mode === 'UNKNOWN') throw Error('unavailable'); return saved.get(k) ?? null; },
    setItem(k, value) { ++writes; if (mode !== 'OK') throw Error('write failure'); saved.set(k, value); } };
  globalThis.localStorage = storage;
  el('sites-filter').value = 'ALL'; el('site-draft').hidden = true; el('retry-site-save').hidden = true;
  t.after(() => { for (const listener of window.listeners.pagehide ?? []) listener();
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete globalThis[name]; else globalThis[name] = value; });
  return { el, storage, saved, clearHandlers: () => { for (const node of nodes.values()) node.listeners = {}; window.listeners = {}; }, writes: () => writes, mode: value => { mode = value; } };
}
export async function sitesFixture(t, options = {}) {
  const context = await fixture(t, true, options), d = dom(t);
  const feedback = []; let proposals = 0, pins = [], failPin = false, available = true, draftMode = 'OK', commandMode = 'OK';
  const raw = await openDraftRepository(context.factory);
  t.after(() => raw.close());
  const repository = { load: () => raw.load(), close() {}, save: (revision, value) => draftMode === 'OK' ? raw.save(revision, value) : Promise.resolve({ type: draftMode }) };
  const settings = { drafts: Promise.resolve(repository), controller: () => available ? context.controller.getView() : undefined,
    attempted: () => true, canEdit: () => available && context.controller.getView().status === 'READY', pins: () => pins,
    pin: (id, pinned) => { if (failPin) return 'FAILED'; pins = [...pins.filter(pin => pin !== id), ...(pinned ? [id] : [])]; return 'SAVED'; },
    propose: async command => {
      if (command.kind === 'PROPOSE_POLICY') {
        ++proposals;
        if (commandMode === 'FAIL') return { result: { type: 'BLOCKED', reason: 'WRITE_FAILED', status: 'READY' } };
        if (commandMode === 'UNKNOWN_BEFORE') return undefined;
        const result = await context.firefox.send(command);
        if (commandMode === 'UNKNOWN_AFTER') return undefined;
        return result;
      }
      return context.firefox.send(command);
    }, vault() {}, changed() {}, feedback: (message, tone) => feedback.push({ message, tone }) };
  const sites = initializeSites(settings); await sites.initialized; sites.render(true);
  const edit = (id = original.id) => { sites.render(true); d.el('sites-list').children.find(n => n.dataset.destinationId === id).fire('click'); d.el('edit-site').fire('click'); };
  const flush = async (target = sites) => { for (let i = 0; i < 12; i++) { await target.refresh(); await target.idle(); await context.adapter.whenIdle(); await new Promise(resolve => setImmediate(resolve)); } };
  const stage = async () => { d.el('site-form').fire('submit'); await flush(); sites.render(true); };
  const submit = async () => { d.el('review-destination-draft').fire('click'); sites.render(true); d.el('submit-destination-draft').fire('click'); await flush(); sites.render(true); };
  const confirm = async () => {
    const pending = context.controller.getView().snapshot.vaultState.pendingProposal;
    assert.ok(pending); context.clock.time = pending.readyAt;
    const result = await context.firefox.send({ kind: 'CONFIRM_POLICY', proposalId: pending.id });
    sites.render(true); await flush(); sites.render(true); return result;
  };
  return { ...context, ...d, sites, settings, raw, feedback, edit, flush, stage, submit, confirm, proposals: () => proposals,
    failPin: value => { failPin = value; }, available: value => { available = value; }, draftMode: value => { draftMode = value; }, commandMode: value => { commandMode = value; } };
}
