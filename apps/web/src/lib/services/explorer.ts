import { API_BASE_URL, fetchWithAuth } from './client';
import { ExplorerApiError } from './explorer-errors';

export { ExplorerApiError, isExplorerNotFound, isExplorerNetworkError, toExplorerApiError } from './explorer-errors';

// Types match Go backend DTOs
export interface ExplorerMetrics {
    chain: string;
    total_transactions: number;
    total_volume: number;
    active_wallets: number;
    active_nodes: number;
    block_height: number;
    avg_block_time_ms: number;
    total_bandwidth_gb: number;
    transactions_per_second: number;
    tps_window_hours?: number;
    region_distribution?: Record<string, number>;
    last_updated: string;
    data_source?: 'aggregated' | 'live';
    time_series_available?: boolean;
}

export interface TransactionSummary {
    tx_hash: string;
    chain: string;
    from_address: string;
    to_address: string;
    amount: number;
    currency: string;
    status: string;
    tx_type: string;
    timestamp: string;
    fee: number;
}

export interface TransactionListResponse {
    transactions: TransactionSummary[];
    total: number;
    page: number;
    page_size: number;
}

export interface NodeSummary {
    node_id: string;
    provider_id?: string;
    provider_username?: string;
    name?: string;
    chain: string;
    region: string;
    country: string;
    city?: string;
    isp?: string;
    latitude: number;
    longitude: number;
    is_active: boolean;
    is_validator: boolean;
    uptime_percent: number;
    active_sessions: number;
    bandwidth_gb: number;
    last_heartbeat: string;
}

export interface NodeListResponse {
    nodes: NodeSummary[];
    total: number;
    active: number;
    page: number;
    page_size: number;
}

export interface BlockSummary {
    block_hash: string;
    block_number: number;
    chain: string;
    timestamp: string;
    transaction_count: number;
    validator_pubkey?: string;
}

export interface BlockListResponse {
    blocks: BlockSummary[];
    total: number;
    page: number;
    page_size: number;
}

export interface WalletDetails {
    address: string;
    chain: string;
    balance_sol: number;
    balance_platform: number;
    sol_price_usd: number;
    transaction_count: number;
    first_activity: string;
    last_activity: string;
    is_contract: boolean;
    linked_user_id?: string;
}

export interface TransactionDetail extends TransactionSummary {
    block_hash: string;
    block_number: number;
    program_id?: string;
    confirmations: number;
    raw_data?: any;
}

export interface ContractSummary {
    address: string;
    chain: string;
    name: string;
    contract_type: string;
    is_verified: boolean;
    total_calls: number;
    deployed_at: string;
}

export interface ContractListResponse {
    contracts: ContractSummary[];
    total: number;
    page: number;
    page_size: number;
}

export interface ContractDetails {
    address: string;
    name: string;
    chain: string;
    contract_type: string;
    is_verified: boolean;
    total_calls: number;
    deployed_at: string;
    deployer_address?: string;
    description?: string;
    source_code?: string;
    abi?: any;
}

export interface NetworkHealth {
    status: string;
    solana_health: string;
    database_health: string;
    active_nodes: number;
    avg_response_time_ms: number;
    last_checked: string;
}

export interface ExplorerDecentralizationStatus {
    chain: string;
    window_slots: number;
    latest_attested_slot: number;
    recent_slots_analyzed: number;
    unique_writers: number;
    min_writers_required: number;
    slots_meeting_quorum: number;
    conflicting_slots: number;
    quorum_ratio: number;
    explorer_mode: string;
    fully_decentralized: boolean;
    last_updated: string;
}

export interface ExplorerWriterHealth {
    writer_id: string;
    rpc_endpoint: string;
    writer_public_key?: string;
    signature_scheme?: string;
    has_attestation_signature?: boolean;
    identity_verified?: boolean;
    latest_slot: number;
    lag_slots: number;
    attestation_count: number;
    slots_covered: number;
    participation_ratio: number;
    conflicting_slots: number;
    first_attested_at: string;
    last_attested_at: string;
}

export interface ExplorerDecentralizationWritersResponse {
    chain: string;
    window_slots: number;
    latest_attested_slot: number;
    recent_slots_analyzed: number;
    min_writers_required: number;
    writers: ExplorerWriterHealth[];
    last_updated: string;
}

// Service Functions

