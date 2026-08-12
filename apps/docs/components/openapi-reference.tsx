'use client';

import { useEffect, useRef, useState } from 'react';

const SCALAR_SRC = '/vendor/scalar-api-reference.js';

function useDocsDarkMode(): boolean {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const read = () => document.documentElement.getAttribute('data-theme') !== 'light';
    setDark(read());
    const obs = new MutationObserver(() => setDark(read()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => obs.disconnect();
  }, []);

  return dark;
}

/**
 * Interactive OpenAPI via version-pinned, self-hosted Scalar bundle
 * (public/vendor/scalar-api-reference.js). Theme follows docs light/dark.
 */
export function OpenApiReference() {
  const host = useRef<HTMLDivElement>(null);
  const dark = useDocsDarkMode();

  useEffect(() => {
    const root = host.current;
    if (!root) return;

    root.innerHTML = '';
    const config = document.createElement('script');
    config.id = 'api-reference';
    config.setAttribute('data-url', '/openapi.yaml');
    config.setAttribute(
      'data-configuration',
      JSON.stringify({
        theme: 'kepler',
        darkMode: dark,
        forceDarkModeState: dark ? 'dark' : 'light',
        hideDarkModeToggle: true,
        hideModels: false,
        defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
        authentication: {
          preferredSecurityScheme: 'bearerAuth',
        },
        servers: [
          { url: 'https://api.proxyhubb.com', description: 'Public testnet / production API' },
          { url: 'http://localhost:8080', description: 'Local development' },
        ],
      }),
    );
    root.appendChild(config);

    const existing = document.querySelector<HTMLScriptElement>(`script[data-phub-scalar="1"]`);
    if (existing) existing.remove();

    const loader = document.createElement('script');
    loader.src = SCALAR_SRC;
    loader.async = true;
    loader.dataset.phubScalar = '1';
    document.body.appendChild(loader);

    return () => {
      loader.remove();
      root.innerHTML = '';
    };
  }, [dark]);

  return (
    <div className="openapi-wrap">
      <div ref={host} className="openapi-frame" />
      <p className="openapi-meta">
        Raw contract:{' '}
        <a href="/openapi.yaml">/openapi.yaml</a>
        {' · '}
        Prefer <code>Authorization: Bearer &lt;jwt&gt;</code> for intents/credentials;{' '}
        <code>X-API-Key: phub_…</code> for bulk pools and B2B purchase.
      </p>
    </div>
  );
}
