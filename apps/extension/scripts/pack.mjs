// Store packages: `npm run pack` (Chrome Web Store) or `npm run pack -- --firefox`
// (Firefox Add-ons, plus the source zip AMO reviewers ask for).
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const firefox = process.argv.includes('--firefox');
const target = firefox ? 'firefox' : 'chrome';
const dist = join(root, firefox ? 'dist-firefox' : 'dist');
const outDir = join(root, 'web-store');
const require = createRequire(import.meta.url);
const version = require('../package.json').version;
const zip = join(outDir, `proxyhubb-extension-${target}-${version}.zip`);

if (process.env.PROXYHUBB_SITE) {
  console.error('PROXYHUBB_SITE is set. Store builds must only trust proxyhubb.com; unset it and pack again.');
  process.exit(1);
}

run(process.execPath, [join(root, 'scripts/build.mjs'), '--store', ...(firefox ? ['--firefox'] : [])], root);
mkdirSync(outDir, { recursive: true });
zipEntries(dist, readdirSync(dist), zip);
console.log(`packed ${zip}`);

if (firefox) {
  // AMO needs the unbundled source and the steps to rebuild it (see AMO_SOURCE.md).
  const sourceZip = join(outDir, `proxyhubb-extension-firefox-${version}-source.zip`);
  const sources = ['AMO_SOURCE.md', 'manifest.json', 'package.json', 'package-lock.json', 'tsconfig.json', 'scripts', 'src'];
  zipEntries(root, sources, sourceZip);
  console.log(`packed ${sourceZip}`);
  console.log('Upload both zips to addons.mozilla.org (the source zip when asked for source code).');
} else {
  console.log('Upload this zip to the Chrome Web Store developer dashboard. Do not commit it.');
}

/** Zip `entries` (relative to `cwd`) with forward-slash paths on every OS. */
function zipEntries(cwd, entries, out) {
  rmSync(out, { force: true });
  if (process.platform === 'win32') {
    // Windows 10+ ships bsdtar; -a picks the format from the .zip extension.
    run('tar.exe', ['-a', '-cf', out, ...entries], cwd);
  } else {
    run('zip', ['-r', '-X', out, ...entries, '-x', '*/node_modules/*'], cwd);
  }
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
