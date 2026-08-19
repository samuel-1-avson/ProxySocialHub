import * as esbuild from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'phubb-egress-'));
const outfile = join(dir, 'egress.mjs');

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/lib/egress.ts')],
  outfile,
  format: 'esm',
  bundle: true,
  platform: 'neutral',
  logLevel: 'silent',
});

const egress = await import(pathToFileURL(outfile).href);

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

assert(egress.parseEgressIp('203.0.113.10') === '203.0.113.10', 'ipify text');
assert(egress.parseEgressIp('{"ip":"203.0.113.11"}') === '203.0.113.11', 'ipify json');
assert(egress.parseEgressIp('{"origin":"198.51.100.4"}') === '198.51.100.4', 'httpbin origin');
assert(egress.parseEgressIp('{"origin":"198.51.100.4, 203.0.113.9"}') === '198.51.100.4', 'httpbin first hop');
assert(egress.parseEgressIp('127.0.0.1') === null, 'reject loopback');
assert(egress.parseEgressIp('not an ip') === null, 'reject junk');
assert(egress.ipsEqual('203.0.113.10', '203.0.113.10'), 'equal');
assert(!egress.ipsEqual('203.0.113.10', '198.51.100.4'), 'unequal');
assert(egress.egressLooksProxied('198.51.100.4', '203.0.113.10'), 'proxied when IPs differ');
assert(!egress.egressLooksProxied('198.51.100.4', '198.51.100.4'), 'not proxied when IPs match');
assert(egress.egressLooksProxied(undefined, '203.0.113.10'), 'allow unknown baseline if current IP exists');
assert(!egress.egressLooksProxied('198.51.100.4', undefined), 'missing current is fail');
assert(egress.VERIFY_PROTOCOL === 'HTTP CONNECT', 'protocol label');

rmSync(dir, { recursive: true, force: true });
console.log('egress tests ok');
