'use client';

import { useEffect, useState } from 'react';
import type { TocItem } from '@/lib/toc';

export function DocToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string>('');

  useEffect(() => {
    if (!items.length) return;
    const els = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!els.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.boundingClientRect.top > b.boundingClientRect.top ? 1 : -1));
        if (visible[0]?.target?.id) setActive(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: [0, 1] },
    );
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  if (!items.length) return null;

  return (
    <nav className="toc" aria-label="On this page">
      <p className="toc-label">On this page</p>
      <ul className="toc-list">
        {items.map((item) => (
          <li key={item.id} className={item.level === 3 ? 'toc-h3' : 'toc-h2'}>
            <a href={`#${item.id}`} className={active === item.id ? 'active' : undefined}>
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
