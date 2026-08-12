import { DocsShell } from '@/components/docs-shell';
import { Markdown } from '@/components/markdown';
import { DocToc } from '@/components/doc-toc';
import { DocPager } from '@/components/doc-pager';
import { OpenApiReference } from '@/components/openapi-reference';
import { getDoc, listDocSlugs, stripLeadingH1 } from '@/lib/content';
import { extractToc } from '@/lib/toc';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

const SITE = 'https://docs.proxyhubb.com';

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateStaticParams() {
  return listDocSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug = [] } = await props.params;
  const doc = getDoc(slug);
  if (!doc) return {};
  const path = '/docs' + (slug.length ? `/${slug.join('/')}` : '');
  const title = doc.title;
  const description =
    doc.description || 'ProxyHubb documentation for buyers, providers, SDKs, and the Control API.';
  return {
    title,
    description,
    alternates: { canonical: `${SITE}${path}` },
    openGraph: {
      title: `${title} | ProxyHubb Docs`,
      description,
      url: `${SITE}${path}`,
      siteName: 'ProxyHubb Docs',
      type: 'article',
    },
    twitter: {
      card: 'summary',
      title: `${title} | ProxyHubb Docs`,
      description,
    },
  };
}

export default async function DocPage(props: Props) {
  const { slug = [] } = await props.params;
  const doc = getDoc(slug);
  if (!doc) notFound();

  const path = '/docs' + (slug.length ? `/${slug.join('/')}` : '');
  const isApi = slug.join('/') === 'api' || (slug[0] === 'api' && slug.length === 1);
  const body = stripLeadingH1(doc.body);
  const toc = isApi ? [] : extractToc(body);

  return (
    <DocsShell activePath={path}>
      <div className={`doc-layout${toc.length ? ' has-toc' : ''}`}>
        <article className="doc-article">
          <h1>{doc.title}</h1>
          {doc.description ? <p className="desc">{doc.description}</p> : null}
          <Markdown source={body} />
          {isApi ? <OpenApiReference /> : null}
          <DocPager href={path} />
        </article>
        {toc.length ? <DocToc items={toc} /> : null}
      </div>
    </DocsShell>
  );
}
