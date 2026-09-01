export const PROXY_BYPASS_LIST = [
  'localhost',
  '127.0.0.1',
  '::1',
  '<local>',
  'proxyhubb.com',
  '*.proxyhubb.com',
  'api.proxyhubb.com',
];

export const PROXY_SECRET_KEYS = ['proxyUser', 'proxyPass'] as const;

export type ConnectionState = 'off' | 'on' | 'lost';

export function getProxyControlLevel(): Promise<string> {
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
