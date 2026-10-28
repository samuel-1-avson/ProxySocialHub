'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, EyeOff, Lock, Trash2, X } from 'lucide-react';
import {
    forumModerationKeys,
    getForumReports,
    updateForumReportStatus,
    type ForumReportAction,
    type ForumReportStatus,
} from '@/lib/api/forum-moderation';
import { getErrorMessage } from '@/lib/utils';
import { ConfirmDialog } from '@/components/patterns/ConfirmDialog';
import { Loading, DataError, EmptyState } from '@/components/workspace/Patterns';

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

const DESTRUCTIVE_ACTIONS = new Set<ForumReportAction>(['hide', 'lock', 'hide_and_lock', 'delete']);

export function ForumReportsQueue({ enabled }: ForumReportsQueueProps) {
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState<ForumReportStatus>('pending');
    const [pending, setPending] = useState<{
        id: string;
        title: string;
        action: ForumReportAction;
        label: string;
    } | null>(null);
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
            setPending(null);
        },
    });

    const reports = data?.reports ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return (
        <div className="space-y-6" data-testid="admin-forum-reports">
            <div>
                <h2>Forum reports</h2>
                <p className="ui-note mt-2">
                    Hide, lock, or delete reported content when resolving. Dismiss leaves content unchanged.
                </p>
            </div>

            <nav className="ui-tabs" aria-label="Report status">
                {(['pending', 'resolved', 'dismissed', 'all'] as const).map((s) => (
                    <button
                        key={s}
                        type="button"
                        onClick={() => {
                            setStatusFilter(s);
                            setPage(1);
                        }}
                        className={statusFilter === s ? 'active' : ''}
                    >
                        {s}
                    </button>
                ))}
            </nav>

            {isLoading && <Loading label="Loading reports…" />}

            {error && <DataError error={error} />}

            {!isLoading && !error && reports.length === 0 && (
                <EmptyState
                    title="No reports in this queue"
                    description="Incoming reports will appear here for review."
                />
            )}

            <ul className="space-y-3">
                {reports.map((report) => (
                    <li
                        key={report.id}
                        data-testid={`forum-report-${report.id}`}
                        className="ui-surface space-y-3"
                    >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="ui-note">
                                    {report.reason} · {report.status}
                                    {report.post_id ? ' · post' : report.thread_id ? ' · thread' : ''}
                                </p>
                                <p className="text-sm font-medium mt-1">
                                    {report.thread_title || report.post_preview || 'Forum content'}
                                </p>
                                {report.reporter_name && (
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Reported by {report.reporter_name}
                                    </p>
                                )}
                            </div>
                            <time className="text-sm text-muted-foreground">
                                {new Date(report.created_at).toLocaleString()}
                            </time>
                        </div>
                        {report.details && (
                            <p className="text-sm text-muted-foreground border-l-2 border-border pl-3">
                                {report.details}
                            </p>
                        )}
                        <div className="flex flex-wrap gap-2 items-center">
                            {report.thread_id && (
                                <Link
                                    href={`/community/forum/thread/${report.thread_id}`}
                                    className="ui-link text-sm"
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
                                            onClick={() => {
                                                if (DESTRUCTIVE_ACTIONS.has(action)) {
                                                    setPending({
                                                        id: report.id,
                                                        title:
                                                            report.thread_title ||
                                                            report.post_preview ||
                                                            'this content',
                                                        action,
                                                        label,
                                                    });
                                                    return;
                                                }
                                                updateMutation.mutate({
                                                    id: report.id,
                                                    status: 'resolved',
                                                    action,
                                                });
                                            }}
                                            className="ui-button small secondary"
                                        >
                                            <Icon size={14} aria-hidden="true" /> {label}
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        disabled={updateMutation.isPending}
                                        onClick={() =>
                                            updateMutation.mutate({ id: report.id, status: 'dismissed' })
                                        }
                                        className="ui-button small ghost"
                                    >
                                        <X size={14} aria-hidden="true" /> Dismiss
                                    </button>
                                </>
                            )}
                        </div>
                        {updateMutation.isError && (
                            <p className="text-sm" role="alert">
                                {getErrorMessage(updateMutation.error)}
                            </p>
                        )}
                    </li>
                ))}
            </ul>

            {totalPages > 1 && (
                <div className="ui-pagination">
                    <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="ui-button small secondary"
                    >
                        Previous
                    </button>
                    <span>
                        {page} / {totalPages}
                    </span>
                    <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="ui-button small secondary"
                    >
                        Next
                    </button>
                </div>
            )}

            <ConfirmDialog
                open={pending !== null}
                onOpenChange={(open) => {
                    if (!open) setPending(null);
                }}
                title={pending?.label || 'Confirm moderation'}
                description={
                    pending
                        ? `Apply “${pending.label}” to ${pending.title}? This cannot be easily undone.`
                        : undefined
                }
                confirmLabel={pending?.label || 'Confirm'}
                cancelLabel="Cancel"
                destructive
                loading={updateMutation.isPending}
                error={updateMutation.error ? getErrorMessage(updateMutation.error) : undefined}
                onConfirm={() => {
                    if (!pending) return;
                    updateMutation.mutate({
                        id: pending.id,
                        status: 'resolved',
                        action: pending.action,
                    });
                }}
            />
        </div>
    );
}
