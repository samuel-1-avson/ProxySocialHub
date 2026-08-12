import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: 'https://docs.proxyhubb.com/sitemap.xml',
    host: 'https://docs.proxyhubb.com',
  };
}
