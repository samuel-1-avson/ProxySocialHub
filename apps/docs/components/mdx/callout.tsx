import type { ReactNode } from 'react';

type Tone = 'info' | 'tip' | 'warning' | 'danger';

const LABELS: Record<Tone, string> = {
  info: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Caution',
};

export function Callout({
  type = 'info',
  title,
  children,
}: {
  type?: Tone;
  title?: string;
  children: ReactNode;
}) {
  const tone = (['info', 'tip', 'warning', 'danger'] as const).includes(type as Tone)
    ? (type as Tone)
    : 'info';
  return (
    <aside className={`doc-callout doc-callout-${tone}`} role="note">
      <p className="doc-callout-title">{title || LABELS[tone]}</p>
      <div className="doc-callout-body">{children}</div>
    </aside>
  );
}
