export const DEFAULT_API_BASE = 'https://api.proxyhubb.com';
export const DEFAULT_SITE = 'https://proxyhubb.com';

export async function getApiBase(): Promise<string> {
  const stored = await chrome.storage.local.get('apiBase');
  const raw = typeof stored.apiBase === 'string' ? stored.apiBase.trim() : '';
  return (raw || DEFAULT_API_BASE).replace(/\/$/, '');
}

export async function setApiBase(url: string): Promise<void> {
  await chrome.storage.local.set({ apiBase: url.replace(/\/$/, '') });
}
