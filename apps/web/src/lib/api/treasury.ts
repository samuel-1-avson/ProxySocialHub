/**
 * Public treasury transparency API (no auth).
 */

const API_BASE_URL = '';

export interface WalletBalanceView {
    address: string;
    balance_lamports: number;
    balance_sol: number;
    min_balance_sol?: number;
    max_balance_sol?: number;
    replenish_sol?: number;
    needs_replenish?: boolean;
}

export interface TreasuryStats {
    address: string;
    balance_sol: number;
    hot: WalletBalanceView;
    cold?: WalletBalanceView;
    combined_balance_sol: number;
    status: string;
    last_checked_at: string;
}

export interface PublicBatchPayout {
    id: string;
    status: string;
    total_amount: number;
    total_count: number;
    success_count: number;
    tx_hash?: string;
    solscan_url?: string;
    processed_at?: string;
}

export interface PublicTreasuryResponse {
    network: string;
    sol_price_usd: number;
    oracle_configured: boolean;
    treasury?: TreasuryStats;
    lifetime_provider_paid_sol: number;
    recent_batch_payouts: PublicBatchPayout[];
    operational_healthy: boolean;
    timestamp: string;
}

export async function getPublicTreasury(signal?: AbortSignal): Promise<PublicTreasuryResponse> {
    const response = await fetch(`${API_BASE_URL}/v1/treasury/public`, signal ? { signal } : undefined);
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Failed to load treasury data');
    }
    return response.json();
}
