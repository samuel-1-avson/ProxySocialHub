import { EGRESS_CHECK_URLS, parseEgressIp } from './egress';

export const VERIFY_TAB_TIMEOUT_MS = 8000;

export type EgressProbe = {
  ip: string | null;
  rttMs: number;
  source: string;
  error?: string;
};

/**
 * Read a public IP from a real tab document.
 * Service-worker fetch() can skip chrome.proxy. Offscreen has no NETWORK reason.
 */
export async function probeEgressIp(timeoutMs = VERIFY_TAB_TIMEOUT_MS): Promise<EgressProbe> {
  const started = Date.now();
  let lastError = 'verify failed';
  for (const url of EGRESS_CHECK_URLS) {
    let tabId: number | undefined;
    try {
      const tab = await createBackgroundTab(withCacheBust(url));
      if (typeof tab.id !== 'number') {
        throw new Error('verify tab id missing');
      }
      tabId = tab.id;
      await waitTabComplete(tabId, timeoutMs);
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      const text = await readTabText(tabId);
      const ip = parseEgressIp(text);
      if (ip) {
        return { ip, rttMs: Date.now() - started, source: url };
      }
      lastError = `no IP in ${url}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'verify failed';
    } finally {
      if (typeof tabId === 'number') {
        try {
          await chrome.tabs.remove(tabId);
        } catch {
          // tab already gone
        }
      }
    }
  }
  return { ip: null, rttMs: Date.now() - started, source: '', error: lastError };
}

function withCacheBust(url: string): string {
  const u = new URL(url);
  u.searchParams.set('_phubb', String(Date.now()));
  return u.toString();
}

async function createBackgroundTab(url: string): Promise<chrome.tabs.Tab> {
  const create: chrome.tabs.CreateProperties = { url, active: false };
  try {
    const focused = await chrome.windows.getLastFocused();
    if (typeof focused.id === 'number') {
      create.windowId = focused.id;
    }
  } catch {
    // no window id is fine
  }
  return chrome.tabs.create(create);
}

function waitTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (err) {
        reject(err);
        return;
      }
      resolve();
    };
    const timer = setTimeout(() => finish(new Error('verify timed out')), timeoutMs);
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === 'complete') {
        finish();
      }
    };
    const onRemoved = (id: number) => {
      if (id === tabId) {
        finish(new Error('verify tab closed'));
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        finish(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab.status === 'complete') {
        finish();
      }
    });
  });
}

async function readTabText(tabId: number): Promise<string> {
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.body?.innerText ?? document.documentElement?.innerText ?? '',
  });
  const value = injected[0]?.result;
  return typeof value === 'string' ? value : '';
}
