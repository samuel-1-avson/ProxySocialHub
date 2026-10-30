declare const __PROXYHUBB_TEST_SITE__: string;
declare const __PROXYHUBB_TARGET__: string;

// Set by `PROXYHUBB_SITE=https://… npm run build` to test a shop served from
// another address (e.g. an ngrok tunnel). Its /v1 API lives on the same origin.
export const TEST_SITE = typeof __PROXYHUBB_TEST_SITE__ === 'string' ? __PROXYHUBB_TEST_SITE__ : '';

/** Which browser this bundle was built for (`npm run build -- --firefox`). */
export const IS_FIREFOX = typeof __PROXYHUBB_TARGET__ === 'string' && __PROXYHUBB_TARGET__ === 'firefox';
export const BROWSER_NAME = IS_FIREFOX ? 'Firefox' : 'Chrome';

/** Websites allowed to drive the extension (Connect button, pairing). */
export const SITE_ORIGINS = [
  'https://proxyhubb.com',
  'https://www.proxyhubb.com',
  'https://app.proxyhubb.com',
  ...(TEST_SITE ? [TEST_SITE] : []),
];

/** Local dev sites; stripped from store builds' manifest, so they only match unpacked builds. */
export const DEV_SITE_ORIGINS = [
  'http://localhost:3009',
  'http://localhost:8088',
  'http://localhost:4011',
  'http://127.0.0.1:4011',
];

export function isAllowedSiteOrigin(origin: string | undefined): boolean {
  return Boolean(origin) && (SITE_ORIGINS.includes(origin!) || DEV_SITE_ORIGINS.includes(origin!));
}

export const DEFAULT_API_BASE = TEST_SITE || 'https://api.proxyhubb.com';
export const DEFAULT_SITE = TEST_SITE || 'https://proxyhubb.com';

export async function getApiBase(): Promise<string> {
  const stored = await chrome.storage.local.get('apiBase');
  const raw = typeof stored.apiBase === 'string' ? stored.apiBase.trim() : '';
  return (raw || DEFAULT_API_BASE).replace(/\/$/, '');
}

export async function setApiBase(url: string): Promise<void> {
  await chrome.storage.local.set({ apiBase: url.replace(/\/$/, '') });
}
