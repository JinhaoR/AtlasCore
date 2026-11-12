import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
test('bundled typography has intact local assets, original OFL notices and no runtime font provider',()=>{
  const base=new URL('../dist/ui/fonts/',import.meta.url),sources=JSON.parse(readFileSync(new URL('sources.json',base)));
  for(const asset of sources.files){const bytes=readFileSync(new URL(asset.file,base));assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);}
  for(const name of ['Cormorant-Garamond-OFL.txt','Source-Sans-3-OFL.txt'])assert.match(readFileSync(new URL(name,base),'utf8'),/SIL OPEN FONT LICENSE/);
  const css=readFileSync(new URL('../dist/ui/fonts.css',import.meta.url),'utf8');
  assert.equal([...css.matchAll(/@font-face/g)].length,6);
  assert.ok([...css.matchAll(/src:\s*url\('([^']+)'\)/g)].every(([,url])=>url.startsWith('fonts/')&&url.endsWith('.woff2')));
  assert.doesNotMatch(css,/@import|https?:\/\//);
});
