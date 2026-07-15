"use client";

import { getProviderNodes, ProviderNode } from '@/lib/api/marketplace';
import { ProviderScoreCard } from '@/components/ProviderScoreCard';
import { ProviderSetupGuide } from '@/components/ProviderSetupGuide';
import { Loader2, Server, BarChart2, Coins, TrendingUp, Activity } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';

async function fetchProviderNodes(): Promise<ProviderNode[]> {
    const data = await getProviderNodes();
    return data.nodes || [];
}

export default function ProviderAnalyticsPage() {
    const { data: nodes = [], isLoading: loading } = useQuery({
        queryKey: ['provider-nodes-analytics'],
        queryFn: fetchProviderNodes,
        retry: 2,
    });

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                <p className="text-xs font-mono uppercase text-muted-foreground">Analyzing Network Performance...</p>
            </div>
        );
    }

    const hasActiveNodes = nodes.length > 0;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <BarChart2 size={14} />
                    Performance Analytics
                </div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Provider Scorecard</h1>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    REAL-TIME TRUST METRICS AND NODE PERFORMANCE.
                </p>
            </div>

            {!hasActiveNodes ? (
                /* No Nodes - Show Setup Guide */
                <ProviderSetupGuide />
            ) : (
                /* Has Active Nodes - Show Analytics */
                <>
                    {/* Earnings Summary */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <GlassCard className="p-5 border-emerald-500/10 bg-emerald-500/5">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                                    <Coins size={20} className="text-emerald-400" />
                                </div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Earnings</div>
                            </div>
                            <div className="text-2xl font-black font-mono text-emerald-400">
                                0.00 <span className="text-sm text-emerald-400/60">SOL</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">Lifetime earnings</p>
                        </GlassCard>

                        <GlassCard className="p-5 border-white/5 bg-white/[0.02]">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                    <Activity size={20} className="text-blue-400" />
                                </div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Nodes</div>
                            </div>
                            <div className="text-2xl font-black font-mono">
                                {nodes.filter(n => n.status === 'online').length}<span className="text-sm text-muted-foreground">/{nodes.length}</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">Online now</p>
                        </GlassCard>

                        <GlassCard className="p-5 border-white/5 bg-white/[0.02]">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                                    <TrendingUp size={20} className="text-purple-400" />
                                </div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Trust Score</div>
                            </div>
                            <div className="text-2xl font-black font-mono">
                                {(nodes.length > 0 ? (nodes.reduce((acc, n) => acc + (Number(n.quality_score) || 0), 0) / nodes.length) : 0).toFixed(1)}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">Average across nodes</p>
                        </GlassCard>

                        <GlassCard className="p-5 border-white/5 bg-white/[0.02]">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                                    <Server size={20} className="text-orange-400" />
                                </div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Connections</div>
                            </div>
                            <div className="text-2xl font-black font-mono">
                                {nodes.reduce((acc, n) => acc + (n.active_connections || 0), 0)}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">Active right now</p>
                        </GlassCard>
                    </div>

                    {/* Nodes Grid */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                            <Server size={16} />
                            Your Nodes
                        </div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            {nodes.map(node => (
                                <ProviderScoreCard key={node.id} node={node} />
                            ))}
                        </div>
                    </div>

                    {/* Add More Nodes CTA */}
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex justify-center pt-8"
                    >
                        <GlassCard className="p-6 border-dashed border-white/10 bg-white/[0.01] max-w-2xl w-full">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                                        <TrendingUp size={24} className="text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold">Scale Your Earnings</h3>
                                        <p className="text-xs text-muted-foreground">Add more nodes to increase your earning potential</p>
                                    </div>
                                </div>
                                <button className="px-4 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-lg text-[10px] font-bold uppercase tracking-wider text-primary transition-all">
                                    Add Node
                                </button>
                            </div>
                        </GlassCard>
                    </motion.div>
                </>
            )}
        </div>
    );
}
