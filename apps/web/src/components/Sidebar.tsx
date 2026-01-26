"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
    Search
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useUIStore } from "@/lib/store/ui-store";
import { AlertCenter } from "@/components/AlertCenter";
import { motion, AnimatePresence } from "framer-motion";

export function Sidebar() {
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const { isSidebarCollapsed, toggleSidebar } = useUIStore();

    const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

    const menuItems = [
        { href: "/dashboard", label: "OVERVIEW", icon: LayoutDashboard },
        { href: "/dashboard/wallet", label: "WALLET", icon: Wallet },
        { href: "/explorer", label: "EXPLORER", icon: Search },
        { href: "/dashboard/proxy", label: "PROXY", icon: Network },
        { href: "/marketplace", label: "MARKET", icon: Globe },
        { href: "/agents", label: "AGENTS", icon: Bot },
        { href: "/feed", label: "FEED", icon: Activity },
        { href: "/messages", label: "COMMS", icon: MessageSquare },
        { href: "/forum", label: "FORUM", icon: Grid },
        { href: "/governance", label: "VOTE", icon: Vote },
    ];

    const bottomItems = [
        { href: "/settings", label: "CONFIG", icon: Settings },
        { href: "/profile", label: "PROFILE", icon: User },
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
            <div className="flex-1 overflow-y-auto py-6 px-4 space-y-1.5 scrollbar-hide">
                {!isSidebarCollapsed && (
                    <p className="px-3 text-[9px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 mb-3">Protocol Modules</p>
                )}

                {menuItems.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all group relative overflow-hidden ${active
                                ? "bg-primary text-primary-foreground font-black shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                                } ${isSidebarCollapsed ? "justify-center" : ""}`}
                            title={isSidebarCollapsed ? item.label : undefined}
                        >
                            <Icon size={isSidebarCollapsed ? 22 : 18} className={`transition-all ${active ? "stroke-[2.5px]" : "stroke-[1.5px] opacity-70 group-hover:opacity-100"}`} />
                            {!isSidebarCollapsed && (
                                <span className="font-mono text-[11px] font-bold tracking-wider">{item.label}</span>
                            )}

                            {active && !isSidebarCollapsed && (
                                <motion.div
                                    layoutId="sidebar-active"
                                    className="absolute right-0 w-1 h-6 bg-primary-foreground/50 rounded-l-full"
                                />
                            )}
                        </Link>
                    );
                })}
            </div>

            {/* Bottom Actions */}
            <div className={`border-t border-white/5 bg-white/2 transition-all duration-300 ${isSidebarCollapsed ? "p-3" : "p-4"}`}>
                <div className="space-y-1 mb-4">
                    {bottomItems.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${active ? "text-primary font-black bg-primary/5 border border-primary/20" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                                    } ${isSidebarCollapsed ? "justify-center" : ""}`}
                                title={isSidebarCollapsed ? item.label : undefined}
                            >
                                <Icon size={16} />
                                {!isSidebarCollapsed && <span className="font-mono text-[10px] font-bold tracking-widest">{item.label}</span>}
                            </Link>
                        );
                    })}
                </div>

                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => logout()}
                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-rose-500/20 text-rose-500 hover:bg-rose-500 hover:text-white transition-all shadow-[0_0_15px_rgba(244,63,94,0.1)] ${isSidebarCollapsed ? "aspect-square p-0" : ""}`}
                    title="Terminate Session"
                >
                    <LogOut size={16} />
                    {!isSidebarCollapsed && <span className="font-mono text-[10px] font-black uppercase tracking-widest">Logout</span>}
                </motion.button>
            </div>

            {/* Toggle Button */}
            <motion.button
                whileHover={{ scale: 1.1 }}
                onClick={toggleSidebar}
                className="absolute -right-3 top-24 w-7 h-7 bg-[#18181b] border border-white/10 rounded-full flex items-center justify-center text-primary hover:text-emerald-400 transition-all shadow-xl z-50 overflow-hidden"
            >
                <div className="absolute inset-0 bg-primary/5 animate-pulse" />
                <LayoutDashboard size={14} className={`relative transition-transform duration-500 ${isSidebarCollapsed ? "rotate-180" : "rotate-0"}`} />
            </motion.button>
        </aside>
    );
}
