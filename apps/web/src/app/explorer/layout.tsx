"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeSelect } from "@/components/workspace/ThemeSelect";
import { ErrorBoundary } from "@/components/ErrorBoundary";
const links = [
  ["Overview", "/explorer"],
  ["Nodes", "/explorer/nodes"],
  ["Ledger", "/explorer/transactions"],
  ["Analytics", "/explorer/analytics"],
  ["Governance", "/governance"],
];
export default function ExplorerLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div>
      <header className="explorer-header">
        <Link className="explorer-brand" href="/explorer">
          <span className="workspace-mark">ph</span>ProxyHubb
          <span>Explorer</span>
        </Link>
        <div className="explorer-tools">
          <ThemeSelect />
          <Link href="/app">Open workspace ↗</Link>
        </div>
      </header>
      <nav className="explorer-nav" aria-label="Explorer primary">
        {links.map(([label, href]) => (
          <Link
            key={href}
            href={href}
            prefetch={false}
            className={
              (href === "/explorer" ? path === href : path.startsWith(href))
                ? "active"
                : ""
            }
          >
            {label}
          </Link>
        ))}
      </nav>
      <main id="main-content" tabIndex={-1} className="explorer-content">
        <ErrorBoundary level="section">{children}</ErrorBoundary>
      </main>
    </div>
  );
}
