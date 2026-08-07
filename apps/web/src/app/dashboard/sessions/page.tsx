"use client";

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createSessionIntent, getSessionIntentStatus, getSessions, listSessionIntents, remintSessionIntent, terminateSession } from '@/lib/api';
import type { CreateSessionIntentResponse, Session, SessionIntentLifecycle, SessionIntentStatusResponse } from '@/lib/api';
import {
    ExternalLink,
    Terminal,
    Globe,
    Shield,
    Loader2,
    Copy,
    Plus,
    Activity,
    Radio,
    ChevronRight,
    Lock,
    ShieldCheck,
} from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { StreamingSessionCard } from '@/components/StreamingSessionCard';
import { SessionLiveCard } from '@/components/SessionLiveCard';
import { useToast } from '@/stores';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';
import { ReviewModal } from '@/components/ReviewModal';
import { DataTable } from '@/components/patterns/DataTable';
import { ConfirmDialog } from '@/components/patterns/ConfirmDialog';
import { Modal } from '@/components/patterns/Modal';
import { StatusBadge, type StatusVariant } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { getBuyerProxyEndpoint } from '@/lib/proxy-endpoint';
import { getErrorMessage } from '@/lib/utils';

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

function lifecycleStatusVariant(state: SessionIntentLifecycle): StatusVariant {
    switch (state) {
        case 'authorized':
            return 'pending';
        case 'routed':
            return 'syncing';
        case 'active':
            return 'live';
        case 'closing':
            return 'degraded';
        case 'ledger_committed':
        case 'batched':
        case 'chain_committed':
            return 'verified';
        case 'archived':
            return 'paused';
        case 'expired':
            return 'error';
        default:
            return 'pending';
    }
}

