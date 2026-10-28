import {
  Activity,
  Cable,
  Coins,
  LayoutDashboard,
  ListChecks,
  Server,
  Store,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceMode } from "@/lib/store/workspace-store";
export interface WorkspaceDestination {
  label: string;
  href: string;
  icon: LucideIcon;
  legacyPaths: string[];
}
export const SHARED_WORKSPACE_TOOLS = [
  { label: 'API keys', href: '/dashboard/settings/api-keys' },
  { label: 'Account data & export', href: '/dashboard/settings/account' },
  { label: 'Help forum', href: '/help/forum' },
  { label: 'Referrals & invitations', href: '/app/settings?tab=referrals' },
  { label: 'Governance participation', href: '/governance/create' },
];
export const WORKSPACE_TOOLS: Record<WorkspaceMode, Array<{ label: string; href: string }>> = {
  buyer: [
    { label: 'Marketplace map', href: '/marketplace/map' },
    { label: 'Saved offers', href: '/marketplace?filter=saved' },
    { label: 'Usage analytics', href: '/dashboard/analytics' },
    { label: 'Billing & Access Passes', href: '/app/activity?tab=billing' },
    { label: 'Client & SDK integration', href: '/dashboard/proxy' },
    { label: 'Usage proof records', href: '/dashboard/trustless' },
  ],
  seller: [
    { label: 'Pair a computer', href: '/dashboard/provider/pair' },
    { label: 'Node credentials', href: '/provider/nodes/credentials' },
    { label: 'Software downloads', href: '/dashboard/provider/cli' },
    { label: 'Node health', href: '/dashboard/provider/health' },
    { label: 'Performance analytics', href: '/dashboard/provider/analytics' },
    { label: 'Service configuration', href: '/dashboard/provider/services' },
    { label: 'Catalog products', href: '/marketplace/manage/products' },
    { label: 'Customers', href: '/dashboard/provider/relationships' },
    { label: 'Enterprise pooling', href: '/dashboard/provider/circle' },
  ],
};
export const WORKSPACE_DESTINATIONS: Record<
  WorkspaceMode,
  WorkspaceDestination[]
> = {
  buyer: [
    {
      label: "Overview",
      href: "/app",
      icon: LayoutDashboard,
      legacyPaths: ["/dashboard"],
    },
    {
      label: "Marketplace",
      href: "/marketplace",
      icon: Store,
      legacyPaths: ["/marketplace/saved", "/marketplace/map"],
    },
    {
      label: "Connections",
      href: "/app/connections",
      icon: Cable,
      legacyPaths: ["/dashboard/proxy", "/dashboard/sessions"],
    },
    {
      label: "Activity",
      href: "/app/activity",
      icon: Activity,
      legacyPaths: [
        "/marketplace/orders",
        "/dashboard/orders",
        "/dashboard/usage",
        "/dashboard/analytics",
        "/dashboard/subscriptions",
        "/dashboard/trustless",
      ],
    },
  ],
  seller: [
    {
      label: "Overview",
      href: "/provider",
      icon: LayoutDashboard,
      legacyPaths: ["/dashboard/provider"],
    },
    {
      label: "Nodes",
      href: "/provider/nodes",
      icon: Server,
      legacyPaths: [
        "/dashboard/provider/nodes",
        "/dashboard/provider/setup",
        "/dashboard/provider/cli",
        "/dashboard/provider/health",
        "/dashboard/provider/services",
        "/dashboard/provider/tokens",
      ],
    },
    {
      label: "Listings",
      href: "/provider/listings",
      icon: ListChecks,
      legacyPaths: ["/marketplace/manage", "/marketplace/create"],
    },
    {
      label: "Earnings",
      href: "/provider/earnings",
      icon: Coins,
      legacyPaths: [
        "/dashboard/provider/earnings",
        "/dashboard/provider/analytics",
        "/dashboard/provider/relationships",
        "/dashboard/provider/circle",
      ],
    },
  ],
};
export function workspaceForPath(pathname: string): WorkspaceMode | undefined {
  if (/^\/app\/(wallet|settings)(?:\/|$)/.test(pathname)) return undefined;
  if (
    /^\/provider(?:\/|$)/.test(pathname) ||
    pathname.startsWith("/dashboard/provider") ||
    /^\/marketplace\/(manage|create)(?:\/|$)/.test(pathname)
  )
    return "seller";
  if (
    /^\/app(?:\/|$)/.test(pathname) ||
    (pathname.startsWith("/marketplace") &&
      !/^\/marketplace\/orders/.test(pathname))
  )
    return "buyer";
  return undefined;
}
export function isWorkspaceDestinationActive(
  path: string,
  item: WorkspaceDestination,
): boolean {
  return [item.href, ...item.legacyPaths].some((candidate) => {
    if (
      ["/app", "/provider", "/dashboard", "/dashboard/provider"].includes(
        candidate,
      )
    )
      return path === candidate;
    if (candidate === "/marketplace")
      return (
        path === candidate ||
        /^\/marketplace\/(saved|map)(?:\/|$)/.test(path) ||
        (/^\/marketplace\/[^/]+$/.test(path) &&
          !["orders", "create", "manage"].includes(path.split("/")[2]))
      );
    return path === candidate || path.startsWith(candidate + "/");
  });
}
/** Preserve current public URLs until the separate deployment is configured. */
export function explorerHref(path = "/"): string {
  const configured = process.env.NEXT_PUBLIC_EXPLORER_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        url.protocol === "https:" ||
        (url.protocol === "http:" && process.env.NODE_ENV !== "production")
      )
        return `${configured.replace(/\/$/, "")}${path === "/" ? "" : path}`;
    } catch {
      /* Legacy fallback. */
    }
  }
  return `/explorer${path === "/" ? "" : path}`;
}
