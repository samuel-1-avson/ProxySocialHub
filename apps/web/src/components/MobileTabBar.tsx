"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  WORKSPACE_DESTINATIONS,
  isWorkspaceDestinationActive,
} from "@/lib/navigation/workspace";
export function MobileTabBar() {
  const pathname = usePathname();
  const { mode } = useWorkspace();
  return (
    <nav className="workspace-mobile-nav" aria-label="Mobile primary">
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
          <item.icon size={20} strokeWidth={1.6} aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
