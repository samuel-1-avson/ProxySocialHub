'use client';

import { useEffect, useRef, useState } from 'react';

type ScalarInstance = { destroy: () => void };
type ScalarFactory = { createApiReference: (element: HTMLElement, config: Record<string, unknown>) => ScalarInstance };
type ScalarWindow = Window & { Scalar?: ScalarFactory };
let loader: Promise<ScalarFactory> | null = null;

function loadScalar(): Promise<ScalarFactory> {
  const existing = (window as ScalarWindow).Scalar;
  if (existing) return Promise.resolve(existing);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/scalar-api-reference.js';
    script.async = true;
    script.dataset.phubScalar = '1';
    script.onload = () => {
      const factory = (window as ScalarWindow).Scalar;
      if (factory) resolve(factory);
      else { loader = null; reject(new Error('API reference could not initialize.')); }
    };
    script.onerror = () => { loader = null; script.remove(); reject(new Error('API reference could not load.')); };
    document.body.appendChild(script);
  });
  return loader;
}

function useDocsDarkMode(): boolean | null {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => setDark(document.documentElement.getAttribute('data-theme') !== 'light');
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Mount the pinned, self-hosted viewer once per appearance; destroy it on cleanup. */
export function OpenApiReference() {
  const host = useRef<HTMLDivElement>(null);
  const dark = useDocsDarkMode();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const root = host.current;
    if (!root || dark === null) return;
    let cancelled = false;
    let instance: ScalarInstance | undefined;
    setState('loading');
    const labelSearch = () => root.querySelectorAll<HTMLElement>('.sidebar-search').forEach(button => {
      if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', 'Search API reference');
    });
    const observer = new MutationObserver(labelSearch);
    observer.observe(root, { childList: true, subtree: true });
    void loadScalar().then(factory => {
      if (cancelled) return;
      instance = factory.createApiReference(root, {
        url: '/openapi.yaml', theme: 'kepler', darkMode: dark,
        forceDarkModeState: dark ? 'dark' : 'light', hideDarkModeToggle: true,
        hideModels: false, defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
        authentication: { preferredSecurityScheme: 'bearerAuth' },
        servers: [{ url: 'https://api.proxyhubb.com', description: 'Public testnet / production API' }, { url: 'http://localhost:8080', description: 'Local development' }],
        customCss: '.light-mode, .dark-mode { --scalar-color-1: var(--foreground); --scalar-color-2: var(--muted-foreground); --scalar-color-3: var(--foreground); --scalar-color-accent: var(--primary); --scalar-background-1: var(--background); --scalar-background-2: var(--card); --scalar-background-3: var(--secondary); --scalar-background-accent: var(--secondary); --scalar-border-color: var(--border); --scalar-font: var(--font-sans); --scalar-font-code: var(--font-mono); } .sidebar-search-placeholder { color: var(--foreground) !important; }',
      });
      labelSearch();
      setState('ready');
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; observer.disconnect(); instance?.destroy(); root.replaceChildren(); };
  }, [dark, retry]);

  return <div className="openapi-wrap">
    {state === 'loading' ? <p className="openapi-load-status" role="status">Loading interactive API reference…</p> : null}
    {state === 'error' ? <div className="openapi-load-status" role="alert"><strong>API reference unavailable</strong><p>Try again or download the raw contract below.</p><button className="icon-btn" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : null}
    <div ref={host} className="openapi-frame" aria-busy={state === 'loading'} />
    <p className="openapi-meta">Raw contract: <a href="/openapi.yaml">/openapi.yaml</a>{' · '}Prefer <code>Authorization: Bearer &lt;jwt&gt;</code> for intents/credentials; <code>X-API-Key: phub_…</code> for bulk pools and B2B purchase.</p>
  </div>;
}
