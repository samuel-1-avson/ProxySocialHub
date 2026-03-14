import { API_BASE_URL, fetchWithAuth } from './client';

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
    region_distribution?: Record<string, number>;
    last_updated: string;
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
    name?: string;
    chain: string;
    region: string;
    country: string;
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

// Service Functions

export async function getExplorerMetrics(chain = 'all'): Promise<ExplorerMetrics> {
    const response = await fetch(`${API_BASE_URL}/v1/explorer/metrics?chain=${chain}`);
    if (!response.ok) throw new Error('Failed to fetch explorer metrics');
    return response.json();
}

export async function getNetworkStats(): Promise<{ total_transactions: number; total_volume: number; active_nodes: number }> {
    const response = await fetch(`${API_BASE_URL}/v1/explorer/stats`);
    if (!response.ok) throw new Error('Failed to fetch network stats');
    return response.json();
}

export async function getRecentTransactions(page = 1, pageSize = 10, chain?: string): Promise<TransactionListResponse> {
    let url = `${API_BASE_URL}/v1/explorer/transactions?page=${page}&page_size=${pageSize}`;
    if (chain) url += `&chain=${chain}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch transactions');
    return response.json();
}

export async function getTransactionDetails(hash: string): Promise<TransactionDetail> {
    const response = await fetch(`${API_BASE_URL}/v1/explorer/transactions/${hash}`);
    if (!response.ok) throw new Error('Failed to fetch transaction details');
    return response.json();
}

export async function getWalletDetails(address: string): Promise<WalletDetails> {
    // Use fetchWithAuth if we want to potentially see private details, but public is fine too
    // Using regular fetch for public explorer view
    const response = await fetch(`${API_BASE_URL}/v1/explorer/wallets/${address}`);
    if (!response.ok) throw new Error('Failed to fetch wallet details');
    return response.json();
}

export async function getWalletTransactions(address: string, page = 1, pageSize = 20): Promise<TransactionListResponse> {
    const response = await fetch(`${API_BASE_URL}/v1/explorer/wallets/${address}/transactions?page=${page}&page_size=${pageSize}`);
    if (!response.ok) throw new Error('Failed to fetch wallet transactions');
    return response.json();
}

export async function getBlocks(page = 1, pageSize = 10, chain = 'solana'): Promise<BlockListResponse> {
    const response = await fetch(`${API_BASE_URL}/v1/explorer/blocks?page=${page}&page_size=${pageSize}&chain=${chain}`);
    if (!response.ok) throw new Error('Failed to fetch blocks');
    return response.json();
}

export async function getNodes(page = 1, pageSize = 20, activeOnly = true): Promise<NodeListResponse> {
    const response = await fetch(`${API_BASE_URL}/v1/explorer/nodes?page=${page}&page_size=${pageSize}&active=${activeOnly}`);
    if (!response.ok) throw new Error('Failed to fetch nodes');
    return response.json();
}

export async function getBandwidthStats(period = '24h'): Promise<any> {
    const response = await fetch(`${API_BASE_URL}/v1/explorer/bandwidth?period=${period}`);
    if (!response.ok) throw new Error('Failed to fetch bandwidth stats');
    return response.json();
}

export async function getContractDetails(address: string): Promise<ContractDetails> {
    const response = await fetch(`${API_BASE_URL}/v1/explorer/contracts/${address}`);
    if (!response.ok) throw new Error('Failed to fetch contract details');
    return response.json();
}

export async function getNetworkHealth(): Promise<NetworkHealth> {
    const response = await fetch(`${API_BASE_URL}/v1/explorer/network/health`);
    if (!response.ok) throw new Error('Failed to fetch network health');
    return response.json();
}
