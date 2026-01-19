"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ModeToggle } from "@/components/ModeToggle";

interface NavbarProps {
    showAuth?: boolean;
}

export function Navbar({ showAuth = true }: NavbarProps) {
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const { user } = useAuth();

    const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

    const navItems = [
        { href: "/feed", label: "Feed" },
        { href: "/marketplace", label: "Marketplace" },
        { href: "/leaderboards", label: "Leaderboards" },
        { href: "/messages", label: "Messages" },
    ];

    return (
        <nav className="sticky top-0 z-50 bg-[var(--background)] border-b-2 border-[var(--foreground)]">
            <div className="container mx-auto flex items-center justify-between py-4 px-4 sm:px-6 lg:px-8">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-3 group">
                    <div className="w-10 h-10 bg-[var(--primary)] flex items-center justify-center border-2 border-[var(--foreground)] shadow-[4px_4px_0_var(--foreground)] group-hover:translate-x-0.5 group-hover:translate-y-0.5 group-hover:shadow-[2px_2px_0_var(--foreground)] transition-all">
                        <span className="text-white font-bold text-lg font-mono">PS</span>
                    </div>
                    <span className="text-xl font-bold tracking-tight text-[var(--foreground)] font-mono hidden sm:inline">
                        ProxyHub
                    </span>
                </Link>

                {/* Desktop Navigation */}
                <div className="hidden md:flex items-center gap-8">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`text-sm font-medium font-mono border-b-2 border-transparent hover:border-[var(--primary)] transition-all ${isActive(item.href)
                                ? "text-[var(--primary)] border-[var(--primary)]"
                                : "text-[var(--text-secondary)] hover:text-[var(--primary)]"
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
                    <Link
                        href="/notifications"
                        className="relative p-2 border-2 border-transparent hover:border-[var(--foreground)] rounded transition-all hidden md:flex"
                    >
                        <svg className="w-6 h-6 text-[var(--foreground)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                        <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--background)] bg-[var(--primary)]" />
                    </Link>

                    {/* Profile */}
                    {showAuth && (
                        <Link href="/profile" className="w-10 h-10 border-2 border-[var(--foreground)] overflow-hidden shadow-[4px_4px_0_var(--foreground)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0_var(--foreground)] transition-all bg-[var(--primary-light)]">
                            {user?.avatar_url ? (
                                <img src={user.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-[var(--foreground)] font-bold">
                                    {user?.email?.charAt(0).toUpperCase() || "?"}
                                </div>
                            )}
                        </Link>
                    )}

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="p-2 md:hidden text-[var(--foreground)] border-2 border-transparent hover:border-[var(--foreground)] rounded transition-all"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {mobileMenuOpen ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            )}
                        </svg>
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="md:hidden border-t-2 border-[var(--foreground)] bg-[var(--card)]">
                    <div className="container px-4 py-4 space-y-2">
                        {navItems.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`block px-4 py-3 border-2 transition-all font-mono font-bold ${isActive(item.href)
                                    ? "bg-[var(--primary)] border-[var(--foreground)] text-white shadow-[4px_4px_0_var(--foreground)]"
                                    : "border-transparent text-[var(--foreground)] hover:border-[var(--foreground)] hover:bg-[var(--background)] shadow-none"
                                    }`}
                            >
                                {item.label}
                            </Link>
                        ))}
                        <div className="border-t-2 border-[var(--card-border)] my-2"></div>
                        <Link
                            href="/notifications"
                            onClick={() => setMobileMenuOpen(false)}
                            className="block px-4 py-3 border-2 border-transparent hover:border-[var(--foreground)] font-medium text-[var(--foreground)] hover:bg-[var(--background)] font-mono"
                        >
                            Notifications
                        </Link>
                    </div>
                </div>
            )}
        </nav>
    );
}

// Bottom Navigation for Mobile
export function BottomNav() {
    const pathname = usePathname();
    const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

    const items = [
        {
            href: "/feed", label: "Feed", icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
            )
        },
        {
            href: "/marketplace", label: "Market", icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
            )
        },
        {
            href: "/messages", label: "Messages", icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
            )
        },
        {
            href: "/profile", label: "Profile", icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
            )
        },
    ];

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t pb-safe-bottom bg-[var(--card)]" style={{ borderColor: "var(--card-border)" }}>
            <div className="flex justify-around items-center h-16">
                {items.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${isActive(item.href) ? "text-[var(--primary)]" : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                            }`}
                    >
                        {item.icon}
                        <span className="text-xs font-medium">{item.label}</span>
                    </Link>
                ))}
            </div>
        </div>
    );
}

export default Navbar;
