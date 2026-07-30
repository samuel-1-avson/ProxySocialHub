/**
 * Provider API Module
 * CLI downloads, token management, and node registration
 */

import { ApiError, apiGet, apiPost, apiDelete, apiPut } from './client';

// ============ Types ============

export interface CLIDownload {
    platform: string;
    arch: string;
    version: string;
    package_type?: 'daemon' | 'wrapper' | 'bundle';
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
    expires_in_days?: number;
    expires_soon?: boolean;
    is_expired?: boolean;
    created_at: string;
}

export type ProviderReadinessStatus = 'ready' | 'attention' | 'action_required';
export type ProviderReadinessCheckStatus = 'complete' | 'attention' | 'action_required';

export interface ProviderReadinessCheck {
    id: string;
    label: string;
    status: ProviderReadinessCheckStatus;
    blocking: boolean;
    message: string;
    action_label?: string;
    action_href?: string;
}

export interface ProviderReadinessSummary {
    active_tokens: number;
    nodes: number;
    online_nodes: number;
    proof_verified_nodes: number;
    payout_wallet_nodes: number;
    active_listings: number;
    last_heartbeat_at?: string;
    proof_mode: string;
    ready_for_traffic: boolean;
    ready_for_marketplace: boolean;
    ready_for_payouts: boolean;
}

