"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CircleHelp,
  Inbox,
  LogOut,
  Search,
  Settings,
  Shield,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useRole } from "@/hooks/useRole";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  WORKSPACE_DESTINATIONS,
  WORKSPACE_TOOLS,
  SHARED_WORKSPACE_TOOLS,
  explorerHref,
} from "@/lib/navigation/workspace";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { Modal } from "@/components/patterns/Modal";
import { BrandLockup } from "@/components/BrandLockup";
import { ThemeSelect } from "./ThemeSelect";
export function WorkspaceHeader() {
  const { user, logout } = useAuth();
  const { isAdmin } = useRole();
  const { mode } = useWorkspace();
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const accountName =
    user?.display_name ||
    user?.username ||
    (user?.wallet_address
      ? `${user.wallet_address.slice(0, 4)}…${user.wallet_address.slice(-4)}`
      : "Your account");
  const destinations = [
    ...WORKSPACE_DESTINATIONS[mode],
    { label: "Community forum", href: "/community/forum" },
    { label: "Activity feed", href: "/community/feed" },
    { label: "Governance", href: "/governance" },
    { label: "Settings", href: "/app/settings" },
    { label: "Wallet", href: "/app/wallet" },
    { label: "Inbox", href: "/messages" },
    { label: "Help & support", href: "/help" },
    ...WORKSPACE_TOOLS[mode],
    ...SHARED_WORKSPACE_TOOLS,
    ...(isAdmin ? [{ label: "Administration", href: "/dashboard/admin" }] : []),
  ];
  return (
    <>
      <header className="workspace-header">
        <BrandLockup
          className="workspace-mobile-brand"
          href={mode === "seller" ? "/provider" : "/app"}
        />
        <button
          className="workspace-search-trigger"
          onClick={() => setSearchOpen(true)}
          title="Search workspace"
          aria-label="Search workspace"
          aria-keyshortcuts="Control+k Meta+k"
        >
          <Search size={17} aria-hidden="true" />
          <span>Search workspace</span>
          <kbd aria-hidden="true">Ctrl / ⌘ K</kbd>
        </button>
        <div className="workspace-header-actions">
          <ThemeSelect />
          <Link href="/app/wallet" className="workspace-wallet-link">
            <Wallet size={16} aria-hidden="true" />
            Wallet
          </Link>
          <Link className="workspace-inbox-link" href="/messages">
            <Inbox size={17} aria-hidden="true" />
            <span>Inbox</span>
          </Link>
          <button
            className="workspace-account-button"
            aria-label="Account menu"
            onClick={() => setAccountOpen(true)}
          >
            {user ? accountName.slice(0, 2).toUpperCase() : "→"}
          </button>
        </div>
      </header>
      <Modal
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Search workspace"
        description="Find a page or a supported task."
      >
        <input
          className="ui-input w-full"
          aria-label="Find a page"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search destinations…"
          autoFocus
        />
        <div className="workspace-menu-list mt-4 max-h-[55dvh] overflow-y-auto">
          {destinations
            .filter((item) =>
              item.label.toLowerCase().includes(term.toLowerCase()),
            )
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSearchOpen(false)}
              >
                {item.label}
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            ))}
          {destinations.every(
            (item) => !item.label.toLowerCase().includes(term.toLowerCase()),
          ) && <p className="ui-muted p-3">No matching pages.</p>}
        </div>
      </Modal>
      <Modal
        open={accountOpen}
        onOpenChange={setAccountOpen}
        title={user ? accountName : "Your workspace"}
        description={
          user
            ? "Signed in to ProxyHubb"
            : "Browse public offers or sign in to access your account."
        }
      >
        <WorkspaceSwitcher onSwitch={() => setAccountOpen(false)} />
        <div className="workspace-menu-list mt-5">
          <Link href="/app/settings" onClick={() => setAccountOpen(false)}>
            <Settings size={17} />
            Settings
          </Link>
          <Link href="/app/wallet" onClick={() => setAccountOpen(false)}>
            <Wallet size={17} />
            Wallet & balances
          </Link>
          <Link
            href="/messages"
            onClick={() => setAccountOpen(false)}
          >
            <Inbox size={17} />
            Inbox & messages
          </Link>
          <Link href="/help" onClick={() => setAccountOpen(false)}>
            <CircleHelp size={17} />
            Help & support
          </Link>
          <a href={explorerHref()}>
            <ArrowUpRight size={17} />
            Open standalone Explorer
          </a>
          <details>
            <summary className="ui-link cursor-pointer p-3">Tools for this workspace</summary>
            <nav className="workspace-menu-list max-h-[35dvh] overflow-y-auto" aria-label="Workspace tools">
              {[...WORKSPACE_TOOLS[mode], ...SHARED_WORKSPACE_TOOLS].map(tool => (
                <Link key={tool.href} href={tool.href} onClick={() => setAccountOpen(false)}>{tool.label}</Link>
              ))}
            </nav>
          </details>
          {isAdmin && (
            <Link href="/dashboard/admin" onClick={() => setAccountOpen(false)}>
              <Shield size={17} />
              Administration
            </Link>
          )}
          {user ? (
            <button
              onClick={() => {
                setAccountOpen(false);
                void logout();
              }}
            >
              <LogOut size={17} />
              Sign out
            </button>
          ) : (
            <Link href="/login" onClick={() => setAccountOpen(false)}>
              Sign in with a wallet →
            </Link>
          )}
        </div>
      </Modal>
    </>
  );
}
