// Builds the installer: the provider-node sidecar, the frontend, the app, and the NSIS setup.
//
//   node scripts/build-app.mjs            release build (what would ship)
//   node scripts/build-app.mjs --debug    faster, for CI and local checks
//
// The installer is only built, never installed. It is UNSIGNED: signing is wired in with the
// release workflow once the signing accounts exist (see docs/plans/provider-tray-app.md).
//
// `tauri build` downloads the NSIS tooling from GitHub the first time it bundles, and that
// download times out now and then. So the compile runs once and fails fast (a real error is
// never retried), and only the bundle step is retried; the compile is cached between attempts.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const debug = process.argv.includes('--debug');
const profile = debug ? 'debug' : 'release';
const ATTEMPTS = 3;
const WAIT_MS = 15_000;

// Run the Tauri CLI through node directly: no shell, and the same behaviour on every OS.
const require = createRequire(import.meta.url);
const tauriCli = join(dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js');

function run(label, command, args) {
  console.log(`\n== ${label}`);
  const r = spawnSync(command, args, { cwd: appDir, stdio: 'inherit' });
  return r.status === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. The node the app bundles (release unless --debug).
if (!run('build the provider-node sidecar', process.execPath, [join(here, 'build-sidecar.mjs'), ...(debug ? ['--debug'] : [])])) {
  process.exit(1);
}

// 2. Compile the frontend and the app. A failure here is a real error: stop.
if (!run(`compile the app (${profile})`, process.execPath, [tauriCli, 'build', '--no-bundle', ...(debug ? ['--debug'] : [])])) {
  process.exit(1);
}

// 3. Bundle the installer, retrying only this step (the NSIS download).
let bundled = false;
for (let attempt = 1; attempt <= ATTEMPTS && !bundled; attempt += 1) {
  bundled = run(`bundle the installer (attempt ${attempt}/${ATTEMPTS})`, process.execPath, [tauriCli, 'build', '--bundles', 'nsis', ...(debug ? ['--debug'] : [])]);
  if (!bundled && attempt < ATTEMPTS) {
    console.log(`bundling failed (usually the NSIS tooling download timing out); retrying in ${WAIT_MS / 1000}s`);
    await sleep(WAIT_MS);
  }
}
if (!bundled) {
  console.error('could not build the installer');
  process.exit(1);
}

const bundleDir = join(appDir, 'src-tauri', 'target', profile, 'bundle', 'nsis');
const installers = existsSync(bundleDir) ? readdirSync(bundleDir).filter((f) => f.endsWith('-setup.exe')) : [];
if (installers.length === 0) {
  console.error(`the build reported success but no *-setup.exe is in ${bundleDir}`);
  process.exit(1);
}
for (const f of installers) console.log(`\ninstaller (unsigned, not installed): ${join(bundleDir, f)}`);
