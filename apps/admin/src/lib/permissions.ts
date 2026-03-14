import type { AdminIdentity } from "./auth";

type AdminRole = AdminIdentity["role"];

const PERMISSIONS: Record<string, AdminRole[]> = {
  "users:manage":     ["superadmin", "support"],
  "nodes:manage":     ["superadmin", "sysops"],
  "treasury:view":    ["superadmin"],
  "treasury:manage":  ["superadmin"],
  "blockchain:view":  ["superadmin", "sysops"],
  "config:manage":    ["superadmin", "sysops"],
  "flags:manage":     ["superadmin"],
  "pricing:manage":   ["superadmin"],
  "disputes:manage":  ["superadmin", "support"],
  "governance:view":  ["superadmin", "sysops"],
  "audit:view":       ["superadmin", "sysops", "support"],
  "support:access":   ["superadmin", "support"],
  "proxies:manage":   ["superadmin", "sysops"],
};

export function can(identity: AdminIdentity | null, permission: string): boolean {
  if (!identity) return false;
  const allowed = PERMISSIONS[permission];
  if (!allowed) return true; // Unknown permission — allow by default for admins
  return allowed.includes(identity.role);
}

export function navItems(identity: AdminIdentity | null) {
  if (!identity) return [];
  return [
    { href: "/dashboard",            label: "Overview",    icon: "LayoutDashboard", always: true },
    { href: "/dashboard/users",      label: "Users",       icon: "Users",           perm: "users:manage" },
    { href: "/dashboard/sessions",   label: "Sessions",    icon: "Activity",        always: true },
    { href: "/dashboard/nodes",      label: "Nodes",       icon: "Server",          perm: "nodes:manage" },
    { href: "/dashboard/proxies",    label: "Proxy Pools", icon: "Globe",           perm: "proxies:manage" },
    { href: "/dashboard/treasury",   label: "Treasury",    icon: "Wallet",          perm: "treasury:view" },
    { href: "/dashboard/blockchain", label: "Blockchain",  icon: "Link",            perm: "blockchain:view" },
    { href: "/dashboard/disputes",   label: "Disputes",    icon: "Scale",           perm: "disputes:manage" },
    { href: "/dashboard/governance", label: "Governance",  icon: "Vote",            perm: "governance:view" },
    { href: "/dashboard/audit",      label: "Audit Logs",  icon: "FileText",        perm: "audit:view" },
    { href: "/dashboard/config",     label: "Config",      icon: "Settings",        perm: "config:manage" },
    { href: "/dashboard/pricing",    label: "Pricing",     icon: "TrendingUp",      perm: "pricing:manage" },
    { href: "/dashboard/support",    label: "Support",     icon: "HeartHandshake",  perm: "support:access" },
  ].filter((item) => item.always || can(identity, item.perm!));
}
