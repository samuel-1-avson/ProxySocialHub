import { getSignedInLabel, pairFinish } from './lib/auth';
import {
  connectOrder,
  disconnectProxy,
  ensureProxyMatchesSession,
  handleReliabilityAlarm,
  markConnectionLost,
  readConnectStatus,
  verifyNow,
} from './lib/connect';
import { getProxyControlLevel } from './lib/proxy';

type RuntimeMessage = { type?: string; code?: string; orderId?: string; listingTitle?: string };

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

function allowedWebsiteOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }
  return (
    origin === 'https://proxyhubb.com' ||
    origin === 'https://www.proxyhubb.com' ||
    origin === 'https://app.proxyhubb.com' ||
    origin.startsWith('http://localhost:4011') ||
    origin.startsWith('http://127.0.0.1:4011')
  );
}

// Register before any await. MV3: asyncBlocking + isProxy-only.
chrome.webRequest.onAuthRequired.addListener(
  (details, asyncCallback) => {
    if (!asyncCallback) {
      return undefined;
    }
    if (!details.isProxy) {
      asyncCallback({});
      return undefined;
    }
    chrome.storage.session.get(['proxyUser', 'proxyPass', 'connectionState'], (stored) => {
      const user = typeof stored.proxyUser === 'string' ? stored.proxyUser : '';
      const pass = typeof stored.proxyPass === 'string' ? stored.proxyPass : '';
      const connected = stored.connectionState === 'on' || stored.connectionState === 'lost';
      if (connected && user && pass) {
        asyncCallback({ authCredentials: { username: user, password: pass } });
        return;
      }
      asyncCallback({});
    });
    return undefined;
  },
  { urls: ['<all_urls>'] },
  ['asyncBlocking'],
);

chrome.proxy.onProxyError.addListener((details) => {
  void markConnectionLost(Boolean(details.fatal));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleReliabilityAlarm(alarm.name);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
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

chrome.runtime.onMessageExternal.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (!allowedWebsiteOrigin(senderWebsiteOrigin(sender))) {
    reply(sendResponse, { ok: false, error: 'origin not allowed' });
    return;
  }
  if (message?.type === 'ping') {
    Promise.all([getSignedInLabel(), readConnectStatus(), getProxyControlLevel()])
      .then(([label, status, level]) => {
        reply(sendResponse, {
          ok: true,
          installed: true,
          signedIn: Boolean(label),
          version: chrome.runtime.getManifest().version,
          proxySet: level === 'controlled_by_this_extension',
          connectionState: status.state,
          orderId: status.orderId,
        });
      })
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  if (message?.type === 'pair' && typeof message.code === 'string') {
    pairFinish(message.code)
      .then((session) => reply(sendResponse, { ok: true, email: session.user.email }))
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  if (message?.type === 'connect' && typeof message.orderId === 'string') {
    if (!isHandoffOrderId(message.orderId)) {
      reply(sendResponse, { ok: false, error: 'invalid order' });
      return;
    }
    const orderId = message.orderId.trim();
    const listingTitle = handoffListingTitle(message.listingTitle);
    getSignedInLabel()
      .then(async (label) => {
        if (!label) {
          reply(sendResponse, { ok: false, error: 'pair this browser first' });
          return;
        }
        const status = await connectOrder(orderId, listingTitle);
        try {
          await chrome.action.openPopup();
        } catch {
          // Popup can only open with a user gesture; the badge still shows ON.
        }
        reply(sendResponse, { ok: true, status });
      })
      .catch((err: Error) => reply(sendResponse, { ok: false, error: err.message }));
    return true;
  }
  reply(sendResponse, { ok: false, error: 'unknown message' });
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureProxyMatchesSession();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureProxyMatchesSession();
});

void ensureProxyMatchesSession();
