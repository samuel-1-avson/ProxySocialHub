import type { ReactNode } from 'react';

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="doc-steps">{children}</ol>;
}

export function Step({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <li className="doc-step">
      {title ? <p className="doc-step-title">{title}</p> : null}
      <div className="doc-step-body">{children}</div>
    </li>
  );
}
