import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Check the upstream bytes, before copying and again in the shipped folder. */
export async function verifyBundledFeed(directory) {
  const base = resolve(directory, 'data/stevenblack');
  const [bytes, json] = await Promise.all([readFile(resolve(base, 'hosts')), readFile(resolve(base, 'metadata.json'), 'utf8')]);
  const metadata = JSON.parse(json);
  const source = `https://raw.githubusercontent.com/StevenBlack/hosts/${metadata.revision}/alternates/fakenews-gambling-porn-social/hosts`;
  if (!/^[a-f0-9]{40}$/.test(metadata.revision) || metadata.sourceUrl !== source
    || !/^[a-f0-9]{64}$/.test(metadata.sha256)
    || createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) {
    throw new Error('BUNDLED_BLACKLIST_INVALID: pinned bytes do not match metadata');
  }
  await Promise.all(['NOTICE.md', 'license.txt'].map(name => access(resolve(base, name))));
  return metadata;
}

export async function verifyDistribution(directory) {
  await verifyBundledFeed(directory);
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  const files = [...manifest.background.scripts, ...manifest.content_scripts.flatMap(entry => entry.js),
    manifest.options_ui.page, ...Object.values(manifest.icons), 'ui/main.js', 'ui/style.css'];
  await Promise.all(files.map(file => access(resolve(directory, file))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyDistribution(resolve(process.argv[2] ?? 'dist'));
  console.log('Atlas distribution verified');
}
