import type { ReactNode } from 'react';

/** Inline keyboard hint, e.g. <KbdHint keys="/">to search</KbdHint> */
export function KbdHint({
  keys,
  children,
}: {
  keys: string;
  children?: ReactNode;
}) {
  const parts = keys.split('+').map((k) => k.trim()).filter(Boolean);
  return (
    <span className="kbd-hint">
      {parts.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
      {children ? <span className="kbd-hint-label">{children}</span> : null}
    </span>
  );
}
