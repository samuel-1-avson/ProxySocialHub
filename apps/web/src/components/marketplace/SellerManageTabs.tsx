"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListChecks, Package } from "lucide-react";
import { ROUTES } from "@/lib/navigation/routes";

const TABS = [
    {
        href: "/provider/listings",
        label: "Listings",
        icon: ListChecks,
        match: (path: string) => path === ROUTES.marketplaceManage || path === "/provider/listings",
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
            className="ui-tabs"
        >
            {TABS.map((tab) => {
                const active = tab.match(pathname);
                const Icon = tab.icon;
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        className={active ? "active" : ""}
                        aria-current={active ? "page" : undefined}
                    >
                        <Icon size={14} />
                        {tab.label}
                    </Link>
                );
            })}
        </nav>
    );
}
