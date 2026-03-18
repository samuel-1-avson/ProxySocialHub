"use client";

import { useQuery } from '@tanstack/react-query';
import { getOperationalMetrics } from '@/lib/services/monitoring';
import { Activity, Database, ShieldAlert, Zap, Server, ShieldCheck, Radar } from 'lucide-react';

export default function MonitoringPage() {
    const { data: metrics, isLoading } = useQuery({
        queryKey: ['operational-metrics'],
        queryFn: getOperationalMetrics,
        refetchInterval: 5000,
        retry: 2,
    });

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
                    <h1 className="text-3xl font-black font-mono uppercase tracking-tight flex items-center gap-3">
                        <Activity className="text-green-500" /> Operational Monitoring
                    </h1>
                    <p className="text-muted-foreground font-mono text-sm mt-1">INDUSTRIAL-GRADE INFRASTRUCTURE STATUS</p>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-mono text-muted-foreground uppercase leading-none">Last Sync</p>
                    <time className="text-xs font-mono font-bold">{new Date(metrics.timestamp).toLocaleTimeString()}</time>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* NATS STATUS */}
                <div className="card-retro border-blue-500/30 overflow-hidden relative group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Server size={64} className="text-blue-500" />
                    </div>
                    <div className="p-6 relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                            <Server size={16} className="text-blue-500" />
                            <h2 className="text-xs font-bold font-mono uppercase text-blue-500 tracking-widest">NATS JetStream (SESSIONS)</h2>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <p className="text-[10px] font-mono text-muted-foreground uppercase">Stream Name</p>
                                <p className="text-lg font-bold font-mono">{metrics.nats.stream_name}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-[10px] font-mono text-muted-foreground uppercase">Messages</p>
                                    <p className="text-2xl font-black font-mono">{(metrics.nats?.message_count ?? 0).toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-mono text-muted-foreground uppercase">Consumers</p>
                                    <p className="text-2xl font-black font-mono">{metrics.nats.consumer_count}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="h-1 w-full bg-blue-500/10">
                        <div className="h-full bg-blue-500 animate-pulse w-full"></div>
                    </div>
                </div>

                {/* TREASURY HEALTH */}
                <div className="card-retro border-yellow-500/30 overflow-hidden relative group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Database size={64} className="text-yellow-500" />
                    </div>
                    <div className="p-6 relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                            <Database size={16} className="text-yellow-500" />
                            <h2 className="text-xs font-bold font-mono uppercase text-yellow-500 tracking-widest">Solana Treasury</h2>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <p className="text-[10px] font-mono text-muted-foreground uppercase">Network</p>
                                <p className="text-lg font-bold font-mono uppercase">{metrics.treasury.network}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-mono text-muted-foreground uppercase">SOL Balance</p>
                                <p className="text-3xl font-black font-mono flex items-baseline gap-2">
                                    {metrics.treasury.sol_balance.toFixed(2)}
                                    <span className="text-sm text-yellow-500">SOL</span>
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="h-1 w-full bg-yellow-500/10">
                        <div className="h-full bg-yellow-500 animate-pulse w-3/4"></div>
                    </div>
                </div>

                {/* WATCHTOWER / SECURITY */}
                <div className={`card-retro border-t-4 transition-colors duration-500 ${metrics.watchtower.is_paused ? 'border-red-500 bg-red-500/5' : 'border-green-500 bg-green-500/5'}`}>
                    <div className="p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <ShieldAlert size={16} className={metrics.watchtower.is_paused ? 'text-red-500' : 'text-green-500'} />
                            <h2 className="text-xs font-bold font-mono uppercase tracking-widest">System Security</h2>
                        </div>
                        <div className="flex flex-col items-center justify-center py-4 text-center">
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${metrics.watchtower.is_paused ? 'bg-red-500/20 animate-ping' : 'bg-green-500/20'}`}>
                                {metrics.watchtower.is_paused ? (
                                    <ShieldAlert size={32} className="text-red-500" />
                                ) : (
                                    <ShieldCheck size={32} className="text-green-500" />
                                )}
                            </div>
                            <h3 className={`text-xl font-bold font-mono uppercase ${metrics.watchtower.is_paused ? 'text-red-500' : 'text-green-500'}`}>
                                {metrics.watchtower.is_paused ? 'EMERGENCY PAUSE ACTIVE' : 'SYSTEM OPERATIONAL'}
                            </h3>
                            <p className="text-[10px] font-mono text-muted-foreground mt-2 uppercase">
                                {metrics.watchtower.is_paused ? 'MANUAL RESOLUTION REQUIRED' : 'WATCHTOWER MONITORING INFLOW/OUTFLOW'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Active Event Log */}
            <section className="mt-12">
                <div className="flex items-center gap-2 mb-4">
                    <Activity size={16} className="text-muted-foreground" />
                    <h2 className="text-xs font-bold font-mono uppercase text-muted-foreground tracking-widest">Protocol Event Log</h2>
                </div>
                <div className="bg-black/40 border border-white/5 rounded-sm overflow-hidden p-10 text-center relative group">
                    <div className="absolute inset-0 bg-primary/[0.02] opacity-0 group-hover:opacity-100 transition-opacity" />
                    <Radar size={40} className="mx-auto text-muted-foreground/20 mb-6 animate-spin-slow" />
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-[0.3em]">Synchronizing Real-time Telemetry...</p>
                    <p className="font-mono text-[9px] text-primary/40 mt-2 uppercase tracking-widest">Awaiting next lifecycle fragment</p>
                </div>
            </section>
        </div>
    );
}
