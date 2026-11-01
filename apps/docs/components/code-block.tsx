'use client';

import { type MouseEvent, type ReactNode, useCallback, useState, useEffect, useRef } from 'react';

export function CodeBlock({
  children,
  language,
}: {
  children: ReactNode;
  language?: string;
}) {
  const label = (language || 'code').toLowerCase();
  const body = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    void document.fonts.ready.then(measure);
    measure();
    return () => observer.disconnect();
  }, [children]);
  return (
    <div className="code-block" data-language={label}>
      <div className="code-chrome">
        <span className="code-lang">{label}</span>
        <CopyButton />
      </div>
      <div ref={body} className="code-body" role="region" aria-label={`${label} code example`} tabIndex={0}>{children}</div>
      {overflows ? <p className="code-scroll-hint">Scroll sideways for the complete example.</p> : null}
    </div>
  );
}

function CopyButton() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const onCopy = useCallback(async (e: MouseEvent<HTMLButtonElement>) => {
    const wrap = e.currentTarget.closest('.code-block');
    const code = wrap?.querySelector('pre code, pre, code');
    const text = code?.textContent ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setFailed(true);
    }
  }, []);

  return (
    <button type="button" className="code-copy" onClick={onCopy} aria-label={copied ? 'Code copied' : failed ? 'Copy failed. Try again' : 'Copy code'}>
      {copied ? 'Copied' : failed ? 'Copy failed' : 'Copy'}
    </button>
  );
}
