'use client';

import Link from 'next/link';
import { getBreadcrumbs } from '@/lib/nav';

export function DocBreadcrumb({ path }: { path: string }) {
  const crumbs = getBreadcrumbs(path);
  if (crumbs.length <= 1 && path === '/docs') return null;

  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <ol className="breadcrumb-list">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.href + c.label} className="breadcrumb-item">
              {last ? (
                <span aria-current="page">{c.label}</span>
              ) : (
                <Link href={c.href}>{c.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
