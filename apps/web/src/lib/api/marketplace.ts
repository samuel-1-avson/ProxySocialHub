/**
 * Marketplace API Module
 * All listing and order-related API calls and types
 */

import { apiGet, apiPost, apiPut, apiDelete, publicApiGet } from './client';
import type { CatalogProductSummary } from './catalog';
import type { OrderStatus } from '@/lib/order-status';

export type { CatalogProductSummary } from './catalog';
export type { OrderStatus };
export {
    ORDER_STATUSES,
    isOrderStatus,
    orderStatusLabel,
    orderStatusDescription,
    orderCredentialsEligible,
    orderCancelEligible,
} from '@/lib/order-status';

/** Discovery embed for linked catalog merchandising (#11). */
const LISTING_INCLUDE_PRODUCT = { include: 'product' } as const;

function listingQueryParams(params: Record<string, string> = {}): Record<string, string> {
    return { ...params, ...LISTING_INCLUDE_PRODUCT };
}

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
    status: 'active' | 'paused' | 'sold_out' | 'pending_review' | string;
    country?: string;
    city?: string;
    isp?: string;
    uptime_percent: number;
    /** gateway | explorer | provider | listing — from linked node telemetry */
    sla_source?: 'gateway' | 'explorer' | 'provider' | 'listing' | string;
    avg_latency_ms: number;
    success_rate: number;
    quality_score: number;
    current_tier?: string;
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
    listing_offer_verified?: boolean;
    listing_offer_signer?: string;
    listing_offer_signed_at?: string;
    listing_offer_verification_error?: string;
    created_at: string;
    seller?: {
        id: string;
        username: string;
        display_name?: string;
        avatar_url?: string;
        avg_rating?: number;
        location?: string;
        verified: boolean;
        is_online?: boolean;
        last_seen_at?: string;
        reviews_count?: number;
        total_bandwidth_sold?: number;
        response_time_min?: number;
    };
    /** Present when fetched with ?include=product */
    catalog_product?: CatalogProductSummary;
}

export interface Order {
    id: string;
    buyer_id: string;
    seller_id: string;
    listing_id: string;
    node_id?: string;
    bandwidth_gb: number;
    price_total?: number;
    total_price?: number;
    amount?: number; // Legacy support
    status: OrderStatus;
    session_type?: 'rotating' | 'sticky';
    session_id?: string;
    tx_hash?: string;
    tx_signature?: string;
    created_at: string;
    completed_at?: string;
    listing?: {
        title: string;
    };
    escrow_status?: string;
    escrow_pda?: string;
}

export interface FacetBucket {
    value: string;
    count: number;
}

export interface PriceBucket {
    min: number;
    max: number;
    count: number;
}

export interface ListingFacets {
    countries: FacetBucket[];
    proxy_types: FacetBucket[];
    isps: FacetBucket[];
    price_buckets: PriceBucket[];
}

export interface ListingCollectionSummary {
    slug: string;
    title: string;
    description: string;
    count: number;
}

export interface ListingCollectionResponse {
    collection: Pick<ListingCollectionSummary, 'slug' | 'title' | 'description'>;
    listings: Listing[];
    total: number;
    page: number;
    limit: number;
}

export interface ListingFilters {
    country?: string;
    min_price?: number;
    max_price?: number;
    proxy_type?: 'residential' | 'mobile' | 'datacenter' | 'rotating' | 'sticky' | string;
    min_rating?: number;
    seller_id?: string;
    sort_by?: 'newest' | 'price' | 'price_asc' | 'price_desc' | 'rating' | 'popular' | 'sales' | 'uptime' | 'latency' | 'quality' | string;
    sort_order?: 'asc' | 'desc';
    page?: number;
    limit?: number;
}

export interface UpdateListingRequest {
    title?: string;
    description?: string;
    price_per_gb?: number;
    min_purchase_gb?: number;
    available_bandwidth_gb?: number;
    max_concurrency?: number;
    status?: 'active' | 'paused' | 'sold_out' | string;
}

export interface SavedListingEntry {
    id: string;
    listing_id: string;
    created_at: string;
    listing?: Listing;
}

