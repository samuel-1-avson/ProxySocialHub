import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

mkdirSync(join(dist, 'popup'), { recursive: true });
cpSync(join(root, 'manifest.json'), join(dist, 'manifest.json'));
cpSync(join(root, 'src/popup/index.html'), join(dist, 'popup/index.html'));
cpSync(join(root, 'src/popup/popup.css'), join(dist, 'popup/popup.css'));

const opts = {
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  sourcemap: true,
  logLevel: 'info',
};

const ctx = await esbuild.context({
  ...opts,
  entryPoints: {
    sw: join(root, 'src/sw.ts'),
    'popup/popup': join(root, 'src/popup/popup.ts'),
  },
  outdir: dist,
});

if (watch) {
  await ctx.watch();
  console.log('watching extension sources → dist/');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('built unpacked extension in dist/ (Load unpacked → this folder)');
}
