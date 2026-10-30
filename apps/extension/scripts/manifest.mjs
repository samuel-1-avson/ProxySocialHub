// Turns manifest.json into the manifest each build ships. Pure, so
// scripts/test-manifest.mjs can check it without building.

const isLocal = (value) => String(value).includes('localhost') || String(value).includes('127.0.0.1');

/**
 * @param {object} base parsed manifest.json
 * @param {{ target?: 'chrome' | 'firefox', store?: boolean, testSite?: string }} options
 */
export function buildManifest(base, { target = 'chrome', store = false, testSite = '' } = {}) {
  const manifest = structuredClone(base);
  const bridge = manifest.content_scripts?.[0];

  if (store) {
    manifest.host_permissions = (manifest.host_permissions || []).filter((value) => !isLocal(value));
    if (manifest.externally_connectable?.matches) {
      manifest.externally_connectable.matches = manifest.externally_connectable.matches.filter((value) => !isLocal(value));
    }
    if (bridge) {
      bridge.matches = bridge.matches.filter((value) => !isLocal(value));
    }
  }

  // Optional shop on another address (scripts/tunnel/start.ps1 passes the ngrok URL).
  if (testSite) {
    manifest.externally_connectable?.matches.push(`${testSite}/*`);
    bridge?.matches.push(`${testSite}/*`);
  }

  if (target === 'firefox') {
    // Firefox MV3: event page instead of a service worker, blocking webRequest
    // instead of webRequestAuthProvider, and no externally_connectable (the
    // content-script bridge replaces it).
    manifest.background = { scripts: ['sw.js'], type: 'module' };
    manifest.permissions = manifest.permissions
      .filter((p) => p !== 'webRequestAuthProvider')
      .concat('webRequestBlocking');
    delete manifest.externally_connectable;
    delete manifest.minimum_chrome_version;
    manifest.browser_specific_settings.gecko.data_collection_permissions = {
      // Pairing tokens, and the sites a buyer opens travel through the proxy.
      required: ['authenticationInfo', 'browsingActivity'],
    };
  } else {
    delete manifest.browser_specific_settings;
  }
  return manifest;
}
