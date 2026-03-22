"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User, Shield, Wallet, Bell, ChevronRight } from 'lucide-react';

const SETTINGS_NAV = [
    {
        name: 'Identity',
        href: '/dashboard/settings/identity',
        icon: User,
        description: 'Public profile and social presence'
    },
    {
        name: 'Account & Tier',
        href: '/dashboard/settings/account',
        icon: Wallet,
        description: 'Wallet, KYC and network trust'
    },
    {
        name: 'Security',
        href: '/dashboard/settings/security',
        icon: Shield,
        description: '2FA, Sessions and history'
    },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    return (
        <div className="flex flex-col lg:flex-row gap-8 animate-in fade-in duration-700">
            {/* Settings Sidebar */}
            <aside className="w-full lg:w-64 space-y-2 shrink-0">
                <div className="px-4 mb-6">
                    <h1 className="text-2xl font-black font-mono uppercase tracking-tighter">Settings</h1>
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mt-1 opacity-60">
                        System Configuration
                    </p>
                </div>

                <nav className="space-y-1">
                    {SETTINGS_NAV.map((item) => {
                        const isActive = pathname === item.href;
                        const Icon = item.icon;

                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={`group flex items-center justify-between p-3 rounded-sm font-mono transition-all border ${
                                    isActive
                                        ? 'bg-primary/10 border-primary/30 text-primary'
                                        : 'hover:bg-white/5 border-transparent text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <Icon size={18} className={isActive ? 'animate-pulse' : 'opacity-50 group-hover:opacity-100'} />
                                    <div>
                                        <div className="text-[11px] font-black uppercase tracking-tight">{item.name}</div>
                                        <div className="text-[8px] uppercase opacity-40 font-bold hidden lg:block">{item.description}</div>
                                    </div>
                                </div>
                                <ChevronRight size={14} className={`transition-transform ${isActive ? 'translate-x-0' : '-translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-40'}`} />
                            </Link>
                        );
                    })}
                </nav>

                <div className="pt-8 px-4 mt-8 border-t border-white/5 hidden lg:block">
                    <div className="p-4 bg-secondary/20 border border-white/5 rounded-sm">
                        <div className="flex items-center gap-2 text-[9px] font-black font-mono text-primary uppercase tracking-widest mb-2">
                            <Shield size={10} /> Sentry Active
                        </div>
                        <p className="text-[8px] font-mono leading-relaxed text-muted-foreground uppercase">
                            ALL CHANGES ARE CRYPTOGRAPHICALLY SIGNED AND LOGGED TO THE SECURITY WATCHTOWER.
                        </p>
                    </div>
                </div>
            </aside>

            {/* Main Content Area */}
            <section className="flex-1 min-w-0 pb-20">
                {children}
            </section>
        </div>
    );
}
