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
    Network
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useUIStore } from "@/lib/store/ui-store";

export function Sidebar() {
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const { isSidebarCollapsed, toggleSidebar } = useUIStore();

    const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

    const menuItems = [
        { href: "/dashboard", label: "OVERVIEW", icon: LayoutDashboard },
        { href: "/dashboard/wallet", label: "WALLET", icon: Wallet },
        { href: "/dashboard/proxy", label: "PROXY", icon: Network },
        { href: "/marketplace", label: "MARKET", icon: Globe },
        { href: "/agents", label: "AGENTS", icon: Bot },
        { href: "/feed", label: "FEED", icon: Activity },
        { href: "/messages", label: "COMMS", icon: MessageSquare },
        { href: "/forum", label: "FORUM", icon: Grid },
        { href: "/governance", label: "VOTE", icon: Vote },
        { href: "/leaderboards", label: "RANK", icon: Trophy },
    ];

    const bottomItems = [
        { href: "/settings", label: "CONFIG", icon: Settings },
        { href: "/profile", label: "PROFILE", icon: User },
    ];

    return (
        <aside
            className={`fixed left-0 top-0 h-screen bg-card border-r border-border hidden md:flex flex-col z-40 transition-all duration-300 ease-in-out ${isSidebarCollapsed ? "w-20" : "w-64"
                }`}
        >
            {/* Header */}
            {/* Header */}
            <div className={`p-4 border-b border-border flex items-center ${isSidebarCollapsed ? "justify-center" : "gap-3"}`}>
                <Link href="/" className="flex items-center gap-3 group">
                    <div className="w-8 h-8 rounded-sm flex items-center justify-center bg-primary text-primary-foreground border-2 border-foreground shadow-[2px_2px_0px_var(--foreground)] group-hover:translate-x-[2px] group-hover:translate-y-[2px] group-hover:shadow-none transition-all">
                        <span className="font-bold font-mono text-sm">PS</span>
                    </div>
                    {!isSidebarCollapsed && (
                        <span className="text-lg font-bold font-mono uppercase tracking-tight animate-in fade-in duration-300">ProxyHub</span>
                    )}
                </Link>
            </div>

            {/* User Status - Minimized in collapse mode */}
            <div className={`border-b border-border bg-secondary/10 transition-all duration-300 ${isSidebarCollapsed ? "p-2" : "p-4"}`}>
                <div className={`flex items-center gap-3 rounded-sm border border-border bg-background transition-all ${isSidebarCollapsed ? "p-1.5 justify-center border-transparent bg-transparent" : "p-2"}`}>
                    <div className="w-8 h-8 min-w-[32px] rounded-sm bg-primary/20 flex items-center justify-center border border-primary/30 relative">
                        <span className="font-mono text-xs font-bold text-primary">
                            {user?.email?.slice(0, 2).toUpperCase() || "OP"}
                        </span>
                        {isSidebarCollapsed && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse border-2 border-background"></span>}
                    </div>

                    {!isSidebarCollapsed && (
                        <div className="overflow-hidden animate-in fade-in duration-300">
                            <p className="text-xs font-bold font-mono truncate max-w-[120px]">{user?.email || "OPERATOR"}</p>
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                <span className="text-[10px] text-muted-foreground font-mono uppercase">ONLINE</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Main Menu */}
            <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
                {!isSidebarCollapsed && (
                    <p className="px-3 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 animate-in fade-in">Main Modules</p>
                )}

                {menuItems.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-sm transition-all group relative ${active
                                ? "bg-primary text-primary-foreground font-bold border-2 border-foreground shadow-[2px_2px_0px_var(--foreground)]"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent hover:border-l-4 hover:border-primary"
                                } ${isSidebarCollapsed ? "justify-center px-0 border-0 hover:border-0" : ""}`}
                            title={isSidebarCollapsed ? item.label : undefined}
                        >
                            <Icon size={isSidebarCollapsed ? 20 : 18} className={`transition-all ${active ? "stroke-2" : "stroke-[1.5]"}`} />
                            {!isSidebarCollapsed && (
                                <span className="font-mono text-xs tracking-wide animate-in fade-in duration-200">{item.label}</span>
                            )}

                            {/* Tooltip-ish indicator for collapsed active state if shadow is hidden */}
                            {isSidebarCollapsed && active && (
                                <div className="absolute inset-0 border-2 border-foreground rounded-sm pointer-events-none" />
                            )}
                        </Link>
                    );
                })}
            </div>

            {/* Bottom Actions */}
            <div className={`border-t border-border bg-background transition-all duration-300 ${isSidebarCollapsed ? "p-2" : "p-4"}`}>
                <div className="space-y-1 mb-4">
                    {bottomItems.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`flex items-center gap-3 px-3 py-2 rounded-sm transition-colors ${active ? "text-primary font-bold" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                                    } ${isSidebarCollapsed ? "justify-center" : ""}`}
                                title={isSidebarCollapsed ? item.label : undefined}
                            >
                                <Icon size={16} />
                                {!isSidebarCollapsed && <span className="font-mono text-xs animate-in fade-in">{item.label}</span>}
                            </Link>
                        );
                    })}
                </div>

                <button
                    onClick={() => logout()}
                    className={`w-full flex items-center justify-center gap-2 p-2 rounded-sm border border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors ${isSidebarCollapsed ? "aspect-square p-0" : ""}`}
                    title="Terminate Session"
                >
                    <LogOut size={14} />
                    {!isSidebarCollapsed && <span className="font-mono text-xs font-bold uppercase animate-in fade-in">Terminate Session</span>}
                </button>
            </div>

            {/* Toggle Button (Floating at bottom right of sidebar) */}
            <button
                onClick={toggleSidebar}
                className="absolute -right-3 top-24 w-6 h-6 bg-card border border-border rounded-full flex items-center justify-center hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all shadow-sm z-50"
                title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
                <LayoutDashboard size={12} className={`transition-transform duration-300 ${isSidebarCollapsed ? "rotate-90" : "-rotate-90"}`} />
            </button>
        </aside>
    );
}
