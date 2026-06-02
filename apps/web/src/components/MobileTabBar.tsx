"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Globe, Server, User, Search, type LucideIcon } from "lucide-react";
import { useRole } from "@/hooks/useRole";
import { ROUTES } from "@/lib/navigation/routes";

export function MobileTabBar() {
    const pathname = usePathname();
    const { isConsumer, isProvider } = useRole();

    const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

    // We build 5 core tabs based on role
    // Home, Explore/Connect, Earn (if provider) or Marketplace (if consumer), Community, Account

    const tabs: Array<{ href: string; label: string; icon: LucideIcon }> = [
        { href: ROUTES.dashboard, label: "Home", icon: LayoutDashboard },
    ];

    if (isProvider && !isConsumer) {
        tabs.push({ href: ROUTES.dashboardProviderNodes, label: "Nodes", icon: Server });
        tabs.push({ href: ROUTES.dashboardProviderEarnings, label: "Earn", icon: Server });
    } else {
        tabs.push({ href: ROUTES.dashboardProxy, label: "Connect", icon: Globe });
        tabs.push({ href: ROUTES.marketplace, label: "Explore", icon: Search });
    }

    tabs.push({ href: ROUTES.profile, label: "Account", icon: User });

    return (
        <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-black/90 backdrop-blur-lg border-t border-white/10 z-50 flex items-center justify-around px-2 pb-safe">
            {tabs.map((tab) => {
                const active = isActive(tab.href);
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        prefetch={false}
                        className={`flex flex-col items-center justify-center w-16 h-full gap-1 transition-all ${
                            active ? "text-primary" : "text-muted-foreground hover:text-white"
                        }`}
                    >
                        <tab.icon size={20} className={active ? "stroke-[2.5px]" : "stroke-[1.5px]"} />
                        <span className="text-[10px] font-sans font-medium">{tab.label}</span>
                    </Link>
                );
            })}
        </div>
    );
}
