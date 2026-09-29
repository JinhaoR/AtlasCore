import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTarget } from '../dist/index.js';

test('bare hostnames normalize case, surrounding whitespace and a trailing root dot', () => {
  for (const input of ['mail.example', ' MAIL.EXAMPLE. ', 'mail.example.']) {
    assert.deepEqual(normalizeTarget(input), { hostname: 'mail.example' });
  }
});

test('a SiteTarget object is normalized without changing the supplied object', () => {
  const input = Object.freeze({ hostname: ' MAIL.EXAMPLE. ' });

  assert.deepEqual(normalizeTarget(input), { hostname: 'mail.example' });
  assert.deepEqual(input, { hostname: ' MAIL.EXAMPLE. ' });
});

test('HTTP and HTTPS URLs return only the hostname', () => {
  for (const input of [
    'http://MAIL.EXAMPLE/messages',
    ' HTTPS://MAIL.EXAMPLE.:8443/messages?view=compact#summary ',
  ]) {
    assert.deepEqual(normalizeTarget(input), { hostname: 'mail.example' });
  }
});

test('normalization preserves www and subdomain distinctions', () => {
  assert.deepEqual(normalizeTarget('WWW.MAIL.EXAMPLE'), {
    hostname: 'www.mail.example',
  });
  assert.deepEqual(normalizeTarget('child.mail.example'), {
    hostname: 'child.mail.example',
  });
});

test('malformed hostnames and unsupported input shapes are rejected', () => {
  for (const input of [
    null,
    undefined,
    42,
    false,
    {},
    [],
    { hostname: null },
    { hostname: 'https://mail.example' },
    '',
    '   ',
    'mail example',
    'mail..example',
    'mail.example..',
    '-mail.example',
    'mail-.example',
    '*.example',
    'mail.example/path',
    'mail.example:443',
    `${'a'.repeat(64)}.example`,
  ]) {
    assert.equal(normalizeTarget(input), null);
  }
});

test('unsupported schemes and malformed URL authorities are rejected', () => {
  for (const input of [
    'ftp://mail.example',
    'mailto:mail.example',
    '//mail.example',
    'https://',
    'https:///mail.example',
    'https://@mail.example',
    'https://mail.example:65536',
    'https://mail.example\\other.example',
  ]) {
    assert.equal(normalizeTarget(input), null);
  }
});

test('Unicode hostnames and IP literals are outside the initial supported target set', () => {
  for (const input of [
    'm\u00e4il.example',
    'https://m\u00e4il.example',
    '127.0.0.1',
    'https://127.0.0.1',
    '[::1]',
    'https://[::1]',
  ]) {
    assert.equal(normalizeTarget(input), null);
  }
});
