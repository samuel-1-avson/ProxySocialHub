'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
    getMarketAgents,
    getMyAgents,
    rentAgent,
    type MarketAgent,
    type AgentInstance,
} from '@/lib/api';
import { Bot, Cpu, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';
import { ROUTES } from '@/lib/navigation/routes';
import { getErrorMessage } from '@/lib/utils';

function agentPriceLabel(agent: MarketAgent): string {
    const run = Number(agent.price_per_run ?? 0);
    const hour = Number(agent.price_per_hour ?? agent.hourly_rate ?? 0);
    if (run > 0) return `${run.toFixed(6)} SOL / run`;
    if (hour > 0) return `${hour.toFixed(6)} SOL / hr (listed)`;
    return 'Free provisional rent';
}

export default function AgentsConsolePage() {
    const { isAuthenticated } = useAuth();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<'catalog' | 'instances'>('catalog');
    const [marketAgents, setMarketAgents] = useState<MarketAgent[]>([]);
    const [myAgents, setMyAgents] = useState<AgentInstance[]>([]);
    const [loading, setLoading] = useState(true);
    const [rentingId, setRentingId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setActionError(null);
        try {
            const [marketData, myData] = await Promise.all([getMarketAgents(), getMyAgents()]);
            setMarketAgents(marketData);
            setMyAgents(myData);
        } catch (err) {
            setActionError(getErrorMessage(err) || 'Failed to load agents');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isAuthenticated) {
            router.push(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.dashboardAgents)}`);
            return;
        }
        void loadData();
    }, [isAuthenticated, loadData, router]);

    const handleRent = async (agent: MarketAgent) => {
        setActionError(null);
        if (
            !confirm(
                `Provision ${agent.name}? This is experimental — no wallet charge and jobs cannot run until Docker execution ships.`,
            )
        ) {
            return;
        }
        setRentingId(agent.id);
        try {
            await rentAgent(agent.id);
            await loadData();
            setActiveTab('instances');
        } catch (err) {
            setActionError(getErrorMessage(err) || 'Failed to provision agent');
        } finally {
            setRentingId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-6">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="font-mono text-[10px] uppercase font-black tracking-[0.4em] text-muted-foreground animate-pulse">
                    Loading agent console…
                </p>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-10 pb-20 font-mono"
        >
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-white/5 pb-8">
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-amber-400 text-[10px] font-black uppercase tracking-[0.3em]">
                        <AlertTriangle size={12} /> Experimental
                    </div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-foreground">
                        Agent console
                    </h1>
                    <p className="text-muted-foreground text-[11px] max-w-xl opacity-70 uppercase tracking-tight leading-relaxed">
                        Registry and provisional rent only. Payment, escrow, and job EXECUTE are not live —
                        removed from Market until runtime ships.
                    </p>
                </div>

                <div className="flex items-center gap-2 bg-white/2 p-1 rounded-2xl border border-white/5">
                    <button
                        type="button"
                        onClick={() => setActiveTab('catalog')}
                        className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                            activeTab === 'catalog'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground/40 hover:text-foreground'
                        }`}
                    >
                        Catalog
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('instances')}
                        className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                            activeTab === 'instances'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground/40 hover:text-foreground'
                        }`}
                    >
                        Instances ({myAgents.length})
                    </button>
                </div>
            </div>

            <div
                className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-5 py-4 text-[11px] font-bold uppercase tracking-widest text-amber-100/90 leading-relaxed"
                role="status"
            >
                Phase C: Market agent pages redirect here. Do not treat listed prices as billable. Job
                execution fails until Docker runtime is funded.
            </div>

            {actionError && (
                <div
                    className="rounded-2xl border border-red-500/25 bg-red-500/10 px-5 py-4 text-[11px] font-bold text-red-200"
                    role="alert"
                >
                    {actionError}
                </div>
            )}

            <AnimatePresence mode="wait">
                {activeTab === 'catalog' ? (
                    <motion.div
                        key="catalog"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                    >
                        {marketAgents.length === 0 ? (
                            <div className="col-span-full text-center py-24 border border-dashed border-white/10 rounded-3xl">
                                <Bot className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
                                <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/50">
                                    No catalog agents seeded
                                </p>
                            </div>
                        ) : (
                            marketAgents.map((agent) => (
                                <GlassCard
                                    key={agent.id}
                                    className="!p-6 flex flex-col h-full hover:border-primary/30 transition-all"
                                >
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="p-3 rounded-xl bg-primary/10 text-primary border border-primary/20">
                                            <Cpu size={22} />
                                        </div>
                                        <span className="px-2 py-1 rounded-md border border-white/10 text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">
                                            {agent.category || 'agent'}
                                        </span>
                                    </div>
                                    <h3 className="text-lg font-black uppercase tracking-tight mb-2">
                                        {agent.name}
                                    </h3>
                                    <p className="text-[11px] text-muted-foreground/50 leading-relaxed mb-6 flex-1">
                                        {agent.description || 'No description'}
                                    </p>
                                    <div className="pt-4 border-t border-white/5 flex items-center justify-between gap-3">
                                        <div className="text-[10px] font-black text-primary/80 tracking-wider">
                                            {agentPriceLabel(agent)}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void handleRent(agent)}
                                            disabled={!!rentingId}
                                            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest hover:border-primary/40 disabled:opacity-50"
                                        >
                                            {rentingId === agent.id ? (
                                                <Loader2 size={14} className="animate-spin" />
                                            ) : (
                                                'Provision'
                                            )}
                                        </button>
                                    </div>
                                </GlassCard>
                            ))
                        )}
                    </motion.div>
                ) : (
                    <motion.div
                        key="instances"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="space-y-4"
                    >
                        {myAgents.length > 0 ? (
                            myAgents.map((instance) => (
                                <GlassCard
                                    key={instance.id}
                                    className="!p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 border-white/5"
                                >
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className="w-12 h-12 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center text-primary shrink-0">
                                            <Bot size={24} />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-base font-black uppercase tracking-tight truncate">
                                                {instance.agent?.name ||
                                                    instance.market_agent?.name ||
                                                    `Instance ${instance.id.slice(0, 8)}`}
                                            </h3>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 mt-1">
                                                {instance.status} ·{' '}
                                                {new Date(instance.created_at).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40 md:text-right max-w-xs">
                                        EXECUTE disabled — Docker runtime not implemented
                                    </p>
                                </GlassCard>
                            ))
                        ) : (
                            <div className="text-center py-24 border border-dashed border-white/10 rounded-3xl">
                                <Sparkles className="w-10 h-10 text-primary/30 mx-auto mb-4" />
                                <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/50 mb-6">
                                    No instances yet
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('catalog')}
                                    className="px-6 py-3 rounded-xl border border-primary/25 text-primary text-[10px] font-black uppercase tracking-widest"
                                >
                                    Open catalog
                                </button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
