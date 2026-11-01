import type { ReactNode } from 'react';

export function PathCard({
  href,
  code,
  title,
  meta,
  children,
}: {
  href: string;
  code: string;
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} className="path-card">
      <span className="path-card-code">{code}</span>
      <span className="path-card-title">{title}</span>
      {meta ? <span className="path-card-meta">{meta}</span> : null}
      <div className="path-card-body">{children}</div>
      <span className="path-card-cta">Open →</span>
    </a>
  );
}

export function RoleGrid({ children }: { children: ReactNode }) {
  return <div className="role-grid">{children}</div>;
}

export function HomeStrip({ children }: { children: ReactNode }) {
  return <div className="home-strip">{children}</div>;
}

export function StripLink({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint?: string;
}) {
  return (
    <a href={href} className="strip-link">
      <span className="strip-label">{label}</span>
      {hint ? <span className="strip-hint">{hint}</span> : null}
      <span className="strip-arrow" aria-hidden="true">↗</span>
    </a>
  );
}
