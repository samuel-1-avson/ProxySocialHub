"use client";

import { useEffect, useState } from 'react';
import { getSessions, getSessionUsage, Session, UsageStats } from '@/lib/api';
import { ExternalLink, Database, Coins, Server, Loader2, RefreshCw } from 'lucide-react';

interface SessionWithUsage extends Session {
    usage?: UsageStats;
}

export default function UsagePage() {
    const [sessions, setSessions] = useState<SessionWithUsage[]>([]);
    const [loading, setLoading] = useState(true);
    const [totalUsage, setTotalUsage] = useState({ gb: 0, cost: 0 });

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        setLoading(true);
        try {
            const sessionsData = await getSessions();
            const safeSessionsData = Array.isArray(sessionsData) ? sessionsData : [];

            // Fetch usage for each session
            const sessionsWithUsage = await Promise.all(
                safeSessionsData.map(async (session) => {
                    try {
                        const usage = await getSessionUsage(session.credentials_user);
                        return { ...session, usage };
                    } catch {
                        return session;
                    }
                })
            );

            setSessions(sessionsWithUsage as SessionWithUsage[]);

            // Calculate totals
            const totals = (sessionsWithUsage as SessionWithUsage[]).reduce(
                (acc, s) => ({
                    gb: acc.gb + (s.usage?.gb_used || 0),
                    cost: acc.cost + (s.usage?.cost_ghs || 0),
                }),
                { gb: 0, cost: 0 }
            );
            setTotalUsage(totals);
        } catch (error) {
            console.error('Failed to fetch data:', error);
            setSessions([]);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Calculating Consumption...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            <div className="flex justify-between items-end border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-1">Resource Consumption</h1>
                    <p className="text-muted-foreground font-mono text-xs">TRACK BANDWIDTH USAGE AND SESSION COSTS.</p>
                </div>
                <button onClick={fetchData} className="btn-retro btn-retro-outline flex items-center gap-2">
                    <RefreshCw size={14} /> Refresh
                </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { label: "Total Usage", value: `${totalUsage.gb.toFixed(3)} GB`, icon: Database },
                    { label: "Accrued Cost", value: `₵${totalUsage.cost.toFixed(2)}`, icon: Coins },
                    { label: "Active Nodes", value: sessions.filter((s) => s.status === 'active').length, icon: Server },
                ].map((stat, i) => (
                    <div key={i} className="card-retro p-6 bg-card flex items-center justify-between group hover:border-primary transition-colors">
                        <div>
                            <p className="text-[10px] font-mono font-bold text-muted-foreground uppercase mb-1">{stat.label}</p>
                            <p className="text-3xl font-bold font-mono group-hover:text-primary transition-colors">{stat.value}</p>
                        </div>
                        <div className="p-3 bg-secondary rounded-sm border border-border group-hover:scale-110 transition-transform">
                            <stat.icon size={20} className="text-muted-foreground" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Sessions Usage Table */}
            <div className="card-retro p-0 bg-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-secondary/10">
                    <h2 className="text-sm font-bold font-mono uppercase">Session Breakdown</h2>
                </div>
                {sessions.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground font-mono text-xs border-2 border-dashed border-border m-4 rounded-sm">
                        NO SESSION DATA DETECTED.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs font-mono">
                            <thead className="bg-secondary/20">
                                <tr>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Session ID</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Type</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Status</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Usage</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Quota</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Cost</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {sessions.map((session) => {
                                    const usage = session.usage;
                                    const percentUsed = usage?.percent_used || 0;

                                    return (
                                        <tr key={session.id} className="hover:bg-secondary/10 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1">
                                                    <span className="font-bold">{session.id.slice(0, 8)}...</span>
                                                    {session.tx_hash && (
                                                        <a
                                                            href={`https://solscan.io/tx/${session.tx_hash}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex items-center gap-1 text-[10px] text-primary hover:underline font-bold uppercase"
                                                        >
                                                            <ExternalLink size={10} /> On-chain
                                                        </a>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 capitalize font-bold">{session.type}</td>
                                            <td className="px-6 py-4">
                                                <span
                                                    className={`px-2 py-0.5 rounded-sm font-bold uppercase ${session.status === 'active'
                                                        ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                                                        : 'bg-secondary text-muted-foreground border border-border'
                                                        }`}
                                                >
                                                    {session.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 font-bold">
                                                {usage?.gb_used?.toFixed(3) || '0.000'} GB
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1 w-24">
                                                    <span className="text-muted-foreground">{((usage?.bytes_limit || 0) / (1024 * 1024 * 1024)).toFixed(1)} GB</span>
                                                    <div className="h-1 w-full bg-secondary rounded-full overflow-hidden">
                                                        <div className={`h-full ${percentUsed > 90 ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${Math.min(percentUsed, 100)}%` }} />
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-primary font-bold">
                                                ₵{usage?.cost_ghs?.toFixed(2) || '0.00'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Usage Tips */}
            <div className="card-retro p-6 bg-card">
                <h2 className="text-sm font-bold font-mono uppercase mb-4 text-muted-foreground">Optimization Protocols</h2>
                <ul className="space-y-3 font-mono text-xs">
                    <li className="flex items-start gap-3">
                        <div className="w-4 h-4 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center text-[10px] font-bold">✓</div>
                        <span>Use <span className="text-primary">rotating sessions</span> for high-volume scraping to distribute load effectively.</span>
                    </li>
                    <li className="flex items-start gap-3">
                        <div className="w-4 h-4 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center text-[10px] font-bold">✓</div>
                        <span>Enable payload compression (gzip/brotli) to strictly reduce metered data transfer.</span>
                    </li>
                    <li className="flex items-start gap-3">
                        <div className="w-4 h-4 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center text-[10px] font-bold">✓</div>
                        <span>Periodically purge inactive sessions to prevent ghost bandwidth leakage.</span>
                    </li>
                </ul>
            </div>
        </div>
    );
}
