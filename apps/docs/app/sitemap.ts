import type { MetadataRoute } from 'next';
import { listDocSlugs, getDoc } from '@/lib/content';

const SITE = 'https://docs.proxyhubb.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = listDocSlugs().map((slug) => {
    const path = '/docs' + (slug.length ? `/${slug.join('/')}` : '');
    const doc = getDoc(slug);
    const isHome = slug.length === 0;
    return {
      url: `${SITE}${path}`,
      lastModified: new Date(),
      changeFrequency: isHome ? ('weekly' as const) : ('monthly' as const),
      priority: isHome ? 1 : doc?.slug[0] === 'quickstart' ? 0.9 : 0.7,
    };
  });

  return [
    { url: SITE, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    ...pages,
  ];
}
