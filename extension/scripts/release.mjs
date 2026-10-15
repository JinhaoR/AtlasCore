import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { verifyDistribution } from './verify-bundle.mjs';

export const addonId = 'atlas-development@atlas.invalid';
const extension = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(extension, '..');
export const runtimeFiles = [
  'manifest.json', 'background.js', 'journey-indicator.js', 'ui/main.js',
  'ui/index.html', 'ui/style.css', 'ui/atlas.svg', 'ui/site.svg', 'THIRD-PARTY-NOTICES.txt',
  'data/stevenblack/hosts', 'data/stevenblack/metadata.json',
  'data/stevenblack/NOTICE.md', 'data/stevenblack/license.txt', 'data/stevenblack/upstream-readme.md',
].sort();
const sourceDirectories = ['packages/core/src', 'packages/core/tests', 'extension/src', 'extension/tests'];
const sourceFiles = [
  'packages/core/package.json', 'packages/core/package-lock.json', 'packages/core/tsconfig.json',
  'extension/package.json', 'extension/package-lock.json', 'extension/tsconfig.json',
  'extension/manifest.json', 'extension/build.mjs', 'extension/THIRD-PARTY-NOTICES.txt',
  'extension/scripts/release.mjs', 'extension/scripts/verify-bundle.mjs',
  'extension/REVIEWER-BUILD.md', 'docs/firefox-private-release.md', 'docs/firefox-privacy.md', 'docs/firefox-backup.md',
  'docs/firefox-downloads.md', 'docs/home-organization.md', 'docs/visual-polish.md', 'docs/ui-stability.md',
  ...runtimeFiles.filter(name => name.startsWith('data/')).map(name => `extension/${name}`),
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const fail = message => { throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function validVersion(version) {
  return typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    && version.split('.').every(part => Number(part) <= 65535);
}
export function validateManifest(manifest, version) {
  if (!validVersion(version) || manifest.version !== version || manifest.manifest_version !== 2
    || manifest.browser_specific_settings?.gecko?.id !== addonId
    || manifest.browser_specific_settings.gecko.strict_min_version !== '140.0'
    || !same(manifest.browser_specific_settings.gecko.data_collection_permissions?.required, ['browsingActivity'])
    || manifest.browser_specific_settings.gecko.update_url !== undefined) fail('RELEASE_MANIFEST_INVALID');
}
export function validateLockfile(pkg, lock) {
  const ordered = value => Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version
    || ['dependencies', 'devDependencies'].some(key => !same(ordered(pkg[key]), ordered(lock.packages[''][key])))) {
    fail('PACKAGE_LOCK_MISMATCH: run npm install and commit the matching lockfile');
  }
  for (const entry of Object.values(lock.packages)) {
    if (typeof entry.resolved === 'string' && /^https?:/.test(entry.resolved)) {
      const url = new URL(entry.resolved);
      if (url.username || url.password) fail('CREDENTIAL_BEARING_LOCKFILE_URL');
    }
  }
}
export function safePath(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/')
    || name.split('/').some(part => !part || part === '.' || part === '..')
    || /[\x00-\x1f:]/.test(name)) fail('UNSAFE_ARCHIVE_PATH');
  return name;
}
async function listFiles(directory, prefix = '') {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = safePath(`${prefix}${item.name}`);
    if (item.isSymbolicLink()) fail(`SYMLINK_NOT_ALLOWED: ${name}`);
    if (item.isDirectory()) files.push(...await listFiles(resolve(directory, item.name), `${name}/`));
    else if (item.isFile()) files.push(name);
    else fail(`UNSUPPORTED_FILE: ${name}`);
  }
  return files.sort();
}
async function fileMap(directory, names) {
  const result = {};
  for (const name of names) {
    safePath(name);
    // Reject links in every ancestor, including the entry directory.
    let path = directory;
    if ((await lstat(path)).isSymbolicLink()) fail('SYMLINK_NOT_ALLOWED');
    for (const part of name.split('/')) {
      path = resolve(path, part);
      if ((await lstat(path)).isSymbolicLink()) fail(`SYMLINK_NOT_ALLOWED: ${name}`);
    }
    result[name] = await readFile(path);
  }
  return result;
}
function hashes(files) {
  return Object.fromEntries(Object.keys(files).sort().map(name => [name, digest(files[name])]));
}
export const signatureFiles = ['META-INF/manifest.mf', 'META-INF/mozilla.sf', 'META-INF/mozilla.rsa',
  'META-INF/cose.manifest', 'META-INF/cose.sig'].sort();
