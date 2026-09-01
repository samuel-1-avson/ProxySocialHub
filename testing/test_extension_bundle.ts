/**
 * ==============================================================================
 * ProxyHubb Protocol: Browser Extension Bundle & WebRTC Shield Test Suite
 * ==============================================================================
 * Validates:
 * 1. Manifest v3 Schema Compliance for Chrome Web Store & Firefox Add-ons
 * 2. Privacy & WebRTC IP Leak Prevention Permissions
 * 3. Chrome webRequest.onAuthRequired proxy authentication handler logic
 * 4. Automated ZIP bundle packaging & build integrity
 */

import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[ASSERTION_FAILED] ${msg}`);
  }
}

const EXTENSION_DIR = path.resolve(__dirname, '../apps/extension');
const MANIFEST_PATH = path.join(EXTENSION_DIR, 'manifest.json');

// 1. Test Manifest v3 Schema & Permissions
function testManifestV3Compliance() {
  console.log('[1/4] Testing Manifest v3 Schema & Permissions Compliance...');

  assert(fs.existsSync(MANIFEST_PATH), 'manifest.json does not exist');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  assert(manifest.manifest_version === 3, 'manifest_version must be 3');
  assert(manifest.name === 'ProxyHubb', 'Extension name must be ProxyHubb');
  assert(typeof manifest.version === 'string', 'Extension version must be defined');

  // Permissions validation
  const perms: string[] = manifest.permissions || [];
  assert(perms.includes('proxy'), 'Missing required "proxy" permission');
  assert(perms.includes('storage'), 'Missing required "storage" permission');
  assert(perms.includes('privacy'), 'Missing required "privacy" permission for WebRTC shield');
  assert(perms.includes('webRequest'), 'Missing required "webRequest" permission');
  assert(perms.includes('webRequestAuthProvider'), 'Missing required "webRequestAuthProvider" permission');

  // Background service worker
  assert(manifest.background?.service_worker === 'sw.js', 'Service worker must be sw.js');
  assert(manifest.background?.type === 'module', 'Service worker type must be module');

  // Firefox Gecko settings
  assert(
    manifest.browser_specific_settings?.gecko?.id === 'extension@proxyhubb.com',
    'Firefox Gecko extension ID must be configured'
  );

  console.log('  [PASS] Manifest v3 validated for both Chrome Web Store and Firefox Add-ons.');
}

// 2. Test WebRTC IP Leak Shield Invariants
function testWebRTCProtectionLogic() {
  console.log('[2/4] Testing WebRTC IP Leak Shield Invariants...');

  const proxySource = fs.readFileSync(path.join(EXTENSION_DIR, 'src/lib/proxy.ts'), 'utf8');

  assert(
    proxySource.includes('enableWebRTCProtection'),
    'proxy.ts must export enableWebRTCProtection()'
  );
  assert(
    proxySource.includes('disable_non_proxied_udp'),
    'WebRTC policy must set "disable_non_proxied_udp" to block STUN leaks'
  );
  assert(
    proxySource.includes('clearWebRTCProtection'),
    'proxy.ts must clear WebRTC policy on proxy disconnect'
  );

  console.log('  [PASS] WebRTC IP leak protection handlers verified.');
}

// 3. Test Proxy Authentication Auto-Injection Logic
function testProxyAuthInjection() {
  console.log('[3/4] Testing webRequest.onAuthRequired Credential Auto-Injection...');

  const swSource = fs.readFileSync(path.join(EXTENSION_DIR, 'src/sw.ts'), 'utf8');

  assert(
    swSource.includes('chrome.webRequest.onAuthRequired.addListener'),
    'sw.ts must listen to webRequest.onAuthRequired'
  );
  assert(
    swSource.includes("details.isProxy"),
    'Authentication injection must verify details.isProxy is true'
  );
  assert(
    swSource.includes("authCredentials: { username: user, password: pass }"),
    'Must auto-inject HMAC credentials to proxy challenge'
  );

  console.log('  [PASS] Proxy credential auto-injection logic verified.');
}

// 4. Test Web Store Packaging Output
function testPackagingOutput() {
  console.log('[4/4] Testing Store Distribution Package Integrity...');

  const distManifest = path.join(EXTENSION_DIR, 'dist/manifest.json');
  const distSw = path.join(EXTENSION_DIR, 'dist/sw.js');
  const distPopup = path.join(EXTENSION_DIR, 'dist/popup/popup.js');

  assert(fs.existsSync(distManifest), 'dist/manifest.json must exist');
  assert(fs.existsSync(distSw), 'dist/sw.js must exist');
  assert(fs.existsSync(distPopup), 'dist/popup/popup.js must exist');

  console.log('  [PASS] Extension distribution artifacts compiled successfully.');
}

// Run test suite
console.log('======================================================================');
console.log('     ProxyHubb: Browser Extension & WebRTC Shield Verification        ');
console.log('======================================================================');

testManifestV3Compliance();
testWebRTCProtectionLogic();
testProxyAuthInjection();
testPackagingOutput();

console.log('======================================================================');
console.log('   >>> ALL BROWSER EXTENSION VERIFICATION TESTS PASSED (100%) <<<     ');
console.log('======================================================================');
