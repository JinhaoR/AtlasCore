import { build } from 'esbuild';
import { mkdir, copyFile, cp, readFile } from 'node:fs/promises';
import { verifyBundledFeed, verifyDistribution } from './scripts/verify-bundle.mjs';

const release = process.argv.slice(2);
if (release.length > 1 || (release.length === 1 && release[0] !== '--release')) throw new Error('Unknown build option');
const { version } = JSON.parse(await readFile('manifest.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
const outdir = release.length ? `release/${version}/addon` : 'dist';
await verifyBundledFeed('.');
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: { background: 'src/background/main.ts', 'ui/main': 'src/ui/main.ts', 'journey-indicator': 'src/content/journey-indicator.ts' },
  outdir, bundle: true, platform: 'browser', format: 'iife', target: 'firefox140',
  // Maps are local development artifacts; neither maps nor bundles contain user data.
  sourcemap: !release.length,
});
await copyFile('manifest.json', `${outdir}/manifest.json`);
await copyFile('THIRD-PARTY-NOTICES.txt', `${outdir}/THIRD-PARTY-NOTICES.txt`);
await cp('src/ui/assets', `${outdir}/ui`, { recursive: true });
await cp('data', `${outdir}/data`, { recursive: true });
await verifyDistribution(outdir);
