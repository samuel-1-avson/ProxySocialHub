"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ModeToggle } from '@/components/ModeToggle';
import { Bell, LogOut, Menu, User as UserIcon, Settings, LayoutDashboard, Rss, ShoppingCart, Trophy, MessageSquare, Wallet, Users, CreditCard, ShoppingBag, Scale, Bot } from 'lucide-react';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const { user, logout } = useAuth();

    const navItems = [
        { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
        { href: '/dashboard/wallet', label: 'Wallet', icon: <Wallet size={20} /> },
        { href: '/dashboard/referrals', label: 'Referrals', icon: <Users size={20} /> },
        { href: '/agents', label: 'AI Agents', icon: <Bot size={20} /> },
        { href: '/dashboard/subscription', label: 'Membership', icon: <CreditCard size={20} /> },
        { href: '/dashboard/orders', label: 'My Orders', icon: <ShoppingBag size={20} /> },
        { href: '/forum', label: 'Community', icon: <MessageSquare size={20} /> },
        { href: '/governance', label: 'Governance', icon: <Scale size={20} /> },
        { href: '/feed', label: 'Feed', icon: <Rss size={20} /> },
        { href: '/marketplace', label: 'Marketplace', icon: <ShoppingCart size={20} /> },
        { href: '/leaderboards', label: 'Leaderboards', icon: <Trophy size={20} /> },
        { href: '/messages', label: 'Messages', icon: <MessageSquare size={20} /> },
    ];

    const subItems = [
        { href: '/profile', label: 'Profile', icon: <UserIcon size={20} /> },
        { href: '/settings', label: 'Settings', icon: <Settings size={20} /> },
    ]

    const isActive = (path: string) => {
        if (path === '/dashboard') return pathname === '/dashboard';
        return pathname?.startsWith(path);
    };

    const getPageTitle = () => {
        const item = [...navItems, ...subItems].find(i => isActive(i.href));
        return item ? item.label : 'App';
    };

    return (
        <div className="min-h-screen bg-[#050505] text-foreground selection:bg-primary/30">
            {/* Dot Pattern Background Overlay */}
            <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:24px_24px] z-0"></div>

            {/* Mobile Navigation Header */}
            <nav className="lg:hidden bg-black/50 backdrop-blur-xl border-b border-white/10 sticky top-0 z-50">
                <div className="px-6 h-16 flex items-center justify-between">
                    <Link href="/dashboard" className="flex items-center space-x-2">
                        <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-white font-bold text-xs ring-1 ring-white/20">
                            PS
                        </div>
                        <span className="text-lg font-bold tracking-tight">ProxyHub</span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <ModeToggle />
                        <button onClick={() => logout()} className="p-2 text-muted-foreground">
                            <LogOut size={20} />
                        </button>
                    </div>
                </div>
            </nav>

            <div className="flex relative z-10">
                {/* Sidebar - Desktop */}
                <aside className="hidden lg:flex w-72 min-h-screen flex-col bg-[var(--background)] border-r-2 border-[var(--foreground)] fixed left-0 top-0 bottom-0 z-40">
                    {/* Logo Area */}
                    <div className="h-20 flex items-center px-8 border-b-2 border-[var(--foreground)]">
                        <Link href="/dashboard" className="flex items-center gap-3 group">
                            <div className="w-10 h-10 bg-[var(--primary)] flex items-center justify-center text-white font-bold text-lg font-mono border-2 border-[var(--foreground)] shadow-[4px_4px_0_var(--foreground)] group-hover:translate-x-0.5 group-hover:translate-y-0.5 group-hover:shadow-[2px_2px_0_var(--foreground)] transition-all">
                                PS
                            </div>
                            <span className="font-bold text-xl tracking-tight text-[var(--foreground)] font-mono">
                                ProxyHub
                            </span>
                        </Link>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-4 py-8 space-y-8 overflow-y-auto no-scrollbar">
                        <div>
                            <div className="text-xs font-bold text-[var(--foreground)] uppercase tracking-widest mb-4 px-4 font-mono">Navigation</div>
                            <div className="space-y-2">
                                {navItems.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`flex items-center gap-3 px-4 py-3 border-2 transition-all duration-200 group relative font-medium text-sm ${isActive(item.href)
                                            ? 'bg-[var(--primary)] border-[var(--foreground)] text-white shadow-[4px_4px_0_var(--foreground)] -translate-y-1'
                                            : 'bg-transparent border-transparent text-[var(--text-secondary)] hover:border-[var(--foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)] hover:shadow-[4px_4px_0_var(--foreground)] hover:-translate-y-1'
                                            }`}
                                    >
                                        <span className={`transition-transform duration-300 ${isActive(item.href) ? 'text-white' : 'text-[var(--text-muted)] group-hover:text-[var(--foreground)]'}`}>
                                            {item.icon}
                                        </span>
                                        <span className={isActive(item.href) ? "font-bold" : ""}>{item.label}</span>
                                    </Link>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="text-xs font-bold text-[var(--foreground)] uppercase tracking-widest mb-4 px-4 font-mono">Account</div>
                            <div className="space-y-2">
                                {subItems.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`flex items-center gap-3 px-4 py-3 border-2 transition-all duration-200 group relative font-medium text-sm ${isActive(item.href)
                                            ? 'bg-[var(--primary)] border-[var(--foreground)] text-white shadow-[4px_4px_0_var(--foreground)] -translate-y-1'
                                            : 'bg-transparent border-transparent text-[var(--text-secondary)] hover:border-[var(--foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)] hover:shadow-[4px_4px_0_var(--foreground)] hover:-translate-y-1'
                                            }`}
                                    >
                                        <span className={`transition-transform duration-300 ${isActive(item.href) ? 'text-white' : 'text-[var(--text-muted)] group-hover:text-[var(--foreground)]'}`}>
                                            {item.icon}
                                        </span>
                                        <span className={isActive(item.href) ? "font-bold" : ""}>{item.label}</span>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </nav>

                    {/* User Footer */}
                    <div className="p-4 border-t-2 border-[var(--foreground)] bg-[var(--card)]">
                        <div className="flex items-center gap-3 p-3 border-2 border-[var(--foreground)] shadow-[4px_4px_0_var(--foreground)] bg-[var(--background)]">
                            <div className="relative">
                                {user?.user_metadata?.avatar_url ? (
                                    <img
                                        src={user.user_metadata.avatar_url}
                                        alt="Avatar"
                                        className="w-10 h-10 border-2 border-[var(--foreground)] object-cover"
                                    />
                                ) : (
                                    <div className="w-10 h-10 bg-[var(--primary-light)] border-2 border-[var(--foreground)] flex items-center justify-center text-[var(--foreground)] text-xs font-bold">
                                        {(user?.user_metadata?.full_name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold truncate text-[var(--foreground)]">
                                    {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)] truncate uppercase tracking-wider font-mono">
                                    {user?.email?.split('@')[1] || 'PRO USER'}
                                </div>
                            </div>
                            <button
                                onClick={() => logout()}
                                className="p-2 text-[var(--text-secondary)] hover:text-[var(--error)] hover:bg-red-50 rounded transition-all"
                            >
                                <LogOut size={18} />
                            </button>
                        </div>
                    </div>
                </aside>

                {/* Main Content Area */}
                <div className="flex-1 lg:ml-72 flex flex-col min-h-screen">
                    {/* Top Header - Desktop only */}
                    <header className="hidden lg:flex h-20 items-center justify-between px-10 sticky top-0 z-30 bg-[var(--background)] border-b-2 border-[var(--foreground)]">
                        <h2 className="text-2xl font-bold text-[var(--foreground)] tracking-tight font-mono">
                            {getPageTitle()}
                        </h2>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-3">
                                <Link
                                    href="/notifications"
                                    className="p-2.5 text-[var(--foreground)] hover:bg-[var(--card)] border-2 border-transparent hover:border-[var(--foreground)] hover:shadow-[4px_4px_0_var(--foreground)] rounded transition-all relative"
                                >
                                    <Bell size={20} />
                                    <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-[var(--primary)] border border-white"></span>
                                </Link>
                                <ModeToggle />
                            </div>
                        </div>
                    </header>

                    {/* Page Content */}
                    <main className="flex-1 p-6 md:p-10">
                        <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
                            {children}
                        </div>
                    </main>
                </div>
            </div>
        </div>
    );
}

