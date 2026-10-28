// Builds services/provider-node and copies it where Tauri's `externalBin` expects it:
//   src-tauri/binaries/provider-node-<host-triple>[.exe]
// Tauri then ships it next to the app executable as plain `provider-node[.exe]`.
//
//   node scripts/build-sidecar.mjs            release build (what the installer ships)
//   node scripts/build-sidecar.mjs --debug    faster build for local work
//   PROVIDER_NODE_BIN=<path> node scripts/build-sidecar.mjs   reuse an existing binary
//   node scripts/build-sidecar.mjs --placeholder   an EMPTY stand-in, for fmt/clippy/test runs.
//                                    tauri-build only needs the file to exist; nothing that
//                                    uses a placeholder may run the app.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const nodeDir = resolve(appDir, '../../services/provider-node');
const profile = process.argv.includes('--debug') ? 'debug' : 'release';

const host = /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1];
if (!host) throw new Error('could not read the Rust host triple from `rustc -vV`');
const ext = host.includes('windows') ? '.exe' : '';

if (process.argv.includes('--placeholder')) {
  const destDir = join(appDir, 'src-tauri', 'binaries');
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, `provider-node-${host}${ext}`);
  writeFileSync(dest, '');
  console.log(`placeholder sidecar (empty, not runnable): ${dest}`);
  process.exit(0);
}

let built;
if (process.env.PROVIDER_NODE_BIN) {
  built = resolve(process.env.PROVIDER_NODE_BIN);
} else {
  const args = ['build', '--locked', ...(profile === 'release' ? ['--release'] : [])];
  execFileSync('cargo', args, { cwd: nodeDir, stdio: 'inherit' });
  built = join(nodeDir, 'target', profile, `provider-node${ext}`);
}
if (!existsSync(built)) throw new Error(`provider-node binary not found at ${built}`);

const destDir = join(appDir, 'src-tauri', 'binaries');
mkdirSync(destDir, { recursive: true });
const dest = join(destDir, `provider-node-${host}${ext}`);
copyFileSync(built, dest);
console.log(`sidecar ready: ${dest}`);