function sessionStatusVariant(status: Session['status']): StatusVariant {
    switch (status) {
        case 'active':
            return 'online';
        case 'activation_pending':
            return 'pending';
        case 'activation_failed':
        case 'terminated':
        case 'expired':
            return 'error';
        case 'disabled':
            return 'paused';
        default:
            return 'pending';
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

function formatTTLRemaining(expiresAt: string, nowMs: number): string {
    const ms = new Date(expiresAt).getTime() - nowMs;
    if (ms <= 0) return 'expired';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export default function SessionsPage() {
    const queryClient = useQueryClient();
    const toast = useToast();

    const [creating, setCreating] = useState(false);
    const [remintingId, setRemintingId] = useState<string | null>(null);
    const [newIntent, setNewIntent] = useState<CreateSessionIntentResponse | null>(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [intentLifecycleFilter, setIntentLifecycleFilter] = useState<IntentLifecycleFilter>('all');
    const [selectedIntentId, setSelectedIntentId] = useState<string | null>(null);
    const [pendingTerminateId, setPendingTerminateId] = useState<string | null>(null);
    const [terminating, setTerminating] = useState(false);
    const [terminateError, setTerminateError] = useState<string | null>(null);
    
    // Review Modal State
    const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);

    useEffect(() => {
        if (!newIntent) return;
        const id = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [newIntent]);

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
            toast.success('Intent issued', 'Use the token within the TTL — CONNECT activates the path.');
        } catch (error) {
            console.error('Failed to create session intent:', error);
            toast.error('Intent failed', 'Could not issue a session intent. Please try again.');
        } finally {
            setCreating(false);
        }
    }

    async function handleRemint(intentId: string) {
        setRemintingId(intentId);
        try {
            const result = await remintSessionIntent(intentId);
            setNewIntent(result);
            setSelectedIntentId(result.intent.intent_id);
            await queryClient.invalidateQueries({ queryKey: ['session-intents'] });
            toast.success('Token reminted', 'Fresh JWT issued for the same intent id.');
        } catch (error) {
            console.error('Failed to remint session intent:', error);
            toast.error('Remint failed', getErrorMessage(error) || 'Could not remint this intent.');
        } finally {
            setRemintingId(null);
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
        setTerminateError(null);
        try {
            await terminateSession(pendingTerminateId);
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
            toast.success('Session terminated', 'The proxy tunnel has been closed.');
            setReviewSessionId(pendingTerminateId);
            setPendingTerminateId(null);
        } catch (error) {
            console.error('Failed to terminate session:', error);
            setTerminateError(getErrorMessage(error) || 'Could not close the session. Please try again.');
            toast.error('Termination failed', 'Could not close the session. Please try again.');
        } finally {
            setTerminating(false);
        }
    }

    const intentColumns = useMemo<ColumnDef<SessionIntentStatusResponse, unknown>[]>(
        () => [
            {
                id: 'intent',
                header: 'Intent / Trust',
                meta: { priority: 1, mono: true },
                cell: ({ row }) => {
                    const ledger = row.original.intent;
                    return (
                        <div className="min-w-0">
                            <p className="truncate font-mono text-sm font-medium">
                                {ledger.intent_id.slice(0, 12)}…
                            </p>
                            <p className="text-xs uppercase text-muted-foreground">
                                {ledger.session_type} / {ledger.trust_tier || 'unscored'}
                            </p>
                        </div>
                    );
                },
            },
            {
                id: 'lifecycle',
                header: 'Lifecycle',
                meta: { priority: 1 },
                cell: ({ row }) => (
                    <StatusBadge
                        status={lifecycleStatusVariant(row.original.lifecycle_state)}
                        label={formatLifecycleLabel(row.original.lifecycle_state)}
                        size="sm"
                    />
                ),
            },
            {
                id: 'route',
                header: 'Route',
                meta: { priority: 2, mono: true },
                cell: ({ row }) => {
                    const ledger = row.original.intent;
                    return (
                        <div>
                            <p className="text-sm">{ledger.provider_node_id || 'Awaiting provider'}</p>
                            <p className="text-xs text-muted-foreground">
                                {ledger.target_host || ledger.target_geo || 'No target bound'}
                            </p>
                        </div>
                    );
                },
            },
            {
                id: 'usage',
                header: 'Usage',
                meta: { priority: 2, mono: true, align: 'right' },
                cell: ({ row }) => {
                    const ledger = row.original.intent;
                    const totalBytes = (ledger.total_bytes_up ?? 0) + (ledger.total_bytes_down ?? 0);
                    const lastDelta = (ledger.last_bytes_up_delta ?? 0) + (ledger.last_bytes_down_delta ?? 0);
                    return (
                        <div>
                            <p className="text-sm">{formatBytes(totalBytes)}</p>
                            <p className="text-xs text-muted-foreground">
                                Δ {formatBytes(lastDelta)} / {ledger.usage_update_count ?? 0} syncs
                            </p>
                        </div>
                    );
                },
            },
            {
                id: 'time',
                header: 'Time',
                meta: { priority: 3, mono: true },
                cell: ({ row }) => (
                    <div>
                        <p className="text-sm">Issued {new Date(row.original.created_at).toLocaleDateString()}</p>
                        <p className="text-xs text-muted-foreground">
                            {describeLifecycleTimestamp(row.original)}
                        </p>
                    </div>
                ),
            },
            {
                id: 'actions',
                header: 'Actions',
                meta: { priority: 1, align: 'right' },
                enableSorting: false,
                cell: ({ row }) => {
                    const ledger = row.original.intent;
                    const canCopyToken = newIntent?.intent.intent_id === ledger.intent_id;
                    const canRemint =
                        row.original.lifecycle_state === 'authorized' ||
                        row.original.lifecycle_state === 'expired';
                    return (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant={selectedIntentId === ledger.intent_id ? 'primary' : 'outline'}
                                onClick={() => setSelectedIntentId(ledger.intent_id)}
                            >
                                Inspect
                            </Button>
                            {canCopyToken ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                        navigator.clipboard.writeText(buildIntentCommand(newIntent!));
                                        toast.success('Copied', 'Intent curl command copied.');
                                    }}
                                >
                                    Copy Curl
                                </Button>
                            ) : null}
                            {canRemint ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={remintingId === ledger.intent_id}
                                    onClick={() => void handleRemint(ledger.intent_id)}
                                >
                                    {remintingId === ledger.intent_id ? 'Reminting…' : 'Remint'}
                                </Button>
                            ) : null}
                        </div>
                    );
                },
            },
        ],
        [newIntent, remintingId, selectedIntentId, toast]
    );

    const sessionColumns = useMemo<ColumnDef<Session, unknown>[]>(
        () => [
            {
                id: 'id',
                header: 'Identifier',
                meta: { priority: 1, mono: true },
                cell: ({ row }) => (
                    <div className="min-w-0">
                        <p className="font-mono text-sm font-medium">{row.original.id.slice(0, 12)}…</p>
                        {row.original.tx_hash ? (
                            <a
                                href={`https://solscan.io/tx/${row.original.tx_hash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                                <ExternalLink size={10} aria-hidden /> On-chain
                            </a>
                        ) : null}
                    </div>
                ),
            },
            {
                accessorKey: 'type',
                header: 'Type',
                meta: { priority: 2 },
                cell: ({ row }) => <span className="capitalize">{row.original.type}</span>,
            },
            {
                accessorKey: 'status',
                header: 'Status',
                meta: { priority: 1, align: 'center' },
                cell: ({ row }) => (
                    <StatusBadge
                        status={sessionStatusVariant(row.original.status)}
                        label={row.original.status}
                        size="sm"
                    />
                ),
            },
            {
                id: 'integrity',
                header: 'Integrity',
                meta: { priority: 3, align: 'center' },
                enableSorting: false,
                cell: ({ row }) =>
                    row.original.status === 'active' ? (
                        <a
                            href={`/dashboard/trustless?session=${row.original.id}`}
                            className="inline-flex rounded-[var(--radius-md)] border border-border p-1.5 text-primary hover:bg-secondary"
                            title="View integrity proofs"
                        >
                            <ShieldCheck size={14} aria-hidden />
                        </a>
                    ) : (
                        <span className="inline-flex rounded-[var(--radius-md)] border border-border p-1.5 text-muted-foreground opacity-40">
                            <ShieldCheck size={14} aria-hidden />
                        </span>
                    ),
            },
            {
                id: 'created',
                header: 'Created',
                meta: { priority: 2, mono: true, align: 'right' },
                cell: ({ row }) => (
                    <div>
                        <p className="text-sm">{new Date(row.original.created_at).toLocaleDateString()}</p>
                        <p className="text-xs text-muted-foreground">
                            {new Date(row.original.created_at).toLocaleTimeString()}
                        </p>
                    </div>
                ),
            },
            {
                id: 'actions',
                header: 'Actions',
                meta: { priority: 1, align: 'right' },
                enableSorting: false,
                cell: ({ row }) =>
                    row.original.status === 'active' ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            onClick={() => {
                                setTerminateError(null);
                                setPendingTerminateId(row.original.id);
                            }}
                        >
                            Terminate
                        </Button>
                    ) : null,
            },
        ],
        []
    );

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
            <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-border pb-8">
                <div>
                    <div className="flex items-center gap-2 text-primary font-mono text-[10px] font-black uppercase tracking-[0.3em] mb-1">
                        <Terminal size={12} className="animate-pulse" /> Signal Node Alpha
                    </div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                        Session Ledger
                    </h1>
                </div>
                <div className="flex bg-secondary p-1.5 rounded-xl border border-border backdrop-blur-md">
                    <span className="px-4 py-2 text-[10px] font-mono font-black uppercase text-primary bg-primary/10 rounded-lg border border-primary/20">
                        {liveIntents.length + activeLegacySessions.length} Active Paths / {intents.length} Intents
                    </span>
                </div>
            </motion.div>

            <motion.div variants={itemVariants}>
                <GlassCard className="p-5 border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/5">
                    <p className="text-[10px] font-mono font-black uppercase tracking-[0.2em] text-amber-900 dark:text-amber-300">
                        Authorized ≠ active path
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                        Issuing an intent only mints a JWT (~30 min TTL). Live Pulse and Active Paths
                        update after the gateway accepts a CONNECT with that token. Remint authorized
                        or expired intents if the token was lost or expired. Usage settles to your
                        wallet when the intent closes.
                    </p>
                </GlassCard>
            </motion.div>

            {/* Real-time Session Monitor Section */}
            <motion.div variants={itemVariants} className="space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                        <Radio size={16} className="text-primary animate-pulse" /> Live Pulse Monitor
                    </h2>
                </div>
                <div className="rounded-2xl overflow-hidden border border-border shadow-2xl">
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
                            className={`group relative p-8 glass-card border-border bg-gradient-to-br ${btn.gradient} items-start text-left overflow-hidden disabled:opacity-50 transition-all hover:border-border-strong`}
                        >
                            <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 group-hover:opacity-10 transition-all duration-500">
                                <btn.icon size={120} />
                            </div>
                            <div className="relative z-10">
                                <div className="p-3 bg-muted rounded-xl border border-border w-fit mb-6 group-hover:bg-primary/20 group-hover:border-primary/40 transition-colors">
                                    <btn.icon size={24} className="text-primary" />
                                </div>
                                <h3 className="text-lg font-black font-mono uppercase text-foreground mb-2 tracking-tight group-hover:text-primary transition-colors">
                                    {btn.title}
                                </h3>
                                <p className="text-[10px] font-mono text-muted-foreground leading-relaxed uppercase font-black">
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
                    <GlassCard className="p-5 border-border bg-muted">
                        <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground">Expired Records</div>
                        <div className="mt-3 text-3xl font-mono font-black text-foreground">{expiredIntentCount}</div>
                    </GlassCard>
                    <GlassCard className="p-5 border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/5">
                        <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-amber-800 dark:text-amber-400">Ledger Throughput</div>
                        <div className="mt-3 text-3xl font-mono font-black text-amber-700 dark:text-amber-300">{formatBytes(totalIntentBytes)}</div>
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
                                    : 'border-border bg-muted text-muted-foreground hover:border-border-strong hover:text-foreground'
                            }`}
                        >
                            {filter.label} · {filter.count}
                        </button>
                    ))}
                    {selectedIntentId && (
                        <button
                            onClick={() => setSelectedIntentId(null)}
                            className="px-4 py-2 rounded-xl border border-border bg-muted text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground hover:border-border-strong hover:text-foreground transition-all"
                        >
                            Clear Focus
                        </button>
                    )}
                </div>

                {intents.length === 0 ? (
                    <GlassCard className="p-20 text-center border-dashed border-border">
                        <p className="text-[10px] font-mono font-black uppercase tracking-[0.5em] text-muted-foreground">
                            No intent ledger entries recorded yet.
                        </p>
                    </GlassCard>
                ) : (
                    <DataTable
                        columns={intentColumns}
                        data={filteredIntents}
                        emptyTitle="No matching intents"
                        emptyDescription="No intent records match the current lifecycle filter."
                        getRowId={(row) => row.intent.intent_id}
                        density="compact"
                        renderMobileCard={(intentRecord) => {
                            const ledger = intentRecord.intent;
                            const totalBytes = (ledger.total_bytes_up ?? 0) + (ledger.total_bytes_down ?? 0);
                            const canCopyToken = newIntent?.intent.intent_id === ledger.intent_id;
                            const canRemint =
                                intentRecord.lifecycle_state === 'authorized' ||
                                intentRecord.lifecycle_state === 'expired';
                            return (
                                <div className="space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="font-mono text-sm font-medium">
                                                {ledger.intent_id.slice(0, 12)}…
                                            </p>
                                            <p className="text-xs text-muted-foreground uppercase">
                                                {ledger.session_type} / {ledger.trust_tier || 'unscored'}
                                            </p>
                                        </div>
                                        <StatusBadge
                                            status={lifecycleStatusVariant(intentRecord.lifecycle_state)}
                                            label={formatLifecycleLabel(intentRecord.lifecycle_state)}
                                            size="sm"
                                        />
                                    </div>
                                    <p className="font-mono text-xs text-muted-foreground">
                                        {formatBytes(totalBytes)} · {describeLifecycleTimestamp(intentRecord)}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={selectedIntentId === ledger.intent_id ? 'primary' : 'outline'}
                                            onClick={() => setSelectedIntentId(ledger.intent_id)}
                                        >
                                            Inspect
                                        </Button>
                                        {canCopyToken ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(buildIntentCommand(newIntent!));
                                                    toast.success('Copied', 'Intent curl command copied.');
                                                }}
                                            >
                                                Copy Curl
                                            </Button>
                                        ) : null}
                                        {canRemint ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={remintingId === ledger.intent_id}
                                                onClick={() => void handleRemint(ledger.intent_id)}
                                            >
                                                {remintingId === ledger.intent_id ? 'Reminting…' : 'Remint'}
                                            </Button>
                                        ) : null}
                                    </div>
                                </div>
                            );
                        }}
                    />
                )}

                {selectedIntent && (
                    <GlassCard className="p-8 border-primary/20 bg-primary/5">
                        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                            <div>
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.25em] text-primary/70">Intent Focus</div>
                                <h3 className="mt-2 text-2xl font-black font-mono uppercase tracking-tight text-foreground">
                                    {selectedIntent.intent.intent_id.slice(0, 16)}...
                                </h3>
                                <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
                                    {selectedIntent.intent.session_type} / {formatLifecycleLabel(selectedIntent.lifecycle_state)} / {selectedIntent.billing_snapshot.price_source}
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                {selectedIntentLoading && (
                                    <span className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-primary/70">
                                        Refreshing...
                                    </span>
                                )}
                                {(selectedIntent.lifecycle_state === 'authorized' ||
                                    selectedIntent.lifecycle_state === 'expired') && (
                                    <button
                                        onClick={() => void handleRemint(selectedIntent.intent.intent_id)}
                                        disabled={remintingId === selectedIntent.intent.intent_id}
                                        className="px-4 py-2 rounded-xl border border-primary/30 bg-primary/10 text-[9px] font-mono font-black uppercase tracking-[0.2em] text-primary hover:border-primary/50 transition-all disabled:opacity-50"
                                    >
                                        {remintingId === selectedIntent.intent.intent_id
                                            ? 'Reminting…'
                                            : 'Remint token'}
                                    </button>
                                )}
                                <button
                                    onClick={() => setSelectedIntentId(null)}
                                    className="px-4 py-2 rounded-xl border border-border bg-muted text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground hover:border-border-strong hover:text-foreground transition-all"
                                >
                                    Close Focus
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 mt-8">
                            <GlassCard className="p-5 border-border bg-muted">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground">Route</div>
                                <div className="mt-3 text-[11px] font-black uppercase text-foreground break-all">
                                    {selectedIntent.intent.provider_node_id || 'Awaiting provider'}
                                </div>
                                <div className="mt-2 text-[9px] font-black uppercase text-muted-foreground">
                                    {selectedIntent.intent.target_host || selectedIntent.intent.target_geo || 'No host bound'}
                                </div>
                            </GlassCard>
                            <GlassCard className="p-5 border-border bg-muted">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground">Usage</div>
                                <div className="mt-3 text-[11px] font-black uppercase text-foreground">
                                    {formatBytes(selectedIntent.usage_snapshot.total_bytes)} total
                                </div>
                                <div className="mt-2 text-[9px] font-black uppercase text-muted-foreground">
                                    Up {formatBytes(selectedIntent.usage_snapshot.total_bytes_up)} / Down {formatBytes(selectedIntent.usage_snapshot.total_bytes_down)}
                                </div>
                                <div className="mt-2 text-[9px] font-black uppercase text-muted-foreground">
                                    Remaining {selectedIntent.usage_snapshot.unlimited ? 'unlimited' : formatBytes(selectedIntent.usage_snapshot.bytes_remaining)}
                                </div>
                            </GlassCard>
                            <GlassCard className="p-5 border-border bg-muted">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground">Billing</div>
                                <div className="mt-3 text-[11px] font-black uppercase text-foreground">
                                    {formatSOL(selectedIntent.billing_snapshot.estimated_cost_sol)} est.
                                </div>
                                <div className="mt-2 text-[9px] font-black uppercase text-muted-foreground">
                                    {formatSOL(selectedIntent.billing_snapshot.unit_price_sol_per_gb)} / GB
                                </div>
                                <div className="mt-2 text-[9px] font-black uppercase text-muted-foreground">
                                    Wallet settle on close
                                </div>
                            </GlassCard>
                            <GlassCard className="p-5 border-border bg-muted">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground">Timing</div>
                                <div className="mt-4 grid grid-cols-2 gap-3 text-[10px] font-mono font-black uppercase">
                                    <div className="text-muted-foreground">Issued</div>
                                    <div className="text-right text-foreground">{new Date(selectedIntent.created_at).toLocaleTimeString()}</div>
                                    <div className="text-muted-foreground">Routed</div>
                                    <div className="text-right text-foreground">{selectedIntent.routed_at ? new Date(selectedIntent.routed_at).toLocaleTimeString() : '—'}</div>
                                    <div className="text-muted-foreground">Active</div>
                                    <div className="text-right text-foreground">{selectedIntent.activated_at ? new Date(selectedIntent.activated_at).toLocaleTimeString() : '—'}</div>
                                    <div className="text-muted-foreground">Closing</div>
                                    <div className="text-right text-foreground">{selectedIntent.closing_at ? new Date(selectedIntent.closing_at).toLocaleTimeString() : '—'}</div>
                                    <div className="text-muted-foreground">Ledger</div>
                                    <div className="text-right text-foreground">{selectedIntent.ledger_committed_at ? new Date(selectedIntent.ledger_committed_at).toLocaleTimeString() : '—'}</div>
                                    <div className="text-muted-foreground">Expiry</div>
                                    <div className="text-right text-foreground">{selectedIntent.expired_at ? new Date(selectedIntent.expired_at).toLocaleTimeString() : new Date(selectedIntent.expires_at).toLocaleTimeString()}</div>
                                </div>
                            </GlassCard>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                            <GlassCard className="p-5 border-border bg-muted">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground">Usage Snapshot</div>
                                <div className="mt-4 grid grid-cols-2 gap-3 text-[10px] font-mono font-black uppercase">
                                    <div className="text-muted-foreground">Percent Used</div>
                                    <div className="text-right text-foreground">{selectedIntent.usage_snapshot.unlimited ? 'unlimited' : `${selectedIntent.usage_snapshot.percent_used.toFixed(1)}%`}</div>
                                    <div className="text-muted-foreground">Last Delta</div>
                                    <div className="text-right text-foreground">{formatBytes(selectedIntent.usage_snapshot.last_bytes_up_delta + selectedIntent.usage_snapshot.last_bytes_down_delta)}</div>
                                    <div className="text-muted-foreground">Meter Syncs</div>
                                    <div className="text-right text-foreground">{selectedIntent.intent.usage_update_count ?? 0}</div>
                                    <div className="text-muted-foreground">Routing Profile</div>
                                    <div className="text-right text-foreground">{selectedIntent.intent.routing_profile || 'default'}</div>
                                </div>
                            </GlassCard>
                            <GlassCard className="p-5 border-border bg-muted">
                                <div className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground">Billing Snapshot</div>
                                <div className="mt-4 grid grid-cols-2 gap-3 text-[10px] font-mono font-black uppercase">
                                    <div className="text-muted-foreground">Price Source</div>
                                    <div className="text-right text-foreground">{selectedIntent.billing_snapshot.price_source}</div>
                                    <div className="text-muted-foreground">Projected Limit</div>
                                    <div className="text-right text-foreground">{formatSOL(selectedIntent.billing_snapshot.projected_full_limit_cost_sol)}</div>
                                    <div className="text-muted-foreground">Requested ISP</div>
                                    <div className="text-right text-foreground">{selectedIntent.intent.target_isp || 'any'} <span className="text-muted-foreground normal-case font-medium">(best-effort)</span></div>
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
                    <span className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground">
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
                    <GlassCard className="p-20 text-center border-dashed border-border">
                        <p className="text-[10px] font-mono font-black uppercase tracking-[0.5em] text-muted-foreground">
                            No legacy session records detected.
                        </p>
                    </GlassCard>
                ) : (
                    <DataTable
                        columns={sessionColumns}
                        data={sessions}
                        emptyTitle="No sessions"
                        emptyDescription="No legacy session records detected."
                        getRowId={(row) => row.id}
                        density="compact"
                        className="mt-12"
                        renderMobileCard={(session) => (
                            <div className="space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="font-mono text-sm font-medium">{session.id.slice(0, 12)}…</p>
                                        <p className="text-xs capitalize text-muted-foreground">{session.type}</p>
                                    </div>
                                    <StatusBadge
                                        status={sessionStatusVariant(session.status)}
                                        label={session.status}
                                        size="sm"
                                    />
                                </div>
                                <p className="font-mono text-xs text-muted-foreground">
                                    {new Date(session.created_at).toLocaleString()}
                                </p>
                                {session.status === 'active' ? (
                                    <div className="flex flex-wrap gap-2">
                                        <a
                                            href={`/dashboard/trustless?session=${session.id}`}
                                            className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] border border-border px-3 text-xs font-medium hover:bg-secondary"
                                        >
                                            <ShieldCheck size={12} aria-hidden /> Integrity
                                        </a>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="danger"
                                            onClick={() => {
                                                setTerminateError(null);
                                                setPendingTerminateId(session.id);
                                            }}
                                        >
                                            Terminate
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    />
                )}
            </motion.div>

            <Modal
                open={!!newIntent}
                onOpenChange={(open) => {
                    if (!open) setNewIntent(null);
                }}
                title="Intent issued"
                description="Use this token now — CONNECT activates the path. Remint if it expires."
                footer={
                    newIntent ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    navigator.clipboard.writeText(buildIntentCommand(newIntent));
                                    toast.success('System Sync', 'Intent curl command copied.');
                                }}
                            >
                                <Copy size={14} className="mr-2" aria-hidden />
                                Copy curl
                            </Button>
                            <Button type="button" onClick={() => setNewIntent(null)}>
                                Acknowledged
                            </Button>
                        </>
                    ) : null
                }
            >
                {newIntent ? (
                    <div className="space-y-4 rounded-[var(--radius-md)] border border-border bg-secondary/50 p-4 font-mono text-xs">
                        <div className="space-y-1">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                TTL remaining
                            </p>
                            <p className="text-primary font-black">
                                {formatTTLRemaining(newIntent.expires_at, nowMs)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                                Token stays authorized until gateway CONNECT. Then it becomes an active path.
                            </p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                Endpoint
                            </p>
                            <p className="break-all text-foreground">{PROXY_ENDPOINT}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                Intent ID
                            </p>
                            <p className="break-all text-primary">{newIntent.intent.intent_id}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                Token
                            </p>
                            <div className="flex items-start justify-between gap-2">
                                <p className="line-clamp-2 break-all text-foreground">{newIntent.token}</p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(newIntent.token);
                                        toast.success('Copied', 'Intent token copied.');
                                    }}
                                    className="shrink-0 text-primary hover:text-foreground"
                                    aria-label="Copy token"
                                >
                                    <Copy size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </Modal>

            <ConfirmDialog
                open={!!pendingTerminateId}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingTerminateId(null);
                        setTerminateError(null);
                    }
                }}
                title="Terminate session"
                description="Close this proxy tunnel? Active connections will drop immediately."
                confirmLabel="Terminate"
                cancelLabel="Keep session"
                destructive
                loading={terminating}
                error={terminateError ?? undefined}
                onConfirm={() => void confirmTerminate()}
            />
            
            <ReviewModal 
                isOpen={!!reviewSessionId} 
                onClose={() => setReviewSessionId(null)} 
                sessionId={reviewSessionId || ""} 
            />
        </motion.div>
    );
}
