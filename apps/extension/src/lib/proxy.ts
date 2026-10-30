import { IS_FIREFOX, TEST_SITE } from './config';

export const PROXY_BYPASS_LIST = [
  'localhost',
  '127.0.0.1',
  '::1',
  '<local>',
  'proxyhubb.com',
  '*.proxyhubb.com',
  'api.proxyhubb.com',
  ...(TEST_SITE ? [new URL(TEST_SITE).hostname] : []),
];

export const PROXY_SECRET_KEYS = ['proxyUser', 'proxyPass'] as const;

export type ConnectionState = 'off' | 'on' | 'lost';

/** True when Chrome's bypassList would send this host direct. */
export function bypassesProxy(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return PROXY_BYPASS_LIST.some((rule) => {
    if (rule === '<local>') {
      return !host.includes('.') && !host.includes(':');
    }
    if (rule.startsWith('*.')) {
      return host.endsWith(rule.slice(1));
    }
    return host === rule;
  });
}

// Firefox has no fixed_servers proxy mode for extensions; route each request
// through proxy.onRequest instead. The route lives in memory and in
// storage.session (proxyHost/proxyPort, written by connectOrder) so it survives
// the background page being unloaded.
type FirefoxRoute = { host: string; port: number } | null;
let firefoxRoute: FirefoxRoute = null;

type FirefoxProxyInfo = { type: 'direct' } | { type: 'http'; host: string; port: number };
type FirefoxProxyApi = {
  onRequest: {
    addListener: (cb: (details: { url: string }) => FirefoxProxyInfo, filter: { urls: string[] }) => void;
  };
  onError: { addListener: (cb: (error: { message?: string }) => void) => void };
};

function firefoxProxy(): FirefoxProxyApi {
  return (chrome as unknown as { proxy: FirefoxProxyApi }).proxy;
}

/** Call once at worker start (Firefox only). */
export function installFirefoxProxyRouting(onError: (message: string) => void): void {
  firefoxProxy().onRequest.addListener(
    (details) => {
      if (!firefoxRoute) {
        return { type: 'direct' };
      }
      try {
        if (bypassesProxy(new URL(details.url).hostname)) {
          return { type: 'direct' };
        }
      } catch {
        return { type: 'direct' };
      }
      return { type: 'http', host: firefoxRoute.host, port: firefoxRoute.port };
    },
    { urls: ['<all_urls>'] },
  );
  firefoxProxy().onError.addListener((error) => onError(error?.message ?? ''));
  void chrome.storage.session.get(['proxyHost', 'proxyPort', 'connectionState']).then((stored) => {
    const on = stored.connectionState === 'on' || stored.connectionState === 'lost';
    if (on && typeof stored.proxyHost === 'string' && typeof stored.proxyPort === 'number') {
      firefoxRoute = { host: stored.proxyHost, port: stored.proxyPort };
    }
  });
}

export function getProxyControlLevel(): Promise<string> {
  if (IS_FIREFOX) {
    // Same vocabulary as Chrome so callers need no branches.
    return Promise.resolve(firefoxRoute ? 'controlled_by_this_extension' : 'controllable_by_this_extension');
  }
  return new Promise((resolve) => {
    if (!chrome.proxy?.settings?.get) {
      resolve('unknown');
      return;
    }
    chrome.proxy.settings.get({ incognito: false }, (config) => {
      resolve(config?.levelOfControl ?? 'unknown');
    });
  });
}

/**
 * Enable WebRTC IP leak protection by restricting STUN/UDP routing to proxied interfaces only.
 */
export async function enableWebRTCProtection(): Promise<void> {
  try {
    if (chrome.privacy?.network?.webRTCIPHandlingPolicy?.set) {
      await new Promise<void>((resolve) => {
        chrome.privacy.network.webRTCIPHandlingPolicy.set(
          { value: 'disable_non_proxied_udp', scope: 'regular' },
          () => resolve(),
        );
      });
    }
  } catch {
    // Non-fatal if browser environment does not support privacy API
  }
}

/**
 * Clear WebRTC IP handling policy back to default browser behavior.
 */
export async function clearWebRTCProtection(): Promise<void> {
  try {
    if (chrome.privacy?.network?.webRTCIPHandlingPolicy?.clear) {
      await new Promise<void>((resolve) => {
        chrome.privacy.network.webRTCIPHandlingPolicy.clear({ scope: 'regular' }, () => resolve());
      });
    }
  } catch {
    // Non-fatal
  }
}

export function setDirectProxy(): Promise<void> {
  if (IS_FIREFOX) {
    firefoxRoute = null;
    return clearWebRTCProtection();
  }
  return new Promise((resolve, reject) => {
    // Revert WebRTC policy when proxy is disabled
    void clearWebRTCProtection();

    chrome.proxy.settings.set({ value: { mode: 'direct' }, scope: 'regular' }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

export async function setHmacHttpProxy(host: string, port: number): Promise<void> {
  if (IS_FIREFOX) {
    firefoxRoute = { host, port };
    await enableWebRTCProtection();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    chrome.proxy.settings.set(
      {
        value: {
          mode: 'fixed_servers',
          rules: {
            singleProxy: { scheme: 'http', host, port },
            bypassList: PROXY_BYPASS_LIST,
          },
        },
        scope: 'regular',
      },
      () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve();
      },
    );
  });

  // Enable WebRTC leak shield alongside the proxy
  await enableWebRTCProtection();

  const level = await getProxyControlLevel();
  if (level !== 'controlled_by_this_extension') {
    try {
      await setDirectProxy();
    } catch {
      // still report the control failure
    }
    if (level === 'controlled_by_other_extensions') {
      throw new Error('another extension controls Chrome proxy');
    }
    throw new Error(`Chrome proxy not controlled by ProxyHubb (${level})`);
  }
}

export async function wipeProxySecrets(): Promise<void> {
  await chrome.storage.session.remove([...PROXY_SECRET_KEYS]);
}
