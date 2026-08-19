import * as esbuild from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'phubb-hmac-'));
const outfile = join(dir, 'hmac.mjs');

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/lib/hmac.ts')],
  outfile,
  format: 'esm',
  bundle: true,
  platform: 'neutral',
  logLevel: 'silent',
});

const hmac = await import(pathToFileURL(outfile).href);

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

function throws(fn, re) {
  try {
    fn();
  } catch (err) {
    if (re.test(String(err.message))) {
      return;
    }
    throw new Error(`wrong error: ${err.message}`);
  }
  throw new Error(`expected throw matching ${re}`);
}

const hmacPass = 'deadbeefhmacfor8090notcapability';

const primary = hmac.hmacConnectTarget({
  username: 'buyer',
  password: hmacPass,
  host: 'proxy.proxyhubb.com',
  port: 8090,
});
assert(primary.password === hmacPass, 'use HMAC password');
assert(primary.host === 'proxy.proxyhubb.com', 'host');
assert(primary.port === 8090, 'port 8090');

const nested = hmac.hmacConnectTarget({
  proxy_credentials: {
    username: 'buyer',
    password: 'phubb1.capability-token',
    legacy_password: hmacPass,
    endpoint: 'proxy.proxyhubb.com:8090',
  },
});
assert(nested.password === hmacPass, 'phubb1. in password falls back to legacy_password');
assert(nested.port === 8090, 'nested still 8090');

throws(
  () =>
    hmac.hmacConnectTarget({
      username: 'buyer',
      password: 'phubb1.a',
      legacy_password: 'phubb1.b',
    }),
  /no HMAC password/,
);

throws(
  () =>
    hmac.hmacConnectTarget({
      username: 'buyer',
      password: hmacPass,
      auth_for_endpoint: 'capability',
    }),
  /capability-only/,
);

throws(
  () =>
    hmac.hmacConnectTarget({
      username: 'buyer',
      password: hmacPass,
      host: '127.0.0.1',
      port: 18091,
    }),
  /18091/,
);

throws(
  () =>
    hmac.hmacConnectTarget({
      username: 'buyer',
      password: hmacPass,
      endpoint: 'edge-gateway.example:18091',
    }),
  /18091/,
);

rmSync(dir, { recursive: true, force: true });
console.log('hmac tests ok');
