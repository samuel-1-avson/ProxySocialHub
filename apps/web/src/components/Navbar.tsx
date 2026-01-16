"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

interface NavbarProps {
    showAuth?: boolean;
}

export function Navbar({ showAuth = true }: NavbarProps) {
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

    const navItems = [
        { href: "/feed", label: "Feed" },
        { href: "/marketplace", label: "Marketplace" },
        { href: "/leaderboards", label: "Leaderboards" },
        { href: "/messages", label: "Messages" },
    ];

    return (
        <nav className="border-b sticky top-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md" style={{ borderColor: "var(--card-border)" }}>
            <div className="container flex items-center justify-between py-3">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--primary)" }}>
                        <span className="text-white font-bold text-sm">PS</span>
                    </div>
                    <span className="text-lg font-semibold hidden sm:inline" style={{ color: "var(--foreground)" }}>
                        ProxySocialHub
                    </span>
                </Link>

                {/* Desktop Navigation */}
                <div className="hidden md:flex items-center gap-1">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                            style={{
                                color: isActive(item.href) ? "var(--primary)" : "var(--muted)",
                                background: isActive(item.href) ? "rgba(249, 115, 22, 0.1)" : "transparent",
                            }}
                        >
                            {item.label}
                        </Link>
                    ))}
                </div>

                {/* Right Side */}
                <div className="flex items-center gap-3">
                    {/* Notifications */}
                    <Link
                        href="/notifications"
                        className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 hidden md:flex"
                    >
                        <svg className="w-5 h-5" style={{ color: "var(--foreground)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                        <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: "var(--primary)" }} />
                    </Link>

                    {/* Profile */}
                    {showAuth && (
                        <Link href="/profile" className="avatar">
                            <span>K</span>
                        </Link>
                    )}

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="p-2 rounded-lg md:hidden hover:bg-gray-100 dark:hover:bg-neutral-800"
                    >
                        <svg className="w-5 h-5" style={{ color: "var(--foreground)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                <div className="md:hidden border-t" style={{ borderColor: "var(--card-border)", background: "var(--card)" }}>
                    <div className="container py-2">
                        {navItems.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className="block px-3 py-3 rounded-lg font-medium"
                                style={{
                                    color: isActive(item.href) ? "var(--primary)" : "var(--foreground)",
                                    background: isActive(item.href) ? "rgba(249, 115, 22, 0.1)" : "transparent",
                                }}
                            >
                                {item.label}
                            </Link>
                        ))}
                        <Link
                            href="/notifications"
                            onClick={() => setMobileMenuOpen(false)}
                            className="block px-3 py-3 rounded-lg font-medium"
                            style={{ color: "var(--foreground)" }}
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
        <div className="bottom-nav safe-area-bottom">
            {items.map((item) => (
                <Link
                    key={item.href}
                    href={item.href}
                    className={`bottom-nav-item ${isActive(item.href) ? "active" : ""}`}
                >
                    {item.icon}
                    <span>{item.label}</span>
                </Link>
            ))}
        </div>
    );
}

// Export both components
export default Navbar;
