/** Read-only bridge for Windows deployment. The existing frozen-artifact
 * verifier is mandatory; manifest inspection alone never authorizes deployment. */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addonId, safePath, validVersion, verifySignedRelease } from '../extension/scripts/release.mjs';

const { unzipSync } = createRequire(new URL('../extension/package.json', import.meta.url))('fflate');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };

export async function inspectPackage(path) {
  const bytes = await readFile(path);
  const seen = new Set();
  const entries = unzipSync(bytes, { filter(entry) {
    safePath(entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name);
    if (seen.has(entry.name)) fail('DUPLICATE_ARCHIVE_ENTRY');
    seen.add(entry.name);
    return entry.name === 'manifest.json';
  } });
  if (!entries['manifest.json']) fail('PACKAGE_MANIFEST_MISSING');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entries['manifest.json']));
  if (manifest.browser_specific_settings?.gecko?.id !== addonId) fail('PACKAGE_ID_MISMATCH');
  if (!validVersion(manifest.version)) fail('PACKAGE_VERSION_INVALID');
  return { addonId, version: manifest.version, sha256: hash(bytes), path: resolve(path) };
}

export async function verifiedRelease(version) {
  if (!validVersion(version)) fail('VERSION_INVALID');
  const directory = resolve(root, 'extension/release', version, 'signed');
  const names = (await readdir(directory)).filter(name => /\.xpi$/i.test(name));
  if (names.length !== 1 || !names[0].endsWith('.xpi')) fail('SIGNED_XPI_AMBIGUOUS: expected one lowercase .xpi');
  const path = resolve(directory, names[0]);
  if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) fail('SIGNED_XPI_NOT_REGULAR');
  // Keep stdout machine-readable without changing the underlying verifier.
  const originalLog = console.log;
  let verified;
  try {
    console.log = () => {};
    verified = await verifySignedRelease(version);
  } finally { console.log = originalLog; }
  const inspected = await inspectPackage(path);
  if (inspected.version !== version || inspected.sha256 !== verified.signedSha256) fail('VERIFIED_RELEASE_CHANGED');
  return { ...inspected, verified: true, runtimeFileCount: verified.runtimeFileCount };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [operation, argument, ...extra] = process.argv.slice(2);
    if (!argument || extra.length || !['verify', 'inspect'].includes(operation)) fail('USAGE: verify VERSION | inspect XPI');
    const result = operation === 'verify' ? await verifiedRelease(argument) : await inspectPackage(argument);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`Atlas package check failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
