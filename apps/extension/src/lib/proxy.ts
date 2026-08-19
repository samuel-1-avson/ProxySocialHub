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

export function setDirectProxy(): Promise<void> {
  return new Promise((resolve, reject) => {
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
