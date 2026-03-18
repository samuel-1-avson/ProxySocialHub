'use client';

import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { motion } from 'framer-motion';
import {
    Server, Wallet, TrendingUp, Activity, AlertCircle, Fingerprint,
    FileCode, ShieldCheck, ArrowRight, Wifi, WifiOff, Clock, Radio
} from 'lucide-react';
import Link from 'next/link';
import { getMyNodes, getProviderEarningsSummary } from '@/lib/api/provider';

export default function ProviderDashboard() {
    const { data: summary, isLoading: summaryLoading } = useQuery({
        queryKey: ['provider-earnings-summary'],
        queryFn: getProviderEarningsSummary,
    });

    const { data: nodesData, isLoading: nodesLoading } = useQuery({
        queryKey: ['my-nodes'],
        queryFn: getMyNodes,
        refetchInterval: 30_000,
    });

    const nodes = nodesData?.nodes ?? [];
    const onlineNodes = nodes.filter((n) => n.status === 'online').length;
    const offlineNodes = nodes.filter((n) => n.status === 'offline').length;

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <Server size={14} />
                    Provider
                </div>
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Provider Overview</h1>
                    {nodes.length === 0 && (
                        <Link
                            href="/dashboard/provider/setup"
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold uppercase hover:bg-primary/90 transition-colors"
                        >
                            Get Started
                            <ArrowRight size={12} />
                        </Link>
                    )}
                </div>
            </div>

            {/* Earnings stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    icon={<Wallet className="h-5 w-5 text-emerald-500" />}
                    label="Total Earned"
                    value={summaryLoading ? '…' : `${(summary?.total_earned_sol ?? 0).toFixed(4)} SOL`}
                    sub="lifetime"
                    color="emerald"
                />
                <StatCard
                    icon={<TrendingUp className="h-5 w-5 text-amber-500" />}
                    label="Pending Payout"
                    value={summaryLoading ? '…' : `${(summary?.pending_sol ?? 0).toFixed(4)} SOL`}
                    sub="awaiting transfer"
                    color="amber"
                />
                <StatCard
                    icon={<Activity className="h-5 w-5 text-blue-500" />}
                    label="Last 7 Days"
                    value={summaryLoading ? '…' : `${(summary?.last_7_days_sol ?? 0).toFixed(4)} SOL`}
                    sub="recent earnings"
                    color="blue"
                />
                <StatCard
                    icon={<Server className="h-5 w-5 text-purple-500" />}
                    label="Nodes Online"
                    value={nodesLoading ? '…' : `${onlineNodes} / ${nodes.length}`}
                    sub={offlineNodes > 0 ? `${offlineNodes} offline` : 'all healthy'}
                    color="purple"
                />
            </div>

            {/* Node list preview */}
            <GlassCard hoverEffect={false}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="font-bold font-mono text-sm flex items-center gap-2">
                        <Radio size={14} className="text-primary" />
                        Your Nodes
                    </h2>
                    <Link href="/dashboard/provider/nodes" className="text-xs font-mono text-primary hover:underline flex items-center gap-1">
                        Manage all <ArrowRight size={10} />
                    </Link>
                </div>
                {nodesLoading ? (
                    <div className="py-6 text-center text-muted-foreground text-sm font-mono">Loading…</div>
                ) : nodes.length === 0 ? (
                    <div className="py-10 text-center space-y-3">
                        <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground/30" />
                        <p className="text-sm font-mono font-bold">No nodes registered</p>
                        <p className="text-xs font-mono text-muted-foreground">
                            Use the Setup Wizard or install the CLI to register your first node.
                        </p>
                        <div className="flex gap-3 justify-center pt-1">
                            <Link
                                href="/dashboard/provider/setup"
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold uppercase"
                            >
                                Setup Wizard
                            </Link>
                            <Link
                                href="/dashboard/provider/cli"
                                className="px-4 py-2 bg-white/10 rounded-xl font-mono text-xs font-bold uppercase"
                            >
                                Get CLI
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {nodes.slice(0, 5).map((node) => (
                            <NodeRow key={node.id} node={node} />
                        ))}
                        {nodes.length > 5 && (
                            <p className="text-center text-[10px] font-mono text-muted-foreground pt-2">
                                +{nodes.length - 5} more nodes
                            </p>
                        )}
                    </div>
                )}
            </GlassCard>

            {/* Quick nav cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <QuickCard
                    href="/dashboard/provider/setup"
                    icon={<Server size={20} className="text-primary" />}
                    title="Setup Wizard"
                    desc="Register a new node step-by-step"
                    badge="Start here"
                />
                <QuickCard
                    href="/dashboard/provider/tokens"
                    icon={<Fingerprint size={20} className="text-amber-400" />}
                    title="API Tokens"
                    desc="Manage CLI authentication tokens"
                />
                <QuickCard
                    href="/dashboard/provider/cli"
                    icon={<FileCode size={20} className="text-blue-400" />}
                    title="CLI & Tools"
                    desc="Download the provider CLI"
                />
                <QuickCard
                    href="/dashboard/provider/health"
                    icon={<ShieldCheck size={20} className="text-emerald-400" />}
                    title="Node Health"
                    desc="Diagnostics and status checks"
                />
                <QuickCard
                    href="/dashboard/provider/analytics"
                    icon={<Activity size={20} className="text-purple-400" />}
                    title="Analytics"
                    desc="Bandwidth usage and trends"
                />
                <QuickCard
                    href="/dashboard/earnings"
                    icon={<Wallet size={20} className="text-green-400" />}
                    title="Earnings"
                    desc="Income history and payouts"
                />
            </div>
        </div>
    );
}

function StatCard({
    icon, label, value, sub, color,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    sub?: string;
    color: 'emerald' | 'amber' | 'blue' | 'purple';
}) {
    const borders: Record<string, string> = {
        emerald: 'border-emerald-500/10 bg-emerald-500/5',
        amber: 'border-amber-500/10 bg-amber-500/5',
        blue: 'border-blue-500/10 bg-blue-500/5',
        purple: 'border-purple-500/10 bg-purple-500/5',
    };
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl border p-4 space-y-2 ${borders[color]}`}
        >
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-mono">
                {icon}
                <span className="uppercase tracking-wider text-[9px] font-bold">{label}</span>
            </div>
            <p className="text-xl font-black font-mono">{value}</p>
            {sub && <p className="text-[9px] font-mono text-muted-foreground uppercase">{sub}</p>}
        </motion.div>
    );
}

function NodeRow({ node }: { node: any }) {
    const online = node.status === 'online';
    return (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors text-sm">
            <div className="flex items-center gap-3">
                {online
                    ? <Wifi size={12} className="text-emerald-400" />
                    : <WifiOff size={12} className="text-red-400" />}
                <span className="font-mono font-medium text-xs">{node.name}</span>
                {node.country && (
                    <span className="text-muted-foreground text-[9px] font-mono">{node.country}</span>
                )}
            </div>
            <div className="flex gap-4 text-[9px] font-mono text-muted-foreground">
                <span>{node.uptime_percent?.toFixed(1) ?? '—'}% up</span>
                <span className="hidden sm:block">{node.quality_score?.toFixed(0) ?? '—'} score</span>
                <span className={`font-bold ${online ? 'text-emerald-400' : 'text-red-400'}`}>
                    {node.status}
                </span>
            </div>
        </div>
    );
}

function QuickCard({
    href, icon, title, desc, badge,
}: {
    href: string;
    icon: React.ReactNode;
    title: string;
    desc: string;
    badge?: string;
}) {
    return (
        <Link href={href}>
            <motion.div
                whileHover={{ y: -2 }}
                className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 hover:bg-white/[0.05] transition-colors h-full"
            >
                <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/10">
                        {icon}
                    </div>
                    {badge && (
                        <span className="text-[9px] font-mono font-black uppercase px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                            {badge}
                        </span>
                    )}
                </div>
                <p className="font-bold font-mono text-sm mb-1">{title}</p>
                <p className="text-xs text-muted-foreground font-mono">{desc}</p>
                <div className="flex items-center gap-1 mt-3 text-[9px] font-mono text-primary">
                    Open <ArrowRight size={9} />
                </div>
            </motion.div>
        </Link>
    );
}
