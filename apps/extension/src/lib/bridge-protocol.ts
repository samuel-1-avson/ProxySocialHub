/**
 * Page <-> extension bridge messages. The website posts a request with
 * window.postMessage; the content script (bridge.ts) relays it to the worker
 * and posts the answer back. Works in Chrome and Firefox, with no extension ID.
 * apps/web/src/lib/extension.ts speaks the same format.
 */

export const BRIDGE_PAGE_SOURCE = 'proxyhubb-page';
export const BRIDGE_EXT_SOURCE = 'proxyhubb-ext';
/** Set on <html> by the content script so the page can tell the extension is there. */
export const BRIDGE_MARKER_ATTRIBUTE = 'data-proxyhubb-extension';

export const WEBSITE_MESSAGE_TYPES = ['ping', 'pair', 'connect', 'disconnect'] as const;
export type WebsiteMessageType = (typeof WEBSITE_MESSAGE_TYPES)[number];

export type WebsiteMessage = {
  type: WebsiteMessageType;
  code?: string;
  orderId?: string;
  listingTitle?: string;
};

export type BridgeRequest = {
  source: typeof BRIDGE_PAGE_SOURCE;
  id: string;
  message: WebsiteMessage;
};

/** Internal runtime message the content script sends to the worker. */
export type BridgeRelay = { type: 'website'; request: WebsiteMessage };

export function isWebsiteMessage(value: unknown): value is WebsiteMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const msg = value as Record<string, unknown>;
  if (!WEBSITE_MESSAGE_TYPES.includes(msg.type as WebsiteMessageType)) {
    return false;
  }
  for (const key of ['code', 'orderId', 'listingTitle'] as const) {
    if (msg[key] !== undefined && (typeof msg[key] !== 'string' || (msg[key] as string).length > 300)) {
      return false;
    }
  }
  return true;
}

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const req = value as Record<string, unknown>;
  return (
    req.source === BRIDGE_PAGE_SOURCE &&
    typeof req.id === 'string' &&
    req.id.length > 0 &&
    req.id.length <= 64 &&
    isWebsiteMessage(req.message)
  );
}

export function isBridgeRelay(value: unknown): value is BridgeRelay {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const relay = value as Record<string, unknown>;
  return relay.type === 'website' && isWebsiteMessage(relay.request);
}
