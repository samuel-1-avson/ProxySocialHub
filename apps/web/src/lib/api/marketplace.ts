/**
 * Marketplace API Module
 * All listing and order-related API calls and types
 */

import { apiGet, apiPost, apiPut, apiDelete } from './client';

// ============ Types ============

export interface Listing {
    id: string;
    provider_id: string;
    node_id: string;
    title: string;
    description: string;
    price_per_gb: number;
    min_bandwidth_gb: number;
    max_bandwidth_gb?: number;
    available_bandwidth_gb: number;
    status: 'active' | 'paused' | 'sold_out';
    proxy_type: 'rotating' | 'sticky' | 'both';
    country?: string;
    city?: string;
    isp?: string;
    uptime_percent: number;
    avg_latency_ms: number;
    total_sales: number;
    rating: number;
    created_at: string;
    provider?: {
        id: string;
        username: string;
        display_name?: string;
        avatar_url?: string;
        rating: number;
        verified: boolean;
    };
}

export interface Order {
    id: string;
    buyer_id: string;
    listing_id: string;
    node_id: string;
    bandwidth_gb: number;
    price_total: number;
    status: 'pending' | 'paid' | 'active' | 'completed' | 'cancelled' | 'refunded';
    session_type: 'rotating' | 'sticky';
    session_id?: string;
    created_at: string;
    completed_at?: string;
}

export interface ListingFilters {
    country?: string;
    min_price?: number;
    max_price?: number;
    proxy_type?: 'rotating' | 'sticky';
    min_rating?: number;
    sort_by?: 'price' | 'rating' | 'sales' | 'uptime';
    sort_order?: 'asc' | 'desc';
    page?: number;
    limit?: number;
}

export interface CreateOrderRequest {
    listing_id: string;
    bandwidth_gb: number;
    session_type: 'rotating' | 'sticky';
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
 * Get user's orders
 */
export function getOrders(status?: Order['status']) {
    const params = status ? { status } : undefined;
    return apiGet<Order[]>('/v1/orders', params);
}

/**
 * Get a specific order
 */
export function getOrder(id: string) {
    return apiGet<Order>(`/v1/orders/${id}`);
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
