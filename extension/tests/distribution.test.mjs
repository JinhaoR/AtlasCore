import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBundledFeed, verifyDistribution } from '../scripts/verify-bundle.mjs';
import { createManagedBlacklist, sha256 } from '../dist/lib/managed/manager.js';

const extension = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(extension, '..');
const paths = ['extension/data/stevenblack/hosts', 'extension/dist/data/stevenblack/hosts'];

test('source and shipped folder retain verified pinned bytes and a complete current manifest', async () => {
  const source = await verifyBundledFeed(extension);
  const shipped = await verifyBundledFeed(join(extension, 'dist'));
  assert.deepEqual(shipped, source);
  await verifyDistribution(join(extension, 'dist'));
  const [manifest, shippedManifest, pkg] = await Promise.all(['manifest.json', 'dist/manifest.json', 'package.json']
    .map(path => readFile(join(extension, path), 'utf8').then(JSON.parse)));
  assert.deepEqual(shippedManifest, manifest);
  assert.equal(shippedManifest.version, pkg.version);
});

test('Windows Git checkout filters preserve both exact feeds and cold-start managed verification', async () => {
  const metadata = JSON.parse(await readFile(join(extension, 'data/stevenblack/metadata.json'), 'utf8'));
  for (const path of paths) {
    const bytes = execFileSync('git', ['-c', 'core.autocrlf=true', 'cat-file', '--filters', `HEAD:${path}`],
      { cwd: root, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const text = bytes.toString('utf8');
    assert.equal(await sha256(text), metadata.sha256, `${path} must survive a Windows checkout`);
    const managed = await createManagedBlacklist({ cache: { load: async () => null, save: async () => true },
      now: () => 1000, digest: sha256, download: async () => { throw new Error('No network in this test'); },
      bundle: async () => ({ text, sourceUrl: metadata.sourceUrl, sha256: metadata.sha256, fetchedAt: null, upstreamVersion: metadata.revision }) });
    assert.equal(managed.getView().active, true);
    assert.equal(managed.getView().count, 163850);
  }
});

test('distribution gate rejects converted bytes and incomplete folders rather than changing the digest', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-distribution-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()), 'delete only the isolated fixture');
    return rm(directory, { recursive: true, force: true });
  });
  await cp(join(extension, 'data'), join(directory, 'data'), { recursive: true });
  const hosts = join(directory, 'data/stevenblack/hosts');
  const original = await readFile(hosts, 'utf8');
  await writeFile(hosts, original.replace(/\r?\n/g, '\r\n'));
  await assert.rejects(verifyBundledFeed(directory), /BUNDLED_BLACKLIST_INVALID/);
  await writeFile(hosts, original);
  await verifyBundledFeed(directory);
  await assert.rejects(verifyDistribution(directory), /ENOENT/);
});
