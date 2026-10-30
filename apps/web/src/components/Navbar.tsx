"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ModeToggle } from "@/components/ModeToggle";
import { Bell, Menu, X, Home, Wallet } from "lucide-react";
import { AlertCenter } from "@/components/AlertCenter";
import { NotificationCenter } from "@/components/NotificationCenter";
import { PRIMARY_AUTH_NAV, PRIMARY_PUBLIC_NAV, ROUTES } from "@/lib/navigation/routes";

interface NavbarProps {
    showAuth?: boolean;
}

export function Navbar({ showAuth = true }: NavbarProps) {
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const { user } = useAuth();

    const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

    const navItems = [
        ...PRIMARY_PUBLIC_NAV,
        ...(user ? PRIMARY_AUTH_NAV : []),
    ];

    return (
        <nav className="sticky top-0 z-50 bg-background/95 border-b border-border">
            <div className="container mx-auto flex items-center justify-between py-3 px-4">
                {/* Logo */}
                <Link href={ROUTES.home} className="flex items-center gap-3 group">
                    <div className="w-10 h-10 rounded-sm flex items-center justify-center bg-primary text-primary-foreground border-2 border-foreground group-active:shadow-none group-active:translate-x-[4px] group-active:translate-y-[4px] transition-all">
                        <span className="font-bold text-lg font-mono">PS</span>
                    </div>
                    <span className="text-xl font-bold tracking-tight font-mono text-foreground hidden sm:inline group-hover:underline decoration-2 underline-offset-4 decoration-primary">
                        ProxyHubb
                    </span>
                </Link>

                {/* Desktop Navigation */}
                <div className="hidden md:flex items-center gap-8">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`text-sm font-mono font-medium transition-all hover:-translate-y-0.5 ${isActive(item.href)
                                ? "text-primary border-b-2 border-primary"
                                : "text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            {item.label}
                        </Link>
                    ))}
                </div>

                {/* Right Side */}
                <div className="flex items-center gap-4">
                    <ModeToggle />

                    {/* Notifications */}
                    {user && (
                        <div className="hidden md:flex">
                            <NotificationCenter />
                        </div>
                    )}

                    {/* Infrastructure Alerts */}
                    <div className="hidden md:flex">
                        <AlertCenter />
                    </div>

                    {/* Auth & Profile */}
                    {showAuth && (
                        <>
                            {!user ? (
                                <div className="hidden sm:flex items-center gap-4 ml-4">
                                    <Link href={ROUTES.login} className="text-sm font-mono font-medium text-muted-foreground hover:text-foreground transition-colors">
                                        Login
                                    </Link>
                                    <Link href={ROUTES.register}>
                                        <button className="btn-retro btn-retro-primary px-4 py-2 text-xs">
                                            SIGN UP
                                        </button>
                                    </Link>
                                </div>
                            ) : (
                                <div className="flex items-center gap-4 ml-4">
                                    <Link href={ROUTES.dashboard} className="hidden sm:block">
                                        <button className="btn-retro btn-retro-outline px-4 py-2 text-xs flex items-center gap-2 border-primary/50 text-primary">
                                            <Home size={14} />
                                            System dashboard
                                        </button>
                                    </Link>
                                    <Link href={ROUTES.profile} className="w-9 h-9 rounded-sm overflow-hidden border border-border hover:border-primary shadow-sm transition-colors">
                                        {user?.avatar_url ? (
                                            <img src={user.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-secondary text-foreground font-bold font-mono text-sm leading-none pt-0.5">
                                                {user?.email?.charAt(0).toUpperCase() || "?"}
                                            </div>
                                        )}
                                    </Link>
                                </div>
                            )}
                        </>
                    )}

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="p-2 md:hidden text-foreground border border-transparent hover:border-border rounded-sm"
                    >
                        {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="md:hidden border-t border-border bg-background absolute left-0 right-0 shadow-sm">
                    <div className="container px-4 py-4 space-y-2">
                        {navItems.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`block px-4 py-3 rounded-sm font-mono text-sm font-medium transition-colors border border-transparent ${isActive(item.href)
                                    ? "bg-primary/10 text-primary border-primary/20"
                                    : "text-foreground hover:bg-accent hover:border-border"
                                    }`}
                            >
                                {item.label}
                            </Link>
                        ))}
                        {showAuth && !user && (
                            <div className="px-4 py-2 flex flex-col gap-2 mt-2">
                                <Link href={ROUTES.login} onClick={() => setMobileMenuOpen(false)}>
                                    <button className="btn-retro btn-retro-outline w-full py-2 text-xs">LOGIN</button>
                                </Link>
                                <Link href={ROUTES.register} onClick={() => setMobileMenuOpen(false)}>
                                    <button className="btn-retro btn-retro-primary w-full py-2 text-xs">SIGN UP</button>
                                </Link>
                            </div>
                        )}
                        {user && (
                            <>
                                <Link
                                    href={ROUTES.dashboardWallet}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className={`flex items-center gap-3 px-4 py-3 mt-2 rounded-sm font-mono text-sm font-medium transition-colors border border-transparent ${isActive('/dashboard/wallet') ? 'bg-primary/10 text-primary border-primary/20' : 'text-foreground hover:bg-accent hover:border-border'}`}
                                >
                                    <Wallet size={16} /> WALLET
                                </Link>
                                <Link
                                    href={ROUTES.dashboardSettingsNotifications}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="block px-4 py-3 rounded-sm font-mono text-sm font-medium text-foreground hover:bg-accent border border-transparent hover:border-border"
                                >
                                    NOTIFICATIONS
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            )}
        </nav>
    );
}

export default Navbar;
