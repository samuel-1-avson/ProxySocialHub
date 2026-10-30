import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { buildManifest } from './manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const store = process.argv.includes('--store');
const target = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
const dist = join(root, target === 'firefox' ? 'dist-firefox' : 'dist');

if (!watch) {
  rmSync(dist, { recursive: true, force: true });
}

mkdirSync(join(dist, 'popup'), { recursive: true });
mkdirSync(join(dist, 'icons'), { recursive: true });
cpSync(join(root, 'src/popup/index.html'), join(dist, 'popup/index.html'));
cpSync(join(root, 'src/popup/popup.css'), join(dist, 'popup/popup.css'));
copyIcons(join(root, 'src/icons'), join(dist, 'icons'));

// Optional shop on another address (scripts/tunnel/start.ps1 passes the ngrok URL).
const testSite = (process.env.PROXYHUBB_SITE || '').trim().replace(/\/$/, '');
const manifest = buildManifest(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')), {
  target,
  store,
  testSite,
});
writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const opts = {
  bundle: true,
  target: target === 'firefox' ? 'firefox128' : 'chrome116',
  sourcemap: !store,
  logLevel: 'info',
  define: {
    __PROXYHUBB_TEST_SITE__: JSON.stringify(testSite),
    __PROXYHUBB_TARGET__: JSON.stringify(target),
  },
  outdir: dist,
};

// The worker and popup are ES modules; content scripts must be classic scripts.
const contexts = [
  await esbuild.context({
    ...opts,
    format: 'esm',
    entryPoints: { sw: join(root, 'src/sw.ts'), 'popup/popup': join(root, 'src/popup/popup.ts') },
  }),
  await esbuild.context({ ...opts, format: 'iife', entryPoints: { bridge: join(root, 'src/bridge.ts') } }),
];

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log(`watching extension sources → ${dist}`);
} else {
  for (const ctx of contexts) {
    await ctx.rebuild();
    await ctx.dispose();
  }
  const name = target === 'firefox' ? 'Firefox' : 'Chrome';
  console.log(
    store
      ? `built ${name} store package sources in ${dist} (no localhost hosts, no source maps)`
      : `built unpacked ${name} extension in ${dist}`,
  );
}

function copyIcons(from, to) {
  for (const name of readdirSync(from)) {
    if (name.endsWith('.png') && !name.includes('source')) {
      cpSync(join(from, name), join(to, name));
    }
  }
}
