import type { ReactNode } from 'react';

export function HomeHero({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  const lastSpace = title.lastIndexOf(' ');
  return (
    <header className="home-hero">
      <div className="home-hero-copy">
      <p className="home-kicker">{kicker}</p>
      <h1 className="home-title">{title.slice(0, lastSpace)} <span>{title.slice(lastSpace + 1)}</span></h1>
      <div className="home-lede">{children}</div>
      <div className="home-hero-actions"><a href="/docs/getting-started" className="ph-primary-link">Get started <span aria-hidden="true">→</span></a><a href="/docs/api" className="ph-subtle-link">API reference <span aria-hidden="true">↗</span></a></div>
      </div>
      <aside className="home-hero-guide">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4V4Zm16 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3V4Z" /></svg>
        <p>New to ProxyHubb?</p><h2>See the whole picture.</h2><span>Understand the request path, the marketplace, and the terms before you connect.</span><a href="/docs/how-it-works">How it works <span aria-hidden="true">↗</span></a>
      </aside>
    </header>
  );
}
