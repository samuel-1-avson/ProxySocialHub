"use client";

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
    Server, Wallet, TrendingUp, Activity, AlertCircle, Fingerprint,
    FileCode, ShieldCheck, ArrowRight, Settings, Plus, Network, Cpu,
    Zap, Globe, Terminal, Coins
} from 'lucide-react';
import Link from 'next/link';
import { getMyNodes, getProviderEarningsSummary } from '@/lib/api/provider';
import { StatCard } from '@/components/ui/StatCard';
import { ActionCard } from '@/components/ui/ActionCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SkeletonDashboard } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { ProviderApplicationForm } from '@/components/ProviderApplicationForm';
import { getProviderStatus } from '@/lib/api/provider';

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

    const { user } = useAuth();
    
    const { data: statusData, isLoading: statusLoading } = useQuery({
        queryKey: ['provider-status'],
        queryFn: getProviderStatus,
        enabled: !!user && user.role !== 'provider' && user.role !== 'admin',
    });

    if (summaryLoading || nodesLoading || statusLoading) {
        return <SkeletonDashboard />;
    }

    // Role-based access control
    if (user?.role !== 'provider' && user?.role !== 'admin') {
        // If they have a pending application, show a simplified status view
        if (statusData?.application?.status === 'pending') {
            return (
                <div className="max-w-xl mx-auto py-20 px-4">
                    <ProviderApplicationForm />
                </div>
            );
        }
        return (
            <div className="max-w-xl mx-auto py-20 px-4">
                <ProviderApplicationForm />
            </div>
        );
    }

    if (nodes.length === 0) {
        return <NewProviderLanding />;
    }

    return (
        <div className="space-y-8 pb-20 md:pb-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
                <div>
                    <div className="flex items-center gap-2 text-purple-500 font-bold uppercase tracking-wider text-xs mb-2">
                        <Server size={14} />
                        Provider Workspace
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">
                        Command Center
                    </h1>
                    <p className="text-muted-foreground">
                        Manage your infrastructure and track bandwidth earnings.
                    </p>
                </div>
                
                <div className="flex items-center gap-3">
                    {onlineNodes > 0 ? (
                        <StatusBadge status="online" label={`${onlineNodes} Nodes Active`} pulse />
                    ) : (
                        <StatusBadge status="pending" label="No Active Nodes" />
                    )}
                </div>
            </div>

            {/* Earnings & Node Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    icon={Wallet}
                    title="Total Earned"
                    value={summaryLoading ? '…' : `${(summary?.total_earned_sol ?? 0).toFixed(4)}`}
                    subtitle="SOL Lifetime"
                    variant="brand"
                />
                <StatCard
                    icon={TrendingUp}
                    title="Pending Payout"
                    value={summaryLoading ? '…' : `${(summary?.pending_sol ?? 0).toFixed(4)} SOL`}
                    subtitle="Awaiting transfer"
                    variant="warning"
                />
                <StatCard
                    icon={Activity}
                    title="Last 7 Days"
                    value={summaryLoading ? '…' : `${(summary?.last_7_days_sol ?? 0).toFixed(4)} SOL`}
                    subtitle="Recent earnings"
                    variant="success"
                />
                <StatCard
                    icon={Network}
                    title="Infrastructure"
                    value={`${onlineNodes} / ${nodes.length}`}
                    subtitle={offlineNodes > 0 ? `${offlineNodes} offline` : 'All systems normal'}
                    variant={offlineNodes > 0 ? "error" : "success"}
                />
            </div>

            {/* Two-Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Node List Preview */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="glass-card flex flex-col min-h-[400px]">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center">
                            <h3 className="font-bold flex items-center gap-2">
                                <Cpu size={18} className="text-purple-500" />
                                Active Nodes
                            </h3>
                            <Link href="/dashboard/provider/nodes" className="text-sm font-medium text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors">
                                View Full List <ArrowRight size={14} />
                            </Link>
                        </div>
                        
                        <div className="flex-1 p-0 flex flex-col">
                            {nodes.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white/5 m-4 rounded-xl border border-dashed border-white/10">
                                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                                        <Server className="h-8 w-8 text-muted-foreground/50" />
                                    </div>
                                    <h4 className="text-lg font-bold mb-2">No nodes registered yet</h4>
                                    <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                                        Share your bandwidth and start earning SOL by deploying your first edge node.
                                    </p>
                                    <div className="flex gap-3">
                                        <Link href="/dashboard/provider/setup" className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-colors flex items-center gap-2">
                                            <Plus size={16} /> Add Node
                                        </Link>
                                    </div>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-muted-foreground uppercase bg-white/5 border-b border-white/5">
                                            <tr>
                                                <th className="px-6 py-4 font-medium">Node Name</th>
                                                <th className="px-6 py-4 font-medium">Tier</th>
                                                <th className="px-6 py-4 font-medium">Price/GB</th>
                                                <th className="px-6 py-4 font-medium">Score</th>
                                                <th className="px-6 py-4 font-medium text-right">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {nodes.slice(0, 5).map((node: any) => (
                                                <tr key={node.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                                                    <td className="px-6 py-4 font-medium text-foreground flex items-center gap-3">
                                                        <div className={`w-2 h-2 rounded-full ${node.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                                        {node.name}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                            node.current_tier === 'Gold' ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' :
                                                            node.current_tier === 'Silver' ? 'bg-slate-300/20 text-slate-300 border border-slate-300/30' :
                                                            'bg-orange-700/20 text-orange-400 border border-orange-700/30'
                                                        }`}>
                                                            {node.current_tier || 'Bronze'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                                                        ${(node.base_price_per_gb || 0).toFixed(3)}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                                <div 
                                                                    className={`h-full rounded-full ${
                                                                        (node.quality_score || 0) >= 90 ? 'bg-emerald-500' :
                                                                        (node.quality_score || 0) >= 70 ? 'bg-blue-500' : 'bg-orange-500'
                                                                    }`}
                                                                    style={{ width: `${node.quality_score || 0}%` }}
                                                                />
                                                            </div>
                                                            <span className="text-xs font-medium">{(node.quality_score || 0).toFixed(0)}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <StatusBadge 
                                                            status={node.status === 'online' ? 'online' : 'offline'} 
                                                            label={node.status} 
                                                            pulse={node.status === 'online'} 
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {nodes.length > 5 && (
                                        <div className="p-4 text-center border-t border-white/5">
                                            <span className="text-xs text-muted-foreground font-medium">
                                                +{nodes.length - 5} more nodes hidden
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Quick Actions Sidebar */}
                <div className="space-y-4">
                    <ActionCard
                        title="Setup New Node"
                        description="Deploy a new proxy node with our step-by-step wizard."
                        icon={Server}
                        href="/dashboard/provider/setup"
                        ctaLabel="Start Setup"
                        variant="provider"
                    />
                    
                    <div className="grid grid-cols-2 gap-4">
                        <Link href="/dashboard/provider/cli" className="glass-card p-5 hover:bg-white/10 transition-colors flex flex-col items-center justify-center text-center gap-2 group">
                            <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400 group-hover:scale-110 transition-transform">
                                <FileCode size={20} />
                            </div>
                            <span className="text-xs font-bold mt-1">CLI Tools</span>
                        </Link>
                        
                        <Link href="/dashboard/provider/tokens" className="glass-card p-5 hover:bg-white/10 transition-colors flex flex-col items-center justify-center text-center gap-2 group">
                            <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500 group-hover:scale-110 transition-transform">
                                <Fingerprint size={20} />
                            </div>
                            <span className="text-xs font-bold mt-1">API Tokens</span>
                        </Link>

                        <Link href="/dashboard/provider/health" className="glass-card p-5 hover:bg-white/10 transition-colors flex flex-col items-center justify-center text-center gap-2 group">
                            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500 group-hover:scale-110 transition-transform">
                                <ShieldCheck size={20} />
                            </div>
                            <span className="text-xs font-bold mt-1">Health</span>
                        </Link>
                        
                        <Link href="/dashboard/provider/earnings" className="glass-card p-5 hover:bg-white/10 transition-colors flex flex-col items-center justify-center text-center gap-2 group">
                            <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform">
                                <Wallet size={20} />
                            </div>
                            <span className="text-xs font-bold mt-1">Payouts</span>
                        </Link>
                    </div>
                </div>

            </div>
        </div>
    );
}
function NewProviderLanding() {
    return (
        <div className="space-y-12 py-8">
            <div className="flex flex-col md:flex-row gap-12 items-center">
                <div className="flex-1 space-y-6">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px] font-black uppercase tracking-widest">
                        <Zap size={12} /> Earn Passive Income
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black font-sans tracking-tight leading-none italic uppercase">
                        Become a <span className="text-purple-500">Provider</span>
                    </h1>
                    <p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
                        Turn your unused bandwidth into a revenue stream. Join our global network of decentralized nodes and earn SOL for every GB you share.
                    </p>
                    <div className="flex flex-wrap gap-4 pt-4">
                        <Link href="/dashboard/provider/setup" className="px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-2xl transition-all shadow-[0_0_30px_rgba(168,85,247,0.3)] flex items-center gap-3">
                            <Plus size={20} /> Deploy Your First Node
                        </Link>
                        <Link href="/dashboard/provider/tokens" className="px-8 py-4 bg-white/5 hover:bg-white/10 text-amber-500 border border-amber-500/20 font-bold rounded-2xl transition-all flex items-center gap-3">
                            <Fingerprint size={20} /> Manage API Tokens
                        </Link>
                        <Link href="/dashboard/provider/cli" className="px-8 py-4 bg-white/5 hover:bg-white/10 text-blue-400 border border-blue-500/20 font-bold rounded-2xl transition-all flex items-center gap-3">
                            <Terminal size={20} /> CLI Setup
                        </Link>
                    </div>
                </div>
                <div className="w-full md:w-80 space-y-4">
                    <div className="glass-card p-6 border-purple-500/20 bg-purple-500/5">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
                                <TrendingUp size={18} />
                            </div>
                            <h3 className="font-bold">Earning Estimator</h3>
                        </div>
                        <div className="space-y-4">
                            <div className="flex justify-between items-end">
                                <span className="text-sm text-muted-foreground">Monthly Potential</span>
                                <span className="text-2xl font-black text-emerald-400">2.5 SOL</span>
                            </div>
                            <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-purple-500 rounded-full w-2/3" />
                            </div>
                            <p className="text-[10px] text-muted-foreground italic">Based on average node uptime and current market demand.</p>
                        </div>
                    </div>
                    <div className="glass-card p-6">
                        <h3 className="font-bold mb-4 flex items-center gap-2 text-sm">
                            <ShieldCheck size={16} className="text-blue-400" />
                            Provider Benefits
                        </h3>
                        <ul className="space-y-3">
                            {[
                                "Privacy-preserving architecture",
                                "Trustless usage verifications",
                                "Automated weekly payouts",
                                "Enterprise-grade security"
                            ].map((item, idx) => (
                                <li key={idx} className="text-xs flex items-center gap-2 text-muted-foreground">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500/50" />
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-12 border-t border-white/5">
                <StepCard num="01" title="Download CLI" desc="Get our lightweight, open-source node software for Windows, Mac, or Linux." icon={Terminal} />
                <StepCard num="02" title="Register Node" desc="Authenticate with your wallet and register your node on the ProxyHubb registry." icon={Fingerprint} />
                <StepCard num="03" title="Start Earning" desc="Your node will automatically start handling requests and accumulating rewards." icon={Coins} />
            </div>
        </div>
    );
}

function StepCard({ num, title, desc, icon: Icon }: { num: string, title: string, desc: string, icon: any }) {
    return (
        <div className="relative group">
            <span className="absolute -top-6 -left-2 text-6xl font-black text-white/5 group-hover:text-purple-500/10 transition-colors z-0 select-none">{num}</span>
            <div className="relative z-10 space-y-4">
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground group-hover:text-purple-400 group-hover:border-purple-500/30 transition-all">
                    <Icon size={24} strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-bold">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </div>
        </div>
    );
}
