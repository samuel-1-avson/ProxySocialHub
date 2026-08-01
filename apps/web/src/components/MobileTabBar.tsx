"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { Menu, X } from "lucide-react";
import { useRole } from "@/hooks/useRole";
import { isNavigationRouteActive, ROUTES } from "@/lib/navigation/routes";
import {
    getMobilePrimaryTabs,
    getNavigationBadge,
    MOBILE_MORE_SECTIONS,
    NavigationItem,
} from "@/lib/navigation/nav";
import { filterNavigationSections } from "@/lib/navigation/filter-nav";

export function MobileTabBar() {
    const pathname = usePathname();
    const { isConsumer, isProvider, isDualRole, isAdmin } = useRole();
    const [isMoreOpen, setIsMoreOpen] = useState(false);

    const moreSections = useMemo(
        () =>
            filterNavigationSections(MOBILE_MORE_SECTIONS, {
                isAdmin,
                isProvider,
                isDualRole,
            }),
        [isAdmin, isProvider, isDualRole],
    );

    const isActive = (path: string) => isNavigationRouteActive(pathname, path);
    const getBadge = (item: NavigationItem) => getNavigationBadge(item, { isProvider, isDualRole });
    const tabs = getMobilePrimaryTabs({ isProvider, isConsumer });

    return (
        <>
            {isMoreOpen && (
                <div className="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={() => setIsMoreOpen(false)}>
                    <div
                        className="absolute left-0 right-0 bottom-16 max-h-[72vh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-[#08080a] p-4 shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <span className="text-xs font-black uppercase tracking-widest text-white/50">Navigate</span>
                            <button
                                type="button"
                                onClick={() => setIsMoreOpen(false)}
                                className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10"
                                aria-label="Close navigation"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-5">
                            {moreSections.map(section => (
                                <div key={section.title}>
                                    <div className="px-1 mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
                                        {section.title}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {section.items.map(item => {
                                            const active =
                                                isActive(item.href) ||
                                                (item.activeRouteKeys?.some((key) => isActive(ROUTES[key])) ?? false);
                                            const badge = getBadge(item);

                                            return (
                                                <Link
                                                    key={item.id}
                                                    href={item.href}
                                                    prefetch={false}
                                                    onClick={() => setIsMoreOpen(false)}
                                                    className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-xs font-bold transition-all ${
                                                        active
                                                            ? "border-primary/40 bg-primary/15 text-primary"
                                                            : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.07]"
                                                    }`}
                                                >
                                                    <item.icon size={15} className="min-w-[15px]" />
                                                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                                    {badge && (
                                                        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-amber-300">
                                                            {badge}
                                                        </span>
                                                    )}
                                                </Link>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-black/90 backdrop-blur-lg border-t border-white/10 z-50 flex items-center justify-around px-2 pb-safe">
                {tabs.map((tab) => {
                    const active =
                        isActive(tab.href) ||
                        (tab.activeRouteKeys?.some((key) => isActive(ROUTES[key])) ?? false);

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
                <button
                    type="button"
                    onClick={() => setIsMoreOpen(open => !open)}
                    className={`flex flex-col items-center justify-center w-16 h-full gap-1 transition-all ${
                        isMoreOpen ? "text-primary" : "text-muted-foreground hover:text-white"
                    }`}
                >
                    <Menu size={20} className={isMoreOpen ? "stroke-[2.5px]" : "stroke-[1.5px]"} />
                    <span className="text-[10px] font-sans font-medium">More</span>
                </button>
            </div>
        </>
    );
}