export interface CreateOrderRequest {
    listing_id: string;
    bandwidth_gb: number;
    session_type?: 'rotating' | 'sticky';
}

export interface CreateOrderResponse {
    order: Order;
    session?: {
        id: string;
        status: string;
        type: string;
        listing_id?: string;
        node_id?: string;
        expires_at?: string;
        created_at: string;
    };
    proxy_credentials?: MarketplaceProxyCredentials;
}

export interface CreateListingRequest {
    title: string;
    description?: string;
    provider_node_id?: string;
    proxy_type: string;
    protocol: string;
    rotation_type?: string;
    country?: string;
    isp?: string;
    price_per_gb: number;
    min_purchase_gb?: number;
    available_bandwidth_gb: number;
    max_concurrency?: number;
    bulk_discounts?: Array<{
        min_gb: number;
        price_per_gb: number;
    }>;
    listing_offer_expires_at?: number;
    proof?: ProviderProofEnvelope;
}

export interface ProviderProofEnvelope {
    message_type: string;
    version: string;
    provider_node_id: string;
    gateway_node_id?: string;
    provider_hotkey: string;
    issued_at: number;
    nonce: string;
    payload_hash: string;
    signature: string;
}

export interface MyListingsResponse {
    listings: Listing[];
    total: number;
    page: number;
    limit: number;
}

export interface SessionFromListingRequest {
    listing_id: string;
    type?: 'rotating' | 'sticky';
    bandwidth_limit?: number; // bytes; 0 = use listing minimum
    bandwidth_gb?: number;
}

export interface MarketplaceProxyCredentials {
    username: string;
    password: string;
    endpoint: string;
    seller_name?: string;
    listing_title?: string;
}

export interface SessionFromListingResponse {
    session: {
        id: string;
        status: string;
        type: string;
        listing_id: string;
        node_id?: string;
        expires_at?: string;
        created_at: string;
    };
    proxy_credentials: MarketplaceProxyCredentials;
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
    /** True when buyer/seller PDA already exists and is funded on-chain. */
    escrow_already_funded?: boolean;
    on_chain_escrow_status?: string;
    /** BC-06: "legacy" | "multisig" */
    escrow_seed_kind?: string;
    /** Unix seconds; required for escrow_multisig PDA seeds. */
    escrow_expires_at?: number;
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
export interface MarketplaceGeoPin {
    listing_id: string;
    title: string;
    seller_id: string;
    proxy_type: string;
    protocol: string;
    country: string;
    isp?: string;
    city?: string;
    price_per_gb: number;
    available_bandwidth_gb: number;
    lat: number;
    lon: number;
    node_id?: string;
    node_active: boolean;
    uptime_percent: number;
    latency_ms?: number;
    sla_source?: 'gateway' | 'explorer' | 'provider' | 'listing' | string;
    geo_resolved: boolean;
    purchasable: boolean;
    listing_offer_verified?: boolean;
    listing_offer_signer?: string;
    listing_offer_signed_at?: string;
    listing_offer_verification_error?: string;
}

export interface MarketplaceGeoResponse {
    pins: MarketplaceGeoPin[];
    total: number;
}

export interface MapGeoMeta {
    source: string;
    display_label: string;
    estimated: boolean;
}

export interface MarketplaceMapPoint {
    id: string;
    kind: 'listing' | 'node' | string;
    lat: number;
    lon: number;
    title: string;
    country?: string;
    region?: string;
    city?: string;
    /** Coarse class only (residential/mobile/datacenter/fiber) — not ISP name. */
    network_class?: string;
    /** @deprecated Prefer network_class; raw ISP is no longer returned by map API. */
    isp?: string;
    status: 'active' | 'offline' | 'paused' | 'sold_out' | 'unknown' | string;
    purchasable: boolean;
    listing_id?: string;
    /** Opaque public node id (not the provider UUID). */
    node_id?: string;
    /** @deprecated Removed from public map payloads. */
    seller_id?: string;
    proxy_type?: string;
    protocol?: string;
    price_per_gb?: number;
    available_bandwidth_gb?: number;
    uptime_percent?: number;
    latency_ms?: number;
    quality_score?: number;
    success_rate?: number;
    trust_badge?: 'high_quality' | 'high_uptime' | 'reliable' | 'standard' | 'basic' | string;
    trust_label?: string;
    is_validator?: boolean;
    active_sessions?: number;
    sla_source?: 'gateway' | 'explorer' | 'provider' | 'listing' | string;
    geo_source: 'gps' | 'gateway' | 'explorer' | 'provider' | 'country_centroid' | 'region_hub' | 'city_centroid' | 'unknown' | string;
    geo?: MapGeoMeta;
    listing_offer_verified?: boolean;
    /** Optional proof metadata when include_proofs / enriched map payloads are requested. */
    listing_offer_signer?: string;
    listing_offer_signed_at?: string;
    listing_offer_verification_error?: string;
    heartbeat_verified?: boolean;
    heartbeat_signer?: string;
    heartbeat_signed_at?: string;
    heartbeat_verification_error?: string;
    catalog_product?: CatalogProductSummary;
}

export interface MarketplaceMapResponse {
    points: MarketplaceMapPoint[];
    total: number;
    listing_count: number;
    node_count: number;
    bbox_applied: boolean;
    generated_at: string;
}

export interface MarketplaceMapFilters {
    country?: string;
    proxy_type?: string;
    protocol?: string;
    min_price?: number | string;
    max_price?: number | string;
    min_uptime?: number | string;
    max_latency?: number | string;
    purchasable_only?: boolean;
    include_nodes?: boolean;
    active_nodes_only?: boolean;
    /** When true, node points are validators only (mirrors GET /explorer/nodes/geo?validator=true). */
    validator?: boolean;
    /** west,south,east,north */
    bbox?: string;
    /** Embed catalog_product on listing points (server-side enrich). */
    include_catalog?: boolean;
    /** Include listing offer / heartbeat proof fields (default false for slim map payloads). */
    include_proofs?: boolean;
}

export function getMarketplaceMapPoints(filters?: MarketplaceMapFilters) {
    const params: Record<string, string> = {};
    if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                params[key] = String(value);
            }
        });
    }
    return publicApiGet<MarketplaceMapResponse>('/v1/marketplace/map', params);
}

