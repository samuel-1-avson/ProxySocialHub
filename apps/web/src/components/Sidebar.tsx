"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ArrowUpRight, CircleHelp, Globe2, MessageSquareText, Settings, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import {
  WORKSPACE_DESTINATIONS,
  explorerHref,
  isWorkspaceDestinationActive,
} from "@/lib/navigation/workspace";
export function Sidebar() {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();
  const { mode } = useWorkspace();
  return (
    <aside className="workspace-sidebar" aria-label="Workspace navigation">
      <Link
        className="workspace-brand"
        href={
          isAuthenticated ? (mode === "seller" ? "/provider" : "/app") : "/"
        }
      >
        <span className="workspace-mark" aria-hidden="true">
          PH
        </span>
        ProxyHubb
      </Link>
      <WorkspaceSwitcher />
      <p className="workspace-nav-label">Workspace</p>
      <nav className="workspace-primary" aria-label="Primary">
        {WORKSPACE_DESTINATIONS[mode].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className={
              isWorkspaceDestinationActive(pathname, item) ? "active" : ""
            }
            aria-current={
              isWorkspaceDestinationActive(pathname, item) ? "page" : undefined
            }
          >
            <item.icon size={18} strokeWidth={1.6} aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
      <p className="workspace-nav-label">Community & network</p>
      <nav className="workspace-primary workspace-discovery" aria-label="Community and network">
        <Link href="/community/forum" className={pathname.startsWith("/community/forum") ? "active" : ""} aria-current={pathname.startsWith("/community/forum") ? "page" : undefined}>
          <MessageSquareText size={18} strokeWidth={1.6} aria-hidden="true" />
          Forum
        </Link>
        <Link href="/community/feed" className={pathname === "/community/feed" ? "active" : ""} aria-current={pathname === "/community/feed" ? "page" : undefined}>
          <Activity size={18} strokeWidth={1.6} aria-hidden="true" />
          Activity feed
        </Link>
        <Link href="/governance" className={pathname.startsWith("/governance") ? "active" : ""} aria-current={pathname.startsWith("/governance") ? "page" : undefined}>
          <ShieldCheck size={18} strokeWidth={1.6} aria-hidden="true" />
          Governance
        </Link>
      </nav>
      <nav className="workspace-secondary" aria-label="Workspace utilities">
        <a href={explorerHref()}>
          <Globe2 size={18} aria-hidden="true" />
          Explorer
          <ArrowUpRight className="ml-auto" size={13} aria-hidden="true" />
        </a>
        <Link href="/help">
          <CircleHelp size={18} aria-hidden="true" />
          Help & support
        </Link>
        <Link href="/app/settings">
          <Settings size={18} aria-hidden="true" />
          Settings
        </Link>
        <p className="workspace-rail-note">
          Workspace navigation stays focused.
          <br />
          Public records live in Explorer.
        </p>
      </nav>
    </aside>
  );
}
