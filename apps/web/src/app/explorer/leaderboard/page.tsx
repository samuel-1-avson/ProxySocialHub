'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { getNodes, getLeaderboard } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    ArrowLeft, Trophy, Shield, Cloud, Activity, Zap, Server,
    Star, Medal, TrendingUp, ChevronRight, Globe, Cpu,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

const CATEGORIES = [
    { label: 'Uptime', value: 'uptime', icon: Activity, color: '#10b981', unit: '%' },
    { label: 'Bandwidth', value: 'bandwidth', icon: Zap, color: '#eab308', unit: ' GB' },
    { label: 'Sessions', value: 'sessions', icon: Server, color: '#6366f1', unit: '' },
];

const PERIODS = [
    { label: '1H', value: '1h' },
    { label: '24H', value: '24h' },
    { label: '7D', value: '7d' },
    { label: '30D', value: '30d' },
];

function RankBadge({ rank }: { rank: number }) {
    if (rank === 1) return (
        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-yellow-400/10 border border-yellow-400/20">
            <Trophy size={14} className="text-yellow-400" />
        </div>
    );
    if (rank === 2) return (
        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-slate-300/10 border border-slate-300/20">
            <Medal size={14} className="text-slate-300" />
        </div>
    );
    if (rank === 3) return (
        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-amber-700/10 border border-amber-700/20">
            <Medal size={14} className="text-amber-600" />
        </div>
    );
    return (
        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-white/[0.02] border border-white/5">
            <span className="text-[9px] font-black text-white/30">#{rank}</span>
        </div>
    );
}

function UptimeBar({ value }: { value: number }) {
    const color = value >= 99 ? '#10b981' : value >= 95 ? '#eab308' : '#ef4444';
    return (
        <div className="flex items-center gap-2 w-full">
            <div className="flex-1 bg-white/[0.05] rounded-full h-1.5 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
            </div>
            <span className="text-[9px] font-black w-10 text-right" style={{ color }}>{value.toFixed(1)}%</span>
        </div>
    );
}

const containerVariants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemVariants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

