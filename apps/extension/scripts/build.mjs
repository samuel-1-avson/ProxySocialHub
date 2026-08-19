import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const store = process.argv.includes('--store');

if (!watch) {
  rmSync(dist, { recursive: true, force: true });
}

mkdirSync(join(dist, 'popup'), { recursive: true });
mkdirSync(join(dist, 'icons'), { recursive: true });
cpSync(join(root, 'src/popup/index.html'), join(dist, 'popup/index.html'));
cpSync(join(root, 'src/popup/popup.css'), join(dist, 'popup/popup.css'));
copyIcons(join(root, 'src/icons'), join(dist, 'icons'));

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (store) {
  manifest.host_permissions = (manifest.host_permissions || []).filter(
    (value) => !String(value).includes('localhost') && !String(value).includes('127.0.0.1'),
  );
  if (manifest.externally_connectable?.matches) {
    manifest.externally_connectable.matches = manifest.externally_connectable.matches.filter(
      (value) => !String(value).includes('localhost') && !String(value).includes('127.0.0.1'),
    );
  }
}
writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const opts = {
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  sourcemap: !store,
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
  console.log(
    store
      ? 'built Chrome Web Store package sources in dist/ (no localhost hosts, no source maps)'
      : 'built unpacked extension in dist/ (Load unpacked → this folder)',
  );
}

function copyIcons(from, to) {
  for (const name of readdirSync(from)) {
    if (name.endsWith('.png') && !name.includes('source')) {
      cpSync(join(from, name), join(to, name));
    }
  }
}