// P1-16: thin wrapper so every service function can propagate an AbortSignal.
// Components should create an AbortController in useEffect and pass its signal:
//   const ctrl = new AbortController();
//   getSomething(..., ctrl.signal);
//   return () => ctrl.abort();
async function xfetch(url: string, signal?: AbortSignal): Promise<Response> {
    return fetch(url, signal ? { signal } : undefined);
}

async function throwExplorerError(response: Response, fallback: string): Promise<never> {
    throw await ExplorerApiError.fromResponse(response, fallback);
}

async function explorerFetch<T>(url: string, fallback: string, signal?: AbortSignal): Promise<T> {
    try {
        const response = await xfetch(url, signal);
        if (!response.ok) await throwExplorerError(response, fallback);
        return response.json();
    } catch (err) {
        if (err instanceof ExplorerApiError) throw err;
        throw new ExplorerApiError('network', err instanceof Error ? err.message : fallback);
    }
}

export async function getExplorerMetrics(chain = 'all', signal?: AbortSignal): Promise<ExplorerMetrics> {
    const response = await xfetch(`${API_BASE_URL}/v1/explorer/metrics?chain=${chain}`, signal);
    if (!response.ok) await throwExplorerError(response, 'Failed to fetch explorer metrics');
    return response.json();
}

export async function getNetworkStats(signal?: AbortSignal): Promise<{ total_transactions: number; total_volume: number; active_nodes: number }> {
    const response = await xfetch(`${API_BASE_URL}/v1/explorer/stats`, signal);
    if (!response.ok) throw new Error('Failed to fetch network stats');
    return response.json();
}

export async function getRecentTransactions(page = 1, pageSize = 10, chain?: string, txType?: string, status?: string, signal?: AbortSignal): Promise<TransactionListResponse> {
    let url = `${API_BASE_URL}/v1/explorer/transactions?page=${page}&page_size=${pageSize}`;
    if (chain) url += `&chain=${encodeURIComponent(chain)}`;
    if (txType) url += `&type=${encodeURIComponent(txType)}`;
    if (status) url += `&status=${encodeURIComponent(status)}`;

    const response = await xfetch(url, signal);
    if (!response.ok) await throwExplorerError(response, 'Failed to fetch transactions');
    return response.json();
}

export async function getTransactionDetails(hash: string, signal?: AbortSignal): Promise<TransactionDetail> {
    return explorerFetch(`${API_BASE_URL}/v1/explorer/transactions/${hash}`, 'Failed to fetch transaction details', signal);
}

export async function getWalletDetails(address: string, signal?: AbortSignal): Promise<WalletDetails> {
    return explorerFetch(`${API_BASE_URL}/v1/explorer/wallets/${address}`, 'Failed to fetch wallet details', signal);
}

export async function getWalletTransactions(address: string, page = 1, pageSize = 20, signal?: AbortSignal): Promise<TransactionListResponse> {
    return explorerFetch(
        `${API_BASE_URL}/v1/explorer/wallets/${address}/transactions?page=${page}&page_size=${pageSize}`,
        'Failed to fetch wallet transactions',
        signal,
    );
}

export async function getBlocks(page = 1, pageSize = 10, chain = 'solana', signal?: AbortSignal): Promise<BlockListResponse> {
    const response = await xfetch(`${API_BASE_URL}/v1/explorer/blocks?page=${page}&page_size=${pageSize}&chain=${chain}`, signal);
    if (!response.ok) await throwExplorerError(response, 'Failed to fetch blocks');
    return response.json();
}

export async function getNodes(
    page = 1,
    pageSize = 20,
    activeOnly = true,
    validatorOnly?: boolean,
    signal?: AbortSignal,
    q?: string,
): Promise<NodeListResponse> {
    let url = `${API_BASE_URL}/v1/explorer/nodes?page=${page}&page_size=${pageSize}&active=${activeOnly}`;
    if (validatorOnly) url += `&validator=true`;
    const trimmed = q?.trim();
    if (trimmed) url += `&q=${encodeURIComponent(trimmed)}`;
    const response = await xfetch(url, signal);
    if (!response.ok) await throwExplorerError(response, 'Failed to fetch nodes');
    return response.json();
}

/** Normalize success_rate from API (0–100 percent) or legacy fraction (0–1). */
export function successRatePercent(value?: number | null): number {
    if (value == null || Number.isNaN(value)) return 0;
    if (value > 1) return Math.min(100, value);
    return value * 100;
}

