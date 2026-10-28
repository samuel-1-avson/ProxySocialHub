import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { DocsAnalytics } from '@/components/analytics';
import './globals.css';

const sans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});
const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
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

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#15191f' },
    { media: '(prefers-color-scheme: light)', color: '#f4f4f9' },
  ],
};

const themeBoot = `(function(){var t='system';try{var s=localStorage.getItem('phub-docs-theme');if(s==='light'||s==='dark')t=s;}catch(e){}var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.setAttribute('data-theme',d?'dark':'light');})();`;

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.className} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        {children}
        <DocsAnalytics />
      </body>
    </html>
  );
}
