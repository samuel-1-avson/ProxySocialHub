import { apiGet, apiPost } from './client';
import type { Listing } from './marketplace';

export interface PendingListingsResponse {
    listings: Listing[];
    total: number;
    page: number;
    limit: number;
}

export function getPendingListings(page = 1, limit = 20) {
    return apiGet<PendingListingsResponse>('/v1/moderation/listings/pending', {
        page: String(page),
        limit: String(limit),
    });
}

export function approveListing(id: string) {
    return apiPost<{ message: string; listing: Listing }>(`/v1/moderation/listings/${id}/approve`);
}

export function rejectListing(id: string, reason?: string) {
    return apiPost<{ message: string; listing: Listing }, { reason?: string }>(
        `/v1/moderation/listings/${id}/reject`,
        reason ? { reason } : undefined,
    );
}

export const moderationKeys = {
    all: ['moderation'] as const,
    pending: (page?: number) => [...moderationKeys.all, 'pending', page] as const,
};
