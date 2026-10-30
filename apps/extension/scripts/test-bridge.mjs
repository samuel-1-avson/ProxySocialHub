// Website bridge message checks, proxy bypass rules, and the per-browser manifest.
import * as esbuild from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildManifest } from './manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'phubb-bridge-'));

async function load(entry, name) {
  const outfile = join(dir, `${name}.mjs`);
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [join(root, entry)],
    outfile,
    format: 'esm',
    bundle: true,
    platform: 'neutral',
    logLevel: 'silent',
    define: { __PROXYHUBB_TEST_SITE__: '""', __PROXYHUBB_TARGET__: '"chrome"' },
  });
  return import(pathToFileURL(outfile).href);
}

let count = 0;
function assert(cond, msg) {
  count += 1;
  if (!cond) {
    throw new Error(msg);
  }
}

try {
  const bridge = await load('src/lib/bridge-protocol.ts', 'bridge');
  const ok = { source: 'proxyhubb-page', id: 'r1', message: { type: 'ping' } };
  assert(bridge.isBridgeRequest(ok), 'ping request accepted');
  assert(bridge.isBridgeRequest({ ...ok, message: { type: 'connect', orderId: 'abc12345' } }), 'connect accepted');
  assert(!bridge.isBridgeRequest({ ...ok, source: 'someone-else' }), 'other sources ignored');
  assert(!bridge.isBridgeRequest({ ...ok, message: { type: 'verify' } }), 'worker-only types refused');
  assert(!bridge.isBridgeRequest({ ...ok, id: '' }), 'empty id refused');
  assert(!bridge.isBridgeRequest({ ...ok, id: 'x'.repeat(65) }), 'long id refused');
  assert(!bridge.isBridgeRequest({ ...ok, message: { type: 'pair', code: 42 } }), 'non-string code refused');
  assert(!bridge.isBridgeRequest({ ...ok, message: { type: 'pair', code: 'x'.repeat(301) } }), 'oversized field refused');
  assert(!bridge.isBridgeRequest(null), 'null refused');
  assert(bridge.isBridgeRelay({ type: 'website', request: { type: 'disconnect' } }), 'relay accepted');
  assert(!bridge.isBridgeRelay({ type: 'website', request: { type: 'status' } }), 'relay of unknown type refused');

  const proxy = await load('src/lib/proxy.ts', 'proxy');
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'proxyhubb.com', 'api.proxyhubb.com', 'intranet']) {
    assert(proxy.bypassesProxy(host), `${host} goes direct`);
  }
  for (const host of ['example.com', 'api.ipify.org', 'notproxyhubb.com']) {
    assert(!proxy.bypassesProxy(host), `${host} uses the proxy`);
  }

  const base = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const chrome = buildManifest(base, { target: 'chrome', store: true });
  assert(chrome.background.service_worker === 'sw.js', 'chrome keeps the service worker');
  assert(!chrome.browser_specific_settings, 'chrome drops gecko settings');
  assert(chrome.permissions.includes('webRequestAuthProvider'), 'chrome keeps webRequestAuthProvider');
  assert(!chrome.content_scripts[0].matches.some((m) => m.includes('localhost')), 'store build drops localhost bridge');
  assert(!chrome.host_permissions.some((m) => m.includes('localhost')), 'store build drops localhost hosts');
  assert(chrome.content_scripts[0].js[0] === 'bridge.js', 'bridge content script present');

  const firefox = buildManifest(base, { target: 'firefox', store: true });
  assert(firefox.background.scripts[0] === 'sw.js' && !firefox.background.service_worker, 'firefox uses an event page');
  assert(!firefox.externally_connectable, 'firefox has no externally_connectable');
  assert(firefox.permissions.includes('webRequestBlocking'), 'firefox gets webRequestBlocking');
  assert(!firefox.permissions.includes('webRequestAuthProvider'), 'firefox drops webRequestAuthProvider');
  assert(firefox.browser_specific_settings.gecko.id === 'extension@proxyhubb.com', 'gecko id kept');
  assert(Number.parseFloat(firefox.browser_specific_settings.gecko.strict_min_version) >= 128, 'firefox 128+');
  assert(Array.isArray(firefox.browser_specific_settings.gecko.data_collection_permissions.required), 'data collection declared');

  const tunnel = buildManifest(base, { target: 'chrome', testSite: 'https://x.ngrok-free.app' });
  assert(tunnel.content_scripts[0].matches.includes('https://x.ngrok-free.app/*'), 'test site gets the bridge');
  assert(tunnel.externally_connectable.matches.includes('https://x.ngrok-free.app/*'), 'test site can message');
  assert(!base.content_scripts[0].matches.includes('https://x.ngrok-free.app/*'), 'base manifest untouched');

  console.log(`bridge tests ok (${count} checks)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
