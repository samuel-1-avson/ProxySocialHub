'use client';

import { useEffect, useId, useState } from 'react';
import type { TocItem } from '@/lib/toc';

function TocList({
  items,
  active,
  onNavigate,
}: {
  items: TocItem[];
  active: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="toc-list">
      {items.map((item) => (
        <li key={item.id} className={item.level === 3 ? 'toc-h3' : 'toc-h2'}>
          <a
            href={`#${item.id}`}
            className={active === item.id ? 'active' : undefined}
            onClick={onNavigate}
          >
            {item.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function DocToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string>('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const titleId = useId();

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
      { rootMargin: '-18% 0px -62% 0px', threshold: [0, 0.25, 1] },
    );
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  useEffect(() => {
    document.body.classList.toggle('toc-sheet-open', sheetOpen);
    return () => document.body.classList.remove('toc-sheet-open');
  }, [sheetOpen]);

  if (!items.length) return null;

  return (
    <>
      <nav className="toc toc-rail" aria-label="On this page">
        <p className="toc-label">On this page</p>
        <TocList items={items} active={active} />
      </nav>

      <button
        type="button"
        className="toc-fab"
        aria-expanded={sheetOpen}
        aria-controls="toc-sheet"
        aria-label="On this page"
        onClick={() => setSheetOpen(true)}
      >
        On this page
      </button>

      {sheetOpen ? (
        <div className="toc-sheet-root" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button
            type="button"
            className="toc-sheet-scrim"
            aria-label="Close table of contents"
            onClick={() => setSheetOpen(false)}
          />
          <div id="toc-sheet" className="toc-sheet">
            <div className="toc-sheet-head">
              <p id={titleId} className="toc-label">
                On this page
              </p>
              <button type="button" className="toc-sheet-close" onClick={() => setSheetOpen(false)}>
                Close
              </button>
            </div>
            <TocList items={items} active={active} onNavigate={() => setSheetOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