export default function LeaderboardPage() {
    const searchParams = useSearchParams();
    const [category, setCategory] = useState('uptime');
    const [period, setPeriod] = useState('24h');
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        const cat = searchParams.get('category');
        if (cat && CATEGORIES.some(c => c.value === cat)) {
            setCategory(cat);
        }
    }, [searchParams]);

    const cat = CATEGORIES.find(c => c.value === category)!;

    const { data: leaderboard, isLoading, error: leaderboardError } = useQuery({
        queryKey: ['leaderboard', category, period],
        queryFn: () => getLeaderboard(category, period),
        refetchInterval: 30000,
        retry: false,
    });

    const entries = leaderboard?.entries ?? [];

    const getValue = (node: any) => {
        if (category === 'uptime') return node.uptime_percent || 0;
        if (category === 'bandwidth') return node.bandwidth_gb || 0;
        return node.active_sessions || 0;
    };

    const chartData = entries.slice(0, 10).map((n: any, i: number) => ({
        name: `#${i + 1}`,
        value: getValue(n),
        nodeId: n.node_id,
    }));

    const podium = entries.slice(0, 3);
    const rest = entries.slice(3);

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-8 font-mono">
            {/* Header */}
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-white/5 pb-8">
                <Link href="/explorer" className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary transition-colors uppercase tracking-[0.3em] w-fit">
                    <ArrowLeft size={14} /> Back to Grid
                </Link>
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
                    <div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // Rankings</div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-4">
                            <Trophy className="text-yellow-400" size={32} /> Leaderboard
                        </h1>
                        <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mt-2">
                            Top performing relay nodes ranked by category
                        </p>
                    </div>
                    {/* Period Selector */}
                    <div className="flex items-center gap-2 bg-white/[0.02] border border-white/5 rounded-2xl p-1.5">
                        {PERIODS.map(p => (
                            <button key={p.value} onClick={() => setPeriod(p.value)}
                                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${period === p.value ? 'bg-primary text-black' : 'text-white/30 hover:text-white/60'}`}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
            </motion.header>

            {/* Category Tabs */}
            <motion.div variants={itemVariants} className="flex gap-3">
                {CATEGORIES.map(c => (
                    <button key={c.value} onClick={() => setCategory(c.value)}
                        className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border ${category === c.value
                            ? 'border-transparent text-black'
                            : 'border-white/5 bg-white/[0.02] text-white/30 hover:text-white/60'}`}
                        style={category === c.value ? { background: c.color } : {}}>
                        <c.icon size={12} /> {c.label}
                    </button>
                ))}
            </motion.div>

            {/* Podium (Top 3) */}
            {podium.length >= 3 && (
                <motion.section variants={itemVariants}>
                    <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
                        {/* 2nd */}
                        <div className="mt-8">
                            <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] !p-5 text-center">
                                <div className="flex justify-center mb-3">
                                    <div className="w-10 h-10 rounded-2xl bg-slate-300/10 border border-slate-300/20 flex items-center justify-center">
                                        <Medal size={18} className="text-slate-300" />
                                    </div>
                                </div>
                                <div className="text-[8px] font-black text-slate-300 uppercase tracking-widest mb-1">2nd Place</div>
                                <div className="font-mono text-[9px] text-primary truncate">{podium[1]?.node_id?.slice(0, 12)}...</div>
                                <div className="text-lg font-black text-white mt-2">{getValue(podium[1]).toFixed(2)}{cat.unit}</div>
                            </GlassCard>
                        </div>
                        {/* 1st */}
                        <div>
                            <GlassCard className="border-yellow-400/20 bg-yellow-400/[0.02] rounded-[2rem] !p-5 text-center">
                                <div className="flex justify-center mb-3">
                                    <div className="w-12 h-12 rounded-2xl bg-yellow-400/10 border border-yellow-400/30 flex items-center justify-center">
                                        <Trophy size={22} className="text-yellow-400" />
                                    </div>
                                </div>
                                <div className="text-[8px] font-black text-yellow-400 uppercase tracking-widest mb-1">1st Place</div>
                                <div className="font-mono text-[9px] text-primary truncate">{podium[0]?.node_id?.slice(0, 12)}...</div>
                                <div className="text-2xl font-black text-white mt-2">{getValue(podium[0]).toFixed(2)}{cat.unit}</div>
                            </GlassCard>
                        </div>
                        {/* 3rd */}
                        <div className="mt-12">
                            <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] !p-5 text-center">
                                <div className="flex justify-center mb-3">
                                    <div className="w-10 h-10 rounded-2xl bg-amber-700/10 border border-amber-700/20 flex items-center justify-center">
                                        <Medal size={18} className="text-amber-600" />
                                    </div>
                                </div>
                                <div className="text-[8px] font-black text-amber-600 uppercase tracking-widest mb-1">3rd Place</div>
                                <div className="font-mono text-[9px] text-primary truncate">{podium[2]?.node_id?.slice(0, 12)}...</div>
                                <div className="text-lg font-black text-white mt-2">{getValue(podium[2]).toFixed(2)}{cat.unit}</div>
                            </GlassCard>
                        </div>
                    </div>
                </motion.section>
            )}

            {/* Bar Chart */}
            <motion.section variants={itemVariants}>
                <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] !p-6">
                    <h3 className="text-sm font-black uppercase tracking-tighter text-white mb-6 flex items-center gap-2">
                        <TrendingUp size={14} style={{ color: cat.color }} /> Top 10 — {cat.label}
                    </h3>
                    {mounted && chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={180} minWidth={0} minHeight={0}>
                            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                                <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                                <YAxis tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                                <Tooltip contentStyle={{ background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontFamily: 'monospace', fontSize: 10 }} />
                                <Bar dataKey="value" name={cat.label} radius={[4, 4, 0, 0]}>
                                    {chartData.map((_: any, i: number) => (
                                        <Cell key={i} fill={cat.color} opacity={1 - i * 0.07} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-[180px] flex items-center justify-center">
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">No ranking data yet</p>
                        </div>
                    )}
                </GlassCard>
            </motion.section>

            {/* Full Rankings Table */}
            <motion.section variants={itemVariants} className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-black uppercase tracking-tighter text-white flex items-center gap-2">
                        <Star size={14} className="text-primary" /> Full Rankings
                    </h2>
                    {leaderboardError && (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[8px] font-black uppercase tracking-widest">
                            API unavailable
                        </span>
                    )}
                </div>
                <GlassCard className="overflow-hidden border-white/5 bg-white/[0.01] rounded-[2rem]">
                    {isLoading ? (
                        <div className="space-y-0 divide-y divide-white/5">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="h-14 animate-pulse bg-white/[0.01]" />
                            ))}
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="py-20 text-center">
                            <Trophy size={48} className="text-white/5 mx-auto mb-4" />
                            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest">No nodes registered yet</p>
                        </div>
                    ) : (
                        <>
                            <div className="px-6 py-3 bg-white/[0.02] border-b border-white/5 grid grid-cols-12 text-[9px] font-black text-white/30 uppercase tracking-widest">
                                <span className="col-span-1">Rank</span>
                                <span className="col-span-4">Node</span>
                                <span className="col-span-2">Type</span>
                                <span className="col-span-2">Location</span>
                                <span className="col-span-3 text-right">{cat.label}</span>
                            </div>
                            <div className="divide-y divide-white/5">
                                {entries.map((node: any, i: number) => {
                                    const rank = node.rank ?? i + 1;
                                    const val = getValue(node);
                                    return (
                                        <Link key={node.node_id} href={`/explorer/nodes/${node.node_id}`}
                                            className="grid grid-cols-12 items-center px-6 py-4 hover:bg-white/[0.03] transition-colors group">
                                            <div className="col-span-1">
                                                <RankBadge rank={rank} />
                                            </div>
                                            <div className="col-span-4 min-w-0">
                                                <div className="font-mono text-[10px] text-primary truncate group-hover:text-primary/80 transition-colors">
                                                    {node.node_id?.slice(0, 18)}...
                                                </div>
                                                {node.name && <div className="text-[8px] text-white/30 mt-0.5">{node.name}</div>}
                                            </div>
                                            <div className="col-span-2">
                                                {node.is_validator ? (
                                                    <span className="inline-flex items-center gap-1 text-[8px] font-black text-purple-400 bg-purple-400/10 px-2 py-1 rounded-md uppercase">
                                                        <Shield size={8} /> Val
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[8px] font-black text-blue-400 bg-blue-400/10 px-2 py-1 rounded-md uppercase">
                                                        <Cloud size={8} /> Proxy
                                                    </span>
                                                )}
                                            </div>
                                            <div className="col-span-2">
                                                <div className="flex items-center gap-1">
                                                    <Globe size={9} className="text-white/20" />
                                                    <span className="text-[9px] text-white/40 truncate">{node.country || node.region || '—'}</span>
                                                </div>
                                            </div>
                                            <div className="col-span-3">
                                                {category === 'uptime' ? (
                                                    <UptimeBar value={val} />
                                                ) : (
                                                    <div className="text-right font-mono text-sm font-black text-white">
                                                        {val.toFixed(category === 'sessions' ? 0 : 2)}{cat.unit}
                                                    </div>
                                                )}
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </GlassCard>
            </motion.section>
        </motion.div>
    );
}
