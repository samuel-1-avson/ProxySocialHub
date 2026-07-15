import { apiGet, apiPatch } from './client';

export type ForumReportStatus = 'pending' | 'resolved' | 'dismissed' | 'all';

export interface ForumReportRow {
    id: string;
    reporter_id: string;
    thread_id?: string;
    post_id?: string;
    reason: string;
    details: string;
    status: ForumReportStatus;
    created_at: string;
    updated_at: string;
    reporter_name?: string;
    thread_title?: string;
    post_preview?: string;
}

export interface ForumReportsResponse {
    reports: ForumReportRow[];
    total: number;
    page: number;
    limit: number;
}

export function getForumReports(page = 1, limit = 20, status: ForumReportStatus = 'pending') {
    return apiGet<ForumReportsResponse>('/v1/moderation/forum/reports', {
        page: String(page),
        limit: String(limit),
        status,
    });
}

export function updateForumReportStatus(id: string, status: 'resolved' | 'dismissed' | 'pending') {
    return apiPatch<{ message: string; status: string }, { status: string }>(
        `/v1/moderation/forum/reports/${id}`,
        { status },
    );
}

export const forumModerationKeys = {
    all: ['forum-moderation'] as const,
    reports: (page: number, status: ForumReportStatus) =>
        [...forumModerationKeys.all, 'reports', page, status] as const,
};
