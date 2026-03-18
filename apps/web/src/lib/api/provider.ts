/**
 * Provider API Module
 * CLI downloads, token management, and node registration
 */

import { apiGet, apiPost, apiDelete } from './client';

// ============ Types ============

export interface CLIDownload {
    platform: string;
    arch: string;
    version: string;
    download_url: string;
    file_size: number;
    checksum: string;
    filename: string;
}

export interface CLIDownloadsResponse {
    downloads: Record<string, CLIDownload>;
    latest_version: string;
}

export interface ProviderToken {
    id: string;
    name: string;
    masked: string;
    is_active: boolean;
    last_used: string;
    expires_at?: string;
    created_at: string;
}

export interface CreateTokenRequest {
    name: string;
    expires_in?: number; // Days until expiration, 0 = no expiration
}

export interface CreateTokenResponse {
    id: string;
    name: string;
    token: string; // Raw token - ONLY returned once at creation
    is_active: boolean;
    expires_at?: string;
    created_at: string;
}

// ============ CLI Download API ============

/**
 * Get available CLI downloads for all platforms
 */
export async function getCLIDownloads(): Promise<CLIDownloadsResponse> {
    return apiGet<CLIDownloadsResponse>('/v1/cli/downloads');
}

/**
 * Get the latest CLI download for current platform
 */
export async function getLatestCLI(platform?: string, arch?: string): Promise<CLIDownload> {
    const params: Record<string, string> = {};
    if (platform) params.platform = platform;
    if (arch) params.arch = arch;
    return apiGet<CLIDownload>('/v1/cli/downloads/latest', params);
}

/**
 * Download CLI binary
 * Returns a URL that can be used to download the binary
 */
export function getCLIDownloadUrl(platform: string, arch: string, version?: string): string {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
    let url = `${apiBase}/v1/cli/download?platform=${platform}&arch=${arch}`;
    if (version) {
        url += `&version=${version}`;
    }
    return url;
}

/**
 * Detect current platform and architecture
 */
export function detectPlatform(): { platform: string; arch: string } {
    const userAgent = typeof window !== 'undefined' ? window.navigator.userAgent : '';
    const platform = typeof window !== 'undefined' ? window.navigator.platform : '';
    
    let detectedPlatform = 'linux';
    let detectedArch = 'amd64';
    
    // Detect platform
    if (userAgent.indexOf('Win') !== -1) {
        detectedPlatform = 'windows';
    } else if (userAgent.indexOf('Mac') !== -1) {
        detectedPlatform = 'macos';
    } else if (userAgent.indexOf('Linux') !== -1) {
        detectedPlatform = 'linux';
    }
    
    // Detect architecture (limited detection via JS)
    if (platform.indexOf('arm') !== -1 || platform.indexOf('aarch') !== -1) {
        detectedArch = 'arm64';
    } else {
        detectedArch = 'amd64';
    }
    
    return { platform: detectedPlatform, arch: detectedArch };
}

// ============ Provider Token API ============

/**
 * List all provider tokens for current user
 */
export async function getProviderTokens(): Promise<{ tokens: ProviderToken[] }> {
    return apiGet<{ tokens: ProviderToken[] }>('/v1/provider/tokens');
}

/**
 * Create a new provider token
 * WARNING: The raw token is ONLY returned once in the response
 */
export async function createProviderToken(data: CreateTokenRequest): Promise<CreateTokenResponse> {
    return apiPost<CreateTokenResponse>('/v1/provider/tokens', data);
}

/**
 * Revoke a provider token
 */
export async function revokeProviderToken(tokenId: string): Promise<{ message: string }> {
    return apiDelete<{ message: string }>(`/v1/provider/tokens/${tokenId}`);
}

// ============ Node Registration API ============

export interface NodeRegistration {
    id: string;
    name: string;
    ip_address?: string;
    country?: string;
    city?: string;
    status: 'online' | 'offline' | 'pending';
    quality_score: number;
    uptime_percent: number;
    latency_ms?: number;
    active_connections: number;
    created_at: string;
}

export interface CreateNodeRequest {
    name: string;
    ip_address?: string;
    country?: string;
    city?: string;
}

/**
 * Get all nodes for current provider
 */
export async function getMyNodes(): Promise<{ nodes: NodeRegistration[] }> {
    return apiGet<{ nodes: NodeRegistration[] }>('/v1/provider/nodes');
}

/**
 * Create a new node registration
 */
export async function createNode(data: CreateNodeRequest): Promise<NodeRegistration> {
    return apiPost<NodeRegistration>('/v1/provider/nodes', data);
}

/**
 * Update a node
 */
export async function updateNode(nodeId: string, data: Partial<CreateNodeRequest>): Promise<NodeRegistration> {
    return apiPost<NodeRegistration>(`/v1/provider/nodes/${nodeId}`, data);
}

/**
 * Delete a node
 */
export async function deleteNode(nodeId: string): Promise<{ message: string }> {
    return apiDelete<{ message: string }>(`/v1/provider/nodes/${nodeId}`);
}

/**
 * Get node uptime statistics
 */
export async function getNodeUptime(nodeId: string): Promise<{
    node_id: string;
    uptime_percent: number;
    avg_latency_ms: number;
    checks_24h: number;
    current_status: string;
    last_seen: string;
}> {
    return apiGet(`/v1/provider/nodes/${nodeId}/uptime`);
}

// ============ Earnings API ============

export interface EarningRecord {
    id: string;
    node_id: string;
    session_id: string;
    bandwidth_gb: number;
    gross_amount_sol: number;
    platform_fee_sol: number;
    net_amount_sol: number;
    earnings_multiplier: number;
    price_per_gb: number;
    status: 'pending' | 'paid' | 'failed';
    tx_hash?: string;
    created_at: string;
    paid_at?: string;
}

export interface EarningsSummary {
    total_earned_sol: number;
    pending_sol: number;
    paid_sol: number;
    total_sessions: number;
    total_bandwidth_gb: number;
    last_30_days_sol: number;
    last_7_days_sol: number;
}

/** Overall earnings summary for the provider dashboard. */
export async function getProviderEarningsSummary(): Promise<EarningsSummary> {
    return apiGet<EarningsSummary>('/v1/provider/earnings/summary');
}

/** Paginated list of all earning events. */
export async function getProviderEarnings(params?: { page?: number; limit?: number }): Promise<{
    earnings: EarningRecord[];
    total: number;
    page: number;
    limit: number;
}> {
    return apiGet('/v1/provider/earnings', params as Record<string, string>);
}

/** Completed payout history with on-chain tx_hash. */
export async function getProviderPayoutHistory(): Promise<{ payouts: EarningRecord[] }> {
    return apiGet('/v1/provider/earnings/history');
}

/** Send a heartbeat for a node (keeps it marked online). */
export async function sendNodeHeartbeat(
    nodeId: string,
    metrics?: { latency_ms?: number; active_connections?: number; uptime_percent?: number }
): Promise<{ status: string; server_time: number }> {
    return apiPost(`/v1/provider/nodes/${nodeId}/heartbeat`, metrics ?? {});
}
