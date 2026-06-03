'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { getExplorerSessions, isExplorerNotFound } from '@/lib/services/explorer';
import { explorerPublicSessionsEnabled } from '@/lib/navigation/explorer-nav';
import Link from 'next/link';
import {
    ArrowLeft, Radio, Server, Clock, Zap, Filter, ChevronLeft,
    ChevronRight, CheckCircle, XCircle, Loader, Activity,
    ArrowRightLeft, Database, Download,
} from 'lucide-react';

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
    const content = [headers, ...rows]
        .map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
import { motion } from 'framer-motion';
import { formatDistanceToNow, format } from 'date-fns';

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string; icon: any }> = {
    active: { color: 'text-emerald-400', bg: 'bg-emerald-400/10', label: 'Active', icon: CheckCircle },
    terminated: { color: 'text-rose-400', bg: 'bg-rose-400/10', label: 'Terminated', icon: XCircle },
    disabled: { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Disabled', icon: Loader },
};

const TYPE_CONFIG: Record<string, { color: string; bg: string }> = {
    rotating: { color: 'text-blue-400', bg: 'bg-blue-400/10' },
    sticky: { color: 'text-purple-400', bg: 'bg-purple-400/10' },
};

function StatusBadge({ status }: { status: string }) {
    const cfg = STATUS_CONFIG[status] || { color: 'text-white/40', bg: 'bg-white/5', label: status, icon: Activity };
    const Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1 text-[8px] font-black ${cfg.color} ${cfg.bg} px-2 py-1 rounded-lg uppercase tracking-wider`}>
            <Icon size={8} /> {cfg.label}
        </span>
    );
}

function formatBytes(bytes: number): string {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(3)} GB`;
}

const containerVariants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemVariants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

export default function SessionsPage() {
    const sessionsApiEnabled = explorerPublicSessionsEnabled();
    const [page, setPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [typeFilter, setTypeFilter] = useState<string>('');
    const [showFilters, setShowFilters] = useState(false);
    const pageSize = 20;

    const { data, isLoading, error } = useQuery({
        queryKey: ['explorer-sessions', page, statusFilter, typeFilter],
        queryFn: () => getExplorerSessions(page, pageSize, statusFilter, typeFilter),
        enabled: sessionsApiEnabled,
        refetchInterval: sessionsApiEnabled ? 15000 : false,
        retry: false,
    });

    const sessions = data?.sessions || [];
    const total = data?.total || 0;
    const totalPages = Math.ceil(total / pageSize);

    const activeCount = sessions.filter((s: any) => s.status === 'active').length;
    const sessionsFeedDisabled =
        !sessionsApiEnabled || Boolean(error && isExplorerNotFound(error));

    const handleExport = () => {
        if (!sessions.length) return;
        const headers = ['session_id', 'type', 'status', 'bytes_used', 'start_time', 'end_time'];
        const rows = sessions.map((s: any) => [
            s.session_id ?? '',
            s.session_type ?? '',
            s.status ?? '',
            String(s.bytes_used ?? 0),
            s.start_time ?? '',
            s.end_time ?? '',
        ]);
        const dateTag = new Date().toISOString().slice(0, 10);
        downloadCsv(`sessions_${dateTag}.csv`, headers, rows);
    };

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-8 font-mono">
            {/* Header */}
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-white/5 pb-8">
                <Link href="/explorer" className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary transition-colors uppercase tracking-[0.3em] w-fit">
                    <ArrowLeft size={14} /> Back to Grid
                </Link>
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
                    <div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // Sessions</div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-4">
                            <Radio className="text-primary" size={32} /> Session Explorer
                        </h1>
                        <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mt-2">
                            Live and historical proxy session data
                        </p>
                    </div>
                    <div className="flex gap-3">
                        {[
                            { label: 'Total', value: total, color: 'text-white' },
                            { label: 'Active Now', value: data?.active_count ?? activeCount, color: 'text-emerald-400' },
                        ].map(s => (
                            <GlassCard key={s.label} className="!p-4 border-white/5 bg-white/[0.01] rounded-2xl text-center">
                                <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
                                <div className="text-[8px] font-black text-white/30 uppercase tracking-widest mt-0.5">{s.label}</div>
                            </GlassCard>
                        ))}
                    </div>
                </div>
            </motion.header>

            {/* Filter Bar */}
            {!sessionsFeedDisabled && (
            <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-3">
                <button onClick={() => setShowFilters(!showFilters)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${showFilters ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-white/[0.02] border-white/5 text-white/30 hover:text-white/60'}`}>
                    <Filter size={10} /> Filters
                </button>
                {showFilters && (
                    <>
                        <div className="flex items-center gap-1 bg-white/[0.02] border border-white/5 rounded-xl p-1">
                            {['', 'active', 'terminated', 'disabled'].map(s => (
                                <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
                                    className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all ${statusFilter === s ? 'bg-primary text-black' : 'text-white/30 hover:text-white/60'}`}>
                                    {s || 'All Status'}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-1 bg-white/[0.02] border border-white/5 rounded-xl p-1">
                            {['', 'rotating', 'sticky'].map(t => (
                                <button key={t} onClick={() => { setTypeFilter(t); setPage(1); }}
                                    className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all ${typeFilter === t ? 'bg-primary text-black' : 'text-white/30 hover:text-white/60'}`}>
                                    {t || 'All Types'}
                                </button>
                            ))}
                        </div>
                    </>
                )}
                {(statusFilter || typeFilter) && (
                    <button onClick={() => { setStatusFilter(''); setTypeFilter(''); setPage(1); }}
                        className="text-[8px] font-black text-rose-400 uppercase tracking-widest hover:text-rose-300 transition-colors">
                        ✕ Clear Filters
                    </button>
                )}
                <span className="ml-auto text-[9px] font-black text-white/20 uppercase tracking-wider">{total.toLocaleString()} sessions</span>
                <button onClick={handleExport} disabled={!sessions.length}
                    title="Export current page as CSV"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5 text-[8px] font-black uppercase tracking-widest text-white/30 hover:text-emerald-400 hover:border-emerald-500/30 disabled:opacity-20 disabled:cursor-not-allowed transition-all">
                    <Download size={10} /> CSV
                </button>
            </motion.div>
            )}

            {/* Sessions Table */}
            <motion.section variants={itemVariants}>
                <GlassCard className="overflow-hidden border-white/5 bg-white/[0.01] rounded-[2rem]">
                    {isLoading ? (
                        <div className="space-y-0 divide-y divide-white/5">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="h-16 animate-pulse bg-white/[0.01]" />
                            ))}
                        </div>
                    ) : sessionsFeedDisabled ? (
                        <div className="py-20 text-center max-w-md mx-auto">
                            <Radio size={48} className="text-white/5 mx-auto mb-4" />
                            <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-2">
                                Public session feed disabled
                            </p>
                            <p className="text-[9px] font-bold text-white/20 leading-relaxed">
                                This deployment does not expose live session telemetry on the public explorer.
                                Operators can enable it with <span className="text-primary/80">EXPLORER_PUBLIC_SESSIONS_ENABLED</span>.
                            </p>
                            <Link href="/explorer" className="inline-flex items-center gap-2 mt-6 text-[9px] font-black text-primary uppercase tracking-widest hover:text-primary/80 transition-colors">
                                <ArrowLeft size={10} /> Back to Grid
                            </Link>
                        </div>
                    ) : error ? (
                        <div className="py-20 text-center">
                            <Radio size={48} className="text-white/5 mx-auto mb-4" />
                            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest">Session data unavailable</p>
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="py-20 text-center">
                            <Radio size={48} className="text-white/5 mx-auto mb-4" />
                            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest">No sessions found</p>
                        </div>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-white/5 text-white/40 text-[9px] uppercase tracking-[0.2em] font-black">
                                            <th className="px-6 py-4">Session ID</th>
                                            <th className="px-6 py-4">Type</th>
                                            <th className="px-6 py-4">Status</th>
                                            <th className="px-6 py-4 text-right">Bandwidth Used</th>
                                            <th className="px-6 py-4 text-right">Duration</th>
                                            <th className="px-6 py-4">Started</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {sessions.map((s: any) => {
                                            const typeCfg = TYPE_CONFIG[s.session_type] || { color: 'text-white/40', bg: 'bg-white/5' };
                                            const start = s.start_time ? new Date(s.start_time) : null;
                                            // For active sessions, use server-provided end_time or show "Active"
                                            // Avoid re-computing with new Date() on every render
                                            const isActive = s.status === 'active';
                                            const end = s.end_time ? new Date(s.end_time) : null;
                                            const durationMs = start && end ? end.getTime() - start.getTime() : 0;
                                            const durationMin = Math.floor(durationMs / 60000);
                                            return (
                                                <tr key={s.session_id} className="hover:bg-white/[0.03] transition-colors">
                                                    <td className="px-6 py-4">
                                                        <span className="font-mono text-primary text-[10px] font-bold">
                                                            {s.session_id?.slice(0, 8)}...{s.session_id?.slice(-6)}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`text-[8px] font-black px-2 py-1 rounded-md uppercase ${typeCfg.color} ${typeCfg.bg}`}>
                                                            {s.session_type || '—'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <StatusBadge status={s.status} />
                                                    </td>
                                                    <td className="px-6 py-4 text-right font-mono text-[10px] font-black text-white">
                                                        {formatBytes(s.bytes_used || 0)}
                                                    </td>
                                                    <td className="px-6 py-4 text-right font-mono text-[10px] font-black text-white/60">
                                                        {isActive ? <span className="text-emerald-400">Active</span> : durationMin > 0 ? `${durationMin}m` : '<1m'}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-2 text-[9px] text-white/40">
                                                            <Clock size={9} />
                                                            {start ? formatDistanceToNow(start, { addSuffix: true }) : '—'}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination */}
                            <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
                                <span className="text-[9px] font-black text-white/30 uppercase tracking-wider">
                                    Page {page} of {totalPages || 1}
                                </span>
                                <div className="flex gap-2">
                                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                                        className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5 text-white/30 hover:text-primary hover:border-primary/20 disabled:opacity-30 text-[9px] font-black uppercase tracking-wider transition-all">
                                        <ChevronLeft size={10} /> Prev
                                    </button>
                                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                                        className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5 text-white/30 hover:text-primary hover:border-primary/20 disabled:opacity-30 text-[9px] font-black uppercase tracking-wider transition-all">
                                        Next <ChevronRight size={10} />
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </GlassCard>
            </motion.section>
        </motion.div>
    );
}
