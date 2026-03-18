'use client';

import React, { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { GlassCard } from '@/components/ui/glass-card';
import { getNodeDetail } from '@/lib/services/explorer';
import type { NodeDetail } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    ArrowLeft, Server, CheckCircle, XCircle, Shield, Cloud,
    MapPin, Cpu, Zap, Activity, BarChart2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';

const containerVariants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemVariants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

// Metrics to compare — each row in the side-by-side table
const METRICS: { label: string; key: keyof NodeDetail; format: (v: any) => string; highlight?: 'higher_better' | 'lower_better' }[] = [
    { label: 'Uptime', key: 'uptime_percent', format: v => `${(v ?? 0).toFixed(2)}%`, highlight: 'higher_better' },
    { label: 'Latency', key: 'latency_ms', format: v => `${v ?? 0} ms`, highlight: 'lower_better' },
    { label: 'Quality Score', key: 'quality_score', format: v => (v ?? 0).toFixed(1), highlight: 'higher_better' },
    { label: 'Success Rate', key: 'success_rate', format: v => `${((v ?? 0) * 100).toFixed(1)}%`, highlight: 'higher_better' },
    { label: 'Active Sessions', key: 'active_sessions', format: v => String(v ?? 0), highlight: 'higher_better' },
    { label: 'Total Sessions', key: 'total_sessions', format: v => (v ?? 0).toLocaleString(), highlight: 'higher_better' },
    { label: 'Bandwidth', key: 'bandwidth_gb', format: v => `${(v ?? 0).toFixed(2)} GB`, highlight: 'higher_better' },
    { label: 'Region', key: 'region', format: v => v || '—' },
    { label: 'Country', key: 'country', format: v => v || '—' },
    { label: 'Version', key: 'version', format: v => v || '—' },
    { label: 'Stake', key: 'stake_amount', format: v => v ? `${(v as number).toFixed(2)} SOL` : '—', highlight: 'higher_better' },
    { label: 'Commission', key: 'commission_rate', format: v => v ? `${((v as number) * 100).toFixed(1)}%` : '—', highlight: 'lower_better' },
];

const COLUMN_COLORS = ['text-primary', 'text-cyan-400', 'text-purple-400'];
const COLUMN_BORDERS = ['border-primary/20', 'border-cyan-400/20', 'border-purple-400/20'];
const COLUMN_BG = ['bg-primary/[0.03]', 'bg-cyan-400/[0.03]', 'bg-purple-400/[0.03]'];

function getBestIndex(nodes: (NodeDetail | null)[], key: keyof NodeDetail, direction: 'higher_better' | 'lower_better'): number {
    const values = nodes.map(n => (n ? Number(n[key]) : NaN));
    let bestIdx = -1;
    let bestVal = direction === 'higher_better' ? -Infinity : Infinity;
    for (let i = 0; i < values.length; i++) {
        if (isNaN(values[i])) continue;
        if (direction === 'higher_better' ? values[i] > bestVal : values[i] < bestVal) {
            bestVal = values[i];
            bestIdx = i;
        }
    }
    return bestIdx;
}

function NodeColumn({ node, idx, isLoading }: { node: NodeDetail | null; idx: number; isLoading: boolean }) {
    const color = COLUMN_COLORS[idx];
    const border = COLUMN_BORDERS[idx];
    const bg = COLUMN_BG[idx];

    if (isLoading) {
        return (
            <div className={`rounded-[2rem] border ${border} ${bg} p-6 animate-pulse`}>
                <div className="h-4 bg-white/5 rounded mb-3 w-3/4" />
                <div className="h-3 bg-white/5 rounded w-1/2" />
            </div>
        );
    }

    if (!node) {
        return (
            <div className={`rounded-[2rem] border border-rose-500/20 bg-rose-500/[0.03] p-6 text-center`}>
                <XCircle size={24} className="text-rose-500/40 mx-auto mb-2" />
                <p className="text-[9px] font-black text-rose-400 uppercase tracking-widest">Node not found</p>
            </div>
        );
    }

    return (
        <div className={`rounded-[2rem] border ${border} ${bg} p-6 space-y-4`}>
            {/* Node header */}
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className={`text-[9px] font-black uppercase tracking-widest mb-1 ${color}`}>Node {idx + 1}</div>
                    <Link href={`/explorer/nodes/${node.node_id}`}
                        className={`font-mono text-[11px] font-black ${color} hover:opacity-80 transition-opacity break-all`}>
                        {node.node_id?.slice(0, 16)}...
                    </Link>
                    {node.name && <div className="text-[9px] text-white/30 mt-0.5">{node.name}</div>}
                </div>
                <div className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${node.is_active ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            </div>
            {/* Type badge */}
            <div>
                {node.is_validator ? (
                    <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-purple-400 bg-purple-400/10 px-3 py-1.5 rounded-lg uppercase tracking-wider">
                        <Shield size={9} /> Validator
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-blue-400 bg-blue-400/10 px-3 py-1.5 rounded-lg uppercase tracking-wider">
                        <Cloud size={9} /> Proxy Node
                    </span>
                )}
            </div>
            {/* Location */}
            <div className="flex items-center gap-2 text-[10px] text-white/40">
                <MapPin size={10} />
                {[node.city, node.country, node.region].filter(Boolean).join(', ') || '—'}
            </div>
            {/* Last heartbeat */}
            <div className="text-[8px] font-black text-white/20 uppercase tracking-wider">
                {node.last_heartbeat
                    ? `Last seen ${formatDistanceToNow(new Date(node.last_heartbeat), { addSuffix: true })}`
                    : 'No heartbeat'}
            </div>
            <Link href={`/explorer/nodes/${node.node_id}`}
                className={`block w-full text-center py-2 rounded-xl border ${border} ${color} text-[9px] font-black uppercase tracking-widest hover:opacity-80 transition-opacity`}>
                Full Details →
            </Link>
        </div>
    );
}

function CompareContent() {
    const searchParams = useSearchParams();
    const idsParam = searchParams.get('ids') || '';
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);

    const queries = [
        useQuery({ queryKey: ['node-detail', ids[0]], queryFn: () => getNodeDetail(ids[0]!), enabled: !!ids[0], retry: false }),
        useQuery({ queryKey: ['node-detail', ids[1]], queryFn: () => getNodeDetail(ids[1]!), enabled: !!ids[1], retry: false }),
        useQuery({ queryKey: ['node-detail', ids[2]], queryFn: () => getNodeDetail(ids[2]!), enabled: !!ids[2], retry: false }),
    ];

    const nodes: (NodeDetail | null)[] = ids.map((_, i) => queries[i]?.data ?? null);
    const loadings = ids.map((_, i) => queries[i]?.isLoading ?? false);
    const isAnyLoading = loadings.some(Boolean);

    if (ids.length === 0) {
        return (
            <div className="py-24 text-center">
                <Server size={48} className="text-white/10 mx-auto mb-4" />
                <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">No nodes selected</p>
                <p className="text-[9px] text-white/10 mb-6">Select 2–3 nodes from the node list to compare them here.</p>
                <Link href="/explorer/nodes" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-primary text-[9px] font-black uppercase tracking-widest hover:bg-primary/20 transition-all">
                    ← Back to Nodes
                </Link>
            </div>
        );
    }

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-8 font-mono">
            {/* Header */}
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-white/5 pb-8">
                <Link href="/explorer/nodes" className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary transition-colors uppercase tracking-[0.3em] w-fit">
                    <ArrowLeft size={14} /> Back to Nodes
                </Link>
                <div>
                    <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // Nodes</div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-4">
                        <BarChart2 className="text-primary" size={32} /> Node Comparison
                    </h1>
                    <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mt-2">
                        Side-by-side performance analysis for {ids.length} node{ids.length > 1 ? 's' : ''}
                    </p>
                </div>
            </motion.header>

            {/* Node header cards */}
            <motion.section variants={itemVariants}
                className={`grid gap-4 ${ids.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'}`}>
                {ids.map((_, i) => (
                    <NodeColumn key={i} node={nodes[i]} idx={i} isLoading={loadings[i]} />
                ))}
            </motion.section>

            {/* Metric comparison table */}
            {!isAnyLoading && nodes.some(Boolean) && (
                <motion.section variants={itemVariants}>
                    <GlassCard className="overflow-hidden border-white/5 bg-white/[0.01] rounded-[2rem]">
                        <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
                            <Activity size={14} className="text-primary" />
                            <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">Metric Comparison</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="bg-white/5 text-white/40 text-[9px] uppercase tracking-[0.2em] font-black">
                                        <th className="px-6 py-3 text-left w-40">Metric</th>
                                        {ids.map((_, i) => (
                                            <th key={i} className={`px-6 py-3 text-right ${COLUMN_COLORS[i]}`}>
                                                Node {i + 1}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.04]">
                                    {METRICS.map(metric => {
                                        const bestIdx = metric.highlight
                                            ? getBestIndex(nodes, metric.key, metric.highlight)
                                            : -1;
                                        return (
                                            <tr key={metric.key} className="hover:bg-white/[0.02] transition-colors">
                                                <td className="px-6 py-3">
                                                    <span className="text-[9px] font-black text-white/40 uppercase tracking-wider">{metric.label}</span>
                                                </td>
                                                {ids.map((_, i) => {
                                                    const node = nodes[i];
                                                    const val = node ? metric.format(node[metric.key]) : '—';
                                                    const isBest = bestIdx === i && nodes.filter(Boolean).length > 1;
                                                    return (
                                                        <td key={i} className="px-6 py-3 text-right">
                                                            <span className={`font-mono text-[11px] font-black ${isBest ? COLUMN_COLORS[i] : 'text-white/60'}`}>
                                                                {val}
                                                            </span>
                                                            {isBest && (
                                                                <span className={`ml-1.5 text-[7px] font-black uppercase ${COLUMN_COLORS[i]} opacity-70`}>
                                                                    ▲ best
                                                                </span>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </GlassCard>
                </motion.section>
            )}
        </motion.div>
    );
}

export default function ComparePage() {
    return (
        <Suspense fallback={
            <div className="py-24 text-center">
                <div className="text-[10px] font-black text-white/20 uppercase tracking-widest animate-pulse">Loading comparison...</div>
            </div>
        }>
            <CompareContent />
        </Suspense>
    );
}
