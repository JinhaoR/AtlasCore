import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: { background: 'src/background/main.ts', 'ui/main': 'src/ui/main.ts' },
  outdir: 'dist', bundle: true, platform: 'browser', format: 'iife', target: 'firefox140',
  // Maps are local development artifacts; neither maps nor bundles contain user data.
  sourcemap: true,
});
await copyFile('manifest.json', 'dist/manifest.json');
await cp('src/ui/assets', 'dist/ui', { recursive: true });
await cp('data', 'dist/data', { recursive: true });
