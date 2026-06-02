"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
    LayoutDashboard,
    Wallet,
    Globe,
    Bot,
    Settings,
    LogOut,
    User,
    Activity,
    MessageSquare,
    Grid,
    Vote,
    Trophy,
    ShieldCheck,
    Network,
    Search,
    ChevronRight,
    Blocks,
    ArrowRightLeft,
    Fingerprint,
    FileCode,
    Server,
    Radio,
    Wifi,
    Cpu,
    Coins,
    BarChart3,
    CircleDot,
    Users,
    Terminal,
    LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useUIStore } from "@/lib/store/ui-store";
import { useRole } from "@/hooks/useRole";
import { ForProvider, ForConsumer, ForNewUser } from "@/components/RoleGuard";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { AlertCenter } from "@/components/AlertCenter";
import { motion, AnimatePresence } from "framer-motion";
import { ROUTES } from "@/lib/navigation/routes";

interface MenuItem {
    href: string;
    label: string;
    icon: LucideIcon;
    description?: string;
    badge?: string;
}

interface MenuSection {
    id: string;
    title?: string;
    description?: string;
    items: MenuItem[];
}

export function Sidebar() {
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const { isSidebarCollapsed, toggleSidebar } = useUIStore();
    const { isConsumer, isProvider, isDualRole } = useRole();

    const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

    // NEW ROLE-BASED NAVIGATION ARRAYS

    const sharedHome: MenuSection = {
        id: "main",
        items: [
            { href: ROUTES.dashboard, label: "Dashboard", icon: LayoutDashboard },
            { href: ROUTES.dashboardProvider, label: "Provider", icon: Server, description: "Manage nodes & earnings" },
        ]
    };

    const consumerSections: MenuSection[] = [
        {
            id: "consumer-proxy",
            title: "My Proxy",
            items: [
                { href: ROUTES.dashboardProxy, label: "Connect", icon: Globe, description: "Create proxy sessions" },
                { href: ROUTES.dashboardSessions, label: "My Sessions", icon: Wifi, description: "Active & history" },
                { href: ROUTES.dashboardUsage, label: "Usage & Billing", icon: BarChart3, description: "Track bandwidth" },
                { href: ROUTES.dashboardTrustless, label: "Integrity", icon: ShieldCheck, description: "Usage proofs" },
            ]
        },
        {
            id: "consumer-discover",
            title: "Discover",
            items: [
                { href: ROUTES.marketplace, label: "Marketplace", icon: Search },
                { href: ROUTES.marketplaceAgents, label: "AI Agents", icon: Bot },
            ]
        }
    ];

    const providerSections: MenuSection[] = [
        {
            id: "provider-nodes",
            title: "My Nodes",
            items: [
                { href: ROUTES.dashboardProviderNodes, label: "Node Health", icon: Radio, description: "Manage infrastructure" },
                { href: ROUTES.dashboardProviderCircle, label: "Circle Pool", icon: CircleDot, description: "Enterprise pooling" },
                { href: ROUTES.dashboardProviderRelationships, label: "Customers", icon: Users },
            ]
        },
        {
            id: "provider-earnings",
            title: "Earnings",
            items: [
                { href: ROUTES.dashboardProviderEarnings, label: "Income", icon: Coins, description: "Income & payouts" },
                { href: ROUTES.marketplaceManage, label: "Listings", icon: FileCode, description: "Manage listings" },
            ]
        },
        {
            id: "provider-tools",
            title: "Tools",
            items: [
                { href: ROUTES.dashboardProviderTokens, label: "API Tokens", icon: Fingerprint, description: "CLI authentication" },
                { href: ROUTES.dashboardProviderCli, label: "CLI & Download", icon: Terminal, description: "Download & setup" },
            ]
        }
    ];

    const networkSections: MenuSection[] = [
        {
            id: "network",
            title: "Network",
            items: [
                { href: ROUTES.explorer, label: "Explorer", icon: Blocks },
                { href: ROUTES.communityFeed, label: "Community", icon: Activity },
            ]
        }
    ];

    const bottomItems = [
        { href: ROUTES.dashboardWallet, label: "Wallet", icon: Wallet },
        { href: ROUTES.settings, label: "Settings", icon: Settings },
        { href: ROUTES.profile, label: "Profile", icon: User },
    ];

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
                
                {/* Home */}
                <SidebarSection section={sharedHome} isCollapsed={isSidebarCollapsed} isActive={isActive} />

                {/* Role-Based Sections */}
                <ForConsumer>
                    {consumerSections.map(sec => <SidebarSection key={sec.id} section={sec} isCollapsed={isSidebarCollapsed} isActive={isActive} />)}
                </ForConsumer>

                <ForProvider>
                    {providerSections.map(sec => <SidebarSection key={sec.id} section={sec} isCollapsed={isSidebarCollapsed} isActive={isActive} />)}
                </ForProvider>

                {/* Network (Shared) */}
                {networkSections.map(sec => <SidebarSection key={sec.id} section={sec} isCollapsed={isSidebarCollapsed} isActive={isActive} />)}

            </div>

            {/* Bottom Actions */}
            <div className="p-4 border-t border-white/5 space-y-1">
                {bottomItems.map((item) => (
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
function SidebarSection({ section, isCollapsed, isActive }: { section: MenuSection, isCollapsed: boolean, isActive: (p: string) => boolean }) {
    if (!section.items || section.items.length === 0) return null;

    return (
        <div className="space-y-1 mb-6">
            {!isCollapsed && section.title && (
                <div className="px-3 mb-2">
                    <p className="text-[10px] font-bold font-sans uppercase tracking-[0.2em] text-muted-foreground/60">
                        {section.title}
                    </p>
                </div>
            )}
            
            {section.items.map((item) => (
                <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all group relative overflow-hidden ${
                        isActive(item.href)
                            ? "bg-primary text-primary-foreground font-bold shadow-[0_0_15px_rgba(16,185,129,0.2)] border border-primary/30"
                            : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"
                    }`}
                >
                    <div className="relative">
                        <item.icon size={18} className={`transition-all ${isActive(item.href) ? "stroke-[2px]" : "stroke-[1.5px] opacity-70 group-hover:opacity-100"}`} />
                        {item.badge && !isCollapsed && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        )}
                    </div>
                    
                    {!isCollapsed && (
                        <div className="flex-1 min-w-0">
                            <span className="font-sans text-[14px] font-medium tracking-wide block">
                                {item.label}
                            </span>
                        </div>
                    )}
                </Link>
            ))}
        </div>
    );
}
