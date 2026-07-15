"use client";

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createSessionIntent, getSessionIntentStatus, getSessions, listSessionIntents, terminateSession } from '@/lib/api';
import type { CreateSessionIntentResponse, SessionIntentLifecycle, SessionIntentStatusResponse } from '@/lib/api';
import { 
    ExternalLink, 
    Terminal, 
    Globe, 
    Shield, 
    Loader2, 
    Copy, 
    Trash2, 
    Plus, 
    Clock, 
    Activity, 
    Radio, 
    AlertTriangle, 
    X, 
    Zap,
    ChevronRight,
    Lock,
    ShieldCheck
} from 'lucide-react';
import { StreamingSessionCard } from '@/components/StreamingSessionCard';
import { SessionLiveCard } from '@/components/SessionLiveCard';
import { useToast } from '@/stores';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';
import { ReviewModal } from '@/components/ReviewModal';

import { getBuyerProxyEndpoint } from '@/lib/proxy-endpoint';

const PROXY_ENDPOINT = getBuyerProxyEndpoint();

type IntentLifecycleFilter = 'all' | SessionIntentLifecycle;

const lifecycleOrder: SessionIntentLifecycle[] = [
    'authorized',
    'routed',
    'active',
    'closing',
    'ledger_committed',
    'batched',
    'chain_committed',
    'archived',
    'expired',
];

const defaultLifecycleFilters = new Set<SessionIntentLifecycle>([
    'authorized',
    'routed',
    'active',
    'closing',
    'ledger_committed',
    'expired',
]);

const liveLifecycleStates = new Set<SessionIntentLifecycle>(['routed', 'active', 'closing']);
const completedLifecycleStates = new Set<SessionIntentLifecycle>(['ledger_committed', 'batched', 'chain_committed', 'archived']);

function formatLifecycleLabel(state: SessionIntentLifecycle) {
    return state.replace(/_/g, ' ');
}

function getLifecycleBadgeClass(state: SessionIntentLifecycle) {
    switch (state) {
        case 'authorized':
            return 'bg-primary/10 text-primary border-primary/20';
        case 'routed':
            return 'bg-sky-500/10 text-sky-300 border-sky-500/20';
        case 'active':
            return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
        case 'closing':
            return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
        case 'ledger_committed':
            return 'bg-blue-500/10 text-blue-300 border-blue-500/20';
        case 'batched':
            return 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20';
        case 'chain_committed':
            return 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20';
        case 'archived':
            return 'bg-slate-500/10 text-slate-300 border-slate-500/20';
        default:
            return 'bg-white/5 text-muted-foreground border-white/10';
    }
}

function describeLifecycleTimestamp(intent: SessionIntentStatusResponse) {
    if (intent.archived_at) {
        return `Archived ${new Date(intent.archived_at).toLocaleTimeString()}`;
    }
    if (intent.chain_committed_at) {
        return `Chain ${new Date(intent.chain_committed_at).toLocaleTimeString()}`;
    }
    if (intent.batched_at) {
        return `Batched ${new Date(intent.batched_at).toLocaleTimeString()}`;
    }
    if (intent.ledger_committed_at) {
        return `Ledger ${new Date(intent.ledger_committed_at).toLocaleTimeString()}`;
    }
    if (intent.closing_at) {
        return `Closing ${new Date(intent.closing_at).toLocaleTimeString()}`;
    }
    if (intent.activated_at) {
        return `Active ${new Date(intent.activated_at).toLocaleTimeString()}`;
    }
    if (intent.routed_at) {
        return `Routed ${new Date(intent.routed_at).toLocaleTimeString()}`;
    }
    if (intent.last_metered_at) {
        return `Metered ${new Date(intent.last_metered_at).toLocaleTimeString()}`;
    }
    return `Expires ${new Date(intent.expires_at).toLocaleTimeString()}`;
}

