import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { countdown } from '../dist/lib/ui/presentation.js';
import { deferred } from './support/fixture.mjs';

const source = (await readFile(new URL('../dist/lib/content/journey-indicator.js', import.meta.url), 'utf8')).replace(/^import .*\r?\n/, '');
const display = { journeyId: 1, destinationLabel: 'Synthetic root', expiresAt: 10000 };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

async function fixture(read) {
  let sequence = 0, reads = 0, listener;
  const clock = { now: 1000 }, timers = new Map(), events = new Map();
  const node = () => ({ id: '', dataset: {}, style: {}, textContent: '', children: [], parent: null,
    setAttribute() {},
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
    attachShadow() { return this.shadowRoot = node(); } });
  const root = node();
  vm.runInNewContext(source, {
    countdown, Date: { now: () => clock.now },
    document: { documentElement: root, readyState: 'complete', createElement: node },
    window: { addEventListener: (name, callback) => events.set(name, callback) },
    browser: { runtime: { id: 'synthetic', onMessage: { addListener: callback => { listener = callback; } },
      sendMessage: command => { assert.deepEqual({ ...command }, { kind: 'GET_JOURNEY_DISPLAY' }); return read(++reads); } } },
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: clock.now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  await settle();
  return { host: () => root.children.find(child => child.id === 'atlas-journey-indicator') ?? null,
    reads: () => reads, timers, events,
    push: presentation => listener({ kind: 'ATLAS_JOURNEY_DISPLAY', presentation }, { id: 'synthetic' }),
    tick: async ms => {
      clock.now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > clock.now || !timers.has(id)) continue;
        timers.delete(id); timer.callback(); await settle();
      }
      await settle();
    } };
}

test('a push during an overlapping indicator read retains native nodes and schedules one fresh follow-up', async () => {
  const held = deferred();
  const f = await fixture(number => number === 2 ? held.promise : Promise.resolve({ presentation: display }));
  const host = f.host(); assert.ok(host);
  await f.tick(1000); f.events.get('pageshow')(); await settle(); f.push(display);
  await f.tick(1000); f.events.get('pageshow')(); await settle();
  assert.equal(f.reads(), 2, 'the overlapping timer cannot start parallel reads');
  held.resolve({ presentation: display }); await settle();
  assert.equal(f.reads(), 3, 'a consumed timer requires one follow-up after the old read settles');
  await f.tick(1000);
  assert.equal(f.host(), host); assert.equal(f.timers.size, 1);
  assert.equal(display.expiresAt, 10000);
});

test('the original two-second lease clears hung display; recovery needs a fresh reply and expiry never renews', async () => {
  const held = deferred();
  const f = await fixture(number => number === 2 ? held.promise : Promise.resolve({ presentation: display }));
  const host = f.host();
  await f.tick(1000); f.events.get('pageshow')(); await settle(); await f.tick(1000);
  assert.equal(f.host(), null, 'unresponsive background clears the indicator at the existing deadline');
  held.resolve({ presentation: display }); await settle();
  assert.equal(f.reads(), 3); assert.ok(f.host()); assert.notEqual(f.host(), host);
  await f.tick(7000);
  assert.equal(f.host(), null); assert.equal(f.timers.size, 0); assert.equal(display.expiresAt, 10000);
});

test('page unload cancels timers and a late pending reply cannot recreate an indicator', async () => {
  const held = deferred();
  const f = await fixture(number => number === 2 ? held.promise : Promise.resolve({ presentation: display }));
  await f.tick(1000); f.events.get('pageshow')(); await settle(); f.push(display);
  await f.tick(1000); f.events.get('pageshow')(); await settle();
  f.events.get('pagehide')(); held.resolve({ presentation: display }); await settle();
  assert.equal(f.host(), null); assert.equal(f.timers.size, 0); assert.equal(f.reads(), 2);
});
