"use client";

import { useQuery } from '@tanstack/react-query';
import { getOperationalMetrics } from '@/lib/services/monitoring';
import Link from 'next/link';
import { Activity, Database, ShieldAlert, Zap, Server, ShieldCheck, Radar, Shield } from 'lucide-react';
import { useRole } from '@/hooks/useRole';
import { ROUTES } from '@/lib/navigation/routes';

export default function MonitoringPage() {
    const { isAdmin } = useRole();
    const { data: metrics, isLoading } = useQuery({
        queryKey: ['operational-metrics'],
        queryFn: getOperationalMetrics,
        refetchInterval: 5000,
        retry: 2,
        enabled: isAdmin,
    });

    if (!isAdmin) {
        return (
            <div className="mx-auto max-w-3xl space-y-4 px-4 py-16 text-center">
                <Shield className="mx-auto text-muted-foreground/40" size={48} />
                <p className="text-muted-foreground">This page is for admins only.</p>
                <Link href={ROUTES.dashboard} className="text-sm font-medium text-primary hover:underline">
                    Back to dashboard
                </Link>
            </div>
        );
    }

    if (isLoading || !metrics) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <header className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-semibold font-mono tracking-tight flex items-center gap-3">
                        <Activity className="text-success" /> Operational Monitoring
                    </h1>
                    <p className="text-muted-foreground font-mono text-sm mt-1">Live health of the platform&apos;s services</p>
                </div>
                <div className="text-right">
                    <p className="text-xs font-mono text-muted-foreground leading-none">Last Sync</p>
                    <time className="text-xs font-mono font-bold">{new Date(metrics.timestamp).toLocaleTimeString()}</time>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* NATS STATUS */}
                <div className="card-retro border-info/30 overflow-hidden relative group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Server size={64} className="text-info" />
                    </div>
                    <div className="p-6 relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                            <Server size={16} className="text-info" />
                            <h2 className="text-xs font-bold font-mono text-info">NATS JetStream (SESSIONS)</h2>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <p className="text-xs font-mono text-muted-foreground">Stream Name</p>
                                <p className="text-lg font-bold font-mono">{metrics.nats.stream_name}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs font-mono text-muted-foreground">Messages</p>
                                    <p className="text-2xl font-semibold font-mono">{(metrics.nats?.message_count ?? 0).toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-mono text-muted-foreground">Consumers</p>
                                    <p className="text-2xl font-semibold font-mono">{metrics.nats.consumer_count}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="h-1 w-full bg-info/10">
                        <div className="h-full bg-info animate-pulse w-full"></div>
                    </div>
                </div>

                {/* TREASURY HEALTH */}
                <div className="card-retro border-warning/30 overflow-hidden relative group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Database size={64} className="text-warning" />
                    </div>
                    <div className="p-6 relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                            <Database size={16} className="text-warning" />
                            <h2 className="text-xs font-bold font-mono text-warning">Solana Treasury</h2>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <p className="text-xs font-mono text-muted-foreground">Network</p>
                                <p className="text-lg font-bold font-mono">{metrics.treasury.network}</p>
                            </div>
                            <div>
                                <p className="text-xs font-mono text-muted-foreground">SOL Balance</p>
                                <p className="text-3xl font-semibold font-mono flex items-baseline gap-2">
                                    {Number(metrics.treasury.sol_balance ?? 0).toFixed(2)}
                                    <span className="text-sm text-warning">SOL</span>
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="h-1 w-full bg-warning/10">
                        <div className="h-full bg-warning animate-pulse w-3/4"></div>
                    </div>
                </div>

                {/* WATCHTOWER / SECURITY */}
                <div className={`card-retro border-t-4 transition-colors duration-500 ${metrics.watchtower.is_paused ? 'border-destructive bg-destructive/5' : 'border-success bg-success/5'}`}>
                    <div className="p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <ShieldAlert size={16} className={metrics.watchtower.is_paused ? 'text-destructive' : 'text-success'} />
                            <h2 className="text-xs font-bold font-mono">System Security</h2>
                        </div>
                        <div className="flex flex-col items-center justify-center py-4 text-center">
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${metrics.watchtower.is_paused ? 'bg-destructive/20 animate-ping' : 'bg-success/20'}`}>
                                {metrics.watchtower.is_paused ? (
                                    <ShieldAlert size={32} className="text-destructive" />
                                ) : (
                                    <ShieldCheck size={32} className="text-success" />
                                )}
                            </div>
                            <h3 className={`text-xl font-bold font-mono ${metrics.watchtower.is_paused ? 'text-destructive' : 'text-success'}`}>
                                {metrics.watchtower.is_paused ? 'Emergency pause active' : 'System operational'}
                            </h3>
                            <p className="text-xs font-mono text-muted-foreground mt-2">
                                {metrics.watchtower.is_paused ? 'Manual resolution required' : 'Watchtower monitoring inflow/outflow'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Active Event Log */}
            <section className="mt-12">
                <div className="flex items-center gap-2 mb-4">
                    <Activity size={16} className="text-muted-foreground" />
                    <h2 className="text-xs font-bold font-mono text-muted-foreground">Protocol Event Log</h2>
                </div>
                <div className="bg-secondary border border-border rounded-sm overflow-hidden p-10 text-center relative group">
                    <div className="absolute inset-0 bg-primary/[0.02] opacity-0 group-hover:opacity-100 transition-opacity" />
                    <Radar size={40} className="mx-auto text-muted-foreground/20 mb-6 animate-spin-slow" />
                    <p className="font-mono text-xs text-muted-foreground">Synchronizing Real-time Telemetry...</p>
                    <p className="font-mono text-xs text-primary/40 mt-2">Awaiting next lifecycle fragment</p>
                </div>
            </section>
        </div>
    );
}
