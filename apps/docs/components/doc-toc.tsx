'use client';

import { useEffect, useId, useState, useRef } from 'react';
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

export function DocToc({ items, mode }: { items: TocItem[]; mode: 'mobile' | 'desktop' }) {
  const [active, setActive] = useState<string>('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);

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
    if (mode === 'desktop') return;
    document.body.classList.toggle('toc-sheet-open', sheetOpen);
    return () => document.body.classList.remove('toc-sheet-open');
  }, [sheetOpen, mode]);

  useEffect(() => {
    if (!sheetOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => [...(sheet.current?.querySelectorAll<HTMLElement>('a, button') || [])];
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSheetOpen(false); }
      if (event.key !== 'Tab') return;
      const elements = controls(), first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const media = window.matchMedia('(min-width: 1201px)');
    const onResize = () => { if (media.matches) setSheetOpen(false); };
    document.addEventListener('keydown', onKey);
    media.addEventListener('change', onResize);
    return () => { document.removeEventListener('keydown', onKey); media.removeEventListener('change', onResize); previous?.focus(); };
  }, [sheetOpen]);

  if (!items.length) return null;

  return (
    <>
      {mode === 'desktop' && <nav className="toc toc-rail" aria-label="On this page">
        <p className="toc-label">On this page</p>
        <TocList items={items} active={active} />
      </nav>}

      {mode === 'mobile' && <button
        type="button"
        className="toc-fab"
        aria-expanded={sheetOpen}
        aria-controls={sheetOpen ? `${titleId}-sheet` : undefined}
        aria-label="On this page"
        onClick={() => setSheetOpen(true)}
      >
        On this page
      </button>}

      {sheetOpen ? (
        <div className="toc-sheet-root" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button
            type="button"
            className="toc-sheet-scrim"
            aria-label="Close table of contents"
            onClick={() => setSheetOpen(false)}
          />
          <div ref={sheet} id={`${titleId}-sheet`} className="toc-sheet">
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
