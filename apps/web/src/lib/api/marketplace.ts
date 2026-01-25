/**
 * Marketplace API Module
 * All listing and order-related API calls and types
 */

import { apiGet, apiPost, apiPut, apiDelete } from './client';

// ============ Types ============

export interface Listing {
    id: string;
    seller_id: string;
    node_id: string;
    title: string;
    description: string;
    price_per_gb: number;
    min_purchase_gb: number;
    available_bandwidth_gb: number;
    max_concurrency: number;
    proxy_type: 'residential' | 'mobile' | 'datacenter' | 'rotating' | 'sticky' | 'both';
    protocol: string;
    status: 'active' | 'paused' | 'sold_out' | string;
    country?: string;
    city?: string;
    isp?: string;
    uptime_percent: number;
    avg_latency_ms: number;
    success_rate: number;
    quality_score: number;
    views_count: number;
    saves_count: number;
    orders_count: number;
    total_sales: number;
    rating: number;
    bulk_discounts?: any[];
    staked_amount: number;
    priority_rank: number;
    is_priority: boolean;
    zk_proof?: string;
    privacy_enabled?: boolean;
    created_at: string;
    seller?: {
        id: string;
        username: string;
        display_name?: string;
        avatar_url?: string;
        avg_rating?: number;
        verified: boolean;
    };
}

export interface Order {
    id: string;
    buyer_id: string;
    seller_id: string;
    listing_id: string;
    node_id: string;
    bandwidth_gb: number;
    price_total: number;
    amount?: number; // Legacy support
    status: 'pending' | 'paid' | 'active' | 'completed' | 'cancelled' | 'refunded' | string;
    session_type: 'rotating' | 'sticky';
    session_id?: string;
    tx_hash?: string;
    created_at: string;
    completed_at?: string;
    listing?: {
        title: string;
    };
    escrow_status?: string;
}

export interface ListingFilters {
    country?: string;
    min_price?: number;
    max_price?: number;
    proxy_type?: 'residential' | 'mobile' | 'datacenter' | 'rotating' | 'sticky' | string;
    min_rating?: number;
    sort_by?: 'price' | 'rating' | 'sales' | 'uptime' | string;
    sort_order?: 'asc' | 'desc';
    page?: number;
    limit?: number;
}

export interface CreateOrderRequest {
    bandwidth_gb: number;
    session_type: 'rotating' | 'sticky';
}

export interface StakeNodeRequest {
    amount_sol: number;
    listing_id: string;
}

export interface UnstakeNodeRequest {
    listing_id: string;
}

export interface SolanaPaymentParams {
    program_id: string;
    escrow_pda: string;
    buyer_pubkey: string;
    seller_pubkey: string;
    amount_lamports: number;
    amount_sol: number;
    bandwidth_gb: number;
    oracle_pubkey: string;
}

export interface ProviderNode {
    id: string;
    name: string;
    ip_address: string;
    country: string;
    city: string;
    status: string;
    quality_score: number;
    latency_ms?: number;
    uptime_percent?: number;
    active_connections?: number;
    connection_type?: string;
}

// ============ API Functions ============

/**
 * Get marketplace listings with filters
 */
export function getListings(filters?: ListingFilters) {
    const params: Record<string, string> = {};
    if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined) {
                params[key] = value.toString();
            }
        });
    }
    return apiGet<{ listings: Listing[]; total: number; page: number }>('/v1/listings', params);
}

/**
 * Get detailed telemetry for all provider nodes
 */
export function getProviderNodes() {
    return apiGet<{ nodes: ProviderNode[] }>('/v1/provider/nodes');
}

/**
 * Get a specific listing
 */
export function getListing(id: string) {
    return apiGet<Listing>(`/v1/listings/${id}`);
}

/**
 * Get featured/top listings
 */
export function getFeaturedListings() {
    return apiGet<Listing[]>('/v1/listings/featured');
}

/**
 * Search listings
 */
export function searchListings(query: string) {
    return apiGet<{ listings: Listing[]; total: number }>('/v1/listings/search', { q: query });
}

/**
 * Create a new order
 */
export function createOrder(data: CreateOrderRequest) {
    return apiPost<Order>('/v1/orders', data);
}

/**
 * Initiate a Solana escrow payment for an order
 */
export function initiateSmartContractPayment(orderId: string) {
    return apiPost<SolanaPaymentParams>(`/v1/orders/${orderId}/pay/solana`);
}

/**
 * Get user's orders
 */
export async function getOrders(status?: Order['status']) {
    const params = status ? { status } : undefined;
    const data = await apiGet<Order[] | { orders: Order[] }>('/v1/orders', params);
    return Array.isArray(data) ? data : data.orders || [];
}

/**
 * Initiate a node staking session to boost priority
 */
export async function stakeNode(data: StakeNodeRequest) {
    return apiPost<{ tx_hash: string; new_rank: number }>('/v1/staking/node/stake', data);
}

/**
 * Initiate unstaking cooldown
 */
export async function unstakeNode(data: UnstakeNodeRequest) {
    return apiPost<{ message: string; available_at: string }>('/v1/staking/node/unstake', data);
}

/**
 * Get a specific order
 */
export function getOrder(id: string) {
    return apiGet<Order>(`/v1/orders/${id}`);
}

/**
 * Get reputation telemetry fragments for ZK-proof generation
 */
export async function getReputationTelemetry() {
    return apiGet<{ fragments: any[]; trust_root: string }>('/v1/reputation/telemetry');
}

/**
 * Submit a generated ZK-reputation proof for verification
 */
export async function verifyReputationProof(proof: any) {
    return apiPost<{ token: string; expires_at: string }>('/v1/reputation/verify', { proof });
}

/**
 * Cancel an order
 */
export function cancelOrder(id: string) {
    return apiPost<{ message: string }>(`/v1/orders/${id}/cancel`);
}

// ============ Query Keys ============

export const marketplaceKeys = {
    all: ['marketplace'] as const,
    listings: (filters?: ListingFilters) => [...marketplaceKeys.all, 'listings', filters] as const,
    listing: (id: string) => [...marketplaceKeys.all, 'listing', id] as const,
    featured: () => [...marketplaceKeys.all, 'featured'] as const,
    search: (query: string) => [...marketplaceKeys.all, 'search', query] as const,
    orders: (status?: string) => [...marketplaceKeys.all, 'orders', status] as const,
    order: (id: string) => [...marketplaceKeys.all, 'order', id] as const,
};
