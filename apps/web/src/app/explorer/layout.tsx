"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeSelect } from "@/components/workspace/ThemeSelect";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ExplorerTrustBadge } from "@/components/explorer/ExplorerTrustBadge";
import { BrandMonogram } from "@/components/BrandMonogram";
const links = [
  ["Overview", "/explorer"],
  ["Map", "/explorer/map"],
  ["Nodes", "/explorer/nodes"],
  ["Sessions", "/explorer/sessions"],
  ["Transactions", "/explorer/transactions"],
  ["Blocks", "/explorer/blocks"],
  ["Wallets", "/explorer/wallets"],
  ["Contracts", "/explorer/contracts"],
  ["Analytics", "/explorer/analytics"],
  ["Health", "/explorer/health"],
  ["Earnings", "/explorer/earnings"],
  ["Leaderboard", "/explorer/leaderboard"],
  ["Governance", "/governance"],
  ["Search", "/explorer/search"],
];
export default function ExplorerLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div>
      <header className="explorer-header">
        <Link
          className="explorer-brand"
          href="/explorer"
          aria-label="ProxyHubb Explorer"
        >
          <span className="workspace-mark" aria-hidden="true">
            <BrandMonogram />
          </span>
          <span className="explorer-brand-label">
            <span className="explorer-brand-product">ProxyHubb</span>{" "}
            <span className="explorer-brand-area">Explorer</span>
          </span>
        </Link>
        <div className="explorer-tools">
          <ThemeSelect />
          <ExplorerTrustBadge />
          <Link href="/app">
            Open workspace <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>
      <nav className="explorer-nav" aria-label="Explorer primary">
        {links.map(([label, href]) => (
          // These destinations intentionally remain in one swipeable rail on narrow screens.
          <Link
            key={href}
            href={href}
            prefetch={false}
            className={
              (href === "/explorer" ? path === href : path.startsWith(href))
                ? "active"
                : ""
            }
            aria-current={
              (href === "/explorer" ? path === href : path.startsWith(href))
                ? "page"
                : undefined
            }
          >
            {label}
          </Link>
        ))}
      </nav>
      <main id="main-content" tabIndex={-1} className="explorer-content">
        <ErrorBoundary level="section">
          <div className="record-family">{children}</div>
        </ErrorBoundary>
      </main>
      <footer className="explorer-site-footer">
        <span>Public network data / ProxyHubb Explorer</span>
        <Link href="/help">Help & data notes</Link>
      </footer>
    </div>
  );
}
