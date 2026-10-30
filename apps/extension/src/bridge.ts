// Content script on the ProxyHubb website. Firefox has no externally_connectable,
// so the page talks to us through window.postMessage and this script relays to
// the worker. Chrome uses the same path, so the site never needs our ID.
import {
  BRIDGE_EXT_SOURCE,
  BRIDGE_MARKER_ATTRIBUTE,
  isBridgeRequest,
  type BridgeRelay,
} from './lib/bridge-protocol';

const version = chrome.runtime.getManifest().version;
const origin = window.location.origin;

document.documentElement.setAttribute(BRIDGE_MARKER_ATTRIBUTE, version);

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.origin !== origin || !isBridgeRequest(event.data)) {
    return;
  }
  const { id, message } = event.data;
  const relay: BridgeRelay = { type: 'website', request: message };
  chrome.runtime.sendMessage(relay, (response: unknown) => {
    const error = chrome.runtime.lastError?.message;
    window.postMessage(
      { source: BRIDGE_EXT_SOURCE, id, response: error ? { ok: false, error } : response ?? null },
      origin,
    );
  });
});

window.postMessage({ source: BRIDGE_EXT_SOURCE, type: 'ready', version }, origin);
