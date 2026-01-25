'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/Navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { getNodes } from '@/lib/services/explorer';
import {
    Trophy,
    Medal,
    Award,
    Zap,
    Shield,
    Globe,
    ArrowUpRight,
    Search,
    Filter
} from 'lucide-react';

export default function LeaderboardsPage() {
    const [tab, setTab] = useState<'providers' | 'referrals' | 'contributors'>('providers');

    const { data: nodes, isLoading: loadingNodes } = useQuery({
        queryKey: ['leaderboard-nodes'],
        queryFn: () => getNodes(1, 50, true),
        refetchInterval: 60000,
    });

    // Sort nodes for leaderboards
    const topByUptime = nodes?.nodes ? [...nodes.nodes].sort((a, b) => b.uptime_percent - a.uptime_percent).slice(0, 10) : [];
    const topByBandwidth = nodes?.nodes ? [...nodes.nodes].sort((a, b) => b.bandwidth_gb - a.bandwidth_gb).slice(0, 10) : [];

    return (
        <div className="min-h-screen bg-black text-white selection:bg-yellow-500/30">
            <Navbar />

            <main className="container mx-auto px-4 py-8 mt-16">
                <div className="flex flex-col gap-8">

                    {/* Header */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                        <div>
                            <h1 className="text-4xl font-bold flex items-center gap-3">
                                <Trophy className="text-yellow-500 w-10 h-10" /> Network Leaderboards
                            </h1>
                            <p className="text-gray-400 mt-2 max-w-2xl">
                                Top performers in the ProxyHub ecosystem. Rewards are distributed periodically based on these rankings.
                            </p>
                        </div>

                        <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                            {(['providers', 'referrals', 'contributors'] as const).map((t) => (
                                <button
                                    key={t}
                                    onClick={() => setTab(t)}
                                    className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t
                                            ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20'
                                            : 'text-gray-400 hover:text-white'
                                        }`}
                                >
                                    {t.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    {tab === 'providers' && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                            {/* Top by Uptime */}
                            <div className="space-y-4">
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <Zap className="text-cyan-400 w-5 h-5" /> Reliability Titans
                                    <span className="text-xs font-normal text-gray-500 bg-white/5 px-2 py-0.5 rounded-full ml-auto">99%+ Uptime</span>
                                </h2>

                                <div className="space-y-3">
                                    {loadingNodes ? (
                                        Array.from({ length: 5 }).map((_, i) => (
                                            <div key={i} className="h-20 bg-white/5 rounded-2xl animate-pulse" />
                                        ))
                                    ) : topByUptime.map((node, idx) => (
                                        <LeaderboardItem
                                            key={node.node_id}
                                            rank={idx + 1}
                                            title={node.name || `Node ${node.node_id.slice(0, 6)}`}
                                            subtitle={node.region}
                                            value={`${node.uptime_percent.toFixed(2)}%`}
                                            label="Uptime"
                                            icon={<Shield className="text-cyan-500" />}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Top by Bandwidth */}
                            <div className="space-y-4">
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <Globe className="text-purple-400 w-5 h-5" /> Traffic Powerhouses
                                    <span className="text-xs font-normal text-gray-500 bg-white/5 px-2 py-0.5 rounded-full ml-auto">24h Throughput</span>
                                </h2>

                                <div className="space-y-3">
                                    {loadingNodes ? (
                                        Array.from({ length: 5 }).map((_, i) => (
                                            <div key={i} className="h-20 bg-white/5 rounded-2xl animate-pulse" />
                                        ))
                                    ) : topByBandwidth.map((node, idx) => (
                                        <LeaderboardItem
                                            key={node.node_id}
                                            rank={idx + 1}
                                            title={node.name || `Node ${node.node_id.slice(0, 6)}`}
                                            subtitle={node.country}
                                            value={`${node.bandwidth_gb.toFixed(1)} GB`}
                                            label="Bandwidth"
                                            icon={<ActivityIcon className="text-purple-500" />}
                                            highlight={idx < 3}
                                        />
                                    ))}
                                </div>
                            </div>

                        </div>
                    )}

                    {tab !== 'providers' && (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                                <Award className="w-10 h-10 text-gray-600" />
                            </div>
                            <h3 className="text-2xl font-bold mb-2">No Data Available Yet</h3>
                            <p className="text-gray-500 max-w-sm">
                                Data for {tab} leaderboards is aggregated weekly. Check back after the next epoch reset.
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

function LeaderboardItem({ rank, title, subtitle, value, label, icon, highlight }: any) {
    const isTop3 = rank <= 3;

    return (
        <GlassCard className={`p-4 group hover:scale-[1.01] transition-all duration-300 ${highlight ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-white/5'}`}>
            <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg ${rank === 1 ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/30' :
                        rank === 2 ? 'bg-gray-300 text-black' :
                            rank === 3 ? 'bg-amber-600 text-black' : 'bg-white/5 text-gray-500'
                    }`}>
                    {rank}
                </div>

                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white group-hover:text-yellow-400 transition-colors truncate">{title}</h3>
                    <p className="text-xs text-gray-500 uppercase tracking-tighter">{subtitle}</p>
                </div>

                <div className="text-right">
                    <p className="text-lg font-mono font-bold text-white">{value}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">{label}</p>
                </div>

                <div className="p-2 bg-white/5 rounded-lg opacity-40 group-hover:opacity-100 transition-opacity">
                    {icon}
                </div>
            </div>
        </GlassCard>
    );
}

function ActivityIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
    )
}