function readArchive(bytes) {
  const entries = [];
  const seen = new Set();
  const files = unzipSync(bytes, { filter: entry => {
    safePath(entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name);
    if (seen.has(entry.name)) fail(`DUPLICATE_ARCHIVE_ENTRY: ${entry.name}`);
    if (entry.name.endsWith('/') && entry.originalSize !== 0) fail(`INVALID_DIRECTORY_ENTRY: ${entry.name}`);
    seen.add(entry.name); entries.push(entry.name);
    return true;
  } });
  return { files, entries };
}
/** Only insignificant JSON whitespace may differ. Strings, keys, token order and
 * values stay exact. This also rejects duplicate-key tricks that JSON.parse alone hides. */
function compactManifest(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  JSON.parse(text);
  let compact = '', quoted = false, escaped = false;
  for (const character of text) {
    if (quoted) {
      compact += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') { quoted = true; compact += character; }
    else if (!' \t\r\n'.includes(character)) compact += character;
  }
  return compact;
}
export function checkArchive(bytes, expected, { signed = false, manifestBytes } = {}) {
  if (signed && manifestBytes !== undefined && digest(manifestBytes) !== expected['manifest.json']) fail('UNSIGNED_MANIFEST_MISMATCH');
  const { files, entries } = readArchive(bytes);
  const names = entries.filter(name => !name.endsWith('/') && !(signed && signatureFiles.includes(name))).sort();
  const missing = Object.keys(expected).filter(name => !names.includes(name)).sort();
  const unexpected = names.filter(name => !Object.hasOwn(expected, name));
  const changed = [];
  for (const name of names.filter(name => Object.hasOwn(expected, name))) {
    const actualSha256 = digest(files[name]);
    if (actualSha256 === expected[name]) continue;
    if (signed && name === 'manifest.json' && manifestBytes !== undefined) {
      try { if (compactManifest(files[name]) === compactManifest(manifestBytes)) continue; }
      catch { /* Invalid JSON/UTF-8 remains a runtime mismatch. */ }
    }
    changed.push({ name, expectedSha256: expected[name], actualSha256 });
  }
  if (missing.length || unexpected.length || changed.length) {
    fail(`ARCHIVE_CONTENT_MISMATCH: ${JSON.stringify({ missing, unexpected, changed })}`);
  }
  if (signed) {
    const metadata = signatureFiles.filter(name => entries.includes(name));
    if (!metadata.includes('META-INF/manifest.mf') || !metadata.includes('META-INF/mozilla.sf')
      || !metadata.includes('META-INF/mozilla.rsa') || metadata.some(name => files[name].length === 0)
      || metadata.includes('META-INF/cose.manifest') !== metadata.includes('META-INF/cose.sig')) fail('SIGNED_METADATA_MISSING');
  }
  return files;
}
export function verifySignedArchive(signedBytes, receipt, unsignedBytes) {
  if (digest(unsignedBytes) !== receipt.unsignedSha256) fail('ARCHIVE_CHANGED: unsigned ZIP');
  const original = checkArchive(unsignedBytes, receipt.runtime);
  const files = checkArchive(signedBytes, receipt.runtime, { signed: true, manifestBytes: original['manifest.json'] });
  return { signedSha256: digest(signedBytes), runtimeFileCount: Object.keys(receipt.runtime).length,
    exactFileCount: Object.keys(receipt.runtime).filter(name => digest(files[name]) === receipt.runtime[name]).length,
    manifestFormattingChanged: digest(files['manifest.json']) !== receipt.runtime['manifest.json'],
    signatureFiles: signatureFiles.filter(name => Object.hasOwn(files, name)) };
}
export function deterministicZip(files) {
  const entries = {};
  for (const name of Object.keys(files).sort()) entries[safePath(name)] = [files[name], { mtime: new Date(1980, 0, 1), level: 9 }];
  return zipSync(entries);
}
async function collectSource() {
  let names = [...sourceFiles];
  for (const directory of sourceDirectories) names.push(...(await listFiles(resolve(root, directory))).map(name => `${directory}/${name}`));
  names = [...new Set(names)].sort();
  // These trees are exclusively source/tests, not arbitrary private configuration.
  if (names.some(name => /(^|\/)(\.env[^/]*|node_modules|dist|release|profiles?|credentials?|secrets?)(\/|$)/i.test(name)
    || !/\.(ts|mjs|json|md|txt|html|css|svg)$/.test(name) && !name.endsWith('/hosts'))) fail('UNEXPECTED_SOURCE_FILE');
  return fileMap(root, names);
}
export function cleanEnvironment(environment, signing = false) {
  const result = Object.fromEntries(Object.entries(environment).filter(([key]) => !key.toUpperCase().startsWith('WEB_EXT_')));
  if (signing) {
    for (const key of ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET']) {
      if (typeof environment[key] !== 'string' || !environment[key].trim()) fail(`MISSING_${key}: use environment credentials`);
      result[key] = environment[key];
    }
  }
  return result;
}
function redact(value, environment) {
  let result = String(value);
  for (const key of ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET']) {
    if (environment[key]) result = result.split(environment[key]).join('[REDACTED]');
  }
  return result;
}
async function execute(script, args, environment = cleanEnvironment(process.env)) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: extension, env: environment, shell: false, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', error => reject(new Error(redact(error.message, environment))));
    child.on('close', code => {
      if (code !== 0) reject(new Error(redact(`TOOL_FAILED (${code}): ${stderr || stdout}`, environment).slice(0, 8000)));
      else resolveResult(redact(stdout, environment));
    });
  });
}
const webExtScript = resolve(extension, 'node_modules/web-ext/bin/web-ext.js');
async function runNpm(args) {
  const script = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  await access(script);
  const output = await execute(script, args);
  console.log(output.trim());
}
async function lint(paths) {
  const output = await execute(webExtScript, ['lint', '--source-dir', paths.addon, '--self-hosted', '--output=json', '--no-config-discovery']);
  const result = JSON.parse(output);
  if (result.summary.errors !== 0) fail(`WEB_EXT_LINT_ERRORS: ${result.summary.errors}`);
  console.log(`web-ext lint: ${result.summary.errors} errors, ${result.summary.warnings} warnings, ${result.summary.notices} notices`);
  for (const message of [...result.warnings, ...result.notices]) console.log(`${message.code}: ${message.message}`);
  return result;
}
async function current() {
  const [manifest, pkg, lock, core, coreLock] = await Promise.all([
    json(resolve(extension, 'manifest.json')), json(resolve(extension, 'package.json')), json(resolve(extension, 'package-lock.json')),
    json(resolve(root, 'packages/core/package.json')), json(resolve(root, 'packages/core/package-lock.json')),
  ]);
  const version = manifest.version;
  validateManifest(manifest, pkg.version);
  validateLockfile(pkg, lock);
  validateLockfile(core, coreLock);
  for (const [directory, packageInfo] of [[extension, pkg], [resolve(root, 'packages/core'), core]]) {
    for (const [name, expected] of Object.entries({ ...packageInfo.dependencies, ...packageInfo.devDependencies })) {
      if (name === '@atlas/core') continue; // Local source is included and rebuilt.
      const installed = await json(resolve(directory, 'node_modules', name, 'package.json'));
      if (installed.version !== expected) fail(`INSTALLED_DEPENDENCY_MISMATCH: ${name}; run npm ci`);
    }
  }
  if (Number(process.versions.node.split('.')[0]) < 24) fail('NODE_24_REQUIRED');
  return releasePaths(version);
}
function releasePaths(version) {
  if (!validVersion(version)) fail('INVALID_RELEASE_VERSION');
  const directory = resolve(extension, 'release', version);
  return { version, directory, addon: resolve(directory, 'addon'), signed: resolve(directory, 'signed'),
    unsigned: resolve(directory, `atlas-${version}-unsigned.zip`), source: resolve(directory, `atlas-${version}-source.zip`),
    receipt: resolve(directory, 'release.json') };
}
export function checkRuntimeFiles(names, { afterSigning = false } = {}) {
  // web-ext saves this upload receipt locally after submitting. Never admit it
  // to unsigned/signed archives or pre-sign staging; it carries no runtime authority.
  const runtimeNames = afterSigning ? names.filter(name => name !== '.amo-upload-uuid') : names;
  if (!same([...runtimeNames].sort(), runtimeFiles)) fail('UNEXPECTED_RUNTIME_FILES');
}
async function runtime(paths, options) {
  checkRuntimeFiles(await listFiles(paths.addon), options);
  await verifyDistribution(paths.addon);
  validateManifest(await json(resolve(paths.addon, 'manifest.json')), paths.version);
  return fileMap(paths.addon, runtimeFiles);
}
export async function buildRelease() {
  const paths = await current();
  try { if ((await readdir(paths.signed)).some(name => name.endsWith('.xpi'))) fail('SIGNED_VERSION_EXISTS: choose a new version'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(paths.directory, { recursive: true });
  // Reuse the same compiler and bundler; no separate browser implementation.
  await runNpm(['run', 'build', '--', '--release']);
  const files = await runtime(paths);
  const lintResult = await lint(paths);
  await execute(webExtScript, ['build', '--source-dir', paths.addon, '--artifacts-dir', paths.directory,
    '--filename', `atlas-${paths.version}-unsigned.zip`, '--overwrite-dest', '--no-config-discovery']);
  const runtimeHashes = hashes(files);
  checkArchive(await readFile(paths.unsigned), runtimeHashes);
  // Normalize ZIP timestamps/order so identical source produces identical archives.
  await writeFile(paths.unsigned, deterministicZip(files));
  const source = await collectSource();
  await writeFile(paths.source, deterministicZip(source));
  const receipt = { schemaVersion: 1, version: paths.version, addonId, channel: 'unlisted',
    node: process.versions.node, webExt: (await json(resolve(extension, 'node_modules/web-ext/package.json'))).version,
    runtime: runtimeHashes, source: hashes(source),
    unsignedSha256: digest(await readFile(paths.unsigned)), sourceSha256: digest(await readFile(paths.source)),
    lint: lintResult };
  await writeFile(paths.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Release ready: ${paths.unsigned}\nReviewer source: ${paths.source}\nNo submission made.`);
}
export async function validateRelease({ runLint = true } = {}) {
  const paths = await current();
  const receipt = await json(paths.receipt);
  if (receipt.schemaVersion !== 1 || receipt.version !== paths.version || receipt.addonId !== addonId || receipt.channel !== 'unlisted') fail('RELEASE_RECEIPT_INVALID');
  const files = await runtime(paths);
  if (!same(hashes(files), receipt.runtime)) fail('RUNTIME_CHANGED: rebuild before signing');
  if (!same(hashes(await collectSource()), receipt.source)) fail('SOURCE_CHANGED: rebuild before signing');
  for (const [path, sha, expected] of [[paths.unsigned, receipt.unsignedSha256, receipt.runtime], [paths.source, receipt.sourceSha256, receipt.source]]) {
    const bytes = await readFile(path);
    if (digest(bytes) !== sha) fail('ARCHIVE_CHANGED');
    checkArchive(bytes, expected);
  }
  if (runLint) await lint(paths);
  console.log(`Verified release ${paths.version}: identity, source, runtime and archives agree.`);
  return { paths, receipt };
}
export function signingArguments(paths) {
  return ['sign', '--channel=unlisted', '--source-dir', paths.addon, '--artifacts-dir', paths.signed,
    '--upload-source-code', paths.source, '--amo-base-url=https://addons.mozilla.org/api/v5/', '--no-config-discovery', '--no-input'];
}
export async function signRelease({ environment = process.env, validate = validateRelease, run = execute } = {}) {
  const signingEnvironment = cleanEnvironment(environment, true);
  const { paths, receipt } = await validate();
  const unsignedBytes = await readFile(paths.unsigned);
  if (digest(unsignedBytes) !== receipt.unsignedSha256) fail('ARCHIVE_CHANGED: unsigned ZIP');
  await mkdir(paths.signed, { recursive: true });
  if ((await readdir(paths.signed)).some(name => name.endsWith('.xpi'))) fail('SIGNED_VERSION_EXISTS');
  console.log('Submitting this validated release to Mozilla UNLISTED signing. Review may take longer than the command timeout.');
  const output = await run(webExtScript, signingArguments(paths), signingEnvironment);
  console.log(redact(output, signingEnvironment).trim());
  const packages = (await readdir(paths.signed)).filter(name => name.endsWith('.xpi'));
  if (packages.length !== 1) fail('SIGNED_XPI_NOT_FOUND: check the AMO developer dashboard before retrying');
  const signed = resolve(paths.signed, packages[0]);
  const verification = verifySignedArchive(await readFile(signed), receipt, unsignedBytes);
  if (verification.manifestFormattingChanged) console.log('manifest.json: verified whitespace-only formatting change; JSON tokens unchanged.');
  console.log(`Downloaded XPI matches release assets: ${signed}\nInstall in ordinary Firefox to verify Mozilla's signature and restart behavior.`);
}
/** Read-only recovery after signing; uses frozen artifacts, never edited workspace
 * source, credentials, subprocesses, the network or a fresh build. */
export async function verifySignedRelease(version) {
  const paths = releasePaths(version ?? (await json(resolve(extension, 'manifest.json'))).version);
  const receipt = await json(paths.receipt);
  if (receipt.schemaVersion !== 1 || receipt.version !== paths.version || receipt.addonId !== addonId || receipt.channel !== 'unlisted'
    || !same(Object.keys(receipt.runtime).sort(), runtimeFiles)) fail('RELEASE_RECEIPT_INVALID');
  const staged = await runtime(paths, { afterSigning: true });
  if (!same(hashes(staged), receipt.runtime)) fail('RUNTIME_CHANGED: staged files do not match the saved release');
  const [unsignedBytes, sourceBytes] = await Promise.all([readFile(paths.unsigned), readFile(paths.source)]);
  if (digest(sourceBytes) !== receipt.sourceSha256) fail('ARCHIVE_CHANGED: source ZIP');
  const source = checkArchive(sourceBytes, receipt.source);
  if (digest(source['extension/manifest.json']) !== receipt.runtime['manifest.json']) fail('SOURCE_MANIFEST_MISMATCH');
  validateManifest(JSON.parse(new TextDecoder().decode(source['extension/manifest.json'])), paths.version);
  const packages = (await readdir(paths.signed)).filter(name => name.endsWith('.xpi'));
  if (packages.length !== 1) fail('SIGNED_XPI_NOT_FOUND: expected exactly one downloaded XPI');
  const signed = resolve(paths.signed, packages[0]);
  const result = verifySignedArchive(await readFile(signed), receipt, unsignedBytes);
  console.log(`Verified existing signed XPI offline: ${signed}`);
  console.log(`${result.exactFileCount}/${result.runtimeFileCount} runtime files match exact SHA-256 hashes; manifest JSON tokens match.`);
  if (result.manifestFormattingChanged) console.log('manifest.json: whitespace-only formatting change verified.');
  console.log(`Signing metadata: ${result.signatureFiles.join(', ')}`);
  console.log(`XPI SHA-256: ${result.signedSha256}\nNo signing, submission or artifact modification performed. Firefox verifies the cryptographic signature on installation.`);
  return result;
}
async function changeVersion(next) {
  const paths = await current();
  const compare = validVersion(next) ? next.split('.').map((part, i) => Number(part) - Number(paths.version.split('.')[i])).find(value => value !== 0) : undefined;
  if (compare === undefined || compare <= 0) fail('VERSION_MUST_INCREASE: use three numeric components');
  try { await access(resolve(extension, 'release', next)); fail('VERSION_ARTIFACTS_EXIST'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const manifest = await json(resolve(extension, 'manifest.json'));
  const pkg = await json(resolve(extension, 'package.json'));
  const lock = await json(resolve(extension, 'package-lock.json'));
  manifest.version = pkg.version = lock.version = lock.packages[''].version = next;
  for (const [name, value] of [['manifest.json', manifest], ['package.json', pkg], ['package-lock.json', lock]]) {
    await writeFile(resolve(extension, name), `${JSON.stringify(value, null, 2)}\n`);
  }
  console.log(`Version ${next}; identity preserved. Rebuild and test before signing.`);
}
export function parseCommand(args) {
  if (args.length === 1 && ['build', 'validate', 'sign', 'verify-signed'].includes(args[0])) return { command: args[0] };
  if (args.length === 2 && args[0] === 'verify-signed' && validVersion(args[1])) return { command: args[0], version: args[1] };
  if (args.length === 2 && args[0] === 'version' && validVersion(args[1])) return { command: 'version', version: args[1] };
  fail('USAGE: release.mjs build | validate | sign | verify-signed [x.y.z] | version <x.y.z>; extra options are not accepted');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { command, version } = parseCommand(process.argv.slice(2));
    if (command === 'build') await buildRelease();
    else if (command === 'validate') await validateRelease();
    else if (command === 'sign') await signRelease();
    else if (command === 'verify-signed') await verifySignedRelease(version);
    else await changeVersion(version);
  } catch (error) {
    console.error(`Atlas release failed: ${redact(error.message, process.env)}`);
    process.exitCode = 1;
  }
}