export default function SessionsPage() {
    const queryClient = useQueryClient();
    const toast = useToast();

    const [creating, setCreating] = useState(false);
    const [newIntent, setNewIntent] = useState<CreateSessionIntentResponse | null>(null);
    const [intentLifecycleFilter, setIntentLifecycleFilter] = useState<IntentLifecycleFilter>('all');
    const [selectedIntentId, setSelectedIntentId] = useState<string | null>(null);
    const [pendingTerminateId, setPendingTerminateId] = useState<string | null>(null);
    const [terminating, setTerminating] = useState(false);
    
    // Review Modal State
    const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);

    const { data: sessions = [], isLoading: loading } = useQuery({
        queryKey: ['sessions'],
        queryFn: getSessions,
        refetchInterval: 10000,
        retry: 2,
    });

    const { data: intents = [], isLoading: intentsLoading } = useQuery({
        queryKey: ['session-intents'],
        queryFn: listSessionIntents,
        refetchInterval: 5000,
        retry: 2,
    });

    const { data: selectedIntentDetail, isLoading: selectedIntentLoading } = useQuery({
        queryKey: ['session-intent-detail', selectedIntentId],
        queryFn: () => getSessionIntentStatus(selectedIntentId!),
        enabled: !!selectedIntentId,
        refetchInterval: selectedIntentId ? 5000 : false,
        retry: 1,
    });

    async function handleCreateSession(type: 'rotating' | 'sticky') {
        setCreating(true);
        try {
            const result = await createSessionIntent({ type });
            setNewIntent(result);
            setSelectedIntentId(result.intent.intent_id);
            await queryClient.invalidateQueries({ queryKey: ['session-intents'] });
            toast.success('Intent issued', 'A signed proxy admission token is ready to use.');
        } catch (error) {
            console.error('Failed to create session intent:', error);
            toast.error('Intent failed', 'Could not issue a session intent. Please try again.');
        } finally {
            setCreating(false);
        }
    }

    function formatBytes(value?: number) {
        const bytes = value ?? 0;
        if (bytes <= 0) {
            return '0 B';
        }
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let unitIndex = 0;
        let scaled = bytes;
        while (scaled >= 1024 && unitIndex < units.length - 1) {
            scaled /= 1024;
            unitIndex += 1;
        }
        const precision = scaled >= 100 || unitIndex === 0 ? 0 : 1;
        return `${scaled.toFixed(precision)} ${units[unitIndex]}`;
    }

    function formatSOL(value?: number) {
        const resolved = value ?? 0;
        return `${resolved.toFixed(resolved >= 1 ? 3 : 6)} SOL`;
    }

    function buildIntentCommand(intent: CreateSessionIntentResponse) {
        return `curl -x session-intent:${encodeURIComponent(intent.token)}@${PROXY_ENDPOINT} https://httpbin.org/ip`;
    }

    async function confirmTerminate() {
        if (!pendingTerminateId) return;
        setTerminating(true);
        try {
            await terminateSession(pendingTerminateId);
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
            toast.success('Session terminated', 'The proxy tunnel has been closed.');
            setReviewSessionId(pendingTerminateId);
        } catch (error) {
            console.error('Failed to terminate session:', error);
            toast.error('Termination failed', 'Could not close the session. Please try again.');
        } finally {
            setTerminating(false);
            setPendingTerminateId(null);
        }
    }

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    if (loading || intentsLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground animate-pulse">Scanning Active Tunnels...</p>
            </div>
        );
    }

    const activeLegacySessions = sessions.filter(s => s.status === 'active');
    const lifecycleCounts = lifecycleOrder.reduce((counts, state) => {
        counts[state] = intents.filter((intent) => intent.lifecycle_state === state).length;
        return counts;
    }, {} as Record<SessionIntentLifecycle, number>);
    const liveIntents = intents.filter((intent) => liveLifecycleStates.has(intent.lifecycle_state));
    const authorizedIntentCount = lifecycleCounts.authorized;
    const completedIntentCount = intents.filter((intent) => completedLifecycleStates.has(intent.lifecycle_state)).length;
    const expiredIntentCount = lifecycleCounts.expired;
    const visibleLifecycleFilters = lifecycleOrder.filter((state) => defaultLifecycleFilters.has(state) || lifecycleCounts[state] > 0);
    const filteredIntents = intentLifecycleFilter === 'all'
        ? intents
        : intents.filter((intent) => intent.lifecycle_state === intentLifecycleFilter);
    const selectedIntent = selectedIntentDetail ?? intents.find((intent) => intent.intent.intent_id === selectedIntentId) ?? null;
    const totalIntentBytes = intents.reduce((sum, intent) => {
        return sum + (intent.intent.total_bytes_up ?? 0) + (intent.intent.total_bytes_down ?? 0);
    }, 0);
    const totalEstimatedIntentCostSOL = intents.reduce((sum, intent) => {
        return sum + (intent.billing_snapshot?.estimated_cost_sol ?? 0);
    }, 0);

    return (
        <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-12 pb-20"
        >
            {/* Header Section */}
            <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-white/5 pb-8">
                <div>
                    <div className="flex items-center gap-2 text-primary font-mono text-[10px] font-black uppercase tracking-[0.3em] mb-1">
                        <Terminal size={12} className="animate-pulse" /> Signal Node Alpha
                    </div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                        Session Ledger
                    </h1>
                </div>
                <div className="flex bg-white/5 p-1.5 rounded-xl border border-white/10 backdrop-blur-md">
                    <span className="px-4 py-2 text-[10px] font-mono font-black uppercase text-primary bg-primary/10 rounded-lg border border-primary/20">
                        {liveIntents.length + activeLegacySessions.length} Active Paths / {intents.length} Intents
                    </span>
                </div>
            </motion.div>

            {/* Real-time Session Monitor Section */}
            <motion.div variants={itemVariants} className="space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                        <Radio size={16} className="text-primary animate-pulse" /> Live Pulse Monitor
                    </h2>
                </div>
                <div className="rounded-2xl overflow-hidden border border-white/5 shadow-2xl">
                    <SessionLiveCard />
                </div>
            </motion.div>

            {/* Create Session Section */}
            <motion.div variants={itemVariants} className="space-y-6">
                <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                    <Plus size={16} className="text-primary" /> Issue New Intent
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[
                        { 
                            type: 'rotating' as const, 
                            title: 'Rotating Segment', 
                            desc: 'Mint a signed rotating intent token for short-lived gateway admission and fast route churn.', 
                            icon: Globe,
                            gradient: "from-primary/20 to-emerald-500/20"
                        },
                        { 
                            type: 'sticky' as const, 
                            title: 'Sticky Node', 
                            desc: 'Mint a signed sticky intent token for persistent routing with provider and target-host ledger tracking.', 
                            icon: Shield,
                            gradient: "from-blue-500/20 to-purple-500/20"
                        }
                    ].map((btn) => (
                        <motion.button
                            key={btn.type}
                            whileHover={{ y: -5, scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleCreateSession(btn.type)}
                            disabled={creating}
                            className={`group relative p-8 glass-card border-white/5 bg-gradient-to-br ${btn.gradient} items-start text-left overflow-hidden disabled:opacity-50 transition-all hover:border-white/20`}
                        >
                            <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 group-hover:opacity-10 transition-all duration-500">
                                <btn.icon size={120} />
                            </div>
                            <div className="relative z-10">
                                <div className="p-3 bg-white/5 rounded-xl border border-white/10 w-fit mb-6 group-hover:bg-primary/20 group-hover:border-primary/40 transition-colors">
                                    <btn.icon size={24} className="text-primary" />
                                </div>
                                <h3 className="text-lg font-black font-mono uppercase text-foreground mb-2 tracking-tight group-hover:text-primary transition-colors">
                                    {btn.title}
                                </h3>
                                <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed uppercase font-black">
                                    {btn.desc}
                                </p>
                                <div className="mt-8 flex items-center gap-2 text-[9px] font-mono font-black text-primary uppercase tracking-[0.2em]">
                                    {creating ? 'Signing...' : 'Issue Intent'} <ChevronRight size={12} />
                                </div>
                            </div>
                        </motion.button>
                    ))}
                </div>
            </motion.div>

            {/* Intent Ledger Section */}
            <motion.div variants={itemVariants} className="space-y-6">
                <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                    <Lock size={16} className="text-primary" /> Intent Ledger
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
                    <GlassCard className="p-5 border-emerald-500/20 bg-emerald-500/5">
                        <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-emerald-500/70">Live Intents</div>
                        <div className="mt-3 text-3xl font-mono font-black text-emerald-400">{liveIntents.length}</div>
                    </GlassCard>
                    <GlassCard className="p-5 border-primary/20 bg-primary/5">
                        <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-primary/70">Authorized Queue</div>
                        <div className="mt-3 text-3xl font-mono font-black text-primary">{authorizedIntentCount}</div>
                    </GlassCard>
                    <GlassCard className="p-5 border-blue-500/20 bg-blue-500/5">
                        <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-blue-300/70">Ledger Finalized</div>
                        <div className="mt-3 text-3xl font-mono font-black text-blue-300">{completedIntentCount}</div>
                    </GlassCard>
                    <GlassCard className="p-5 border-white/10 bg-white/5">
                        <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/60">Expired Records</div>
                        <div className="mt-3 text-3xl font-mono font-black text-foreground">{expiredIntentCount}</div>
                    </GlassCard>
                    <GlassCard className="p-5 border-amber-500/20 bg-amber-500/5">
                        <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-amber-400/70">Ledger Throughput</div>
                        <div className="mt-3 text-3xl font-mono font-black text-amber-300">{formatBytes(totalIntentBytes)}</div>
                    </GlassCard>
                    <GlassCard className="p-5 border-sky-500/20 bg-sky-500/5">
                        <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-sky-400/70">Estimated Spend</div>
                        <div className="mt-3 text-3xl font-mono font-black text-sky-300">{formatSOL(totalEstimatedIntentCostSOL)}</div>
                    </GlassCard>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {[
                        { id: 'all', label: 'All', count: intents.length },
                        ...visibleLifecycleFilters.map((state) => ({
                            id: state,
                            label: formatLifecycleLabel(state),
                            count: lifecycleCounts[state],
                        })),
                    ].map((filter) => (
                        <button
                            key={filter.id}
                            onClick={() => setIntentLifecycleFilter(filter.id as IntentLifecycleFilter)}
                            className={`px-4 py-2 rounded-xl border text-[9px] font-mono font-black uppercase tracking-[0.2em] transition-all ${
                                intentLifecycleFilter === filter.id
                                    ? 'border-primary/40 bg-primary/15 text-primary'
                                    : 'border-white/10 bg-white/5 text-muted-foreground/60 hover:border-white/20 hover:text-foreground'
                            }`}
                        >
                            {filter.label} · {filter.count}
                        </button>
                    ))}
                    {selectedIntentId && (
                        <button
                            onClick={() => setSelectedIntentId(null)}
                            className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/60 hover:border-white/20 hover:text-foreground transition-all"
                        >
                            Clear Focus
                        </button>
                    )}
                </div>

                {intents.length === 0 ? (
                    <GlassCard className="p-20 text-center border-dashed border-white/10 opacity-50">
                        <p className="text-[10px] font-mono font-black uppercase tracking-[0.5em] text-muted-foreground">
                            No intent ledger entries recorded yet.
                        </p>
                    </GlassCard>
                ) : (
                    <div className="overflow-hidden glass-card border-white/5 bg-white/2 rounded-2xl">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="text-[9px] font-black uppercase text-muted-foreground/30 border-b border-white/5 bg-white/5">
                                    <tr>
                                        <th className="px-8 py-5 tracking-widest">Intent / Trust</th>
                                        <th className="px-8 py-5 tracking-widest">Lifecycle</th>
                                        <th className="px-8 py-5 tracking-widest">Route Ledger</th>
                                        <th className="px-8 py-5 tracking-widest">Usage Ledger</th>
                                        <th className="px-8 py-5 tracking-widest">Time Ledger</th>
                                        <th className="px-8 py-5 tracking-widest text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/2">
                                    {filteredIntents.map((intentRecord: SessionIntentStatusResponse) => {
                                        const ledger = intentRecord.intent;
                                        const totalBytes = (ledger.total_bytes_up ?? 0) + (ledger.total_bytes_down ?? 0);
                                        const lastDelta = (ledger.last_bytes_up_delta ?? 0) + (ledger.last_bytes_down_delta ?? 0);
                                        const canCopyToken = newIntent?.intent.intent_id === ledger.intent_id;
                                        return (
                                        <motion.tr
                                            key={ledger.intent_id}
                                            layout
                                            className={`hover:bg-white/5 transition-colors group ${selectedIntentId === ledger.intent_id ? 'bg-primary/5' : ''}`}
                                        >
                                            <td className="px-8 py-5">
                                                <div className="font-black uppercase text-[11px] group-hover:text-primary transition-colors">
                                                    {ledger.intent_id.slice(0, 12)}...
                                                </div>
                                                <div className="text-[8px] text-muted-foreground/50 uppercase tracking-widest mt-1 font-black">
                                                    {ledger.session_type} / {ledger.trust_tier || 'unscored'}
                                                </div>
                                            </td>
                                            <td className="px-8 py-5">
                                                <span className={`px-3 py-1 rounded-full text-[9px] font-black border uppercase tracking-widest inline-block ${getLifecycleBadgeClass(intentRecord.lifecycle_state)}`}>
                                                    {formatLifecycleLabel(intentRecord.lifecycle_state)}
                                                </span>
                                            </td>
                                            <td className="px-8 py-5">
                                                <div className="text-[10px] font-black uppercase text-foreground">
                                                    {ledger.provider_node_id || 'Awaiting provider'}
                                                </div>
                                                <div className="text-[9px] text-muted-foreground/40 uppercase font-black mt-1">
                                                    {ledger.target_host || ledger.target_geo || 'No target bound'}
                                                </div>
                                            </td>
                                            <td className="px-8 py-5">
                                                <div className="text-[10px] font-black uppercase text-foreground">{formatBytes(totalBytes)}</div>
                                                <div className="text-[9px] text-muted-foreground/40 uppercase font-black mt-1">
                                                    Delta {formatBytes(lastDelta)} / {ledger.usage_update_count ?? 0} syncs
                                                </div>
                                            </td>
                                            <td className="px-8 py-5">
                                                <div className="text-[10px] font-black opacity-50 uppercase">Issued {new Date(intentRecord.created_at).toLocaleDateString()}</div>
                                                <div className="text-[9px] opacity-30 uppercase font-black mt-1">
                                                    {describeLifecycleTimestamp(intentRecord)}
                                                </div>
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => setSelectedIntentId(ledger.intent_id)}
                                                        className={`px-3 py-2 text-[9px] font-black uppercase rounded-md transition-colors ${
                                                            selectedIntentId === ledger.intent_id
                                                                ? 'bg-primary text-primary-foreground'
                                                                : 'bg-white/5 text-foreground hover:bg-white/10'
                                                        }`}
                                                    >
                                                        Inspect
                                                    </button>
                                                    {canCopyToken ? (
                                                        <button
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(buildIntentCommand(newIntent!));
                                                                toast.success('Copied', 'Intent curl command copied.');
                                                            }}
                                                            className="px-3 py-2 text-[9px] font-black uppercase bg-primary/10 text-primary rounded-md hover:bg-primary/20 transition-colors"
                                                        >
                                                            Copy Curl
                                                        </button>
                                                    ) : (
                                                        <span className="text-[9px] font-black uppercase text-muted-foreground/40">
                                                            Token not retained
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </motion.tr>
                                        )})}
                                    {filteredIntents.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-8 py-10 text-center text-[10px] font-mono font-black uppercase tracking-[0.3em] text-muted-foreground/40">
                                                No intent records match the current lifecycle filter.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {selectedIntent && (
                    <GlassCard className="p-8 border-primary/20 bg-primary/5">
                        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                            <div>
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.25em] text-primary/70">Intent Focus</div>
                                <h3 className="mt-2 text-2xl font-black font-mono uppercase tracking-tight text-foreground">
                                    {selectedIntent.intent.intent_id.slice(0, 16)}...
                                </h3>
                                <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60">
                                    {selectedIntent.intent.session_type} / {formatLifecycleLabel(selectedIntent.lifecycle_state)} / {selectedIntent.billing_snapshot.price_source}
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                {selectedIntentLoading && (
                                    <span className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-primary/70">
                                        Refreshing...
                                    </span>
                                )}
                                <button
                                    onClick={() => setSelectedIntentId(null)}
                                    className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/60 hover:border-white/20 hover:text-foreground transition-all"
                                >
                                    Close Focus
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 mt-8">
                            <GlassCard className="p-5 border-white/10 bg-black/20">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/50">Route</div>
                                <div className="mt-3 text-[11px] font-black uppercase text-foreground break-all">
                                    {selectedIntent.intent.provider_node_id || 'Awaiting provider'}
                                </div>
                                <div className="mt-2 text-[9px] font-black uppercase text-muted-foreground/40">
                                    {selectedIntent.intent.target_host || selectedIntent.intent.target_geo || 'No host bound'}
                                </div>
                            </GlassCard>
                            <GlassCard className="p-5 border-white/10 bg-black/20">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/50">Usage</div>
                                <div className="mt-3 text-[11px] font-black uppercase text-foreground">
                                    {formatBytes(selectedIntent.usage_snapshot.total_bytes)} total
                                </div>
                                <div className="mt-2 text-[9px] font-black uppercase text-muted-foreground/40">
                                    Up {formatBytes(selectedIntent.usage_snapshot.total_bytes_up)} / Down {formatBytes(selectedIntent.usage_snapshot.total_bytes_down)}
                                </div>
                                <div className="mt-2 text-[9px] font-black uppercase text-muted-foreground/40">
                                    Remaining {selectedIntent.usage_snapshot.unlimited ? 'unlimited' : formatBytes(selectedIntent.usage_snapshot.bytes_remaining)}
                                </div>
                            </GlassCard>
                            <GlassCard className="p-5 border-white/10 bg-black/20">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/50">Billing</div>
                                <div className="mt-3 text-[11px] font-black uppercase text-foreground">
                                    {formatSOL(selectedIntent.billing_snapshot.estimated_cost_sol)} est.
                                </div>
                                <div className="mt-2 text-[9px] font-black uppercase text-muted-foreground/40">
                                    {formatSOL(selectedIntent.billing_snapshot.unit_price_sol_per_gb)} / GB
                                </div>
                                <div className="mt-2 text-[9px] font-black uppercase text-muted-foreground/40">
                                    Native SOL settlement
                                </div>
                            </GlassCard>
                            <GlassCard className="p-5 border-white/10 bg-black/20">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/50">Timing</div>
                                <div className="mt-4 grid grid-cols-2 gap-3 text-[10px] font-mono font-black uppercase">
                                    <div className="text-muted-foreground/70">Issued</div>
                                    <div className="text-right text-foreground">{new Date(selectedIntent.created_at).toLocaleTimeString()}</div>
                                    <div className="text-muted-foreground/70">Routed</div>
                                    <div className="text-right text-foreground">{selectedIntent.routed_at ? new Date(selectedIntent.routed_at).toLocaleTimeString() : '—'}</div>
                                    <div className="text-muted-foreground/70">Active</div>
                                    <div className="text-right text-foreground">{selectedIntent.activated_at ? new Date(selectedIntent.activated_at).toLocaleTimeString() : '—'}</div>
                                    <div className="text-muted-foreground/70">Closing</div>
                                    <div className="text-right text-foreground">{selectedIntent.closing_at ? new Date(selectedIntent.closing_at).toLocaleTimeString() : '—'}</div>
                                    <div className="text-muted-foreground/70">Ledger</div>
                                    <div className="text-right text-foreground">{selectedIntent.ledger_committed_at ? new Date(selectedIntent.ledger_committed_at).toLocaleTimeString() : '—'}</div>
                                    <div className="text-muted-foreground/70">Expiry</div>
                                    <div className="text-right text-foreground">{selectedIntent.expired_at ? new Date(selectedIntent.expired_at).toLocaleTimeString() : new Date(selectedIntent.expires_at).toLocaleTimeString()}</div>
                                </div>
                            </GlassCard>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                            <GlassCard className="p-5 border-white/10 bg-black/20">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/50">Usage Snapshot</div>
                                <div className="mt-4 grid grid-cols-2 gap-3 text-[10px] font-mono font-black uppercase">
                                    <div className="text-muted-foreground/70">Percent Used</div>
                                    <div className="text-right text-foreground">{selectedIntent.usage_snapshot.unlimited ? 'unlimited' : `${selectedIntent.usage_snapshot.percent_used.toFixed(1)}%`}</div>
                                    <div className="text-muted-foreground/70">Last Delta</div>
                                    <div className="text-right text-foreground">{formatBytes(selectedIntent.usage_snapshot.last_bytes_up_delta + selectedIntent.usage_snapshot.last_bytes_down_delta)}</div>
                                    <div className="text-muted-foreground/70">Meter Syncs</div>
                                    <div className="text-right text-foreground">{selectedIntent.intent.usage_update_count ?? 0}</div>
                                    <div className="text-muted-foreground/70">Routing Profile</div>
                                    <div className="text-right text-foreground">{selectedIntent.intent.routing_profile || 'default'}</div>
                                </div>
                            </GlassCard>
                            <GlassCard className="p-5 border-white/10 bg-black/20">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/50">Billing Snapshot</div>
                                <div className="mt-4 grid grid-cols-2 gap-3 text-[10px] font-mono font-black uppercase">
                                    <div className="text-muted-foreground/70">Price Source</div>
                                    <div className="text-right text-foreground">{selectedIntent.billing_snapshot.price_source}</div>
                                    <div className="text-muted-foreground/70">Projected Limit</div>
                                    <div className="text-right text-foreground">{formatSOL(selectedIntent.billing_snapshot.projected_full_limit_cost_sol)}</div>
                                    <div className="text-muted-foreground/70">Target ISP</div>
                                    <div className="text-right text-foreground">{selectedIntent.intent.target_isp || 'any'}</div>
                                </div>
                            </GlassCard>
                        </div>
                    </GlassCard>
                )}
            </motion.div>

            {/* Legacy Sessions Section */}
            <motion.div variants={itemVariants} className="space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                        <Activity size={16} className="text-primary" /> Legacy Session Compatibility
                    </h2>
                    <span className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/40">
                        Transitional surface while dashboards move to intent-native views
                    </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                    <AnimatePresence mode="popLayout">
                        {activeLegacySessions.map((session) => (
                            <motion.div
                                key={session.id}
                                layout
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                            >
                                <StreamingSessionCard
                                    session={session}
                                    onTerminate={(id) => setPendingTerminateId(id)}
                                />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>

                {sessions.length === 0 ? (
                    <GlassCard className="p-20 text-center border-dashed border-white/10 opacity-50">
                        <p className="text-[10px] font-mono font-black uppercase tracking-[0.5em] text-muted-foreground">
                            No legacy session records detected.
                        </p>
                    </GlassCard>
                ) : (
                    <div className="overflow-hidden glass-card border-white/5 bg-white/2 rounded-2xl mt-12">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="text-[9px] font-black uppercase text-muted-foreground/30 border-b border-white/5 bg-white/5">
                                    <tr>
                                        <th className="px-8 py-5 tracking-widest">Identifier / Logic</th>
                                        <th className="px-8 py-5 tracking-widest">Protocol Type</th>
                                        <th className="px-8 py-5 tracking-widest text-center">Status</th>
                                        <th className="px-8 py-5 tracking-widest text-center">Integrity</th>
                                        <th className="px-8 py-5 tracking-widest text-right">Synchronization</th>
                                        <th className="px-8 py-5 tracking-widest text-right">Operations</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/2">
                                    {sessions.map((session) => (
                                        <motion.tr
                                            key={session.id}
                                            layout
                                            className={`hover:bg-white/5 transition-colors group ${pendingTerminateId === session.id ? 'bg-rose-500/5' : ''}`}
                                        >
                                            <td className="px-8 py-5">
                                                <div className="font-black uppercase text-[11px] group-hover:text-primary transition-colors">
                                                    {session.id.slice(0, 12)}...
                                                </div>
                                                {session.tx_hash && (
                                                    <a
                                                        href={`https://solscan.io/tx/${session.tx_hash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-1 text-[8px] text-primary hover:underline font-black uppercase tracking-widest mt-1"
                                                    >
                                                        <ExternalLink size={10} /> On-chain Segment
                                                    </a>
                                                )}
                                            </td>
                                            <td className="px-8 py-5 font-black uppercase opacity-60">
                                                {session.type} Tunnel
                                            </td>
                                            <td className="px-8 py-5 text-center">
                                                <span className={`px-3 py-1 rounded-full text-[9px] font-black border uppercase tracking-widest inline-block ${
                                                    session.status === 'active' 
                                                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]' 
                                                        : 'bg-white/5 text-muted-foreground border-white/10'
                                                }`}>
                                                    {session.status}
                                                </span>
                                            </td>
                                            <td className="px-8 py-5 text-center">
                                                <div className="flex justify-center">
                                                    <a 
                                                        href={`/dashboard/trustless?session=${session.id}`}
                                                        className={`p-1.5 rounded-lg border transition-all ${
                                                            session.status === 'active' 
                                                                ? 'bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20' 
                                                                : 'bg-white/5 border-white/10 text-muted-foreground opacity-30 pointer-events-none'
                                                        }`}
                                                        title="View Integrity Proofs"
                                                    >
                                                        <ShieldCheck size={14} />
                                                    </a>
                                                </div>
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <div className="text-[10px] font-black opacity-40 uppercase">{new Date(session.created_at).toLocaleDateString()}</div>
                                                <div className="text-[9px] opacity-20 uppercase font-black">{new Date(session.created_at).toLocaleTimeString()}</div>
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                {session.status === 'active' && (
                                                    pendingTerminateId === session.id ? (
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button 
                                                                onClick={confirmTerminate}
                                                                className="px-3 py-1 text-[9px] font-black uppercase bg-rose-500 text-white rounded-md hover:bg-rose-600 transition-colors shadow-lg"
                                                            >
                                                                {terminating ? '...' : 'Confirm'}
                                                            </button>
                                                            <button 
                                                                onClick={() => setPendingTerminateId(null)}
                                                                className="px-3 py-1 text-[9px] font-black uppercase bg-white/5 text-muted-foreground rounded-md hover:bg-white/10 transition-colors"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setPendingTerminateId(session.id)}
                                                            className="p-2 text-muted-foreground hover:text-rose-500 transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )
                                                )}
                                            </td>
                                        </motion.tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </motion.div>

            {/* New Intent Modal Overlay */}
            <AnimatePresence>
                {newIntent && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-50 p-4"
                    >
                        <motion.div 
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                        >
                            <GlassCard className="w-full max-w-md p-10 border-primary shadow-[0_0_50px_rgba(34,197,94,0.15)] animate-glow">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-3 bg-primary/20 rounded-2xl border border-primary/40">
                                        <Zap size={24} className="text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black font-mono uppercase text-primary tracking-tighter">Intent Issued</h3>
                                        <p className="text-[9px] font-mono uppercase text-muted-foreground tracking-widest">Signed gateway admission token ready</p>
                                    </div>
                                </div>

                                <div className="space-y-4 bg-black/40 border border-white/5 rounded-2xl p-6 font-mono text-xs my-8">
                                    <div className="space-y-1">
                                        <label className="text-muted-foreground text-[9px] font-black uppercase tracking-widest opacity-40">Endpoint</label>
                                        <p className="text-foreground break-all font-black">{PROXY_ENDPOINT}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-muted-foreground text-[9px] font-black uppercase tracking-widest opacity-40">Intent ID</label>
                                        <p className="text-primary break-all font-black">{newIntent.intent.intent_id}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-muted-foreground text-[9px] font-black uppercase tracking-widest opacity-40">Token</label>
                                        <div className="flex justify-between items-center group/pass">
                                            <p className="text-foreground break-all font-black tracking-widest line-clamp-2">{newIntent.token}</p>
                                            <button 
                                                onClick={() => {
                                                    navigator.clipboard.writeText(newIntent.token);
                                                    toast.success('Copied', 'Intent token copied.');
                                                }}
                                                className="text-primary hover:text-white transition-colors"
                                            >
                                                <Copy size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-4">
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(buildIntentCommand(newIntent));
                                            toast.success('System Sync', 'Intent curl command copied.');
                                        }}
                                        className="flex-1 py-4 bg-white/5 border border-white/10 rounded-xl text-[10px] font-mono font-black uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-2 group"
                                    >
                                        <Copy size={14} className="group-hover:text-primary transition-colors" /> COPY CURL
                                    </button>
                                    <button
                                        onClick={() => setNewIntent(null)}
                                        className="flex-1 py-4 bg-primary text-primary-foreground rounded-xl text-[10px] font-mono font-black uppercase tracking-widest hover:opacity-90 transition-all shadow-xl shadow-primary/20"
                                    >
                                        ACKNOWLEDGED
                                    </button>
                                </div>
                            </GlassCard>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            
            <ReviewModal 
                isOpen={!!reviewSessionId} 
                onClose={() => setReviewSessionId(null)} 
                sessionId={reviewSessionId || ""} 
            />
        </motion.div>
    );
}
