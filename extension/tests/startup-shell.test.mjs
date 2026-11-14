import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../dist/ui/startup.js', import.meta.url), 'utf8');
test('first-paint shell follows the same explicit URL route without browser or storage access', () => {
  for (const [suffix, page, section, mode] of [
    ['', 'home', 'home', 'control'], ['#sites', 'sites', 'sites', 'control'],
    ['#vault', 'vault', 'settings', 'control'], ['#settings', 'settings', 'settings', 'control'],
    ['?view=access&tab=4', 'access', 'access', 'control'], ['?view=access#home', 'home', 'home', 'control'],
    ['#unknown', 'home', 'home', 'control'],
    ['#access', 'access', 'access', 'control'],
  ]) {
    const document = { body: { dataset: {} } }, location = new URL(`https://extension.example/ui/index.html${suffix}`);
    // No Firefox, clock, storage or command surface is present in this context.
    runInNewContext(script, { document, location, URL });
    assert.deepEqual(document.body.dataset, { page, section, mode });
  }
});
