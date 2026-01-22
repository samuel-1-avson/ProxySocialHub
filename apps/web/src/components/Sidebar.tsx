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

export function Sidebar() {
    const pathname = usePathname();
    const { user, logout } = useAuth();

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
        <aside className="fixed left-0 top-0 h-screen w-64 bg-card border-r-2 border-border hidden md:flex flex-col z-40">
            {/* Header */}
            <div className="p-6 border-b-2 border-border">
                <Link href="/" className="flex items-center gap-3 group">
                    <div className="w-8 h-8 rounded-sm flex items-center justify-center bg-primary text-primary-foreground border-2 border-foreground shadow-[2px_2px_0px_var(--foreground)] group-hover:translate-x-[2px] group-hover:translate-y-[2px] group-hover:shadow-none transition-all">
                        <span className="font-bold font-mono text-sm">PS</span>
                    </div>
                    <span className="text-lg font-bold font-mono uppercase tracking-tight">ProxyHub</span>
                </Link>
            </div>

            {/* User Status */}
            <div className="p-4 border-b border-border bg-secondary/20">
                <div className="flex items-center gap-3 p-2 rounded-sm border border-border bg-background">
                    <div className="w-8 h-8 rounded-sm bg-primary/20 flex items-center justify-center border border-primary/30">
                        <span className="font-mono text-xs font-bold text-primary">
                            {user?.email?.slice(0, 2).toUpperCase() || "OP"}
                        </span>
                    </div>
                    <div className="overflow-hidden">
                        <p className="text-xs font-bold font-mono truncate">{user?.email || "OPERATOR"}</p>
                        <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                            <span className="text-[10px] text-muted-foreground font-mono uppercase">ONLINE</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Menu */}
            <div className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
                <p className="px-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4">Main Modules</p>

                {menuItems.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-sm transition-all group ${active
                                ? "bg-primary text-primary-foreground font-bold border-2 border-foreground shadow-[2px_2px_0px_var(--foreground)]"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent hover:border-l-4 hover:border-primary"
                                }`}
                        >
                            <Icon size={18} className={active ? "stroke-2" : "stroke-[1.5]"} />
                            <span className="font-mono text-xs tracking-wide">{item.label}</span>
                        </Link>
                    );
                })}
            </div>

            {/* Bottom Actions */}
            <div className="p-4 border-t-2 border-border bg-background">
                <div className="space-y-1 mb-4">
                    {bottomItems.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`flex items-center gap-3 px-3 py-2 rounded-sm transition-colors ${active ? "text-primary font-bold" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                                    }`}
                            >
                                <Icon size={16} />
                                <span className="font-mono text-xs">{item.label}</span>
                            </Link>
                        );
                    })}

                    {user?.role === "admin" && (
                        <Link
                            href="/dashboard/admin"
                            className={`flex items-center gap-3 px-3 py-2 rounded-sm transition-colors ${isActive("/dashboard/admin") ? "text-destructive font-bold" : "text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                                }`}
                        >
                            <ShieldCheck size={16} />
                            <span className="font-mono text-xs">SYSTEM</span>
                        </Link>
                    )}
                </div>

                <button
                    onClick={() => logout()}
                    className="w-full flex items-center justify-center gap-2 p-2 rounded-sm border border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                >
                    <LogOut size={14} />
                    <span className="font-mono text-xs font-bold uppercase">Terminate Session</span>
                </button>
            </div>
        </aside>
    );
}
