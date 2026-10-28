"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, CircleHelp, Globe2, Settings } from "lucide-react";
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
          ph
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
          Four focused destinations.
          <br />
          Public evidence lives in Explorer.
        </p>
      </nav>
    </aside>
  );
}
