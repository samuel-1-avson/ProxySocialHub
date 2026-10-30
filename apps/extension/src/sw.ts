import { getSignedInLabel, pairFinish } from './lib/auth';
import {
  connectOrder,
  disconnectProxy,
  ensureProxyMatchesSession,
  handleReliabilityAlarm,
  readConnectStatus,
  verifyNow,
} from './lib/connect';
import { isBridgeRelay, isWebsiteMessage, type WebsiteMessage } from './lib/bridge-protocol';
import { IS_FIREFOX, isAllowedSiteOrigin } from './lib/config';
import { getProxyControlLevel, installFirefoxProxyRouting } from './lib/proxy';

type RuntimeMessage = { type?: string; code?: string; orderId?: string; listingTitle?: string };
type AuthAnswer = { authCredentials?: { username: string; password: string } };

function isHandoffOrderId(value: string): boolean {
  return /^[0-9a-zA-Z_-]{8,64}$/.test(value.trim());
}

function handoffListingTitle(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, 200);
}

function reply(sendResponse: (r: unknown) => void, payload: unknown) {
  sendResponse(payload);
}

function senderWebsiteOrigin(sender: chrome.runtime.MessageSender): string | undefined {
  if (sender.origin) {
    return sender.origin;
  }
  if (!sender.url) {
    return undefined;
  }
  try {
    return new URL(sender.url).origin;
  } catch {
    return undefined;
  }
}

async function proxyAuthAnswer(): Promise<AuthAnswer> {
  const stored = await chrome.storage.session.get(['proxyUser', 'proxyPass', 'connectionState']);
  const user = typeof stored.proxyUser === 'string' ? stored.proxyUser : '';
  const pass = typeof stored.proxyPass === 'string' ? stored.proxyPass : '';
  const connected = stored.connectionState === 'on' || stored.connectionState === 'lost';
  return connected && user && pass ? { authCredentials: { username: user, password: pass } } : {};
}

function recordProxyError(fatal: boolean, error: string) {
  // A single failed CONNECT (blocked dest, RST, idle timeout) is not a dead
  // proxy. Wiping HMAC here is why browsing dropped the tunnel after a few seconds.
  void chrome.storage.session.set({ lastProxyError: { fatal, error, at: Date.now() } });
}

// Register before any await, so a woken worker still answers the 407.
if (IS_FIREFOX) {
  // Firefox: blocking listener that returns a Promise.
  (chrome.webRequest.onAuthRequired.addListener as unknown as (
    cb: (details: { isProxy: boolean }) => Promise<AuthAnswer> | AuthAnswer,
    filter: { urls: string[] },
    spec: string[],
  ) => void)(
    (details) => (details.isProxy ? proxyAuthAnswer() : {}),
    { urls: ['<all_urls>'] },
    ['blocking'],
  );
  installFirefoxProxyRouting((message) => recordProxyError(false, message));
} else {
  // Chrome MV3: asyncBlocking + isProxy-only.
  chrome.webRequest.onAuthRequired.addListener(
    (details, asyncCallback) => {
      if (!asyncCallback) {
        return undefined;
      }
      if (!details.isProxy) {
        asyncCallback({});
        return undefined;
      }
      void proxyAuthAnswer().then(asyncCallback, () => asyncCallback({}));
      return undefined;
    },
    { urls: ['<all_urls>'] },
    ['asyncBlocking'],
  );
  chrome.proxy.onProxyError.addListener((details) => {
    recordProxyError(Boolean(details.fatal), typeof details.error === 'string' ? details.error : '');
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleReliabilityAlarm(alarm.name);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  // Website request relayed by our own content script (bridge.ts).
  if (isBridgeRelay(message)) {
    const fromBridge = sender.id === chrome.runtime.id && Boolean(sender.tab);
    if (!fromBridge || !isAllowedSiteOrigin(senderWebsiteOrigin(sender))) {
      reply(sendResponse, { ok: false, error: 'origin not allowed' });
      return false;
    }
    return handleWebsiteMessage(message.request, sendResponse);
  }
  if (message?.type === 'pair' && typeof message.code === 'string') {
    pairFinish(message.code)
      .then((session) => reply(sendResponse, { ok: true, email: session.user.email }))
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  if (message?.type === 'connect' && typeof message.orderId === 'string') {
    connectOrder(message.orderId, message.listingTitle ?? '')
      .then((status) => reply(sendResponse, { ok: true, status }))
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  if (message?.type === 'disconnect') {
    disconnectProxy()
      .then(() => reply(sendResponse, { ok: true }))
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  if (message?.type === 'verify') {
    verifyNow()
      .then((status) => reply(sendResponse, { ok: true, status }))
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  if (message?.type === 'status') {
    Promise.all([getSignedInLabel(), readConnectStatus(), getProxyControlLevel()])
      .then(([label, status, level]) => {
        reply(sendResponse, {
          ok: true,
          signedIn: Boolean(label),
          label,
          status,
          levelOfControl: level,
        });
      })
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  return false;
});

/**
 * ping / pair / connect / disconnect from the ProxyHubb website. Reached through
 * the content-script bridge (Chrome + Firefox) or Chrome's externally_connectable.
 * Returns true when sendResponse will be called asynchronously.
 */
function handleWebsiteMessage(message: WebsiteMessage, sendResponse: (r: unknown) => void): boolean {
  if (message.type === 'ping') {
    Promise.all([getSignedInLabel(), readConnectStatus(), getProxyControlLevel()])
      .then(([label, status, level]) => {
        reply(sendResponse, {
          ok: true,
          installed: true,
          browser: IS_FIREFOX ? 'firefox' : 'chrome',
          signedIn: Boolean(label),
          version: chrome.runtime.getManifest().version,
          proxySet: level === 'controlled_by_this_extension',
          connectionState: status.state,
          orderId: status.orderId,
          ip: status.verify?.healthy ? status.verify.ip : undefined,
        });
      })
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'disconnect') {
    disconnectProxy()
      .then(() => reply(sendResponse, { ok: true }))
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  if (message?.type === 'pair' && typeof message.code === 'string') {
    pairFinish(message.code)
      .then((session) => reply(sendResponse, { ok: true, email: session.user.email }))
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'connect' && typeof message.orderId === 'string') {
    if (!isHandoffOrderId(message.orderId)) {
      reply(sendResponse, { ok: false, error: 'invalid order' });
      return false;
    }
    const orderId = message.orderId.trim();
    const listingTitle = handoffListingTitle(message.listingTitle);
    getSignedInLabel()
      .then(async (label) => {
        if (!label) {
          reply(sendResponse, { ok: false, error: 'pair this browser first' });
          return;
        }
        // The page shows the result (and the toolbar badge says ON), so no popup.
        const status = await connectOrder(orderId, listingTitle);
        reply(sendResponse, { ok: true, status });
      })
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  reply(sendResponse, { ok: false, error: 'unknown message' });
  return false;
}

// Chrome only: older site builds message us directly by extension ID.
if (!IS_FIREFOX) {
  chrome.runtime.onMessageExternal.addListener((message: unknown, sender, sendResponse) => {
    if (!isAllowedSiteOrigin(senderWebsiteOrigin(sender))) {
      reply(sendResponse, { ok: false, error: 'origin not allowed' });
      return false;
    }
    if (!isWebsiteMessage(message)) {
      reply(sendResponse, { ok: false, error: 'unknown message' });
      return false;
    }
    return handleWebsiteMessage(message, sendResponse);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureProxyMatchesSession();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureProxyMatchesSession();
});

void ensureProxyMatchesSession();
