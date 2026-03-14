"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Activity, Server, Globe, Wallet, Link as LinkIcon,
  Scale, Vote, FileText, Settings, TrendingUp, HeartHandshake, Shield, LogOut,
} from "lucide-react";
import { navItems } from "@/lib/permissions";
import type { AdminIdentity } from "@/lib/auth";

const ICON_MAP: Record<string, React.ReactNode> = {
  LayoutDashboard: <LayoutDashboard className="w-4 h-4" />,
  Users:           <Users className="w-4 h-4" />,
  Activity:        <Activity className="w-4 h-4" />,
  Server:          <Server className="w-4 h-4" />,
  Globe:           <Globe className="w-4 h-4" />,
  Wallet:          <Wallet className="w-4 h-4" />,
  Link:            <LinkIcon className="w-4 h-4" />,
  Scale:           <Scale className="w-4 h-4" />,
  Vote:            <Vote className="w-4 h-4" />,
  FileText:        <FileText className="w-4 h-4" />,
  Settings:        <Settings className="w-4 h-4" />,
  TrendingUp:      <TrendingUp className="w-4 h-4" />,
  HeartHandshake:  <HeartHandshake className="w-4 h-4" />,
};

const ROLE_BADGE: Record<string, string> = {
  superadmin: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  sysops:     "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  support:    "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

interface SidebarProps {
  identity: AdminIdentity;
  onLogout: () => void;
}

export function Sidebar({ identity, onLogout }: SidebarProps) {
  const pathname = usePathname();
  const items = navItems(identity);

  return (
    <aside className="flex flex-col w-60 min-h-screen bg-[#111118] border-r border-[#1e1e2e] shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[#1e1e2e]">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
          <Shield className="w-4 h-4 text-indigo-400" />
        </div>
        <div>
          <p className="text-sm font-bold text-white leading-none">ProxyHub</p>
          <p className="text-[10px] text-[#4a4a6a] mt-0.5">Admin Console</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {items.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-indigo-500/15 text-indigo-300 font-medium"
                  : "text-[#94a3b8] hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className={isActive ? "text-indigo-400" : "text-[#4a4a6a]"}>
                {ICON_MAP[item.icon]}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-[#1e1e2e] space-y-3">
        {/* Identity */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-indigo-300">
            {identity.username[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{identity.username}</p>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${ROLE_BADGE[identity.role] ?? ROLE_BADGE.support}`}>
              {identity.role}
            </span>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#94a3b8] hover:bg-red-500/10 hover:text-red-400 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