export function formatSuccessRate(value?: number | null, decimals = 1): string {
    return `${successRatePercent(value).toFixed(decimals)}%`;
}

// Lightweight type returned by GET /nodes/geo — only what the map engine needs
export interface NodeGeoPoint {
    node_id: string;
    lat: number;
    lon: number;
    is_active: boolean;
    is_validator: boolean;
    uptime_percent: number;
    active_sessions: number;
    country: string;
    region: string;
    city?: string;
    isp?: string;
}

export interface NodeGeoResponse {
    nodes: NodeGeoPoint[];
    total: number;
}

/** Fetches the minimal geo dataset used exclusively by the map engine. */
export async function getNodeGeo(activeOnly = false, validatorOnly = false, signal?: AbortSignal): Promise<NodeGeoResponse> {
    let url = `${API_BASE_URL}/v1/explorer/nodes/geo?active=${activeOnly}`;
    if (validatorOnly) url += `&validator=true`;
    const response = await xfetch(url, signal);
    if (!response.ok) throw new Error('Failed to fetch node geo data');
    return response.json();
}

export async function getBandwidthStats(period = '24h', signal?: AbortSignal): Promise<any> {
    const response = await xfetch(`${API_BASE_URL}/v1/explorer/bandwidth?period=${period}`, signal);
    if (!response.ok) throw new Error('Failed to fetch bandwidth stats');
    return response.json();
}

export async function getContracts(page = 1, pageSize = 20, signal?: AbortSignal): Promise<ContractListResponse> {
    return explorerFetch(
        `${API_BASE_URL}/v1/explorer/contracts?page=${page}&page_size=${pageSize}`,
        'Failed to fetch contracts',
        signal,
    );
}

export async function getContractDetails(address: string, signal?: AbortSignal): Promise<ContractDetails> {
    return explorerFetch(`${API_BASE_URL}/v1/explorer/contracts/${address}`, 'Failed to fetch contract details', signal);
}

export async function getNetworkHealth(signal?: AbortSignal): Promise<NetworkHealth> {
    const response = await xfetch(`${API_BASE_URL}/v1/explorer/network/health`, signal);
    if (!response.ok) throw new Error('Failed to fetch network health');
    return response.json();
}

export async function getExplorerDecentralizationStatus(windowSlots = 256, signal?: AbortSignal): Promise<ExplorerDecentralizationStatus> {
    const response = await xfetch(`${API_BASE_URL}/v1/explorer/decentralization/status?window_slots=${windowSlots}`, signal);
    if (!response.ok) throw new Error('Failed to fetch explorer decentralization status');
    return response.json();
}

export async function getExplorerDecentralizationWriters(windowSlots = 256, signal?: AbortSignal): Promise<ExplorerDecentralizationWritersResponse> {
    const response = await xfetch(`${API_BASE_URL}/v1/explorer/decentralization/writers?window_slots=${windowSlots}`, signal);
    if (!response.ok) throw new Error('Failed to fetch explorer writer health');
    return response.json();
}

// --- Analytics & Leaderboard ---

export interface AnalyticsPoint {
    timestamp: string;
    value: number;
}

export interface AnalyticsResponse {
    period: string;
    transaction_volume: AnalyticsPoint[];
    bandwidth_gb: AnalyticsPoint[];
    active_nodes: AnalyticsPoint[];
    active_wallets: AnalyticsPoint[];
    metrics_available: boolean;
    message?: string;
}

export interface LeaderboardEntry {
    rank: number;
    node_id: string;
    name?: string;
    region: string;
    country: string;
    uptime_percent: number;
    bandwidth_gb: number;
    active_sessions: number;
    quality_score: number;
    is_validator: boolean;
}

export interface LeaderboardResponse {
    entries: LeaderboardEntry[];
    category: string;
    period: string;
}

export interface NodeDetail {
    node_id: string;
    provider_id?: string;
    provider_username?: string;
    name?: string;
    chain: string;
    region: string;
    country: string;
    city?: string;
    isp?: string;
    is_active: boolean;
    is_validator: boolean;
    stake_amount: number;
    commission_rate: number;
    uptime_percent: number;
    latency_ms: number;
    quality_score: number;
    success_rate: number;
    active_sessions: number;
    total_sessions: number;
    bandwidth_gb: number;
    bytes_up: number;
    bytes_down: number;
    last_heartbeat: string;
    version?: string;
    hotkey?: string;
}

