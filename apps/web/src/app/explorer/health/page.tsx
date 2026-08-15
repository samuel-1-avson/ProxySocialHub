'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import {
    getNetworkHealth,
    getHealthHistory,
    getExplorerMetrics,
    type ExplorerMetrics,
    type HealthHistoryResponse,
    type NetworkHealth,
} from '@/lib/services/explorer';
import Link from 'next/link';
import {
    ArrowLeft, Activity, CheckCircle, AlertTriangle, XCircle,
    Database, Server, Clock, Wifi, TrendingUp, History,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, ReferenceLine,
} from 'recharts';
import { format, formatDistanceToNow } from 'date-fns';
import { MetricsUnavailableBanner } from '@/components/explorer/MetricsUnavailableBanner';

function StatusIndicator({ status }: { status: string }) {
    if (status === 'healthy') return (
        <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
            <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Healthy</span>
        </div>
    );
    if (status === 'degraded') return (
        <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-yellow-400 inline-block" />
            <span className="text-[10px] font-black text-yellow-400 uppercase tracking-widest">Degraded</span>
        </div>
    );
    return (
        <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-rose-500 inline-block" />
            <span className="text-[10px] font-black text-rose-400 uppercase tracking-widest">Down</span>
        </div>
    );
}

function SubsystemCard({ label, status, icon: Icon, detail }: { label: string; status: string; icon: any; detail?: string }) {
    const isHealthy = status === 'healthy';
    const isDegraded = status === 'degraded' || status === 'unavailable';
    const borderColor = isHealthy ? 'border-emerald-500/20' : isDegraded ? 'border-yellow-400/20' : 'border-rose-500/20';
    const bgColor = isHealthy ? 'bg-emerald-500/[0.03]' : isDegraded ? 'bg-yellow-400/[0.03]' : 'bg-rose-500/[0.03]';
    const iconColor = isHealthy ? 'text-emerald-400' : isDegraded ? 'text-yellow-400' : 'text-rose-400';
    const StatusIcon = isHealthy ? CheckCircle : isDegraded ? AlertTriangle : XCircle;

    return (
        <GlassCard className={`!p-5 border rounded-[1.5rem] ${borderColor} ${bgColor}`}>
            <div className="flex items-start justify-between mb-4">
                <Icon size={18} className={`${iconColor} opacity-60`} />
                <StatusIcon size={14} className={iconColor} />
            </div>
            <div className="text-sm font-black text-foreground uppercase tracking-tighter">{label}</div>
            {detail && <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mt-1">{detail}</div>}
            <div className={`text-[9px] font-black uppercase tracking-widest mt-3 ${iconColor}`}>{status}</div>
        </GlassCard>
    );
}

// Response-time health thresholds (ms). Change these to match your SLO targets.
const RESPONSE_HEALTHY_MS = 200;
const RESPONSE_DEGRADED_MS = 500;

const containerVariants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemVariants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

export default function HealthPage() {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    const { data: health, isLoading: loadingHealth } = useQuery<NetworkHealth>({
        queryKey: ['network-health'],
        queryFn: ({ signal }) => getNetworkHealth(signal),
        refetchInterval: 15000,
        retry: false,
    });

    const { data: historyData, isLoading: loadingHistory } = useQuery<HealthHistoryResponse>({
        queryKey: ['health-history'],
        queryFn: ({ signal }) => getHealthHistory('24h', signal),
        refetchInterval: 60000,
        retry: false,
    });

    const { data: metrics } = useQuery<ExplorerMetrics>({
        queryKey: ['explorer-metrics-health'],
        queryFn: ({ signal }) => getExplorerMetrics('all', signal),
        refetchInterval: 30000,
        retry: false,
    });

    const history = (historyData?.history ?? []).map((p: any) => ({
        t: (() => { try { return format(new Date(p.timestamp), 'HH:mm'); } catch { return p.timestamp; } })(),
        nodes: p.active_nodes,
        response: p.avg_response_ms,
        healthy: p.status === 'healthy' ? 1 : 0,
    }));
    const healthEvents = historyData?.events ?? [];

    const uptime24h = historyData?.uptime_percent ?? null;

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-8 font-mono">
            {/* Header */}
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-border pb-8">
                <Link href="/explorer" className="flex items-center gap-2 text-[10px] font-black text-muted-foreground hover:text-primary transition-colors uppercase tracking-[0.3em] w-fit">
                    <ArrowLeft size={14} /> Back to Grid
                </Link>
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
                    <div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // Health</div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-foreground flex items-center gap-4">
                            <Activity className="text-primary" size={32} /> Network Health
                        </h1>
                        <p className="text-[11px] font-black text-muted-foreground uppercase tracking-widest mt-2">
                            Real-time subsystem status and historical uptime
                        </p>
                    </div>
                    {health && (
                        <div className="flex flex-col items-end gap-2">
                            <StatusIndicator status={health.status} />
                            <span className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">
                                Last checked {formatDistanceToNow(new Date(health.last_checked), { addSuffix: true })}
                            </span>
                        </div>
                    )}
                </div>
            </motion.header>

            {historyData && historyData.metrics_available === false && (
                <motion.div variants={itemVariants}>
                    <MetricsUnavailableBanner message={historyData.message} />
                </motion.div>
            )}

            {/* Uptime Banner */}
            {uptime24h !== null && (
                <motion.section variants={itemVariants}>
                    <div className={`rounded-[2rem] border px-8 py-5 flex items-center justify-between ${uptime24h >= 99 ? 'border-emerald-500/20 bg-emerald-500/[0.03]' : uptime24h >= 95 ? 'border-yellow-400/20 bg-yellow-400/[0.03]' : 'border-rose-500/20 bg-rose-500/[0.03]'}`}>
                        <div className="flex items-center gap-4">
                            <TrendingUp size={20} className={uptime24h >= 99 ? 'text-emerald-400' : uptime24h >= 95 ? 'text-yellow-400' : 'text-rose-400'} />
                            <div>
                                <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">24h Network Uptime</div>
                                <div className={`text-3xl font-black tracking-tighter ${uptime24h >= 99 ? 'text-emerald-400' : uptime24h >= 95 ? 'text-yellow-400' : 'text-rose-400'}`}>
                                    {uptime24h.toFixed(2)}%
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Active Nodes</div>
                            <div className="text-2xl font-black text-foreground">{health?.active_nodes ?? metrics?.active_nodes ?? '—'}</div>
                        </div>
                    </div>
                </motion.section>
            )}

            {/* Subsystem Status */}
            <motion.section variants={itemVariants} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SubsystemCard label="Solana RPC" status={health?.solana_health || 'unknown'} icon={Wifi}
                    detail={health?.solana_health === 'healthy' ? 'Mainnet connected' : 'Check RPC endpoint'} />
                <SubsystemCard label="Database" status={health?.database_health || 'unknown'} icon={Database}
                    detail="PostgreSQL" />
                <SubsystemCard label="Relay Nodes" status={(health?.active_nodes ?? 0) > 0 ? 'healthy' : 'degraded'} icon={Server}
                    detail={`${health?.active_nodes ?? 0} online`} />
                <SubsystemCard label="Response Time" status={(health?.avg_response_time_ms ?? Infinity) < RESPONSE_HEALTHY_MS ? 'healthy' : (health?.avg_response_time_ms ?? Infinity) < RESPONSE_DEGRADED_MS ? 'degraded' : 'down'} icon={Clock}
                    detail={health ? `${health.avg_response_time_ms.toFixed(0)}ms avg` : 'N/A'} />
            </motion.section>

            {/* Charts */}
            {loadingHistory ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {[0, 1].map(i => <div key={i} className="h-56 animate-pulse bg-card border border-border rounded-[2rem]" />)}
                </div>
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {/* Active Nodes History */}
                    <motion.section variants={itemVariants}>
                        <GlassCard className="border-border bg-card rounded-[2rem] !p-6">
                            <h3 className="text-sm font-black uppercase tracking-tighter text-foreground mb-5 flex items-center gap-2">
                                <Server size={14} className="text-primary" /> Active Nodes — 24h
                            </h3>
                            {mounted && history.length > 0 ? (
                                <ResponsiveContainer width="100%" height={160} minWidth={0} minHeight={0}>
                                    <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                        <defs>
                                            <linearGradient id="nodesGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                                        <XAxis dataKey="t" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                                        <YAxis tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                                        <Tooltip contentStyle={{ background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontFamily: 'monospace', fontSize: 10 }} />
                                        <Area type="monotone" dataKey="nodes" name="Active Nodes" stroke="#6366f1" strokeWidth={2} fill="url(#nodesGrad)" dot={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-[160px] flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl">
                                    <History size={24} className="text-muted-foreground mb-2" />
                                    <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest text-center px-4">
                                        {historyData?.message || 'No history data yet'}
                                    </p>
                                </div>
                            )}
                        </GlassCard>
                    </motion.section>

                    {/* Response Time History */}
                    <motion.section variants={itemVariants}>
                        <GlassCard className="border-border bg-card rounded-[2rem] !p-6">
                            <h3 className="text-sm font-black uppercase tracking-tighter text-foreground mb-5 flex items-center gap-2">
                                <Clock size={14} className="text-yellow-400" /> Response Time — 24h
                            </h3>
                            {mounted && history.length > 0 ? (
                                <ResponsiveContainer width="100%" height={160} minWidth={0} minHeight={0}>
                                    <LineChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                                        <XAxis dataKey="t" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                                        <YAxis tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                                        <Tooltip contentStyle={{ background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontFamily: 'monospace', fontSize: 10 }}
                                            formatter={(v: any) => [`${v}ms`, 'Response']} />
                                        <ReferenceLine y={RESPONSE_HEALTHY_MS} stroke="rgba(234,179,8,0.3)" strokeDasharray="4 4" />
                                        <Line type="monotone" dataKey="response" name="Response" stroke="#eab308" strokeWidth={1.5} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-[160px] flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl">
                                    <History size={24} className="text-muted-foreground mb-2" />
                                    <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest text-center px-4">
                                        {historyData?.message || 'No history data yet'}
                                    </p>
                                </div>
                            )}
                        </GlassCard>
                    </motion.section>
                </div>
            )}

            {/* Health Event Log */}
            <motion.section variants={itemVariants} className="space-y-4">
                <h2 className="text-sm font-black uppercase tracking-tighter text-foreground flex items-center gap-2">
                    <History size={14} className="text-primary" /> Health Event Log
                </h2>
                <GlassCard className="overflow-hidden border-border bg-card rounded-[2rem]">
                    {healthEvents.length > 0 ? (
                        <div className="divide-y divide-border">
                            {healthEvents.map((ev: any, i: number) => (
                                <div key={i} className="flex items-center gap-4 px-6 py-4">
                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ev.status === 'healthy' ? 'bg-emerald-500' : ev.status === 'degraded' ? 'bg-yellow-400' : 'bg-rose-500'}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] font-black text-foreground">{ev.message || ev.status}</div>
                                        <div className="text-[8px] text-muted-foreground mt-0.5">{ev.subsystem || 'Network'}</div>
                                    </div>
                                    <div className="text-[8px] font-black text-muted-foreground uppercase tracking-wider flex-shrink-0">
                                        {ev.timestamp ? (() => { try { return formatDistanceToNow(new Date(ev.timestamp), { addSuffix: true }); } catch { return '—'; } })() : '—'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="py-16 text-center">
                            <CheckCircle size={40} className="text-emerald-400/20 mx-auto mb-4" />
                            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">No incidents recorded</p>
                            <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest mt-2">All systems nominal</p>
                        </div>
                    )}
                </GlassCard>
            </motion.section>
        </motion.div>
    );
}
