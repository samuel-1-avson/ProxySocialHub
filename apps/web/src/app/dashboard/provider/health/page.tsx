'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { motion } from 'framer-motion';
import {
    ShieldCheck, RefreshCw, CheckCircle2, XCircle, AlertCircle,
    Loader2, Wifi, Server, Clock, BarChart3, Cpu, MapPin
} from 'lucide-react';
import { getMyNodes, getNodeUptime } from '@/lib/api/provider';

type CheckStatus = 'pass' | 'warn' | 'fail' | 'loading';

interface HealthCheck {
    id: string;
    label: string;
    description: string;
    status: CheckStatus;
    detail?: string;
}

function StatusIcon({ status }: { status: CheckStatus }) {
    if (status === 'loading') return <Loader2 size={16} className="animate-spin text-muted-foreground" />;
    if (status === 'pass') return <CheckCircle2 size={16} className="text-emerald-400" />;
    if (status === 'warn') return <AlertCircle size={16} className="text-amber-400" />;
    return <XCircle size={16} className="text-red-400" />;
}

function statusColor(status: CheckStatus) {
    if (status === 'pass') return 'text-emerald-400';
    if (status === 'warn') return 'text-amber-400';
    if (status === 'fail') return 'text-red-400';
    return 'text-muted-foreground';
}

function statusBg(status: CheckStatus) {
    if (status === 'pass') return 'bg-emerald-500/10 border-emerald-500/20';
    if (status === 'warn') return 'bg-amber-500/10 border-amber-500/20';
    if (status === 'fail') return 'bg-red-500/10 border-red-500/20';
    return 'bg-white/5 border-white/10';
}

