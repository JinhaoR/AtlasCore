import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate } from '../dist/index.js';

test('a whitelisted domain returns ALLOW', () => {
  assert.deepEqual(
    evaluate('mail.example', { whitelist: ['mail.example'], blacklist: [] }),
    {
      outcome: 'ALLOW',
      reason: 'WHITELISTED',
      target: { hostname: 'mail.example' },
    },
  );
});

test('a blacklisted domain returns DENY', () => {
  assert.deepEqual(
    evaluate('blocked.example', { whitelist: [], blacklist: ['blocked.example'] }),
    {
      outcome: 'DENY',
      reason: 'BLACKLISTED',
      target: { hostname: 'blocked.example' },
    },
  );
});

test('an unknown domain returns GREYLIST', () => {
  assert.deepEqual(
    evaluate('unknown.example', { whitelist: ['mail.example'], blacklist: [] }),
    {
      outcome: 'GREYLIST',
      reason: 'UNLISTED',
      target: { hostname: 'unknown.example' },
    },
  );
});

test('blacklist overrides whitelist after normalization', () => {
  assert.deepEqual(
    evaluate('https://mail.example/messages', {
      whitelist: ['mail.example'],
      blacklist: [' MAIL.EXAMPLE. '],
    }),
    {
      outcome: 'DENY',
      reason: 'BLACKLISTED',
      target: { hostname: 'mail.example' },
    },
  );
});

test('requests and policy entries use the same hostname normalization', () => {
  const policy = { whitelist: [' MAIL.EXAMPLE. '], blacklist: [] };
  const expected = {
    outcome: 'ALLOW',
    reason: 'WHITELISTED',
    target: { hostname: 'mail.example' },
  };

  for (const input of [
    ' mail.example ',
    'https://MAIL.EXAMPLE.:8443/messages?view=compact#summary',
    { hostname: ' MAIL.EXAMPLE. ' },
  ]) {
    assert.deepEqual(evaluate(input, policy), expected);
  }
});

test('www, subdomains and lookalike hosts do not inherit an exact hostname rule', () => {
  const policy = { whitelist: ['mail.example'], blacklist: [] };

  for (const hostname of [
    'www.mail.example',
    'child.mail.example',
    'mail.example.other.example',
    'othermail.example',
  ]) {
    assert.deepEqual(evaluate(hostname, policy), {
      outcome: 'GREYLIST',
      reason: 'UNLISTED',
      target: { hostname },
    });
  }
});

test('malformed or unsupported requested targets fail closed', () => {
  const policy = { whitelist: ['mail.example'], blacklist: [] };

  for (const input of [
    null,
    undefined,
    42,
    '',
    'not a hostname',
    'https://',
    'ftp://mail.example',
    '*.mail.example',
    'https://127.0.0.1',
    {},
    [],
    { hostname: 42 },
    { hostname: 'https://mail.example' },
  ]) {
    assert.deepEqual(evaluate(input, policy), {
      outcome: 'DENY',
      reason: 'INVALID_TARGET',
    });
  }
});

test('missing or malformed policy state fails closed', () => {
  for (const policy of [
    null,
    undefined,
    [],
    {},
    { whitelist: ['mail.example'] },
    { blacklist: [] },
    { whitelist: 'mail.example', blacklist: [] },
    { whitelist: ['mail.example'], blacklist: null },
    { whitelist: ['mail.example', 42], blacklist: [] },
    { whitelist: ['https://mail.example'], blacklist: [] },
    { whitelist: ['mail.example'], blacklist: [], greylist: [] },
  ]) {
    assert.deepEqual(evaluate('mail.example', policy), {
      outcome: 'DENY',
      reason: 'INVALID_POLICY',
    });
  }
});

test('Unicode Kelvin sign cannot case-fold into an allowed ASCII hostname', () => {
  const policy = { whitelist: ['k.example'], blacklist: [] };

  for (const input of ['\u212A.example', { hostname: '\u212A.example' }]) {
    assert.deepEqual(evaluate(input, policy), {
      outcome: 'DENY',
      reason: 'INVALID_TARGET',
    });
  }

  for (const invalidPolicy of [
    { whitelist: ['\u212A.example'], blacklist: [] },
    { whitelist: ['k.example'], blacklist: ['\u212A.example'] },
  ]) {
    assert.deepEqual(evaluate('k.example', invalidPolicy), {
      outcome: 'DENY',
      reason: 'INVALID_POLICY',
    });
  }
});

test('one invalid blacklist entry invalidates the policy even when whitelist matches', () => {
  assert.deepEqual(
    evaluate('mail.example', {
      whitelist: ['mail.example'],
      blacklist: ['blocked.example', '*.example'],
    }),
    { outcome: 'DENY', reason: 'INVALID_POLICY' },
  );
});

test('evaluation is deterministic for identical requests and policy', () => {
  const policy = {
    whitelist: ['mail.example'],
    blacklist: ['blocked.example'],
  };

  for (const input of ['mail.example', 'blocked.example', 'unknown.example']) {
    const firstDecision = evaluate(input, policy);
    for (let repetition = 0; repetition < 5; repetition += 1) {
      assert.deepEqual(evaluate(input, policy), firstDecision);
      assert.deepEqual(evaluate(input, structuredClone(policy)), firstDecision);
    }
  }
});

test('evaluation does not mutate policy state or the requested target', () => {
  const policy = Object.freeze({
    whitelist: Object.freeze([' MAIL.EXAMPLE. ', 'other.example']),
    blacklist: Object.freeze([' BLOCKED.EXAMPLE. ']),
  });
  const before = structuredClone(policy);
  const input = Object.freeze({ hostname: ' MAIL.EXAMPLE. ' });

  assert.equal(evaluate(input, policy).outcome, 'ALLOW');
  assert.equal(evaluate('blocked.example', policy).outcome, 'DENY');
  assert.equal(evaluate('unknown.example', policy).outcome, 'GREYLIST');
  assert.deepEqual(policy, before);
  assert.deepEqual(input, { hostname: ' MAIL.EXAMPLE. ' });
});
