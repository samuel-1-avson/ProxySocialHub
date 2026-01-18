import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ModeToggle } from '@/components/ModeToggle';
import { Bell, LogOut, Menu, User as UserIcon, Settings, LayoutDashboard, Rss, ShoppingCart, Trophy, MessageSquare } from 'lucide-react';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const { user, logout } = useAuth();

    const navItems = [
        { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
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
                <aside className="hidden lg:flex w-72 min-h-screen flex-col bg-black/20 backdrop-blur-3xl border-r border-white/5 fixed left-0 top-0 bottom-0 z-40">
                    {/* Logo Area */}
                    <div className="h-20 flex items-center px-8">
                        <Link href="/dashboard" className="flex items-center gap-3 group">
                            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-sm shadow-[0_0_20px_rgba(34,197,94,0.3)] group-hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] transition-all duration-500">
                                PS
                            </div>
                            <span className="font-bold text-xl tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                                ProxyHub
                            </span>
                        </Link>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-4 py-8 space-y-8 overflow-y-auto no-scrollbar">
                        <div>
                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-4 px-4 opacity-50">Navigation</div>
                            <div className="space-y-1">
                                {navItems.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group relative ${isActive(item.href)
                                            ? 'bg-primary/10 text-primary'
                                            : 'text-muted-foreground hover:text-white hover:bg-white/[0.03]'
                                            }`}
                                    >
                                        {isActive(item.href) && (
                                            <div className="absolute left-0 w-1 h-6 bg-primary rounded-full -translate-x-1"></div>
                                        )}
                                        <span className={`transition-transform duration-300 group-hover:scale-110 ${isActive(item.href) ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-white'}`}>
                                            {item.icon}
                                        </span>
                                        <span className="font-medium text-sm">{item.label}</span>
                                    </Link>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-4 px-4 opacity-50">Account</div>
                            <div className="space-y-1">
                                {subItems.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group relative ${isActive(item.href)
                                            ? 'bg-primary/10 text-primary'
                                            : 'text-muted-foreground hover:text-white hover:bg-white/[0.03]'
                                            }`}
                                    >
                                        {isActive(item.href) && (
                                            <div className="absolute left-0 w-1 h-6 bg-primary rounded-full -translate-x-1"></div>
                                        )}
                                        <span className={`transition-transform duration-300 group-hover:scale-110 ${isActive(item.href) ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-white'}`}>
                                            {item.icon}
                                        </span>
                                        <span className="font-medium text-sm">{item.label}</span>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </nav>

                    {/* User Footer */}
                    <div className="p-4 bg-white/[0.02] border-t border-white/5">
                        <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/5 ring-1 ring-white/5">
                            <div className="relative">
                                {user?.user_metadata?.avatar_url ? (
                                    <img
                                        src={user.user_metadata.avatar_url}
                                        alt="Avatar"
                                        className="w-10 h-10 rounded-full object-cover ring-2 ring-white/10"
                                    />
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-primary text-xs font-bold ring-2 ring-primary/20">
                                        {(user?.user_metadata?.full_name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
                                    </div>
                                )}
                                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#050505]"></div>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold truncate text-white">
                                    {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate uppercase tracking-wider font-bold opacity-60">
                                    {user?.email?.split('@')[1] || 'PRO USER'}
                                </div>
                            </div>
                            <button
                                onClick={() => logout()}
                                className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all"
                            >
                                <LogOut size={18} />
                            </button>
                        </div>
                    </div>
                </aside>

                {/* Main Content Area */}
                <div className="flex-1 lg:ml-72 flex flex-col min-h-screen">
                    {/* Top Header - Desktop only */}
                    <header className="hidden lg:flex h-20 items-center justify-between px-10 sticky top-0 z-30 bg-[#050505]/60 backdrop-blur-xl border-b border-white/5">
                        <h2 className="text-xl font-bold text-white tracking-tight">
                            {getPageTitle()}
                        </h2>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/10">
                                <Link
                                    href="/notifications"
                                    className="p-2.5 text-muted-foreground hover:text-white hover:bg-white/5 rounded-lg transition-all relative"
                                >
                                    <Bell size={20} />
                                    <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-primary rounded-full border-2 border-[#050505]"></span>
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