export function getListings(filters?: ListingFilters) {
    const params: Record<string, string> = {};
    if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined) {
                params[key] = value.toString();
            }
        });
    }
    return publicApiGet<{ listings: Listing[]; total: number; page: number }>(
        '/v1/listings',
        listingQueryParams(params),
    );
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
    return publicApiGet<{ listing: Listing; is_saved: boolean }>(
        `/v1/listings/${id}`,
        LISTING_INCLUDE_PRODUCT,
    );
}

/**
 * Get featured/top listings
 */
export async function getFeaturedListings(): Promise<Listing[]> {
    const data = await publicApiGet<{ listings: Listing[]; total: number }>(
        '/v1/listings/featured',
        LISTING_INCLUDE_PRODUCT,
    );
    return data.listings ?? [];
}

export function getListingFacets() {
    return publicApiGet<ListingFacets>('/v1/listings/facets');
}

export function getListingCollections() {
    return publicApiGet<{ collections: ListingCollectionSummary[] }>('/v1/listings/collections');
}

export function getListingCollection(slug: string, page = 1, limit = 20) {
    return publicApiGet<ListingCollectionResponse>(`/v1/listings/collections/${slug}`, listingQueryParams({
        page: String(page),
        limit: String(limit),
    }));
}

/**
 * Search listings
 */
export function searchListings(query: string) {
    return publicApiGet<{ listings: Listing[]; total: number }>(
        '/v1/listings/search',
        listingQueryParams({ q: query }),
    );
}

/**
 * Get current provider/seller listings.
 */
export function getMyListings(page = 1, limit = 20) {
    return apiGet<MyListingsResponse>('/v1/listings/my', listingQueryParams({
        page: String(page),
        limit: String(limit),
    }));
}

