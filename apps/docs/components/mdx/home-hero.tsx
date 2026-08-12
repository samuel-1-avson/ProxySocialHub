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
  return (
    <header className="home-hero">
      <p className="home-kicker">{kicker}</p>
      <h1 className="home-title">{title}</h1>
      <div className="home-lede">{children}</div>
    </header>
  );
}
