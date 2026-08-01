'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, EyeOff, Loader2, Lock, MessageSquare, Trash2, X } from 'lucide-react';
import {
    forumModerationKeys,
    getForumReports,
    updateForumReportStatus,
    type ForumReportAction,
    type ForumReportStatus,
} from '@/lib/api/forum-moderation';
import { getErrorMessage } from '@/lib/utils';

interface ForumReportsQueueProps {
    enabled: boolean;
}

const RESOLVE_ACTIONS: { action: ForumReportAction; label: string; icon: typeof Check }[] = [
    { action: 'hide', label: 'Hide + resolve', icon: EyeOff },
    { action: 'lock', label: 'Lock + resolve', icon: Lock },
    { action: 'hide_and_lock', label: 'Hide & lock', icon: EyeOff },
    { action: 'delete', label: 'Delete + resolve', icon: Trash2 },
    { action: 'none', label: 'Resolve only', icon: Check },
];

export function ForumReportsQueue({ enabled }: ForumReportsQueueProps) {
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState<ForumReportStatus>('pending');
    const limit = 20;

    const { data, isLoading, error } = useQuery({
        queryKey: forumModerationKeys.reports(page, statusFilter),
        queryFn: () => getForumReports(page, limit, statusFilter),
        enabled,
    });

    const updateMutation = useMutation({
        mutationFn: ({
            id,
            status,
            action,
        }: {
            id: string;
            status: 'resolved' | 'dismissed';
            action?: ForumReportAction;
        }) => updateForumReportStatus(id, status, action ?? 'none'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: forumModerationKeys.all });
        },
    });

    const reports = data?.reports ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return (
        <div className="space-y-6" data-testid="admin-forum-reports">
            <div>
                <div className="flex items-center gap-2 text-primary font-bold uppercase tracking-wider text-xs mb-2">
                    <MessageSquare size={14} />
                    Forum moderation
                </div>
                <h2 className="text-2xl font-black tracking-tighter uppercase italic">
                    Content <span className="text-primary">reports</span>
                </h2>
                <p className="text-sm text-muted-foreground mt-2">
                    Hide, lock, or delete reported content when resolving. Dismiss leaves content unchanged.
                </p>
            </div>

            <div className="flex flex-wrap gap-2">
                {(['pending', 'resolved', 'dismissed', 'all'] as const).map((s) => (
                    <button
                        key={s}
                        type="button"
                        onClick={() => {
                            setStatusFilter(s);
                            setPage(1);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                            statusFilter === s
                                ? 'border-primary/40 bg-primary/10 text-primary'
                                : 'border-white/10 text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {s}
                    </button>
                ))}
            </div>

            {isLoading && (
                <div className="flex flex-col items-center py-12 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                        Loading reports…
                    </p>
                </div>
            )}

            {error && (
                <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-sm text-red-400">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <span>{getErrorMessage(error)}</span>
                </div>
            )}

            {!isLoading && !error && reports.length === 0 && (
                <div className="text-center py-12 border border-dashed border-white/10 rounded-2xl">
                    <p className="text-muted-foreground">No reports in this queue.</p>
                </div>
            )}

            <ul className="space-y-3">
                {reports.map((report) => (
                    <li
                        key={report.id}
                        data-testid={`forum-report-${report.id}`}
                        className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3"
                    >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                                <p className="text-[10px] font-mono uppercase text-muted-foreground/60">
                                    {report.reason} · {report.status}
                                    {report.post_id ? ' · post' : report.thread_id ? ' · thread' : ''}
                                </p>
                                <p className="text-sm font-bold mt-1">
                                    {report.thread_title || report.post_preview || 'Forum content'}
                                </p>
                                {report.reporter_name && (
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                        Reported by {report.reporter_name}
                                    </p>
                                )}
                            </div>
                            <time className="text-[9px] font-mono text-muted-foreground/50">
                                {new Date(report.created_at).toLocaleString()}
                            </time>
                        </div>
                        {report.details && (
                            <p className="text-xs text-muted-foreground border-l-2 border-white/10 pl-3">
                                {report.details}
                            </p>
                        )}
                        <div className="flex flex-wrap gap-2 items-center">
                            {report.thread_id && (
                                <Link
                                    href={`/community/forum/thread/${report.thread_id}`}
                                    className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline"
                                >
                                    Open thread
                                </Link>
                            )}
                            {report.status === 'pending' && (
                                <>
                                    {RESOLVE_ACTIONS.map(({ action, label, icon: Icon }) => (
                                        <button
                                            key={action}
                                            type="button"
                                            disabled={updateMutation.isPending}
                                            onClick={() =>
                                                updateMutation.mutate({
                                                    id: report.id,
                                                    status: 'resolved',
                                                    action,
                                                })
                                            }
                                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-widest ${
                                                action === 'delete'
                                                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                                    : action === 'none'
                                                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                      : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                            }`}
                                        >
                                            <Icon size={12} /> {label}
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        disabled={updateMutation.isPending}
                                        onClick={() =>
                                            updateMutation.mutate({ id: report.id, status: 'dismissed' })
                                        }
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 text-muted-foreground border border-white/10 text-[10px] font-bold uppercase tracking-widest"
                                    >
                                        <X size={12} /> Dismiss
                                    </button>
                                </>
                            )}
                        </div>
                        {updateMutation.isError && (
                            <p className="text-xs text-red-400">{getErrorMessage(updateMutation.error)}</p>
                        )}
                    </li>
                ))}
            </ul>

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3">
                    <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground disabled:opacity-30"
                    >
                        Previous
                    </button>
                    <span className="text-[10px] font-mono text-muted-foreground">
                        {page} / {totalPages}
                    </span>
                    <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground disabled:opacity-30"
                    >
                        Next
                    </button>
                </div>
            )}
        </div>
    );
}
