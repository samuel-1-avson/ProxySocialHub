'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { GlassCard } from '@/components/ui/glass-card';
import { Fingerprint, Search, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function WalletsEntryPage() {
    const router = useRouter();
    const [query, setQuery] = React.useState('');

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const val = query.trim();
        if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(val)) {
            router.push(`/explorer/wallets/${val}`);
        }
    };

    return (
        <div className="space-y-12 font-mono">
            <header className="flex flex-col gap-6 border-b border-border pb-10">
                <Link
                    href="/explorer"
                    className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors"
                >
                    <ArrowLeft size={14} /> Back to Grid
                </Link>
                <div>
                    <div className="text-xs font-semibold text-primary mb-1">Segment // Wallets</div>
                    <h1 className="text-4xl font-semibold tracking-tight text-foreground">Identity Registry</h1>
                </div>
            </header>

            <section className="max-w-2xl">
                <GlassCard className="!p-12 border-border bg-card rounded-[2.5rem] text-center space-y-8">
                    <div className="w-20 h-20 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto text-primary">
                        <Fingerprint size={40} />
                    </div>

                    <div className="space-y-2">
                        <h2 className="text-2xl font-semibold text-foreground tracking-tight">Locate Identity</h2>
                        <p className="text-xs font-semibold text-muted-foreground leading-relaxed">
                            Enter a Solana Public Key to intersect linked nodes, <br /> session history, and financial telemetry.
                        </p>
                    </div>

                    <form onSubmit={handleSearch} className="relative group">
                        <div className="absolute -inset-1 bg-primary/5 blur-lg opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Input address..."
                            className="w-full bg-muted border border-border rounded-lg py-5 pl-14 pr-24 text-xs font-semibold text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40 focus:bg-surface-hover transition-all"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        <button
                            type="submit"
                            className="absolute right-3 top-1/2 -translate-y-1/2 px-6 py-2 bg-primary/20 hover:bg-primary/40 border border-primary/20 text-primary text-xs font-semibold rounded-lg transition-all"
                        >
                            Intersect
                        </button>
                    </form>
                </GlassCard>
            </section>
        </div>
    );
}
