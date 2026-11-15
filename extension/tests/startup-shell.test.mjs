import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../dist/ui/startup.js', import.meta.url), 'utf8');
test('first-paint shell follows the same explicit URL route without browser or storage access', () => {
  for (const [suffix, page, section, mode] of [
    ['', 'home', 'home', 'control'], ['#sites', 'sites', 'sites', 'control'],
    ['#vault', 'vault', 'sites', 'control'], ['#settings', 'settings', 'settings', 'control'],
    ['?view=access&tab=4', 'access', 'access', 'control'], ['?view=access#home', 'home', 'home', 'control'],
    ['#unknown', 'home', 'home', 'control'],
    ['#access', 'access', 'access', 'control'],
  ]) {
    const document = { body: { dataset: {} } }, location = new URL(`https://extension.example/ui/index.html${suffix}`);
    // No Firefox, clock, storage or command surface is present in this context.
    runInNewContext(script, { document, location, URL, history: { state: null } });
    assert.deepEqual(document.body.dataset, { page, section, mode });
  }
});

test('Vault first paint retains its Settings context across reload without a section flash', () => {
  const document = { body: { dataset: {} } }, location = new URL('https://extension.example/ui/index.html#vault');
  runInNewContext(script, { document, location, URL, history: { state: { atlasVaultSection: 'settings' } } });
  assert.deepEqual(document.body.dataset, { page: 'vault', section: 'settings', mode: 'control' });
});