export interface ListingProofPolicy {
    mode: 'observe' | 'enforce';
    required: boolean;
    /** Dev/docker: control-api can sign with PROXYHUB_PROVIDER_SIGNING_KEY when wallet ≠ node hotkey */
    dev_server_signing?: boolean;
}

/**
 * Whether signed listing offers are required (public, no auth).
 */
export function getListingProofPolicy() {
    return publicApiGet<ListingProofPolicy>('/v1/system/provider-proof-policy');
}

export interface PriceSuggestion {
    suggested_price: number;
    min_market_price: number;
    max_market_price: number;
    soft_cap_price: number;
    hard_cap_price: number;
    currency: string;
    confidence_score: number;
}

/**
 * Suggested listing price for a country + proxy type (pricing oracle).
 */
export function getSuggestedListingPrice(country: string, proxyType: string) {
    return publicApiGet<PriceSuggestion>('/v1/suggest-price', {
        country,
        proxy_type: proxyType,
    });
}

export interface SignListingOfferDevResponse {
    proof: ProviderProofEnvelope;
    dev_server_signing?: boolean;
}

/**
 * Dev-only: sign a listing create payload with the server provider signing key.
 */
export function signListingOfferDev(data: CreateListingRequest) {
    return apiPost<SignListingOfferDevResponse, CreateListingRequest>(
        '/v1/provider/listings/sign-offer',
        data
    );
}

/**
 * Create a new marketplace listing.
 */
export function createListing(data: CreateListingRequest) {
    return apiPost<Listing, CreateListingRequest>('/v1/listings', data);
}

/**
 * Soft-delete a marketplace listing owned by the current seller.
 */
export function deleteListing(id: string) {
    return apiDelete<{ message: string }>(`/v1/listings/${id}`);
}

export function updateListing(id: string, data: UpdateListingRequest) {
    return apiPut<{ listing: Listing }>(`/v1/listings/${id}`, data);
}

/**
 * Save a marketplace listing for the current user.
 */
export function saveListing(id: string) {
    return apiPost<{ message: string }>(`/v1/listings/${id}/save`);
}

/**
 * Remove a marketplace listing from the current user's saved list.
 */
export function unsaveListing(id: string) {
    return apiDelete<{ message: string }>(`/v1/listings/${id}/save`);
}

/**
 * Create a new order and return the full backend provisioning response.
 */
export async function createOrderWithProvisioning(data: CreateOrderRequest) {
    const response = await apiPost<Order | CreateOrderResponse, CreateOrderRequest>('/v1/orders', data);
    if (response && typeof response === 'object' && 'order' in response) {
        return response as CreateOrderResponse;
    }
    return { order: response as Order };
}

/**
 * Create a new order.
 */
export async function createOrder(data: CreateOrderRequest) {
    const response = await createOrderWithProvisioning(data);
    return response.order;
}

/**
 * Initiate a Solana escrow payment for an order
 */
export function initiateSmartContractPayment(orderId: string) {
    return apiPost<SolanaPaymentParams>(`/v1/orders/${orderId}/pay/solana`);
}

/**
 * Confirm an order against an already-funded on-chain escrow PDA
 * (e.g. after initializeEscrow succeeded, or "account already in use" on retry).
 */
