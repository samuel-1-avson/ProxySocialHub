'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const { user } = useAuth();

    const navItems = [
        { href: '/dashboard', label: 'Dashboard', icon: '📊' },
        { href: '/feed', label: 'Feed', icon: '📱' },
        { href: '/marketplace', label: 'Marketplace', icon: '🛒' },
        { href: '/leaderboards', label: 'Leaderboards', icon: '🏆' },
        { href: '/messages', label: 'Messages', icon: '💬' },
        { href: '/notifications', label: 'Notifications', icon: '🔔' },
    ];

    const subItems = [
        { href: '/profile', label: 'Profile', icon: '👤' },
        { href: '/settings', label: 'Settings', icon: '⚙️' },
    ]

    const isActive = (path: string) => pathname === path || (path !== '/dashboard' && pathname?.startsWith(path));

    return (
        <div className="min-h-screen bg-background">
            {/* Top Navigation - Mobile Only */}
            <nav className="lg:hidden bg-card/50 backdrop-blur-lg border-b border-card-border sticky top-0 z-50">
                <div className="px-4">
                    <div className="flex items-center justify-between h-16">
                        <Link href="/dashboard" className="flex items-center space-x-2">
                            <span className="text-xl font-bold bg-gradient-to-r from-primary to-green-400 bg-clip-text text-transparent">
                                ProxyHub
                            </span>
                        </Link>
                        <div className="flex items-center space-x-4">
                            {/* Mobile Menu Trigger would go here */}
                        </div>
                    </div>
                </div>
            </nav>

            <div className="flex">
                {/* Sidebar - Desktop */}
                <aside className="hidden lg:flex w-64 min-h-screen flex-col bg-card/30 backdrop-blur-md border-r border-card-border fixed left-0 top-0 bottom-0 z-40">
                    {/* Logo Area */}
                    <div className="h-16 flex items-center px-6 border-b border-card-border/50">
                        <Link href="/dashboard" className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-white font-bold text-sm">
                                PS
                            </div>
                            <span className="font-bold text-lg tracking-tight">ProxyHub</span>
                        </Link>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 px-2">Menu</div>
                        {navItems.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group ${isActive(item.href)
                                    ? 'bg-primary/10 text-primary font-medium'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                                    }`}
                            >
                                <span className="text-lg group-hover:scale-110 transition-transform">{item.icon}</span>
                                <span>{item.label}</span>
                            </Link>
                        ))}

                        <div className="mt-8">
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 px-2">Account</div>
                            {subItems.map((item) => (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group ${isActive(item.href)
                                        ? 'bg-primary/10 text-primary font-medium'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                                        }`}
                                >
                                    <span className="text-lg group-hover:scale-110 transition-transform">{item.icon}</span>
                                    <span>{item.label}</span>
                                </Link>
                            ))}
                        </div>
                    </nav>

                    {/* User Footer */}
                    <div className="p-4 border-t border-card-border/50">
                        <div className="flex items-center gap-3 p-2 rounded-lg bg-card/50 border border-card-border/50">
                            {user?.user_metadata?.avatar_url ? (
                                <img
                                    src={user.user_metadata.avatar_url}
                                    alt={user.user_metadata.full_name || 'User'}
                                    className="w-8 h-8 rounded-full object-cover"
                                />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                                    {(user?.user_metadata?.full_name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">
                                    {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User Account'}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                    {user?.email || 'Guest'}
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1 lg:ml-64 p-4 md:p-8 min-h-screen">
                    {children}
                </main>
            </div>
        </div>
    );
}
