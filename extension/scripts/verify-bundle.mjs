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
  // Older frozen releases predate the parser-time presentation shell.
  const ui = await readFile(resolve(directory, manifest.options_ui.page), 'utf8');
  if (ui.includes('src="startup.js"')) files.push('ui/startup.js');
  // Keep frozen releases verifiable without requiring newer presentation assets.
  if (ui.includes('src="theme-startup.js"')) files.push('ui/theme-startup.js', 'ui/fonts.css', 'ui/themes/default.css', 'ui/themes/light-test.css');
  if (ui.includes('themes/celestial.css')) files.push('ui/themes/celestial.css', 'ui/themes/celestial/chart.svg', 'ui/themes/celestial/orbit.svg', 'ui/themes/celestial/mark.svg');
  if (ui.includes('themes/celestial.css') && (await readFile(resolve(directory, 'ui/themes/celestial.css'), 'utf8')).includes('instrument.svg')) files.push('ui/themes/celestial/instrument.svg', 'ui/themes/celestial/doppelmayr-1730.jpg', 'ui/themes/parchment/aguiar-1492.jpg', 'ui/themes/ARTWORK.md');
  if (ui.includes('themes/parchment.css')) files.push('ui/themes/parchment.css', 'ui/themes/parchment/paper.svg', 'ui/themes/parchment/rose.svg', 'ui/themes/parchment/mark.svg');
  if (ui.includes('themes/celestial.css') && (await readFile(resolve(directory, 'ui/themes/celestial.css'), 'utf8')).includes('hemisphere-ink.webp')) files.push('ui/themes/celestial/hemisphere-ink.webp', 'ui/themes/celestial/directory.svg', 'ui/themes/parchment/atlantic-ink.webp', 'ui/themes/parchment/mediterranean-ink.webp', 'ui/themes/parchment/directory.svg');
    if (ui.includes('themes/parchment.css') && (await readFile(resolve(directory, 'ui/themes/parchment.css'), 'utf8')).includes('bearings.svg')) files.push('ui/themes/parchment/bearings.svg', 'ui/themes/celestial/western-figures.webp', 'ui/themes/celestial/eastern-figures.webp', 'ui/themes/celestial/doppelmayr-1730-detail.jpg');
  for (const [theme, source] of [['celestial', 'de-wit-1680.jpg'], ['parchment', 'oliva-17c.jpg']]) {
    if (ui.includes(`themes/${theme}.css`) && (await readFile(resolve(directory, `ui/themes/${theme}.css`), 'utf8')).includes('historical-home.webp')) {
      files.push(`ui/themes/${theme}/historical-home.webp`, `ui/themes/${theme}/historical-workspace.webp`, `ui/themes/${theme}/${source}`, 'ui/themes/ARTWORK.md');
    }
  }
  if (manifest.browser_action?.default_popup) {
    files.push(manifest.browser_action.default_popup, 'ui/popup.js', 'ui/popup.css');
  }
  await Promise.all(files.map(file => access(resolve(directory, file))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyDistribution(resolve(process.argv[2] ?? 'dist'));
  console.log('Atlas distribution verified');
}
