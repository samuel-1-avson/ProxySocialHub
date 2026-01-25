/**
 * Sessions API Module
 * All session-related API calls and types
 */

import { apiGet, apiPost, apiDelete } from './client';

// ============ Types ============

export interface Session {
    id: string;
    user_id: string;
    type: 'rotating' | 'sticky';
    status: 'active' | 'terminated' | 'expired';
    node_id?: string;
    credentials_user: string;
    credentials_pass: string;
    proxy_endpoint?: string;
    bytes_used: number;
    bytes_limit: number;
    tx_hash?: string;
    created_at: string;
    expires_at?: string;
    terminated_at?: string;
    listing?: {
        id: string;
        price_per_gb?: number;
        price_per_hour?: number;
    };
    escrow_address?: string; // Derived or same as tx_hash in some contexts
}

export interface ProxyCredentials {
    username: string;
    password: string;
    endpoint: string;
    port: number;
    protocol: 'http' | 'socks5';
}

export interface CreateSessionRequest {
    type: 'rotating' | 'sticky';
    node_id?: string;
    duration_hours?: number;
    bandwidth_gb?: number;
}

export interface CreateSessionResponse {
    session: Session;
    proxy_credentials: ProxyCredentials;
}

export interface UsageStats {
    session_id: string;
    bytes_used: number;
    bytes_limit: number;
    percent_used: number;
    gb_used: number;
    cost_ghs: number;
}

// ============ API Functions ============

/**
 * Get all user sessions
 */
export async function getSessions() {
    const data = await apiGet<{ sessions: any[] }>('/v1/sessions');
    if (data && Array.isArray(data.sessions)) {
        return data.sessions.map((item: any) => item.session || item) as Session[];
    }
    return [] as Session[];
}

/**
 * Get a specific session
 */
export function getSession(id: string) {
    return apiGet<Session>(`/v1/sessions/${id}`);
}

/**
 * Create a new proxy session
 */
export function createSession(data: CreateSessionRequest) {
    return apiPost<CreateSessionResponse>('/v1/sessions', data);
}

/**
 * Terminate a session
 */
export function terminateSession(id: string) {
    return apiDelete(`/v1/sessions/${id}`);
}

// ============ Query Keys ============

export const sessionKeys = {
    all: ['sessions'] as const,
    lists: () => [...sessionKeys.all, 'list'] as const,
    detail: (id: string) => [...sessionKeys.all, 'detail', id] as const,
    usage: (id: string) => [...sessionKeys.all, 'usage', id] as const,
    totalUsage: () => [...sessionKeys.all, 'totalUsage'] as const,
};
