/**
 * Provider-Buyer Relationships API Module
 * Track ongoing relationships between providers and buyers
 */

import { apiGet, apiPost } from './client';

// ============ Types ============

export interface ProviderBuyerRelationship {
    buyer_id: string;
    buyer_name: string;
    buyer_username?: string;
    buyer_avatar?: string;
    buyer_email?: string;
    first_session_at: string;
    last_session_at: string;
    total_bandwidth_gb: number;
    total_spent: number;
    session_count: number;
    // For buyer view - provider info
    provider_id?: string;
    provider_name?: string;
    provider_username?: string;
    provider_avatar?: string;
}

export interface RelationshipDetail extends ProviderBuyerRelationship {
    sessions: RelationshipSession[];
    milestones_together: number;
    reviews_given: number;
    avg_rating?: number;
}

export interface RelationshipSession {
    session_id: string;
    started_at: string;
    ended_at?: string;
    bandwidth_gb: number;
    amount_spent: number;
    status: string;
}

export interface RefillOffer {
    discount_percent: number;
    bonus_gb: number;
    message: string;
    valid_for_days?: number;
}

export interface RefillOfferResponse {
    offer_id: string;
    message: string;
    sent_at: string;
}

export interface RelationshipStats {
    total_relationships: number;
    total_bandwidth_sold_gb: number;
    total_revenue: number;
    avg_sessions_per_buyer: number;
    top_buyers: ProviderBuyerRelationship[];
    recent_first_time_buyers: ProviderBuyerRelationship[];
}

// ============ Provider APIs ============

/**
 * Get all buyer relationships for the current provider
 */
export async function getProviderRelationships(): Promise<ProviderBuyerRelationship[]> {
    const data = await apiGet<{ relationships: ProviderBuyerRelationship[] }>('/v1/provider/relationships');
    return data.relationships || [];
}

/**
 * Get detailed information about a specific buyer relationship
 */
export async function getProviderRelationshipDetail(buyerId: string): Promise<RelationshipDetail> {
    return apiGet<RelationshipDetail>(`/v1/provider/relationships/${buyerId}`);
}

/**
 * Send a refill offer to an existing buyer
 */
export async function sendRefillOffer(
    buyerId: string,
    offer: RefillOffer
): Promise<RefillOfferResponse> {
    return apiPost<RefillOfferResponse>(`/v1/provider/relationships/${buyerId}/offer`, offer);
}

/**
 * Get relationship statistics for provider dashboard
 */
export async function getProviderRelationshipStats(): Promise<RelationshipStats> {
    const data = await apiGet<{ stats: RelationshipStats }>('/v1/provider/relationships/stats');
    return data.stats;
}

// ============ Buyer APIs ============

/**
 * Get all provider relationships for the current buyer
 */
export async function getBuyerRelationships(): Promise<ProviderBuyerRelationship[]> {
    const data = await apiGet<{ relationships: ProviderBuyerRelationship[] }>('/v1/buyer/relationships');
    return data.relationships || [];
}

/**
 * Get detailed information about a specific provider relationship
 */
export async function getBuyerRelationshipDetail(providerId: string): Promise<RelationshipDetail> {
    return apiGet<RelationshipDetail>(`/v1/buyer/relationships/${providerId}`);
}

// ============ Query Keys ============

export const relationshipKeys = {
    all: ['relationships'] as const,
    provider: {
        all: () => [...relationshipKeys.all, 'provider'] as const,
        lists: () => [...relationshipKeys.provider.all(), 'list'] as const,
        detail: (buyerId: string) => [...relationshipKeys.provider.all(), 'detail', buyerId] as const,
        stats: () => [...relationshipKeys.provider.all(), 'stats'] as const,
    },
    buyer: {
        all: () => [...relationshipKeys.all, 'buyer'] as const,
        lists: () => [...relationshipKeys.buyer.all(), 'list'] as const,
        detail: (providerId: string) => [...relationshipKeys.buyer.all(), 'detail', providerId] as const,
    },
};

// ============ Helpers ============

export function formatRelationshipDuration(firstSessionAt: string): string {
    const firstDate = new Date(firstSessionAt);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 7) return `${diffDays} days`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months`;
    return `${Math.floor(diffDays / 365)} years`;
}

export function getRelationshipTier(totalSpent: number, sessionCount: number): 'new' | 'regular' | 'vip' | 'champion' {
    if (sessionCount >= 20 || totalSpent >= 500) return 'champion';
    if (sessionCount >= 5 || totalSpent >= 100) return 'vip';
    if (sessionCount >= 2) return 'regular';
    return 'new';
}

export function getTierColor(tier: string): string {
    const colors: Record<string, string> = {
        new: 'text-gray-400',
        regular: 'text-blue-400',
        vip: 'text-purple-400',
        champion: 'text-amber-400',
    };
    return colors[tier] || 'text-gray-400';
}

export function getTierLabel(tier: string): string {
    const labels: Record<string, string> = {
        new: 'New Customer',
        regular: 'Regular',
        vip: 'VIP',
        champion: 'Champion',
    };
    return labels[tier] || tier;
}
