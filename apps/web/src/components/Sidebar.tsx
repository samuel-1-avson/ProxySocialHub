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
    LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useUIStore } from "@/lib/store/ui-store";
import { AlertCenter } from "@/components/AlertCenter";
import { motion, AnimatePresence } from "framer-motion";

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
    const [explorerExpanded, setExplorerExpanded] = useState(false);

    const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");
    const isExplorerActive = pathname?.startsWith("/explorer");

    // NEW: Organized menu with clear Consumer/Provider sections
    const menuSections: MenuSection[] = [
        {
            id: "main",
            items: [
                { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
            ]
        },
        {
            id: "consumer",
            title: "Use Proxies",
            description: "Browse the web securely",
            items: [
                { 
                    href: "/dashboard/proxy", 
                    label: "Connect", 
                    icon: Globe,
                    description: "Create proxy sessions"
                },
                { 
                    href: "/dashboard/sessions", 
                    label: "My Sessions", 
                    icon: Wifi,
                    description: "Active connections"
                },
                { 
                    href: "/dashboard/usage", 
                    label: "Usage & Billing", 
                    icon: BarChart3,
                    description: "Track bandwidth"
                },
            ]
        },
        {
            id: "provider",
            title: "Earn Money",
            description: "Share your bandwidth",
            items: [
                {
                    href: "/dashboard/provider",
                    label: "Overview",
                    icon: Server,
                    description: "Provider dashboard"
                },
                {
                    href: "/dashboard/provider/setup",
                    label: "Setup Wizard",
                    icon: Cpu,
                    description: "Get started",
                    badge: "Start"
                },
                {
                    href: "/dashboard/provider/nodes",
                    label: "My Nodes",
                    icon: Radio,
                    description: "Manage infrastructure"
                },
                {
                    href: "/dashboard/provider/health",
                    label: "Node Health",
                    icon: ShieldCheck,
                    description: "Diagnostics"
                },
                {
                    href: "/dashboard/provider/tokens",
                    label: "API Tokens",
                    icon: Fingerprint,
                    description: "CLI authentication"
                },
                {
                    href: "/dashboard/provider/cli",
                    label: "CLI & Tools",
                    icon: FileCode,
                    description: "Download & setup"
                },
                {
                    href: "/dashboard/earnings",
                    label: "Earnings",
                    icon: Coins,
                    description: "Income & payouts"
                },
            ]
        },
        {
            id: "marketplace",
            items: [
                { href: "/marketplace", label: "Marketplace", icon: Search },
                { href: "/agents", label: "AI Marketplace", icon: Bot },
            ]
        },
        {
            id: "explorer",
            title: "Explorer",
            description: "Network analytics",
            items: [
                { href: "/explorer", label: "Overview", icon: Blocks, description: "Network stats" },
                { href: "/explorer/nodes", label: "Nodes", icon: Server, description: "Active nodes" },
                { href: "/explorer/transactions", label: "Transactions", icon: ArrowRightLeft, description: "Tx history" },
                { href: "/explorer/leaderboard", label: "Leaderboard", icon: Trophy, description: "Top providers" },
                { href: "/explorer/sessions", label: "Sessions", icon: Radio, description: "Proxy sessions" },
                { href: "/explorer/earnings", label: "Earnings", icon: Coins, description: "Provider payouts" },
                { href: "/explorer/analytics", label: "Analytics", icon: BarChart3, description: "Network trends" },
                { href: "/explorer/health", label: "Health", icon: ShieldCheck, description: "System status" },
                { href: "/explorer/map", label: "Node Map", icon: Network, description: "Geographic view" },
                { href: "/explorer/search", label: "Search", icon: Search, description: "Find anything" },
                { href: "/explorer/wallets", label: "Wallets", icon: Wallet, description: "Address lookup" },
                { href: "/explorer/contracts", label: "Contracts", icon: FileCode, description: "Smart contracts" },
            ]
        },
        {
            id: "community",
            title: "Community",
            items: [
                { href: "/feed", label: "Network Feed", icon: Activity },
                { href: "/messages", label: "Comms Center", icon: MessageSquare },
                { href: "/forum", label: "Community Forum", icon: Grid },
                { href: "/governance", label: "Governance", icon: Vote },
            ]
        },
    ];

    const bottomItems = [
        { href: "/settings", label: "Settings", icon: Settings },
        { href: "/profile", label: "Profile", icon: User },
    ];

    return (
        <aside
            className={`fixed left-0 top-0 h-screen glass-card !rounded-none border-0 border-r border-white/5 hidden md:flex flex-col z-40 transition-all duration-300 ease-in-out ${isSidebarCollapsed ? "w-20" : "w-64"
                }`}
        >
            {/* Header */}
            <div className={`p-6 border-b border-white/5 flex items-center ${isSidebarCollapsed ? "justify-center" : "gap-3"}`}>
                <Link href="/" className="flex items-center gap-3 group relative">
                    <motion.div
                        whileHover={{ scale: 1.1, rotate: 5 }}
                        className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary text-primary-foreground shadow-[0_0_20px_rgba(16,185,129,0.3)] group-hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] transition-all"
                    >
                        <span className="font-black font-mono text-base">PS</span>
                    </motion.div>
                    {!isSidebarCollapsed && (
                        <motion.span
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="text-xl font-black font-mono uppercase tracking-tighter"
                        >
                            Proxy<span className="text-primary">Hub</span>
                        </motion.span>
                    )}
                </Link>
            </div>

            {/* User Status */}
            <div className={`border-b border-white/5 bg-white/2 transition-all duration-300 ${isSidebarCollapsed ? "p-3" : "p-4"}`}>
                <div className={`flex items-center gap-3 rounded-2xl transition-all ${isSidebarCollapsed ? "justify-center" : "p-2 bg-white/5 border border-white/5"}`}>
                    <div className="w-10 h-10 min-w-[40px] rounded-xl bg-primary/20 flex items-center justify-center border border-primary/20 relative group">
                        <span className="font-mono text-xs font-black text-primary">
                            {user?.email?.slice(0, 2).toUpperCase() || "OP"}
                        </span>
                        <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#18181b] animate-pulse"></span>
                    </div>

                    {!isSidebarCollapsed && (
                        <div className="overflow-hidden">
                            <p className="text-[10px] font-black font-mono truncate text-foreground/80 tracking-tight">{user?.email || "OPERATOR"}</p>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[9px] text-emerald-500 font-black font-mono uppercase tracking-widest">Authorized</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Main Menu */}
            <div className="flex-1 overflow-y-auto py-6 px-4 space-y-6 scrollbar-hide">
                {menuSections.map((section) => (
                    <div key={section.id} className="space-y-1">
                        {/* Section Header */}
                        {!isSidebarCollapsed && section.title && (
                            <div className="px-3 mb-2">
                                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-muted-foreground/60">
                                    {section.title}
                                </p>
                                {section.description && (
                                    <p className="text-[8px] text-muted-foreground/40 mt-0.5">
                                        {section.description}
                                    </p>
                                )}
                            </div>
                        )}
                        
                        {/* Section Items */}
                        {section.items.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                title={item.label}
                                aria-label={item.label}
                                aria-current={isActive(item.href) ? 'page' : undefined}
                                className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all group relative overflow-hidden ${
                                    isActive(item.href)
                                        ? "bg-primary text-primary-foreground font-black shadow-[0_0_20px_rgba(16,185,129,0.4)] border border-white/20"
                                        : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent hover:border-white/10"
                                }`}
                            >
                                <div className="relative">
                                    <item.icon size={18} className={`transition-all ${isActive(item.href) ? "stroke-[2.5px] scale-110" : "stroke-[1.5px] opacity-70 group-hover:opacity-100"}`} />
                                    {/* Badge */}
                                    {item.badge && !isSidebarCollapsed && (
                                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                                    )}
                                </div>
                                
                                {!isSidebarCollapsed && (
                                    <div className="flex-1 min-w-0">
                                        <span className="font-mono text-[11px] font-bold tracking-wider uppercase block">
                                            {item.label}
                                        </span>
                                        {item.description && (
                                            <span className="text-[9px] text-muted-foreground/50 block truncate">
                                                {item.description}
                                            </span>
                                        )}
                                    </div>
                                )}
                                
                                {/* Badge text */}
                                {!isSidebarCollapsed && item.badge && (
                                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[8px] font-black uppercase tracking-wider rounded-full">
                                        {item.badge}
                                    </span>
                                )}
                            </Link>
                        ))}
                    </div>
                ))}
            </div>

            {/* Bottom Actions */}
            <div className="p-4 border-t border-white/5 space-y-1">
                {bottomItems.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                            isActive(item.href)
                                ? "bg-white/10 text-foreground font-bold"
                                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                        }`}
                    >
                        <item.icon size={16} />
                        {!isSidebarCollapsed && (
                            <span className="font-mono text-[10px] font-bold tracking-wider uppercase">{item.label}</span>
                        )}
                    </Link>
                ))}
                
                <button
                    onClick={logout}
                    aria-label="Log out"
                    title="Log out"
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-red-400 hover:bg-red-500/10 transition-all"
                >
                    <LogOut size={16} />
                    {!isSidebarCollapsed && (
                        <span className="font-mono text-[10px] font-bold tracking-wider uppercase">Logout</span>
                    )}
                </button>
            </div>
        </aside>
    );
}
