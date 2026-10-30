'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { getLeaderboard } from '@/lib/services/explorer';
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
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-warning/10 border border-warning/20">
            <Trophy size={14} className="text-warning" />
        </div>
    );
    if (rank === 2) return (
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/10 border border-border">
            <Medal size={14} className="text-muted-foreground" />
        </div>
    );
    if (rank === 3) return (
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-warning/10 border border-warning/20">
            <Medal size={14} className="text-warning" />
        </div>
    );
    return (
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted border border-border">
            <span className="text-xs font-semibold text-muted-foreground">#{rank}</span>
        </div>
    );
}

function UptimeBar({ value }: { value: number }) {
    const color = value >= 99 ? '#10b981' : value >= 95 ? '#eab308' : '#ef4444';
    return (
        <div className="flex items-center gap-2 w-full">
            <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
            </div>
            <span className="text-xs font-semibold w-10 text-right" style={{ color }}>{value.toFixed(1)}%</span>
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
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-border pb-8">
                <Link href="/explorer" className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors w-fit">
                    <ArrowLeft size={14} /> Back to Grid
                </Link>
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
                    <div>
                        <div className="text-xs font-semibold text-primary mb-1">Grid Telemetry // Rankings</div>
                        <h1 className="text-4xl font-semibold tracking-tight text-foreground flex items-center gap-4">
                            <Trophy className="text-warning" size={32} /> Leaderboard
                        </h1>
                        <p className="text-xs font-semibold text-muted-foreground mt-2">
                            Top performing relay nodes ranked by category
                        </p>
                    </div>
                    {/* Period Selector */}
                    <div className="flex items-center gap-2 bg-muted border border-border rounded-lg p-1.5">
                        {PERIODS.map(p => (
                            <button key={p.value} onClick={() => setPeriod(p.value)}
                                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${period === p.value ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground'}`}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
            </motion.header>

            {leaderboard?.period_applied === false && (
                <motion.div variants={itemVariants} className="rounded-lg border border-warning/20 bg-warning/5 px-5 py-4">
                    <p className="text-xs font-semibold text-warning/90">
                        Period filter not applied for this category
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {leaderboard?.note ||
                            'Uptime rankings use current indexed node counters, not the selected time window. Switch to bandwidth or sessions for period-based rankings.'}
                    </p>
                </motion.div>
            )}

            {/* Category Tabs */}
            <motion.div variants={itemVariants} className="flex gap-3">
                {CATEGORIES.map(c => (
                    <button key={c.value} onClick={() => setCategory(c.value)}
                        className={`flex items-center gap-2 px-5 py-3 rounded-lg text-xs font-semibold transition-all border ${category === c.value
                            ? 'border-transparent text-black'
                            : 'border-border bg-muted text-muted-foreground hover:text-foreground'}`}
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
                            <GlassCard className="border-border bg-card rounded-lg !p-5 text-center">
                                <div className="flex justify-center mb-3">
                                    <div className="w-10 h-10 rounded-lg bg-muted/10 border border-border flex items-center justify-center">
                                        <Medal size={18} className="text-muted-foreground" />
                                    </div>
                                </div>
                                <div className="text-xs font-semibold text-muted-foreground mb-1">2nd Place</div>
                                <div className="font-mono text-xs text-primary truncate">{podium[1]?.node_id?.slice(0, 12)}...</div>
                                <div className="text-lg font-semibold text-foreground mt-2">{getValue(podium[1]).toFixed(2)}{cat.unit}</div>
                            </GlassCard>
                        </div>
                        {/* 1st */}
                        <div>
                            <GlassCard className="border-warning/20 bg-warning/[0.02] rounded-lg !p-5 text-center">
                                <div className="flex justify-center mb-3">
                                    <div className="w-12 h-12 rounded-lg bg-warning/10 border border-warning/30 flex items-center justify-center">
                                        <Trophy size={22} className="text-warning" />
                                    </div>
                                </div>
                                <div className="text-xs font-semibold text-warning mb-1">1st Place</div>
                                <div className="font-mono text-xs text-primary truncate">{podium[0]?.node_id?.slice(0, 12)}...</div>
                                <div className="text-2xl font-semibold text-foreground mt-2">{getValue(podium[0]).toFixed(2)}{cat.unit}</div>
                            </GlassCard>
                        </div>
                        {/* 3rd */}
                        <div className="mt-12">
                            <GlassCard className="border-border bg-card rounded-lg !p-5 text-center">
                                <div className="flex justify-center mb-3">
                                    <div className="w-10 h-10 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center">
                                        <Medal size={18} className="text-warning" />
                                    </div>
                                </div>
                                <div className="text-xs font-semibold text-warning mb-1">3rd Place</div>
                                <div className="font-mono text-xs text-primary truncate">{podium[2]?.node_id?.slice(0, 12)}...</div>
                                <div className="text-lg font-semibold text-foreground mt-2">{getValue(podium[2]).toFixed(2)}{cat.unit}</div>
                            </GlassCard>
                        </div>
                    </div>
                </motion.section>
            )}

            {/* Bar Chart */}
            <motion.section variants={itemVariants}>
                <GlassCard className="border-border bg-card rounded-lg !p-6">
                    <h3 className="text-sm font-semibold tracking-tight text-foreground mb-6 flex items-center gap-2">
                        <TrendingUp size={14} style={{ color: cat.color }} /> Top 10: {cat.label}
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
                            <p className="text-xs font-semibold text-muted-foreground">No ranking data yet</p>
                        </div>
                    )}
                </GlassCard>
            </motion.section>

            {/* Full Rankings Table */}
            <motion.section variants={itemVariants} className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                        <Star size={14} className="text-primary" /> Full Rankings
                    </h2>
                    {leaderboardError && (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warning/10 border border-warning/20 text-warning text-xs font-semibold">
                            API unavailable
                        </span>
                    )}
                </div>
                <GlassCard className="overflow-hidden border-border bg-card rounded-lg">
                    {isLoading ? (
                        <div className="space-y-0 divide-y divide-border">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="h-14 animate-pulse bg-card" />
                            ))}
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="py-20 text-center">
                            <Trophy size={48} className="text-muted-foreground mx-auto mb-4" />
                            <p className="text-xs font-semibold text-muted-foreground">No nodes registered yet</p>
                        </div>
                    ) : (
                        <>
                            <div className="px-6 py-3 bg-muted border-b border-border grid grid-cols-12 text-xs font-semibold text-muted-foreground">
                                <span className="col-span-1">Rank</span>
                                <span className="col-span-4">Node</span>
                                <span className="col-span-2">Type</span>
                                <span className="col-span-2">Location</span>
                                <span className="col-span-3 text-right">{cat.label}</span>
                            </div>
                            <div className="divide-y divide-border">
                                {entries.map((node: any, i: number) => {
                                    const rank = node.rank ?? i + 1;
                                    const val = getValue(node);
                                    return (
                                        <Link key={node.node_id} href={`/explorer/nodes/${node.node_id}`}
                                            className="grid grid-cols-12 items-center px-6 py-4 hover:bg-surface-hover transition-colors group">
                                            <div className="col-span-1">
                                                <RankBadge rank={rank} />
                                            </div>
                                            <div className="col-span-4 min-w-0">
                                                <div className="font-mono text-xs text-primary truncate group-hover:text-primary/80 transition-colors">
                                                    {node.node_id?.slice(0, 18)}...
                                                </div>
                                                {node.name && <div className="text-xs text-muted-foreground mt-0.5">{node.name}</div>}
                                            </div>
                                            <div className="col-span-2">
                                                {node.is_validator ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 px-2 py-1 rounded-md">
                                                        <Shield size={8} /> Val
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-info bg-info/10 px-2 py-1 rounded-md">
                                                        <Cloud size={8} /> Proxy
                                                    </span>
                                                )}
                                            </div>
                                            <div className="col-span-2">
                                                <div className="flex items-center gap-1">
                                                    <Globe size={9} className="text-muted-foreground" />
                                                    <span className="text-xs text-muted-foreground truncate">{node.country || node.region || 'Unknown'}</span>
                                                </div>
                                            </div>
                                            <div className="col-span-3">
                                                {category === 'uptime' ? (
                                                    <UptimeBar value={val} />
                                                ) : (
                                                    <div className="text-right font-mono text-sm font-semibold text-foreground">
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
