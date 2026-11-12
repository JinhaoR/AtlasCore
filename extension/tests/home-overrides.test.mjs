import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homeManifest } from '../scripts/build-home-poc.mjs';

test('shipping Home overrides use the bare relative existing UI without new permissions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  const original = structuredClone(manifest);
  const experimental = homeManifest(manifest);
  assert.deepEqual(manifest, original);
  assert.deepEqual(manifest.chrome_url_overrides, { newtab: 'ui/index.html' });
  assert.deepEqual(manifest.chrome_settings_overrides, { homepage: 'ui/index.html' });
  assert.deepEqual(experimental, manifest, 'the old experiment helper remains idempotent');
  assert.deepEqual(experimental.chrome_url_overrides, { newtab: 'ui/index.html' });
  assert.deepEqual(experimental.chrome_settings_overrides, { homepage: 'ui/index.html' });
  delete experimental.chrome_url_overrides;
  delete experimental.chrome_settings_overrides;
  delete original.chrome_url_overrides;
  delete original.chrome_settings_overrides;
  assert.deepEqual(experimental, original, 'no permissions, identity, CSP, storage or script changes');
});
