import test from 'node:test';
import assert from 'node:assert/strict';
import { configurationFromDraft, timingFields } from '../dist/lib/ui/settings-model.js';

const draft = () => ({
  'access-wait': '1.001', 'access-window': '30', 'grant-duration': '600',
  'vault-wait': '1e2', 'vault-window': '20', 'journey-lifetime': '90', 'journey-hops': '4',
});

test('settings proposals retain exact millisecond terms for decimal and scientific input', () => {
  const input = draft();
  const before = structuredClone(input);
  const configuration = configurationFromDraft(input);
  assert.equal(configuration.accessTiming.waitMs, 1001);
  assert.equal(configuration.vaultTiming.waitMs, 100000);
  assert.equal(configuration.journeyLimits.maxHops, 4);
  assert.deepEqual(input, before);
  assert.equal(configurationFromDraft({ ...input, 'access-wait': '9007199254740.991' }).accessTiming.waitMs, Number.MAX_SAFE_INTEGER);
  assert.equal(configurationFromDraft({ ...input, 'access-wait': '0.0010' }).accessTiming.waitMs, 1);
  assert.equal(configurationFromDraft({ ...input, 'access-wait': '.001' }).accessTiming.waitMs, 1);
});

test('settings drafts cannot round fractional milliseconds or invalid bounds into a valid proposal', () => {
  for (const value of ['1.0005', '1000000000000.0001', '0.0004', '0', '-1', '', '.', 'Infinity', 'NaN', '9007199254740.992', '9007199254740992']) {
    assert.equal(configurationFromDraft({ ...draft(), 'access-wait': value }), null, value);
  }
  for (const value of ['0', '1.5', '4.0000000000000001', '-1', '', 'Infinity', '9007199254740992']) {
    assert.equal(configurationFromDraft({ ...draft(), 'journey-hops': value }), null, value);
  }
});

test('rendering existing settings preserves every millisecond when proposing an unchanged draft', () => {
  for (const wait of ['0.001', '1.01', '9007199254740.991']) {
    const configuration = configurationFromDraft({ ...draft(), 'access-wait': wait });
    const rendered = Object.fromEntries(timingFields.map((field) => [field.id, field.value(configuration)]));
    assert.deepEqual(configurationFromDraft(rendered), configuration);
  }
});