export function confirmEscrowPayment(orderId: string, txSignature?: string) {
    return apiPost<{
        order: Order;
        escrow_pda: string;
        on_chain_status?: string;
        already_active?: boolean;
    }>(`/v1/orders/${orderId}/confirm-escrow`, txSignature ? { tx_signature: txSignature } : {});
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
export async function getOrder(id: string) {
    const data = await apiGet<Order | { order: Order }>(`/v1/orders/${id}`);
    if (data && typeof data === 'object' && 'order' in data && data.order) {
        return data.order;
    }
    return data as Order;
}

export function getOrderProxyCredentials(orderId: string) {
    return apiGet<{ proxy_credentials: MarketplaceProxyCredentials }>(`/v1/orders/${orderId}/credentials`);
}

export async function waitForOrderActive(
    orderId: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<Order> {
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const pollIntervalMs = options?.pollIntervalMs ?? 2000;
    const started = Date.now();
    let sawActiveOrder = false;
    while (Date.now() - started < timeoutMs) {
        const order = await getOrder(orderId);
        if (order.status === 'active' || order.status === 'completed') {
            sawActiveOrder = true;
            // Order can be active while Redis session sync is still catching up.
            // Poll credentials until ready so callers do not race a 409.
            try {
                const creds = await getOrderProxyCredentials(orderId);
                if (creds?.proxy_credentials) {
                    return order;
                }
            } catch {
                // retryable — session still activating
            }
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    if (sawActiveOrder) {
        throw new Error(
            'Escrow confirmed but proxy credentials are not ready yet. Wait a moment and open the order again.',
        );
    }
    throw new Error('Timed out waiting for escrow confirmation. Check your wallet transaction and try again.');
}

export function getSavedListings(page = 1, limit = 20) {
    return apiGet<{ saved: SavedListingEntry[]; total: number; page: number; limit: number }>(
        '/v1/saved',
        listingQueryParams({ page: String(page), limit: String(limit) }),
    );
}

/**
 * Get reputation telemetry summary for reputation-gated UX
 */
export async function getReputationTelemetry() {
    return apiGet<{
        user_id: string;
        settled_proof_count: number;
        total_bytes_settled: number;
        proofs: Array<{
            id?: string;
            session_id?: string;
            created_at?: string;
        }>;
    }>('/v1/reputation/telemetry');
}

/**
 * Reputation proof verification is not implemented on-chain yet.
 * Previously returned a fake `ph-local-zk-*` client token (FE-04) — removed.
 */
export async function verifyReputationProof(_proof: unknown): Promise<never> {
    void _proof;
    throw Object.assign(new Error('ZK reputation verification is not available'), { status: 501 });
}

/**
 * Cancel an order
 */
export function cancelOrder(id: string) {
    return apiPost<{ message: string }>(`/v1/orders/${id}/cancel`);
}

export function createOrderFromListing(data: SessionFromListingRequest) {
    const bandwidthGb =
        data.bandwidth_gb ??
        (data.bandwidth_limit && data.bandwidth_limit > 0
            ? data.bandwidth_limit / (1024 * 1024 * 1024)
            : 1);

    return createOrderWithProvisioning({
        listing_id: data.listing_id,
        bandwidth_gb: bandwidthGb,
        session_type: data.type,
    });
}

/**
 * @deprecated Direct session creation from listings has been removed from the
 * public buyer flow. Use createOrderFromListing, then confirm escrow payment and
 * fetch credentials from /v1/orders/:id/credentials.
 */
export function createSessionFromListing(data: SessionFromListingRequest) {
    return createOrderFromListing(data);
}

// ============ Query Keys ============

export const marketplaceKeys = {
    all: ['marketplace'] as const,
    listings: (filters?: ListingFilters) => [...marketplaceKeys.all, 'listings', filters] as const,
    listing: (id: string) => [...marketplaceKeys.all, 'listing', id] as const,
    map: (filters?: MarketplaceMapFilters) => [...marketplaceKeys.all, 'map', filters] as const,
    featured: () => [...marketplaceKeys.all, 'featured'] as const,
    facets: () => [...marketplaceKeys.all, 'facets'] as const,
    collections: () => [...marketplaceKeys.all, 'collections'] as const,
    collection: (slug: string, page?: number) =>
        [...marketplaceKeys.all, 'collection', slug, page] as const,
    search: (query: string) => [...marketplaceKeys.all, 'search', query] as const,
    myListings: (page?: number) => [...marketplaceKeys.all, 'my-listings', page] as const,
    saved: () => [...marketplaceKeys.all, 'saved'] as const,
    orders: (status?: string) => [...marketplaceKeys.all, 'orders', status] as const,
    order: (id: string) => [...marketplaceKeys.all, 'order', id] as const,
    orderCredentials: (id: string) => [...marketplaceKeys.all, 'order', id, 'credentials'] as const,
};

export { catalogKeys } from './catalog';
