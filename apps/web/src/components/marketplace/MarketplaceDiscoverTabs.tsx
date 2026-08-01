"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutList, MapPin } from "lucide-react";
import { ROUTES } from "@/lib/navigation/routes";

const TABS = [
    { href: ROUTES.marketplace, label: "List", icon: LayoutList, match: (path: string) => path === ROUTES.marketplace },
    {
        href: ROUTES.marketplaceMap,
        label: "Map",
        icon: MapPin,
        match: (path: string) => path === ROUTES.marketplaceMap || path.startsWith(`${ROUTES.marketplaceMap}/`),
    },
] as const;

export function MarketplaceDiscoverTabs() {
    const pathname = usePathname()?.split(/[?#]/)[0].replace(/\/$/, "") || "/";

    return (
        <nav
            aria-label="Discover views"
            className="inline-flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-white/[0.03]"
        >
            {TABS.map((tab) => {
                const active = tab.match(pathname);
                const Icon = tab.icon;
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${
                            active
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                        }`}
                    >
                        <Icon size={14} />
                        {tab.label}
                    </Link>
                );
            })}
        </nav>
    );
}
