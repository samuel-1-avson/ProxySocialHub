"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
    LogOut,
    ChevronDown,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useUIStore } from "@/lib/store/ui-store";
import { useRole } from "@/hooks/useRole";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { motion } from "framer-motion";
import { isNavigationRouteActive, ROUTES } from "@/lib/navigation/routes";
import {
    getNavigationBadge,
    NavigationItem,
    NavigationSection,
    NAV_SECTIONS,
    SIDEBAR_BOTTOM_ITEMS,
} from "@/lib/navigation/nav";
import { filterNavigationSections } from "@/lib/navigation/filter-nav";

export function Sidebar() {
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const { isSidebarCollapsed } = useUIStore();
    const { isProvider, isDualRole, isAdmin } = useRole();
    const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

    const navSections = filterNavigationSections(NAV_SECTIONS, {
        isAdmin,
        isProvider,
        isDualRole,
    });

    const isActive = (path: string) => isNavigationRouteActive(pathname, path);
    const getBadge = (item: NavigationItem) => getNavigationBadge(item, { isProvider, isDualRole });

    const toggleSection = (sectionId: string) => {
        setCollapsedSections(current => ({ ...current, [sectionId]: !current[sectionId] }));
    };

    return (
        <aside
            className={`fixed left-0 top-0 h-screen glass-card !rounded-none border-0 border-r border-white/5 hidden md:flex flex-col z-40 transition-all duration-300 ease-in-out ${isSidebarCollapsed ? "w-20" : "w-64"
                }`}
        >
            {/* Header */}
            <div className={`p-6 border-b border-white/5 flex items-center ${isSidebarCollapsed ? "justify-center" : "gap-3"}`}>
                <Link href={ROUTES.home} className="flex items-center gap-3 group relative">
                    <motion.div
                        whileHover={{ scale: 1.1, rotate: 5 }}
                        className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary text-primary-foreground shadow-[0_0_20px_rgba(16,185,129,0.3)] group-hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] transition-all"
                    >
                        <span className="font-black font-sans text-base">PH</span>
                    </motion.div>
                    {!isSidebarCollapsed && (
                        <motion.span
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="text-xl font-black font-sans uppercase tracking-tighter"
                        >
                            Proxy<span className="text-primary">Hubb</span>
                        </motion.span>
                    )}
                </Link>
            </div>

            {/* User Status */}
            <div className={`border-b border-white/5 bg-white/2 transition-all duration-300 ${isSidebarCollapsed ? "p-3" : "p-4"}`}>
                <div className={`flex items-center gap-3 rounded-2xl transition-all ${isSidebarCollapsed ? "justify-center" : "p-2 bg-white/5 border border-white/5"}`}>
                    <div className="w-10 h-10 min-w-[40px] rounded-xl bg-primary/20 flex items-center justify-center border border-primary/20 relative group">
                        <span className="font-sans text-xs font-black text-primary">
                            {user?.email?.slice(0, 2).toUpperCase() || "OP"}
                        </span>
                        <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#18181b] animate-pulse"></span>
                    </div>

                    {!isSidebarCollapsed && (
                        <div className="overflow-hidden">
                            <p className="text-[12px] font-bold font-sans truncate text-foreground/80 tracking-tight">{user?.email || "OPERATOR"}</p>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-emerald-500 font-bold font-sans uppercase tracking-widest">Authorized</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Dual Role / Workspace Switcher */}
            <WorkspaceSwitcher isCollapsed={isSidebarCollapsed} />

            {/* Main Menu */}
            <div className="flex-1 overflow-y-auto py-6 px-4 space-y-6 scrollbar-hide">
                
                {navSections.map(sec => (
                    <SidebarSection
                        key={sec.id}
                        section={sec}
                        isCollapsed={isSidebarCollapsed}
                        isActive={isActive}
                        isSectionCollapsed={!!collapsedSections[sec.id]}
                        onToggleSection={toggleSection}
                        getBadge={getBadge}
                    />
                ))}

            </div>

            {/* Bottom Actions */}
            <div className="p-4 border-t border-white/5 space-y-1">
                {SIDEBAR_BOTTOM_ITEMS.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        prefetch={false}
                        className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                            isActive(item.href)
                                ? "bg-white/10 text-foreground font-bold"
                                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                        }`}
                    >
                        <item.icon size={18} />
                        {!isSidebarCollapsed && (
                            <span className="font-sans text-[13px] font-medium tracking-wide">{item.label}</span>
                        )}
                    </Link>
                ))}

                <button
                    onClick={logout}
                    aria-label="Log out"
                    title="Log out"
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-red-400 hover:bg-red-500/10 transition-all font-sans text-[13px] font-medium tracking-wide"
                >
                    <LogOut size={18} />
                    {!isSidebarCollapsed && <span>Logout</span>}
                </button>
            </div>
        </aside>
    );
}

// Sub-component for rendering a section to keep JSX clean
function SidebarSection({
    section,
    isCollapsed,
    isActive,
    isSectionCollapsed,
    onToggleSection,
    getBadge,
}: {
    section: NavigationSection,
    isCollapsed: boolean,
    isActive: (p: string) => boolean,
    isSectionCollapsed: boolean,
    onToggleSection: (sectionId: string) => void,
    getBadge: (item: NavigationItem) => string | undefined,
}) {
    if (!section.items || section.items.length === 0) return null;
    const hasActiveItem = section.items.some(
        (item) =>
            isActive(item.href) ||
            (item.activeRouteKeys?.some((key) => isActive(ROUTES[key])) ?? false),
    );
    const shouldShowItems = isCollapsed || hasActiveItem || !isSectionCollapsed;

    return (
        <div className="space-y-1 mb-6">
            {!isCollapsed && section.title && (
                <button
                    type="button"
                    onClick={() => onToggleSection(section.id)}
                    className={`w-full px-3 mb-2 flex items-center justify-between rounded-lg py-1 transition-colors ${
                        hasActiveItem ? "text-primary bg-primary/5" : "text-muted-foreground/60 hover:text-foreground hover:bg-white/5"
                    }`}
                >
                    <p className="text-[10px] font-bold font-sans uppercase tracking-[0.2em]">
                        {section.title}
                    </p>
                    <ChevronDown
                        size={12}
                        className={`transition-transform ${isSectionCollapsed && !hasActiveItem ? "-rotate-90" : "rotate-0"}`}
                    />
                </button>
            )}
            
            {shouldShowItems && section.items.map((item) => {
                const badge = getBadge(item);
                const active =
                    isActive(item.href) ||
                    (item.activeRouteKeys?.some((key) => isActive(ROUTES[key])) ?? false);

                return (
                    <Link
                        key={item.id}
                        href={item.href}
                        title={item.label}
                        className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all group relative overflow-hidden ${
                            active
                                ? "bg-primary text-primary-foreground font-bold shadow-[0_0_15px_rgba(16,185,129,0.2)] border border-primary/30"
                                : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"
                        }`}
                    >
                        <div className="relative">
                            <item.icon size={18} className={`transition-all ${active ? "stroke-[2px]" : "stroke-[1.5px] opacity-70 group-hover:opacity-100"}`} />
                            {badge && !isCollapsed && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full" />
                            )}
                        </div>
                        
                        {!isCollapsed && (
                            <div className="flex-1 min-w-0">
                                <span className="font-sans text-[14px] font-medium tracking-wide block">{item.label}</span>
                                {badge && (
                                    <span className="mt-1 inline-flex text-[8px] font-black uppercase tracking-widest text-amber-400/80">
                                        {badge}
                                    </span>
                                )}
                            </div>
                        )}
                    </Link>
                );
            })}
        </div>
    );
}
