import Link from 'next/link';
import { getAdjacent } from '@/lib/nav';

export function DocPager({ href }: { href: string }) {
  const { prev, next } = getAdjacent(href);
  if (!prev && !next) return null;

  return (
    <nav className="doc-pager" aria-label="Adjacent pages">
      {prev ? (
        <Link href={prev.href} className="doc-pager-link prev">
          <span className="doc-pager-dir">← Previous</span>
          <span className="doc-pager-section">{prev.section}</span>
          <span className="doc-pager-title">{prev.label}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.href} className="doc-pager-link next">
          <span className="doc-pager-dir">Next →</span>
          <span className="doc-pager-section">{next.section}</span>
          <span className="doc-pager-title">{next.label}</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
