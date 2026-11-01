"use client";
import { explorerHref } from "@/lib/navigation/workspace";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { ModeToggle } from "@/components/ModeToggle";
import { BrandMonogram } from "@/components/BrandMonogram";
import { useAuth } from "@/lib/auth";
import { ROUTES } from "@/lib/navigation/routes";

const LINKS = [
  { href: ROUTES.marketplace, label: "Marketplace" },
  { href: explorerHref(), label: "Explorer", external: true },
  { href: explorerHref("/map"), label: "Network map", external: true },
  { href: ROUTES.governance, label: "Governance" },
  { href: "/community/forum", label: "Community" },
  { href: ROUTES.docs, label: "Docs", external: true },
] as const;

export function MarketingHeader() {
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navigation = (mobile = false) => (
    <>
      {LINKS.map((item) => {
        const active = item.href === ROUTES.explorer
          ? pathname === item.href
          : pathname === item.href || pathname?.startsWith(`${item.href}/`);
        const className = `${mobile ? "marketing-mobile-link" : "marketing-nav-link"}${active ? " active" : ""}`;
        return "external" in item && item.external ? (
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noreferrer"
            className={className}
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            className={className}
            aria-current={active ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );

  return (
    <header className="marketing-header sticky top-0 z-50">
      <div className="marketing-header-inner mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href={ROUTES.home} className="marketing-brand" aria-label="ProxyHubb home" onClick={() => setMenuOpen(false)}>
          <span className="marketing-brand-mark" aria-hidden="true"><BrandMonogram /></span>
          <span className="marketing-brand-name">ProxyHubb</span>
        </Link>

        <nav className="marketing-desktop-nav hidden items-center gap-1 lg:flex" aria-label="Primary">
          {navigation()}
        </nav>

        <div className="marketing-header-actions flex items-center gap-2 sm:gap-3">
          <ModeToggle />
          {isLoading ? (
            <span className="h-10 w-24 animate-pulse rounded-[var(--radius-md)] bg-secondary" aria-hidden="true" />
          ) : user ? (
            <Link href={ROUTES.dashboard} className="marketing-cta">
              Dashboard <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          ) : (
            <>
              <Link href={ROUTES.login} className="marketing-sign-in">Sign in</Link>
              <Link href={ROUTES.register} className="marketing-cta">Get started</Link>
            </>
          )}
          <button
            type="button"
            className="marketing-menu-toggle lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            aria-controls="marketing-mobile-navigation"
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <nav
        id="marketing-mobile-navigation"
        className={`marketing-mobile-nav lg:hidden${menuOpen ? " is-open" : ""}`}
        aria-label="Mobile primary"
        aria-hidden={!menuOpen}
      >
        {navigation(true)}
        {!user && (
          <Link href={ROUTES.login} className="marketing-mobile-link marketing-mobile-sign-in" onClick={() => setMenuOpen(false)}>
            Sign in
          </Link>
        )}
        <div className="marketing-mobile-footer">
          <span>Proxy capacity, clearly connected.</span>
          <span className="font-data">NETWORK / DEVNET</span>
        </div>
      </nav>
    </header>
  );
}
