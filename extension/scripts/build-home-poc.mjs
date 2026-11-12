// Opt-in experiment. Never changes the shipping manifest or release artifacts.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function homeManifest(manifest) {
  return {
    ...manifest,
    // A fragment breaks Firefox's empty-address-bar handling for new tabs.
    // The existing UI defaults to Home without a fragment or query parameter.
    chrome_settings_overrides: { ...manifest.chrome_settings_overrides, homepage: 'ui/index.html' },
    chrome_url_overrides: { ...manifest.chrome_url_overrides, newtab: 'ui/index.html' },
  };
}

export async function buildHomePoc(source, destination) {
  const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
  await writeFile(resolve(destination, 'manifest.json'), JSON.stringify(homeManifest(manifest), null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const extension = fileURLToPath(new URL('../', import.meta.url));
  const destination = resolve(extension, 'dev-home');
  await buildHomePoc(resolve(extension, 'dist'), destination);
  console.log(`Home/new-tab experiment: ${destination}/manifest.json\nTemporary development load only; not a release package.`);
}
