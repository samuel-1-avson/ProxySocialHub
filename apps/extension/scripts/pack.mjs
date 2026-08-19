import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'web-store');
const require = createRequire(import.meta.url);
const version = require('../package.json').version;
const zip = join(outDir, `proxyhubb-extension-${version}.zip`);

const build = spawnSync(process.execPath, [join(root, 'scripts/build.mjs'), '--store'], {
  cwd: root,
  stdio: 'inherit',
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

mkdirSync(outDir, { recursive: true });
rmSync(zip, { force: true });

let packed;
if (process.platform === 'win32') {
  packed = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${dist.replace(/'/g, "''")}\\*' -DestinationPath '${zip.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit' },
  );
} else {
  packed = spawnSync('zip', ['-r', '-X', zip, '.'], { cwd: dist, stdio: 'inherit' });
}

if (packed.status !== 0) {
  process.exit(packed.status ?? 1);
}

console.log(`packed ${zip}`);
console.log('Upload this zip to the Chrome Web Store. Do not commit it. Private pack keys stay gitignored.');
