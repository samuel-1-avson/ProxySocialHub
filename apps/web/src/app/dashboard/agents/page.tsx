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
                `Provision ${agent.name}? This is experimental. No wallet charge and jobs cannot run until Docker execution ships.`,
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
                <p className="font-mono text-xs font-semibold text-muted-foreground animate-pulse">
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
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-border pb-8">
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-warning text-xs font-semibold">
                        <AlertTriangle size={12} /> Experimental
                    </div>
                    <h1 className="text-4xl font-semibold tracking-tight text-foreground">
                        Agent console
                    </h1>
                    <p className="text-muted-foreground text-xs max-w-xl opacity-70 tracking-tight leading-relaxed">
                        Registry and provisional rent only. Payment, escrow, and job EXECUTE are not live.
                        Removed from Market until runtime ships.
                    </p>
                </div>

                <div className="flex items-center gap-2 bg-secondary p-1 rounded-lg border border-border">
                    <button
                        type="button"
                        onClick={() => setActiveTab('catalog')}
                        className={`px-5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
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
                        className={`px-5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
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
                className="rounded-lg border border-warning/25 bg-warning/10 px-5 py-4 text-xs font-bold text-warning/90 leading-relaxed"
                role="status"
            >
                Phase C: Market agent pages redirect here. Do not treat listed prices as billable. Job
                execution fails until Docker runtime is funded.
            </div>

            {actionError && (
                <div
                    className="rounded-lg border border-destructive/25 bg-destructive/10 px-5 py-4 text-xs font-bold text-destructive"
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
                            <div className="col-span-full text-center py-24 border border-dashed border-border rounded-lg">
                                <Bot className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
                                <p className="text-xs font-semibold text-muted-foreground/50">
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
                                        <div className="p-3 rounded-lg bg-primary/10 text-primary border border-primary/20">
                                            <Cpu size={22} />
                                        </div>
                                        <span className="px-2 py-1 rounded-md border border-border text-xs font-semibold text-muted-foreground/60">
                                            {agent.category || 'agent'}
                                        </span>
                                    </div>
                                    <h3 className="text-lg font-semibold tracking-tight mb-2">
                                        {agent.name}
                                    </h3>
                                    <p className="text-xs text-muted-foreground/50 leading-relaxed mb-6 flex-1">
                                        {agent.description || 'No description'}
                                    </p>
                                    <div className="pt-4 border-t border-border flex items-center justify-between gap-3">
                                        <div className="text-xs font-semibold text-primary/80">
                                            {agentPriceLabel(agent)}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void handleRent(agent)}
                                            disabled={!!rentingId}
                                            className="px-4 py-2 rounded-lg bg-secondary border border-border text-xs font-semibold hover:border-primary/40 disabled:opacity-50"
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
                                    className="!p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 border-border"
                                >
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className="w-12 h-12 rounded-lg bg-secondary border border-border flex items-center justify-center text-primary shrink-0">
                                            <Bot size={24} />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-base font-semibold tracking-tight truncate">
                                                {instance.agent?.name ||
                                                    instance.market_agent?.name ||
                                                    `Instance ${instance.id.slice(0, 8)}`}
                                            </h3>
                                            <p className="text-xs font-semibold text-muted-foreground/50 mt-1">
                                                {instance.status} ·{' '}
                                                {new Date(instance.created_at).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                    <p className="text-xs font-bold text-muted-foreground/40 md:text-right max-w-xs">
                                        EXECUTE disabled: Docker runtime not implemented
                                    </p>
                                </GlassCard>
                            ))
                        ) : (
                            <div className="text-center py-24 border border-dashed border-border rounded-lg">
                                <Sparkles className="w-10 h-10 text-primary/30 mx-auto mb-4" />
                                <p className="text-xs font-semibold text-muted-foreground/50 mb-6">
                                    No instances yet
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('catalog')}
                                    className="px-6 py-3 rounded-lg border border-primary/25 text-primary text-xs font-semibold"
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
