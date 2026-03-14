"use client";

import { usePathname } from "next/navigation";
import { RefreshCw } from "lucide-react";

const LABELS: Record<string, string> = {
  "/dashboard":            "Overview",
  "/dashboard/users":      "User Management",
  "/dashboard/sessions":   "Live Sessions",
  "/dashboard/nodes":      "Node Management",
  "/dashboard/proxies":    "Proxy Pools",
  "/dashboard/treasury":   "Treasury",
  "/dashboard/blockchain": "Blockchain Explorer",
  "/dashboard/disputes":   "Disputes",
  "/dashboard/governance": "Governance",
  "/dashboard/audit":      "Audit Logs",
  "/dashboard/config":     "System Config",
  "/dashboard/pricing":    "Pricing Control",
  "/dashboard/support":    "Customer Support",
};

interface TopBarProps {
  onRefresh?: () => void;
}

export function TopBar({ onRefresh }: TopBarProps) {
  const pathname = usePathname();
  const label = LABELS[pathname] ?? "Admin";

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-[#1e1e2e] bg-[#111118] shrink-0">
      <div>
        <h1 className="text-sm font-semibold text-white">{label}</h1>
        <p className="text-[10px] text-[#4a4a6a]">ProxyHub Administration Console</p>
      </div>
      <div className="flex items-center gap-3">
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-lg text-[#4a4a6a] hover:text-white hover:bg-white/5 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
        <div className="flex items-center gap-1.5 text-xs text-[#4a4a6a]">
          <span className="status-dot ok" />
          System Online
        </div>
      </div>
    </header>
  );
}
