import Link from 'next/link';
import { DocsShell } from '@/components/docs-shell';

export default function NotFound() {
  return (
    <DocsShell activePath="/docs">
      <div className="doc-layout is-home">
        <article className="doc-article not-found-article">
          <p className="home-kicker">404</p>
          <h1>Page not in the manual</h1>
          <p className="desc">
            That path is missing or moved. Jump back to a known surface, or press{' '}
            <kbd>/</kbd> to search.
          </p>
          <div className="not-found-actions">
            <Link href="/docs" className="not-found-primary">
              Docs home
            </Link>
            <Link href="/docs/quickstart/buyer">Buyer quickstart</Link>
            <Link href="/docs/api">API reference</Link>
            <Link href="/docs/troubleshooting">Troubleshooting</Link>
          </div>
        </article>
      </div>
    </DocsShell>
  );
}
