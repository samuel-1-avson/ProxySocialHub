"use client";

import Link from "next/link";
import { ModeToggle } from "@/components/ModeToggle";
import { useAuth } from "@/lib/auth";
import { explorerHref } from "@/lib/navigation/workspace";
import { ROUTES } from "@/lib/navigation/routes";

/**
 * Minimal marketing chrome — Quiet Infrastructure.
 * Auth-aware: shows Dashboard when signed in.
 */
export function MarketingHeader() {
  const { user, isLoading } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={ROUTES.home} className="flex items-center gap-2.5 group">
          <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-primary text-primary-foreground font-data text-sm font-bold tracking-tight">
            PH
          </span>
          <span className="font-data text-sm font-semibold tracking-[0.12em] uppercase text-foreground">
            ProxyHubb
          </span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          {[
            { href: ROUTES.marketplace, label: "Marketplace", external: false },
            { href: explorerHref(), label: "Explorer", external: true, blank: false },
            { href: ROUTES.docs, label: "Docs", external: true, blank: true },
          ].map((item) =>
            item.external ? (
              <a
                key={item.href}
                href={item.href}
                target={item.blank ? "_blank" : undefined}
                rel={item.blank ? "noreferrer" : undefined}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <ModeToggle />
          {isLoading ? (
            <span className="h-9 w-20 animate-pulse rounded-[var(--radius-md)] bg-secondary" aria-hidden />
          ) : user ? (
            <Link
              href={ROUTES.dashboard}
              className="inline-flex h-9 items-center rounded-[var(--radius-md)] bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--primary-dark)]"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href={ROUTES.login}
                className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
              >
                Sign in
              </Link>
              <Link
                href={ROUTES.register}
                className="inline-flex h-9 items-center rounded-[var(--radius-md)] bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--primary-dark)]"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
