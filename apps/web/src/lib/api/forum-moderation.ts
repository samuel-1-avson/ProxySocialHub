import { apiGet, apiPatch, apiDelete } from './client';

export type ForumReportStatus = 'pending' | 'resolved' | 'dismissed' | 'all';

export type ForumReportAction = 'none' | 'hide' | 'lock' | 'hide_and_lock' | 'delete';

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

export function updateForumReportStatus(
    id: string,
    status: 'resolved' | 'dismissed' | 'pending',
    action: ForumReportAction = 'none',
) {
    return apiPatch<
        { message: string; status: string; action?: string; applied?: string },
        { status: string; action?: string }
    >(`/v1/moderation/forum/reports/${id}`, { status, action });
}

export function patchForumThreadModeration(
    id: string,
    body: { is_pinned?: boolean; is_locked?: boolean; is_hidden?: boolean },
) {
    return apiPatch(`/v1/moderation/forum/threads/${id}`, body);
}

export function deleteForumThreadModeration(id: string) {
    return apiDelete(`/v1/moderation/forum/threads/${id}`);
}

export function patchForumPostModeration(
    id: string,
    body: { is_hidden?: boolean; is_solution?: boolean },
) {
    return apiPatch(`/v1/moderation/forum/posts/${id}`, body);
}

export function deleteForumPostModeration(id: string) {
    return apiDelete(`/v1/moderation/forum/posts/${id}`);
}

export const forumModerationKeys = {
    all: ['forum-moderation'] as const,
    reports: (page: number, status: ForumReportStatus) =>
        [...forumModerationKeys.all, 'reports', page, status] as const,
};
