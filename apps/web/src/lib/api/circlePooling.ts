/**
 * Circle Pooling API Module
 * Enterprise bandwidth pooling and revenue sharing
 */

import { apiGet, apiPost } from './client';

// ============ Types ============

export interface CirclePoolStatus {
    circle_id: string;
    circle_name: string;
    total_capacity_gb: number;
    available_capacity_gb: number;
    used_capacity_gb: number;
    utilization_percent: number;
    member_count: number;
    active_session_count: number;
    members: PoolMemberInfo[];
    is_enterprise_ready: boolean;
}

export interface PoolMemberInfo {
    provider_id: string;
    provider_name: string;
    avatar_url: string;
    contributed_gb: number;
    used_gb: number;
    share_percent: number;
    revenue_earned: number;
    is_online: boolean;
    quality_score: number;
}

export interface CircleMember {
    provider_id: string;
    provider_name: string;
    provider_avatar?: string;
    contributed_gb: number;
    share_percent: number;
    revenue_share_percent: number;
    joined_at: string;
    is_active: boolean;
}

export interface CircleContribution {
    contribution_id: string;
    provider_id: string;
    bandwidth_gb: number;
    price_per_gb: number;
    contributed_at: string;
    expires_at?: string;
    status: 'active' | 'expired' | 'withdrawn';
}

export interface EnterpriseQuote {
    quote_id: string;
    bandwidth_gb: number;
    price_per_gb: number;
    total_price: number;
    validity_hours: number;
    expires_at: string;
    available_capacity: number;
}

export interface CircleSession {
    session_id: string;
    enterprise_id: string;
    enterprise_name: string;
    bandwidth_gb: number;
    price_per_gb: number;
    total_paid: number;
    started_at: string;
    expires_at: string;
    status: 'active' | 'expired' | 'cancelled';
}

export interface CircleRevenue {
    revenue_id: string;
    period_start: string;
    period_end: string;
    total_pool_revenue: number;
    provider_id: string;
    provider_share_percent: number;
    provider_revenue: number;
    sessions_count: number;
    status: 'pending' | 'paid' | 'processing';
    paid_at?: string;
    tx_hash?: string;
}

export interface Circle {
    id: string;
    name: string;
    description: string;
    owner_id: string;
    type: 'public' | 'private' | 'enterprise';
    status: string;
    bandwidth_pool_gb: number;
    price_per_gb: number;
    member_count: number;
    created_at: string;
}

export interface ContributeBandwidthRequest {
    bandwidth_gb: number;
}

export interface RequestQuoteRequest {
    bandwidth_gb: number;
    duration_months: number;
    requirements?: string;
    max_price_per_gb?: number;
}

export interface AcceptQuoteRequest {
    quote_id: string;
    billing_address?: string;
    contact_email: string;
}

// ============ Circle Management APIs ============

/**
 * Get all circles (public and user is member of)
 */
export async function getCircles(): Promise<Circle[]> {
    const data = await apiGet<{ circles: Circle[] }>('/v1/circles');
    return data.circles || [];
}

/**
 * Get a specific circle by ID
 */
export async function getCircle(circleId: string): Promise<Circle> {
    return apiGet<Circle>(`/v1/circles/${circleId}`);
}

// ============ Circle Pool APIs ============

/**
 * Get circle pool status
 */
export async function getCirclePoolStatus(circleId: string): Promise<CirclePoolStatus> {
    return apiGet<CirclePoolStatus>(`/v1/circles/${circleId}/pool`);
}

/**
 * Contribute bandwidth to the pool as a provider
 */
export async function contributeBandwidth(
    circleId: string,
    request: ContributeBandwidthRequest
): Promise<{ message: string; contributed_gb: number; total_pool_gb: number }> {
    return apiPost(`/v1/circles/${circleId}/pool/contribute`, request);
}

/**
 * Get circle revenue for current user
 */
export async function getCircleRevenue(circleId: string): Promise<{
    revenues: CircleRevenue[];
    total_earned: number;
    total_claimed: number;
    available: number;
}> {
    return apiGet(`/v1/circles/${circleId}/revenue`);
}

/**
 * Claim circle revenue
 */
export async function claimCircleRevenue(circleId: string): Promise<{
    message: string;
    amount: number;
    transactions: number;
}> {
    return apiPost(`/v1/circles/${circleId}/revenue/claim`, {});
}

// ============ Enterprise Quote APIs ============

/**
 * Request a quote for enterprise bandwidth
 */
export async function requestEnterpriseQuote(
    circleId: string,
    request: RequestQuoteRequest
): Promise<EnterpriseQuote> {
    return apiPost<EnterpriseQuote>(`/v1/circles/${circleId}/quotes`, request);
}

/**
 * Get all quotes for a circle
 */
export async function getCircleQuotes(circleId: string): Promise<{ quotes: EnterpriseQuote[] }> {
    return apiGet(`/v1/circles/${circleId}/quotes`);
}

/**
 * Accept a quote and create circle session
 */
export async function acceptQuote(quoteId: string): Promise<{
    message: string;
    quote: EnterpriseQuote;
    session: CircleSession;
}> {
    return apiPost(`/v1/circles/quotes/${quoteId}/accept`, {});
}

// ============ Circle Session APIs ============

/**
 * Get circle sessions
 */
export async function getCircleSessions(circleId: string): Promise<{ sessions: CircleSession[] }> {
    return apiGet(`/v1/circles/${circleId}/sessions`);
}

/**
 * Create a session using circle pool bandwidth
 */
export async function createCircleSession(
    circleId: string,
    bandwidthGb: number
): Promise<CircleSession> {
    return apiPost(`/v1/circles/${circleId}/sessions`, { bandwidth_gb: bandwidthGb });
}

// ============ Query Keys ============

export const circlePoolingKeys = {
    all: ['circle'] as const,
    circles: () => [...circlePoolingKeys.all, 'list'] as const,
    detail: (id: string) => [...circlePoolingKeys.all, 'detail', id] as const,
    status: (circleId: string) => [...circlePoolingKeys.all, 'status', circleId] as const,
    members: (circleId: string) => [...circlePoolingKeys.all, 'members', circleId] as const,
    contributions: (circleId: string) => [...circlePoolingKeys.all, 'contributions', circleId] as const,
    revenues: (circleId: string) => [...circlePoolingKeys.all, 'revenues', circleId] as const,
    sessions: (circleId: string) => [...circlePoolingKeys.all, 'sessions', circleId] as const,
    quotes: (circleId: string) => [...circlePoolingKeys.all, 'quotes', circleId] as const,
};

// ============ Helpers ============

export function formatBandwidth(bytes: number): string {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1000) return `${(gb / 1024).toFixed(2)} TB`;
    return `${gb.toFixed(2)} GB`;
}

export function formatCurrency(amount: number, currency = 'SOL'): string {
    return `${amount.toFixed(amount >= 1 ? 3 : 6)} ${currency}`;
}

export function getUtilizationColor(percent: number): string {
    if (percent < 50) return 'text-success';
    if (percent < 75) return 'text-warning';
    if (percent < 90) return 'text-warning';
    return 'text-destructive';
}

export function getUtilizationLabel(percent: number): string {
    if (percent < 50) return 'Healthy';
    if (percent < 75) return 'Moderate';
    if (percent < 90) return 'High';
    return 'Critical';
}