export default function HealthPage() {
    const [refreshKey, setRefreshKey] = useState(0);

    const { data: nodesData, isLoading: nodesLoading } = useQuery({
        queryKey: ['my-nodes', refreshKey],
        queryFn: getMyNodes,
    });

    const nodes = nodesData?.nodes ?? [];
    const onlineNodes = nodes.filter((n) => n.status === 'online');
    const offlineNodes = nodes.filter((n) => n.status === 'offline');
    const avgUptime = nodes.length > 0
        ? nodes.reduce((s, n) => s + (n.uptime_percent ?? 0), 0) / nodes.length
        : null;
    const avgLatency = onlineNodes.length > 0
        ? onlineNodes.reduce((s, n) => s + (n.latency_ms ?? 0), 0) / onlineNodes.length
        : null;
    const avgScore = nodes.length > 0
        ? nodes.reduce((s, n) => s + (n.quality_score ?? 0), 0) / nodes.length
        : null;

    const checks: HealthCheck[] = nodesLoading
        ? [
            { id: 'nodes', label: 'Node Registration', description: 'Checking registered nodes…', status: 'loading' },
            { id: 'connectivity', label: 'Connectivity', description: 'Checking online status…', status: 'loading' },
            { id: 'uptime', label: 'Uptime', description: 'Checking uptime metrics…', status: 'loading' },
            { id: 'latency', label: 'Latency', description: 'Checking response times…', status: 'loading' },
            { id: 'score', label: 'Quality Score', description: 'Checking quality scores…', status: 'loading' },
            { id: 'location', label: 'Location Data', description: 'Checking geo information…', status: 'loading' },
        ]
        : [
            {
                id: 'nodes',
                label: 'Node Registration',
                description: 'At least one node registered',
                status: nodes.length > 0 ? 'pass' : 'fail',
                detail: nodes.length === 0
                    ? 'No nodes registered. Run the setup wizard.'
                    : `${nodes.length} node${nodes.length > 1 ? 's' : ''} registered`,
            },
            {
                id: 'connectivity',
                label: 'Connectivity',
                description: 'Nodes online and reachable',
                status: nodes.length === 0
                    ? 'fail'
                    : onlineNodes.length === nodes.length
                    ? 'pass'
                    : onlineNodes.length > 0
                    ? 'warn'
                    : 'fail',
                detail: nodes.length === 0
                    ? 'No nodes to check'
                    : `${onlineNodes.length} of ${nodes.length} online${offlineNodes.length > 0 ? ` · ${offlineNodes.length} offline` : ''}`,
            },
            {
                id: 'uptime',
                label: 'Uptime',
                description: 'Average uptime above 90%',
                status: avgUptime === null
                    ? 'fail'
                    : avgUptime >= 95
                    ? 'pass'
                    : avgUptime >= 80
                    ? 'warn'
                    : 'fail',
                detail: avgUptime !== null ? `Average uptime: ${avgUptime.toFixed(1)}%` : 'No data',
            },
            {
                id: 'latency',
                label: 'Latency',
                description: 'Average response time below 200ms',
                status: avgLatency === null
                    ? onlineNodes.length === 0 ? 'warn' : 'fail'
                    : avgLatency < 100
                    ? 'pass'
                    : avgLatency < 200
                    ? 'warn'
                    : 'fail',
                detail: avgLatency !== null
                    ? `Average latency: ${avgLatency.toFixed(0)}ms`
                    : onlineNodes.length === 0
                    ? 'No online nodes to measure'
                    : 'No latency data',
            },
            {
                id: 'score',
                label: 'Quality Score',
                description: 'Average quality score above 70',
                status: avgScore === null
                    ? 'fail'
                    : avgScore >= 80
                    ? 'pass'
                    : avgScore >= 60
                    ? 'warn'
                    : 'fail',
                detail: avgScore !== null ? `Average score: ${avgScore.toFixed(0)}/100` : 'No score data',
            },
            {
                id: 'location',
                label: 'Location Data',
                description: 'Nodes have geographic info',
                status: nodes.length === 0
                    ? 'fail'
                    : nodes.every((n) => n.country)
                    ? 'pass'
                    : nodes.some((n) => n.country)
                    ? 'warn'
                    : 'warn',
                detail: nodes.length === 0
                    ? 'No nodes'
                    : `${nodes.filter((n) => n.country).length}/${nodes.length} nodes have location data`,
            },
        ];

    const passing = checks.filter((c) => c.status === 'pass').length;
    const failing = checks.filter((c) => c.status === 'fail').length;
    const warning = checks.filter((c) => c.status === 'warn').length;
    const overall: CheckStatus = failing > 0 ? 'fail' : warning > 0 ? 'warn' : nodesLoading ? 'loading' : 'pass';

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <ShieldCheck size={14} />
                    Diagnostics
                </div>
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Node Health</h1>
                    <button
                        onClick={() => setRefreshKey((k) => k + 1)}
                        className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl font-mono text-xs transition-colors"
                    >
                        <RefreshCw size={12} />
                        Refresh
                    </button>
                </div>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    DIAGNOSTIC OVERVIEW OF YOUR PROVIDER INFRASTRUCTURE.
                </p>
            </div>

            {/* Overall status banner */}
            <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl border p-5 flex items-center gap-4 ${statusBg(overall)}`}
            >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${statusBg(overall)} border`}>
                    <StatusIcon status={overall} />
                </div>
                <div>
                    <p className={`text-lg font-black font-mono ${statusColor(overall)}`}>
                        {overall === 'loading'
                            ? 'Running checks…'
                            : overall === 'pass'
                            ? 'All systems healthy'
                            : overall === 'warn'
                            ? 'Some checks need attention'
                            : 'Critical issues detected'}
                    </p>
                    <p className="text-xs font-mono text-muted-foreground">
                        {passing} passed · {warning} warnings · {failing} failed
                    </p>
                </div>
            </motion.div>

            {/* Check list */}
            <div className="space-y-3">
                {checks.map((check, i) => (
                    <motion.div
                        key={check.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05, duration: 0.3 }}
                        className={`rounded-2xl border p-4 flex items-start gap-4 ${statusBg(check.status)}`}
                    >
                        <div className="mt-0.5">
                            <StatusIcon status={check.status} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold font-mono">{check.label}</p>
                            <p className="text-[10px] font-mono text-muted-foreground">{check.description}</p>
                            {check.detail && (
                                <p className={`text-xs font-mono mt-1 ${statusColor(check.status)}`}>{check.detail}</p>
                            )}
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Per-node details */}
            {nodes.length > 0 && (
                <GlassCard hoverEffect={false}>
                    <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                        <Server size={14} className="text-primary" />
                        Node Details
                    </h2>
                    <div className="divide-y divide-white/5">
                        {nodes.map((node) => (
                            <div key={node.id} className="py-3 flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                                        node.status === 'online' ? 'bg-emerald-500' : 'bg-red-400'
                                    }`} />
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold font-mono truncate">{node.name}</p>
                                        {node.country && (
                                            <p className="text-[9px] font-mono text-muted-foreground flex items-center gap-1">
                                                <MapPin size={8} />
                                                {node.city ? `${node.city}, ` : ''}{node.country}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground shrink-0">
                                    <div className="flex items-center gap-1">
                                        <Clock size={10} />
                                        <span>{node.uptime_percent?.toFixed(1) ?? '—'}%</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Wifi size={10} />
                                        <span>{node.latency_ms != null ? `${node.latency_ms}ms` : '—'}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <BarChart3 size={10} />
                                        <span>{node.quality_score?.toFixed(0) ?? '—'}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Cpu size={10} />
                                        <span>{node.active_connections ?? 0} conn</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </GlassCard>
            )}

            {/* Tips */}
            {failing > 0 && (
                <GlassCard hoverEffect={false}>
                    <h2 className="text-sm font-bold font-mono mb-3 flex items-center gap-2">
                        <AlertCircle size={14} className="text-amber-400" />
                        Remediation Tips
                    </h2>
                    <div className="space-y-2 text-xs font-mono text-muted-foreground">
                        {nodes.length === 0 && (
                            <p>• Run <code className="text-primary">provider-cli wizard</code> to register your first node.</p>
                        )}
                        {offlineNodes.length > 0 && (
                            <p>• {offlineNodes.length} node(s) offline — check that <code className="text-primary">provider-cli node start</code> is running.</p>
                        )}
                        {avgLatency !== null && avgLatency > 200 && (
                            <p>• High latency detected. Check your network connection or move the node closer to users.</p>
                        )}
                        {avgScore !== null && avgScore < 60 && (
                            <p>• Low quality score. Ensure stable uptime and sufficient bandwidth capacity.</p>
                        )}
                    </div>
                </GlassCard>
            )}
        </div>
    );
}
