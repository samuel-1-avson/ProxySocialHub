import { apiGet, apiPost } from './client';
import type { Listing } from './marketplace';

export interface PendingListingsResponse {
    listings: Listing[];
    total: number;
    page: number;
    limit: number;
}

export interface MarketplaceFunnelSummary {
    from: string;
    to: string;
    filters: {
        collection?: string;
        country?: string;
        seller_id?: string;
    };
    steps: Array<{ event_name: string; count: number }>;
    conversion: {
        view_to_order?: number;
        order_to_escrow_confirmed?: number;
        view_to_escrow_confirmed?: number;
        [key: string]: number | undefined;
    };
    countries: string[];
}

export type MarketplaceFunnelQuery = {
    from?: string;
    to?: string;
    collection?: string;
    country?: string;
};

function funnelQuery(params: MarketplaceFunnelQuery = {}) {
    const q: Record<string, string> = {};
    if (params.from) q.from = params.from;
    if (params.to) q.to = params.to;
    if (params.collection) q.collection = params.collection;
    if (params.country) q.country = params.country;
    return q;
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

export function getAdminMarketplaceFunnel(params: MarketplaceFunnelQuery = {}) {
    return apiGet<MarketplaceFunnelSummary>('/v1/moderation/marketplace/funnel', funnelQuery(params));
}

export function getSellerMarketplaceFunnel(params: MarketplaceFunnelQuery = {}) {
    return apiGet<MarketplaceFunnelSummary>('/v1/analytics/marketplace/funnel', funnelQuery(params));
}

export const moderationKeys = {
    all: ['moderation'] as const,
    pending: (page?: number) => [...moderationKeys.all, 'pending', page] as const,
    funnel: (params: MarketplaceFunnelQuery) => [...moderationKeys.all, 'funnel', params] as const,
};
