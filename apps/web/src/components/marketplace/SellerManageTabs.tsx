"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListChecks, Package } from "lucide-react";
import { ROUTES } from "@/lib/navigation/routes";

const TABS = [
    {
        href: ROUTES.marketplaceManage,
        label: "Listings",
        icon: ListChecks,
        match: (path: string) => path === ROUTES.marketplaceManage,
    },
    {
        href: ROUTES.marketplaceCatalog,
        label: "Products",
        icon: Package,
        match: (path: string) =>
            path === ROUTES.marketplaceCatalog || path.startsWith(`${ROUTES.marketplaceCatalog}/`),
    },
] as const;

export function SellerManageTabs() {
    const pathname = usePathname()?.split(/[?#]/)[0].replace(/\/$/, "") || "/";

    return (
        <nav
            aria-label="Seller manage"
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
                                ? "bg-primary/20 text-primary border border-primary/30"
                                : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"
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
