'use client';

import { useEffect, useState } from 'react';

/** Reading progress + sticky mini-title for long article pages. */
export function ReadingChrome({ title }: { title: string }) {
  const [progress, setProgress] = useState(0);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const article = document.querySelector<HTMLElement>('.doc-article');
    const h1 = article?.querySelector('h1');

    const onScroll = () => {
      const el = article;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = el.scrollHeight - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      setProgress(Math.round((scrolled / Math.max(total, 1)) * 100));
      if (h1) {
        setStuck(h1.getBoundingClientRect().bottom < 56);
      }
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [title]);

  return (
    <>
      <div
        className="reading-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label="Reading progress"
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className={`reading-sticky${stuck ? ' is-visible' : ''}`} aria-hidden={!stuck}>
        <span className="reading-sticky-title">{title}</span>
      </div>
    </>
  );
}
