import Script from 'next/script';

/**
 * Optional privacy-friendly analytics. Set NEXT_PUBLIC_PLAUSIBLE_DOMAIN to enable.
 * Example: NEXT_PUBLIC_PLAUSIBLE_DOMAIN=docs.proxyhubb.com
 */
export function DocsAnalytics() {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN?.trim();
  if (!domain) return null;

  return (
    <Script
      defer
      data-domain={domain}
      src="https://plausible.io/js/script.js"
      strategy="afterInteractive"
    />
  );
}
