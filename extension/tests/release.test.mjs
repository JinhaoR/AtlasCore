import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { zipSync } from 'fflate';
import { addonId, checkArchive, checkRuntimeFiles, cleanEnvironment, deterministicZip, parseCommand,
  runtimeFiles, safePath, signRelease, signatureFiles, signingArguments, validateLockfile, validateManifest,
  validVersion, verifySignedArchive } from '../scripts/release.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const bytes = text => new TextEncoder().encode(text);
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const otherVersion = manifest.version === '0.0.0' ? '0.0.1' : '0.0.0';
const metadata = () => Object.fromEntries(signatureFiles.map(name => [name, bytes(`synthetic metadata: ${name}; not a real signature`)]));
const fileHashes = files => Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)]));
function signedFixture() {
  const files = { 'manifest.json': bytes(JSON.stringify(manifest)), 'background.js': bytes('unchanged runtime') };
  const unsignedBytes = deterministicZip(files);
  return { files, unsignedBytes, receipt: { runtime: fileHashes(files), unsignedSha256: hash(unsignedBytes) } };
}

test('release identity and data declaration stay aligned with the development manifest', () => {
  validateManifest(manifest, manifest.version);
  for (const mutate of [value => { value.version = otherVersion; },
    value => { value.browser_specific_settings.gecko.id = 'different@atlas.invalid'; },
    value => { value.browser_specific_settings.gecko.data_collection_permissions.required = ['none']; },
    value => { value.browser_specific_settings.gecko.update_url = 'https://example.com'; }]) {
    const value = structuredClone(manifest); mutate(value);
    assert.throws(() => validateManifest(value, manifest.version), /RELEASE_MANIFEST_INVALID/);
  }
});
test('versions reject malformed, path-bearing and out-of-range values', () => {
  for (const value of ['1.2.3', '0.1.13', '65535.0.0']) assert.equal(validVersion(value), true);
  for (const value of ['01.2.3', '1.2', '1.2.3-beta', '../../foo', '65536.1.0', null]) assert.equal(validVersion(value), false);
});
test('package and lockfile versions/dependencies must match before packaging', () => {
  const pkg = { version: '0.1.13', dependencies: { dependency: '1.0.0' } };
  const lock = { version: pkg.version, packages: { '': structuredClone(pkg) } };
  validateLockfile(pkg, lock);
  for (const mutate of [value => { value.version = '0.1.12'; },
    value => { value.packages[''].dependencies.dependency = '2.0.0'; }]) {
    const invalid = structuredClone(lock); mutate(invalid);
    assert.throws(() => validateLockfile(pkg, invalid), /PACKAGE_LOCK_MISMATCH/);
  }
});
test('reviewer lockfiles cannot embed registry credentials', () => {
  const pkg = { version: '0.1.13' };
  assert.throws(() => validateLockfile(pkg, { version: pkg.version, packages: {
    '': pkg, 'node_modules/dependency': { resolved: 'https://fixture-user:fixture-secret@example.com/file.tgz' },
  } }), /CREDENTIAL_BEARING_LOCKFILE_URL/);
});
test('runtime allowlist contains all required assets and excludes development artifacts', () => {
  for (const name of [...manifest.background.scripts, ...manifest.content_scripts.flatMap(value => value.js),
    ...Object.values(manifest.icons), manifest.options_ui.page, 'ui/main.js', 'ui/style.css', 'data/stevenblack/hosts']) {
    assert.ok(runtimeFiles.includes(name), name);
  }
  assert.equal(runtimeFiles.some(name => /node_modules|\.map$|tests|dist\/lib|\.env/.test(name)), false);
});
test('archives use deterministic ordering and timestamps and reject changed/missing/extra files', () => {
  const files = { 'manifest.json': bytes('{}'), 'ui/main.js': bytes('runtime') };
  const expected = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)]));
  const archive = deterministicZip(files);
  assert.deepEqual(archive, deterministicZip({ 'ui/main.js': files['ui/main.js'], 'manifest.json': files['manifest.json'] }));
  checkArchive(archive, expected);
  for (const bad of [{ ...files, '.env': bytes('secret') }, { ...files, 'ui/main.js': bytes('changed') }, { 'manifest.json': files['manifest.json'] }]) {
    assert.throws(() => checkArchive(deterministicZip(bad), expected), /ARCHIVE_CONTENT_MISMATCH/);
  }
});
test('archive paths cannot escape their root or carry Windows absolute paths', () => {
  for (const name of ['../secret', '/absolute', 'C:/secret', 'a\\b', 'a//b', 'a/./b', 'a/../b', '']) assert.throws(() => safePath(name), /UNSAFE/);
  assert.equal(safePath('ui/main.js'), 'ui/main.js');
});
test('signed archive checking admits Mozilla metadata only alongside unchanged runtime', () => {
  const files = { 'manifest.json': bytes('{}') };
  const expected = { 'manifest.json': hash(files['manifest.json']) };
  assert.throws(() => checkArchive(deterministicZip(files), expected, { signed: true }), /SIGNED_METADATA_MISSING/);
  checkArchive(deterministicZip({ ...files, ...metadata() }), expected, { signed: true });
  assert.throws(() => checkArchive(deterministicZip({ ...files, 'extra.js': bytes('extra'), ...metadata() }), expected, { signed: true }), /ARCHIVE_CONTENT_MISMATCH/);
});
test('signed verification permits manifest pretty printing and CRLF/LF conversion against the frozen original', () => {
  const { files, unsignedBytes, receipt } = signedFixture();
  const signed = deterministicZip({ ...files, 'manifest.json': bytes(JSON.stringify(manifest, null, 2).replaceAll('\n', '\r\n') + '\n'), ...metadata() });
  const result = verifySignedArchive(signed, receipt, unsignedBytes);
  assert.equal(result.manifestFormattingChanged, true);
  assert.equal(result.runtimeFileCount, 2);
  assert.equal(result.exactFileCount, 1);
  assert.deepEqual(result.signatureFiles, signatureFiles);
});
test('compression, ordering, timestamps and empty directory entries do not change signed runtime content', () => {
  const { files, unsignedBytes, receipt } = signedFixture();
  const entries = Object.fromEntries(Object.entries({ ...files, ...metadata(), 'META-INF/': bytes('') }).reverse()
    .map(([name, value]) => [name, [value, { level: 0, mtime: new Date(2001, 0, 1) }]]));
  const signed = zipSync(entries);
  assert.notDeepEqual(signed, deterministicZip({ ...files, ...metadata() }));
  assert.equal(verifySignedArchive(signed, receipt, unsignedBytes).exactFileCount, 2);
});
test('any manifest token change including identity, version, permissions, scripts and CSP still fails', () => {
  const { files, unsignedBytes, receipt } = signedFixture();
  for (const mutate of [value => { value.browser_specific_settings.gecko.id = 'changed@atlas.invalid'; },
    value => { value.version = otherVersion; }, value => { value.permissions.push('cookies'); },
    value => { value.background.scripts.push('evil.js'); }, value => { value.content_scripts[0].all_frames = true; },
    value => { value.content_security_policy = "script-src *"; }, value => { value.name += ' '; },
    value => { value.permissions.reverse(); }, value => { value.additionalField = true; }]) {
    const changed = structuredClone(manifest); mutate(changed);
    assert.throws(() => verifySignedArchive(deterministicZip({ ...files, 'manifest.json': bytes(JSON.stringify(changed, null, 2)), ...metadata() }), receipt, unsignedBytes),
      error => error.message.includes('ARCHIVE_CONTENT_MISMATCH') && error.message.includes('manifest.json') && error.message.includes('actualSha256'));
  }
});
test('invalid JSON, duplicate keys and changed whitespace inside strings cannot use the manifest exception', () => {
  const { files, unsignedBytes, receipt } = signedFixture();
  const duplicate = JSON.stringify(manifest).replace('"manifest_version":2', '"manifest_version":2,"manifest_version":2');
  assert.deepEqual(JSON.parse(duplicate), manifest);
  for (const value of ['{ broken', duplicate, JSON.stringify(manifest).replace('Atlas', ' Atlas')]) {
    assert.throws(() => verifySignedArchive(deterministicZip({ ...files, 'manifest.json': bytes(value), ...metadata() }), receipt, unsignedBytes), /ARCHIVE_CONTENT_MISMATCH/);
  }
  assert.throws(() => verifySignedArchive(deterministicZip({ ...files, 'manifest.json': new Uint8Array([255]), ...metadata() }), receipt, unsignedBytes), /ARCHIVE_CONTENT_MISMATCH/);
});
test('manifest formatting preserves spaces inside escaped quoted strings and backslashes', () => {
  const value = { ...manifest, description: 'A \\ path with "quoted spaces"' };
  const files = { 'manifest.json': bytes(JSON.stringify(value)) };
  const original = deterministicZip(files);
  const receipt = { runtime: fileHashes(files), unsignedSha256: hash(original) };
  verifySignedArchive(deterministicZip({ 'manifest.json': bytes(JSON.stringify(value, null, 2)), ...metadata() }), receipt, original);
  const altered = { ...value, description: value.description.replace('quoted spaces', 'quoted  spaces') };
  assert.throws(() => verifySignedArchive(deterministicZip({ 'manifest.json': bytes(JSON.stringify(altered, null, 2)), ...metadata() }), receipt, original), /ARCHIVE_CONTENT_MISMATCH/);
});
test('genuine changed, missing or added runtime entries report exact filenames', () => {
  const { files, unsignedBytes, receipt } = signedFixture();
  for (const changed of [{ ...files, 'background.js': bytes('modified') }, { 'manifest.json': files['manifest.json'] }, { ...files, 'extra.js': bytes('extra') }]) {
    assert.throws(() => verifySignedArchive(deterministicZip({ ...changed, ...metadata() }), receipt, unsignedBytes),
      error => /ARCHIVE_CONTENT_MISMATCH/.test(error.message) && /background\.js|extra\.js/.test(error.message));
  }
});
test('only known nonempty signature metadata and complete RSA/COSE sets are permitted', () => {
  const { files, unsignedBytes, receipt } = signedFixture();
  const rsa = metadata(); delete rsa['META-INF/cose.manifest']; delete rsa['META-INF/cose.sig'];
  verifySignedArchive(deterministicZip({ ...files, ...rsa }), receipt, unsignedBytes);
  for (const changed of [{ ...metadata(), 'META-INF/extra.js': bytes('unknown') },
    { ...rsa, 'META-INF/cose.sig': bytes('unpaired') }, { ...metadata(), 'META-INF/mozilla.rsa': bytes('') }]) {
    assert.throws(() => verifySignedArchive(deterministicZip({ ...files, ...changed }), receipt, unsignedBytes), /ARCHIVE_CONTENT_MISMATCH|SIGNED_METADATA_MISSING/);
  }
  assert.throws(() => verifySignedArchive(zipSync({ ...files, ...metadata(), 'META-INF/../extra.js': bytes('unsafe') }), receipt, unsignedBytes), /UNSAFE_ARCHIVE_PATH/);
});
test('the manifest comparison reference and preserved unsigned archive must retain original hashes', () => {
  const { files, unsignedBytes, receipt } = signedFixture();
  const signed = deterministicZip({ ...files, ...metadata() });
  assert.throws(() => checkArchive(signed, receipt.runtime, { signed: true, manifestBytes: bytes('{}') }), /UNSIGNED_MANIFEST_MISMATCH/);
  assert.throws(() => verifySignedArchive(signed, receipt, deterministicZip({ ...files, 'extra.js': bytes('extra') })), /ARCHIVE_CHANGED/);
});
test('duplicate archive entries and directory entries carrying data fail closed', () => {
  const duplicate = Buffer.from(deterministicZip({ 'ui/a.js': bytes('a'), 'ui/b.js': bytes('b') }));
  const name = Buffer.from('ui/b.js');
  let replacements = 0;
  for (let at = duplicate.indexOf(name); at !== -1; at = duplicate.indexOf(name, at + name.length)) {
    duplicate.set(Buffer.from('ui/a.js'), at); ++replacements;
  }
  assert.equal(replacements, 2); // Local entry name and central directory name.
  assert.throws(() => checkArchive(duplicate, { 'ui/a.js': hash(bytes('a')) }), /DUPLICATE_ARCHIVE_ENTRY/);
  assert.throws(() => checkArchive(zipSync({ 'ui/': bytes('hidden payload') }), {}), /INVALID_DIRECTORY_ENTRY/);
});
test('web-ext upload bookkeeping is tolerated only in post-sign staging and never in packages', () => {
  const names = [...runtimeFiles, '.amo-upload-uuid'];
  checkRuntimeFiles(names, { afterSigning: true });
  assert.throws(() => checkRuntimeFiles(names), /UNEXPECTED_RUNTIME_FILES/);
  assert.throws(() => checkRuntimeFiles([...names, '.env'], { afterSigning: true }), /UNEXPECTED_RUNTIME_FILES/);
  const { files, unsignedBytes, receipt } = signedFixture();
  assert.throws(() => verifySignedArchive(deterministicZip({ ...files, ...metadata(), '.amo-upload-uuid': bytes('fixture') }), receipt, unsignedBytes), /ARCHIVE_CONTENT_MISMATCH/);
});
test('offline command accepts a preserved version and rejects signing/configuration options', () => {
  assert.deepEqual(parseCommand(['verify-signed']), { command: 'verify-signed' });
  assert.deepEqual(parseCommand(['verify-signed', '0.1.13']), { command: 'verify-signed', version: '0.1.13' });
  for (const args of [['verify-signed', '--channel=listed'], ['verify-signed', '../other'], ['verify-signed', '0.1.13', '--config']]) assert.throws(() => parseCommand(args), /USAGE/);
});
test('signing has a fixed unlisted channel and accepts no command-line overrides', () => {
  const args = signingArguments({ addon: 'stage', signed: 'signed', source: 'source.zip' });
  assert.deepEqual(args, ['sign', '--channel=unlisted', '--source-dir', 'stage', '--artifacts-dir', 'signed',
    '--upload-source-code', 'source.zip', '--amo-base-url=https://addons.mozilla.org/api/v5/', '--no-config-discovery', '--no-input']);
  for (const bad of [['sign', '--channel=listed'], ['sign', '--config', 'private.json'], ['sign', 'listed'], []]) assert.throws(() => parseCommand(bad), /USAGE/);
  assert.deepEqual(parseCommand(['sign']), { command: 'sign' });
});
test('environment channel/config/API overrides are removed; credentials stay out of arguments', () => {
  const environment = { PATH: 'normal', WEB_EXT_CHANNEL: 'listed', WEB_EXT_CONFIG: 'secret.json',
    WEB_EXT_AMO_BASE_URL: 'https://wrong.invalid', WEB_EXT_VERBOSE: 'true', WEB_EXT_API_KEY: 'test-key', WEB_EXT_API_SECRET: 'test-secret' };
  assert.deepEqual(cleanEnvironment(environment), { PATH: 'normal' });
  assert.deepEqual(cleanEnvironment(environment, true), { PATH: 'normal', WEB_EXT_API_KEY: 'test-key', WEB_EXT_API_SECRET: 'test-secret' });
  assert.equal(signingArguments({ addon: 'stage', signed: 'signed', source: 'source.zip' }).some(value => value.includes('test-secret')), false);
});
test('missing credentials or failed validation prevent submission', async () => {
  let called = false;
  await assert.rejects(signRelease({ environment: {}, validate: async () => { called = true; }, run: async () => { called = true; } }), /MISSING_WEB_EXT_API_KEY/);
  assert.equal(called, false);
  await assert.rejects(signRelease({ environment: { WEB_EXT_API_KEY: 'fixture', WEB_EXT_API_SECRET: 'fixture-secret' },
    validate: async () => { throw new Error('SOURCE_CHANGED'); }, run: async () => { called = true; } }), /SOURCE_CHANGED/);
  assert.equal(called, false);
});
test('signing orchestration checks the downloaded package and prevents duplicate local submission', async t => {
  const output = [];
  t.mock.method(console, 'log', (...args) => { output.push(args.join(' ')); });
  const directory = await mkdtemp(join(tmpdir(), 'atlas-release-test-'));
  try {
    const paths = { addon: 'fixture-stage', signed: join(directory, 'signed'), source: 'fixture-source.zip', unsigned: join(directory, 'unsigned.zip') };
    const files = { 'manifest.json': bytes(JSON.stringify({ browser_specific_settings: { gecko: { id: addonId } } })) };
    const unsignedBytes = deterministicZip(files);
    await writeFile(paths.unsigned, unsignedBytes);
    let calls = 0;
    const options = { environment: { WEB_EXT_CHANNEL: 'listed', WEB_EXT_API_KEY: 'fake-key', WEB_EXT_API_SECRET: 'fake-secret' },
      validate: async () => ({ paths, receipt: { runtime: fileHashes(files), unsignedSha256: hash(unsignedBytes) } }),
      run: async (_script, args, environment) => {
        ++calls; assert.ok(args.includes('--channel=unlisted')); assert.equal(environment.WEB_EXT_CHANNEL, undefined);
        await writeFile(join(paths.signed, 'fixture.xpi'), deterministicZip({ ...files, ...metadata() }));
        return 'fake-key fake-secret';
      } };
    await signRelease(options);
    await assert.rejects(signRelease(options), /SIGNED_VERSION_EXISTS/);
    assert.equal(calls, 1);
    assert.ok(output.some(line => line.includes('[REDACTED]')));
    assert.ok(output.every(line => !line.includes('fake-key') && !line.includes('fake-secret')));
  } finally {
    // This unique test directory is owned by this test, never a supplied profile.
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    await rm(directory, { recursive: true, force: true });
  }
});
