import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTarget } from '../dist/index.js';
import { normalizeHostname } from '../dist/target.js';

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

test('hostname and label length boundaries preserve one optional root dot', () => {
  const longest = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
  assert.equal(longest.length, 253);
  for (const input of [longest, longest.toUpperCase(), `${longest}.`, `  ${longest}.  `]) {
    assert.equal(normalizeHostname(input), longest);
  }
  for (const input of [`${longest}a`, `${longest}a.`, `${longest}..`, `${'a'.repeat(64)}.example`,
    'a'.repeat(1_000_000), '.', '..', '.example', 'a..example', 'a-.example', '-a.example']) {
    assert.equal(normalizeHostname(input), null);
  }
});

test('every non-ASCII code unit is rejected inside a hostname before case folding', () => {
  const allowed = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.';
  for (let code = 0; code <= 0xffff; code++) {
    const char = String.fromCharCode(code), input = `a${char}b.example`;
    assert.equal(normalizeHostname(input), allowed.includes(char) ? input.toLowerCase() : null, `code unit ${code}`);
  }
  for (const input of ['\u212a.example', '\u017f.example', '\u{1d400}.example', 'a\u{1f600}.example']) {
    assert.equal(normalizeHostname(input), null);
  }
});

test('ASCII labels retain numeric-label support without admitting IP or URL shorthand', () => {
  for (const input of ['123.example', 'a-b.example', '0x7f.example', 'a', 'xn--bcher-kva.example']) {
    assert.equal(normalizeHostname(input), input);
  }
  for (const input of ['123', '127.0.0.1', '127.1', '0177.0.0.1', '0x7f000001', '0x7f.1']) {
    assert.equal(normalizeHostname(input), null);
  }
});
