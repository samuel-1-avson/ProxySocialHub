import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { DocsAnalytics } from '@/components/analytics';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
});

const SITE = 'https://docs.proxyhubb.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'ProxyHubb Docs', template: '%s | ProxyHubb Docs' },
  description:
    'Buyer proxy, SDKs, API reference, marketplace, and provider CLI documentation for ProxyHubb.',
  applicationName: 'ProxyHubb Docs',
  authors: [{ name: 'ProxyHubb' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE,
    siteName: 'ProxyHubb Docs',
    title: 'ProxyHubb Docs',
    description:
      'Buyer proxy, SDKs, API reference, marketplace, and provider CLI documentation for ProxyHubb.',
  },
  twitter: {
    card: 'summary',
    title: 'ProxyHubb Docs',
    description:
      'Buyer proxy, SDKs, API reference, marketplace, and provider CLI documentation for ProxyHubb.',
  },
  alternates: { canonical: SITE },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} data-theme="dark" suppressHydrationWarning>
      <body>
        {children}
        <DocsAnalytics />
      </body>
    </html>
  );
}
