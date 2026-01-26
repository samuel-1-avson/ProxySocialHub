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
            <header className="flex flex-col gap-6 border-b border-white/5 pb-10">
                <Link
                    href="/explorer"
                    className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary transition-colors uppercase tracking-[0.3em]"
                >
                    <ArrowLeft size={14} /> Back to Grid
                </Link>
                <div>
                    <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Segment // Wallets</div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-white">Identity Registry</h1>
                </div>
            </header>

            <section className="max-w-2xl">
                <GlassCard className="!p-12 border-white/5 bg-white/[0.01] rounded-[2.5rem] text-center space-y-8">
                    <div className="w-20 h-20 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto text-primary">
                        <Fingerprint size={40} />
                    </div>

                    <div className="space-y-2">
                        <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter">Locate Identity</h2>
                        <p className="text-[10px] font-black text-white/20 uppercase tracking-widest leading-relaxed">
                            Enter a Solana Public Key to intersect linked nodes, <br /> session history, and financial telemetry.
                        </p>
                    </div>

                    <form onSubmit={handleSearch} className="relative group">
                        <div className="absolute -inset-1 bg-primary/5 blur-lg opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-white/20 w-4 h-4 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="INPUT ADDRESS..."
                            className="w-full bg-white/[0.02] border border-white/5 rounded-2xl py-5 pl-14 pr-24 text-[10px] uppercase font-black tracking-widest text-white placeholder:text-white/10 outline-none focus:border-primary/40 focus:bg-white/[0.05] transition-all"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        <button
                            type="submit"
                            className="absolute right-3 top-1/2 -translate-y-1/2 px-6 py-2 bg-primary/20 hover:bg-primary/40 border border-primary/20 text-primary text-[10px] font-black uppercase rounded-lg transition-all"
                        >
                            Intersect
                        </button>
                    </form>
                </GlassCard>
            </section>
        </div>
    );
}
