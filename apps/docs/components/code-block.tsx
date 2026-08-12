'use client';

import { type MouseEvent, type ReactNode, useCallback, useState } from 'react';

export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <div className="code-block">
      <CopyButton />
      {children}
    </div>
  );
}

function CopyButton() {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async (e: MouseEvent<HTMLButtonElement>) => {
    const wrap = e.currentTarget.closest('.code-block');
    const code = wrap?.querySelector('pre code, pre');
    const text = code?.textContent ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <button type="button" className="code-copy" onClick={onCopy} aria-label="Copy code">
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