export async function getBlockDetail(blockId: string | number, signal?: AbortSignal): Promise<BlockSummary & { transactions?: TransactionSummary[] }> {
    return explorerFetch(`${API_BASE_URL}/v1/explorer/blocks/${blockId}`, 'Failed to fetch block detail', signal);
}

export async function getAnalytics(period = '24h', from?: string, to?: string, signal?: AbortSignal): Promise<AnalyticsResponse> {
    let url = `${API_BASE_URL}/v1/explorer/analytics?period=${period}`;
    if (from) url += `&from=${encodeURIComponent(from)}`;
    if (to) url += `&to=${encodeURIComponent(to)}`;
    const response = await xfetch(url, signal);
    if (!response.ok) await throwExplorerError(response, 'Failed to fetch analytics');
    return response.json();
}

export async function getLeaderboard(category = 'uptime', period = '24h', signal?: AbortSignal): Promise<LeaderboardResponse> {
    const response = await xfetch(`${API_BASE_URL}/v1/explorer/leaderboard?category=${category}&period=${period}`, signal);
    if (!response.ok) throw new Error('Failed to fetch leaderboard');
    return response.json();
}

export async function getNodeDetail(nodeId: string, signal?: AbortSignal): Promise<NodeDetail> {
    return explorerFetch(`${API_BASE_URL}/v1/explorer/nodes/${nodeId}`, 'Failed to fetch node detail', signal);
}

export async function getValidators(page = 1, pageSize = 20, signal?: AbortSignal): Promise<NodeListResponse> {
    const response = await xfetch(`${API_BASE_URL}/v1/explorer/validators?page=${page}&page_size=${pageSize}`, signal);
    if (!response.ok) throw new Error('Failed to fetch validators');
    return response.json();
}

// --- Sessions ---

export interface ExplorerSession {
    session_id: string;
    session_type: string;
    status: string;
    bytes_used: number;
    start_time: string;
    end_time: string;
}

export interface ExplorerSessionsResponse {
    sessions: ExplorerSession[];
    total: number;
    active_count: number;
    page: number;
    page_size: number;
}

export async function getExplorerSessions(
    page = 1, pageSize = 20, status?: string, type?: string, signal?: AbortSignal
): Promise<ExplorerSessionsResponse> {
    let url = `${API_BASE_URL}/v1/explorer/sessions?page=${page}&page_size=${pageSize}`;
    if (status) url += `&status=${status}`;
    if (type) url += `&type=${type}`;
    return explorerFetch<ExplorerSessionsResponse>(url, 'Failed to fetch sessions', signal);
}

// --- Provider Earnings ---

export interface ProviderEarning {
    node_id: string;
    provider_address: string;
    session_count: number;
    bandwidth_gb: number;
    total_earned: number;
    last_payout: string;
}

export interface EarningsSummary {
    total_paid: number;
    active_providers: number;
    avg_earning: number;
    tx_count: number;
}

export interface ProviderEarningsResponse {
    providers: ProviderEarning[];
    total: number;
    summary: EarningsSummary;
    volume_chart: AnalyticsPoint[];
    page: number;
    page_size: number;
}

export async function getProviderEarnings(
    period = '24h', page = 1, pageSize = 20, signal?: AbortSignal
): Promise<ProviderEarningsResponse> {
    return explorerFetch<ProviderEarningsResponse>(
        `${API_BASE_URL}/v1/explorer/earnings?period=${period}&page=${page}&page_size=${pageSize}`,
        'Failed to fetch provider earnings',
        signal,
    );
}

// --- Health History ---

export interface HealthHistoryPoint {
    timestamp: string;
    status: string;
    active_nodes: number;
    avg_response_ms: number;
}

export interface HealthHistoryResponse {
    history: HealthHistoryPoint[];
    uptime_percent: number;
    events: { timestamp: string; status: string; subsystem: string; message: string }[];
    metrics_available: boolean;
    message?: string;
}

export async function getHealthHistory(period = '24h', signal?: AbortSignal): Promise<HealthHistoryResponse> {
    return explorerFetch(`${API_BASE_URL}/v1/explorer/health/history?period=${period}`, 'Failed to fetch health history', signal);
}
