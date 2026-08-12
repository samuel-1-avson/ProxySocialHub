'use client';

import { type MouseEvent, type ReactNode, useCallback, useState } from 'react';

export function CodeBlock({
  children,
  language,
}: {
  children: ReactNode;
  language?: string;
}) {
  const label = (language || 'code').toLowerCase();
  return (
    <div className="code-block" data-language={label}>
      <div className="code-chrome">
        <span className="code-lang">{label}</span>
        <CopyButton />
      </div>
      <div className="code-body">{children}</div>
    </div>
  );
}

function CopyButton() {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async (e: MouseEvent<HTMLButtonElement>) => {
    const wrap = e.currentTarget.closest('.code-block');
    const code = wrap?.querySelector('pre code, pre, code');
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
