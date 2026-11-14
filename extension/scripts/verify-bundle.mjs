import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
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
  if (manifest.browser_action?.default_popup) {
    files.push(manifest.browser_action.default_popup, 'ui/popup.js', 'ui/popup.css');
  }
  await Promise.all(files.map(file => access(resolve(directory, file))));
  // Follow the resources actually declared by each page, including parser-time
  // scripts, font preloads and every linked theme. Frozen releases only require
  // their own declarations; signed runtime inventories remain independently exact.
  const base = resolve(directory);
  function localFile(parent, url) {
    if (/^(?:[a-z][\w+.-]*:|[\\/])/i.test(url)) throw new Error('NONLOCAL_UI_RESOURCE');
    const path = resolve(parent, url), name = relative(base, path);
    if (name.startsWith('..') || isAbsolute(name)) throw new Error('NONLOCAL_UI_RESOURCE');
    return path;
  }
  for (const page of new Set([manifest.options_ui.page, manifest.browser_action?.default_popup].filter(Boolean))) {
    const parent = dirname(resolve(base, page));
    const html = await readFile(resolve(base, page), 'utf8');
    for (const [, url] of html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
      const path = localFile(parent, url);
      await access(path);
      if (!url.endsWith('.css')) continue;
      const css = (await readFile(path, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      // Theme URL tokens resolve at their consuming style.css/popup.css, not
      // at ui/themes/*.css. All application styles consume them at the page root.
      for (const [, resource] of css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
        if (!resource.startsWith('#')) await access(localFile(parent, resource));
      }
    }
    if (html.includes('src="theme-startup.js"')) await access(resolve(parent, 'themes/ARTWORK.md'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyDistribution(resolve(process.argv[2] ?? 'dist'));
  console.log('Atlas distribution verified');
}