export interface ProviderReadinessResponse {
    status: ProviderReadinessStatus;
    summary: ProviderReadinessSummary;
    checks: ProviderReadinessCheck[];
    next?: {
        check_id: string;
        action_label: string;
        action_href: string;
        message: string;
    };
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

export interface ProviderApplication {
    id: string;
    user_id: string;
    isp: string;
    location: string;
    bandwidth: string;
    status: 'pending' | 'approved' | 'rejected';
    created_at: string;
    updated_at?: string;
    reviewer_id?: string | null;
}

export interface ProviderApplicationEligibility {
    status: 'pending' | 'approved' | 'rejected';
    auto_approved: boolean;
    reason_code?: string;
    reason?: string;
    solana_network?: string;
    required_sol?: number;
    current_sol?: number;
}

export interface ProviderDetectedGeo {
    ip?: string;
    isp: string;
    location: string;
    city?: string;
    region?: string;
    country?: string;
    detected: boolean;
}

export interface ProviderApplicationResponse {
    message: string;
    application: ProviderApplication;
    auto_approved?: boolean;
    eligibility?: ProviderApplicationEligibility;
    detected_geo?: ProviderDetectedGeo;
}

export interface ProviderStatusResponse {
    status: 'none' | 'pending' | 'approved' | 'rejected';
    application?: ProviderApplication;
    auto_approved?: boolean;
    eligibility?: ProviderApplicationEligibility;
    detected_geo?: ProviderDetectedGeo;
}

export interface KYCStatusResponse {
    user_id: string;
    kyc_status: 'none' | 'not_started' | 'pending' | 'approved' | 'rejected' | 'insufficient_funds';
    trust_tier: string;
    on_chain_trust_tier?: number;
    on_chain_kyc_status?: number;
    on_chain_attested_at?: number;
}

export interface KYCActionResponse {
    message?: string;
    kyc_status: 'none' | 'not_started' | 'pending' | 'approved' | 'rejected' | 'insufficient_funds';
    trust_tier?: string;
    solana_network?: string;
    awaiting_vendor?: boolean;
    required_sol?: number;
    current_sol?: number;
    error?: string;
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
export function getCLIDownloadUrl(platform: string, arch: string, version?: string, packageType = 'daemon'): string {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
    let url = `${apiBase}/v1/cli/download?platform=${platform}&arch=${arch}&package_type=${packageType}`;
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

export async function getProviderReadiness(): Promise<ProviderReadinessResponse> {
    return apiGet<ProviderReadinessResponse>('/v1/provider/readiness');
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

export async function rotateProviderToken(tokenId: string): Promise<CreateTokenResponse> {
    return apiPost<CreateTokenResponse>(`/v1/provider/tokens/${tokenId}/rotate`, {});
}

// ============ Provider Application & KYC API ============

/**
 * Submit an application to become a provider
 */
export async function applyForProvider(data: {
    bandwidth: string;
}): Promise<ProviderApplicationResponse> {
    return apiPost<ProviderApplicationResponse>('/v1/provider/apply', data);
}

/**
 * Get current provider application status
 */
export async function getProviderStatus(): Promise<ProviderStatusResponse> {
    try {
        return await apiGet<ProviderStatusResponse>('/v1/provider/status');
    } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
            return { status: 'none' };
        }

        throw error;
    }
}

/**
 * Get KYC status for a user
 */
export async function getKYCStatus(userId: string): Promise<KYCStatusResponse> {
    return apiGet<KYCStatusResponse>(`/v1/kyc/status/${userId}`);
}

/** Begin KYC (testnet may approve via wallet+SOL; mainnet enters pending). */
export async function startKYC(): Promise<KYCActionResponse> {
    return apiPost<KYCActionResponse>('/v1/kyc/start', {});
}

/** Re-run balance/attestation check for pending or insufficient_funds. */
export async function recheckKYC(): Promise<KYCActionResponse> {
    return apiPost<KYCActionResponse>('/v1/kyc/recheck', {});
}

// ============ Node Registration API ============

export interface NodeRegistration {
    id: string;
    name: string;
    ip_address?: string;
    country?: string;
    city?: string;
    hotkey?: string;
    gateway_node_id?: string;
    wallet_address?: string;
    status: 'online' | 'offline' | 'pending';
    quality_score: number;
    current_tier: string;
    base_price_per_gb: number;
    uptime_percent: number;
    latency_ms?: number;
    active_connections: number;
    latest_heartbeat_verified?: boolean;
    latest_heartbeat_signer?: string;
    latest_heartbeat_verification_error?: string;
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
    return apiPut<NodeRegistration>(`/v1/provider/nodes/${nodeId}`, data);
}

/**
 * Delete a node
 */
export async function deleteNode(nodeId: string): Promise<{ message: string }> {
    return apiDelete<{ message: string }>(`/v1/provider/nodes/${nodeId}`);
}

/** Server-published URLs for provider-node (no secrets). */
export interface NodeConnectInfo {
    node_id: string;
    control_api_url: string;
    gateway_tunnel_addr: string;
    use_tls: boolean;
    connection_type: string;
    config_path_hint: string;
    start_command: string;
}

export async function getNodeConnectInfo(nodeId: string): Promise<NodeConnectInfo> {
    return apiGet<NodeConnectInfo>(`/v1/provider/nodes/${nodeId}/connect`);
}

export interface NodeHistory {
    uptime: any[];
    bandwidth: {
        timestamp: string;
        upload: number;
        download: number;
    }[];
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
    history?: NodeHistory;
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

// ============ On-chain claim (manual payout) ============

export interface ProviderClaimSummary {
    pending_sol: number;
    pending_count: number;
    payout_wallet: string;
    min_claim_sol: number;
    oracle_ready: boolean;
}

export interface ProviderClaimPrepareResponse {
    claim_id: string;
    message: string;
    amount_sol: number;
    wallet: string;
    expires_at: string;
    instructions?: string;
}

export async function getProviderClaimSummary(): Promise<ProviderClaimSummary> {
    return apiGet<ProviderClaimSummary>('/v1/provider/claim/summary');
}

export async function prepareProviderClaim(): Promise<ProviderClaimPrepareResponse> {
    return apiPost<ProviderClaimPrepareResponse>('/v1/provider/claim/prepare', {});
}

export async function confirmProviderClaim(payload: {
    claim_id: string;
    message: string;
    signature: string;
}): Promise<{ status: string; tx_hash?: string; amount_sol?: number }> {
    return apiPost('/v1/provider/claim/confirm', payload);
}

/** Send a heartbeat for a node (keeps it marked online). */
export async function sendNodeHeartbeat(
    nodeId: string,
    metrics?: { latency_ms?: number; active_connections?: number; uptime_percent?: number }
): Promise<{ status: string; server_time: number }> {
    return apiPost(`/v1/provider/nodes/${nodeId}/heartbeat`, metrics ?? {});
}

// ============ Provider service configurations ============

export interface ProviderServiceNodeSummary {
    ip_address?: string;
    country_code?: string;
    quality_score?: number;
}

export interface ProviderServiceConfig {
    id: string;
    node_id: string;
    enable_http: boolean;
    enable_https: boolean;
    enable_socks5: boolean;
    enable_ssh_tunnel: boolean;
    max_bandwidth_mbps: number;
    priority_tier: 'standard' | 'priority' | 'enterprise';
    allowed_countries: string[];
    blocked_countries: string[];
    max_concurrent_connections: number;
    max_daily_bandwidth_gb: number;
    captcha_solving_enabled: boolean;
    javascript_render_enabled: boolean;
    browser_fingerprint_enabled: boolean;
    screenshot_enabled: boolean;
    price_multiplier_http: number;
    price_multiplier_socks5: number;
    is_active: boolean;
    node?: ProviderServiceNodeSummary;
}

export interface ProviderServiceTemplate {
    name: string;
    description: string;
    config: Partial<ProviderServiceConfig>;
}

export async function getProviderServiceConfigs(): Promise<ProviderServiceConfig[]> {
    return apiGet<ProviderServiceConfig[]>('/v1/provider/services');
}

export async function getProviderServiceTemplates(): Promise<{ templates: ProviderServiceTemplate[] }> {
    return apiGet<{ templates: ProviderServiceTemplate[] }>('/v1/provider/services/templates');
}

export async function updateProviderServiceConfig(
    nodeId: string,
    updates: Partial<ProviderServiceConfig>
): Promise<ProviderServiceConfig> {
    return apiPut<ProviderServiceConfig>(`/v1/provider/services/${nodeId}`, updates);
}
