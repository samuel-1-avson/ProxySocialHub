import client from './client';

// ============ Types ============

export interface Wallet {
    id: string;
    user_id: string;
    balance: number; // Main fiat balance (GHS)
    currency: string;
    linked_solana_address?: string;
    linked_bittensor_addr?: string;
    created_at: string;
}

export interface WalletTransaction {
    id: string;
    wallet_id: string;
    amount: number;
    balance_after: number;
    type: 'deposit' | 'withdrawal' | 'purchase' | 'earning' | 'refund';
    description: string;
    reference?: string;
    tx_hash?: string;
    status: 'pending' | 'completed' | 'failed';
    created_at: string;
}

export interface DepositResponse {
    status: string;
    reference: string;
    message: string;
    authorization_url: string;
}

export interface WithdrawResponse {
    status: string;
    reference: string;
    new_balance: number;
}

// ============ API Functions ============

export async function getWallet(): Promise<Wallet> {
    const res = await client.get('/wallet');
    // Handle { wallet: ... } wrapper if present, based on web api.ts
    return res.data?.wallet || res.data;
}

export async function getTransactions(limit = 20, offset = 0): Promise<{ transactions: WalletTransaction[]; total: number }> {
    const res = await client.get('/wallet/transactions', { params: { limit, offset } });
    return res.data;
}

export async function depositWallet(amount: number, email: string): Promise<DepositResponse> {
    const res = await client.post('/wallet/deposit', { amount, email });
    return res.data;
}

export async function withdrawWallet(amount: number, phone: string, network: string): Promise<WithdrawResponse> {
    const res = await client.post('/wallet/withdraw', { amount, phone, network });
    return res.data;
}

export async function linkWallet(address: string, chain: 'solana' | 'bittensor', signature?: string, message?: string) {
    const res = await client.post('/wallet/link', { wallet_address: address, chain, signature, message });
    return res.data;
}
