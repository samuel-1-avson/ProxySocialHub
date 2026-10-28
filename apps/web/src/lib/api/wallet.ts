/**
 * Wallet API Module
 * All wallet-related API calls and types
 */

import { apiGet, apiPost, apiDeleteWithBody, ApiError } from './client';

// ============ Types ============

export interface Wallet {
    id: string;
    balance_sol: number;
    balance_lamports?: number;
    earnings_payable_lamports?: number;
    earnings_payable_sol?: number;
    auto_payout_enabled?: boolean;
    auto_payout_threshold_lamports?: number;
    transactions_next_cursor?: string;
    on_chain_sol?: number;
    available_sol?: number;
    solana_network?: string;
    transactions?: WalletTransaction[];
    linked_solana_address?: string;
    created_at: string;
    updated_at?: string;
}

export interface WithdrawalSecurity {
    primary_withdrawal_address?: string | null;
    withdrawal_cooldown_active: boolean;
    withdrawal_cooldown_until?: string | null;
    withdrawal_address_changed_at?: string | null;
}

export interface UserSecurityFlag {
    id: string;
    flag_type: string;
    reason: string;
    resolved: boolean;
    resolved_at?: string | null;
    created_at: string;
}

export interface WalletTransaction {
    id: string;
    wallet_id?: string;
    amount: number;
    amount_lamports?: number;
    balance_after?: number;
    type: 'deposit' | 'withdrawal' | 'purchase' | 'earning' | 'refund' | string;
    description: string;
    reference?: string;
    tx_hash?: string;
    solscan_url?: string;
    status?: 'pending' | 'completed' | 'failed' | string;
    created_at: string;
}

export interface WithdrawRequest {
    amount: number;
    phone: string;
    network: string;
}

export interface WithdrawResponse {
    status: string;
    reference: string;
    tx_hash?: string;
    solscan_url?: string;
    new_balance: number;
}

export interface LinkWalletRequest {
    address: string;
    chain: 'solana';
    signature?: string;
    message?: string;
}

export interface CryptoDepositRequest {
    amount: number;
    tx_hash: string;
    chain: 'solana';
}

export interface CryptoDepositResponse {
    status: string;
    credited?: number;
    credited_sol?: number;
    new_balance: number;
    message?: string;
    tx_hash?: string;
    solscan_url?: string;
}

// ============ API Functions ============

/**
 * Get user's wallet
 */
/** Explicit wallet provisioning (W-21: GET /wallet no longer creates). */
export async function initWallet(): Promise<void> {
    await apiPost('/v1/wallet/init');
}

export async function getWallet() {
    try {
        const data = await apiGet<{ wallet: Wallet }>('/v1/wallet');
        return data.wallet;
    } catch (err) {
        if (err instanceof ApiError && err.code === 'wallet_not_initialized') {
            await initWallet();
            const data = await apiGet<{ wallet: Wallet }>('/v1/wallet');
            return data.wallet;
        }
        throw err;
    }
}

/** Keyset-paginated wallet history (W-21 server-side pagination). */
export async function getWalletTransactionsPage(cursor?: string, limit = 50) {
    const data = await apiGet<{ transactions: WalletTransaction[]; next_cursor: string }>(
        `/v1/wallet/transactions?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    );
    return { transactions: data.transactions ?? [], nextCursor: data.next_cursor ?? '' };
}

/**
 * Get wallet transactions
 */
export async function getTransactions(limit = 20, offset = 0) {
    // W-21: server-side keyset pagination. offset is emulated by walking
    // cursors (history is no longer truncated at the first page).
    let cursor: string | undefined;
    let remaining = offset;
    while (remaining > 0) {
        const page = await getWalletTransactionsPage(cursor, Math.min(remaining, 200));
        if (page.transactions.length === 0 || !page.nextCursor) {
            return { transactions: [], total: offset };
        }
        remaining -= page.transactions.length;
        cursor = page.nextCursor;
    }
    const page = await getWalletTransactionsPage(cursor, limit);
    return {
        transactions: page.transactions,
        total: offset + page.transactions.length + (page.nextCursor ? limit : 0),
    };
}

export interface WithdrawSolOptions {
    amountLamports?: number;
    nonce?: string;
    signature?: string;
    /** W-13 server-challenge nonce from requestWithdrawChallenge. */
    challengeNonce?: string;
    /** P0-9: retries with the same key replay the first result instead of debiting again. */
    idempotencyKey?: string;
}

export async function withdrawWallet(
    amount: number,
    phone: string,
    network: string,
    opts?: WithdrawSolOptions
) {
    void phone;
    void network;
    const data = await apiPost<{
        status: string;
        tx_hash?: string;
        reference?: string;
        solscan_url?: string;
        new_balance: number;
        message?: string;
    }>('/v1/wallet/withdraw/sol', {
        amount,
        amount_lamports: opts?.amountLamports ?? Math.round(amount * 1e9),
        nonce: opts?.nonce,
        signature: opts?.signature,
        challenge_nonce: opts?.challengeNonce,
        idempotency_key: opts?.idempotencyKey,
    });
    return {
        status: data.status,
        reference: data.reference || data.tx_hash || '',
        tx_hash: data.tx_hash,
        solscan_url: data.solscan_url,
        new_balance: data.new_balance,
        message: data.message,
    };
}

/**
 * Link a blockchain wallet
 */
/** P0-4: server-issued, single-use message the wallet must sign to link. */
export function getLinkChallenge(address: string, chain: 'solana' | 'ethereum' = 'solana') {
    return apiPost<{ message: string; expires_in_secs: number }>('/v1/wallet/link/challenge', {
        wallet_address: address,
        chain,
    });
}

export function linkWallet(address: string, chain: 'solana', signature?: string, message?: string) {
    return apiPost<{ status: string; message: string }>('/v1/wallet/link', {
        wallet_address: address,
        chain,
        signature,
        message
    });
}

/**
 * Unlink a blockchain wallet (Decouple identity)
 */
export function unlinkWallet(chain: 'solana' | 'bittensor' = 'solana') {
    return apiDeleteWithBody<{ status: string; message: string }>('/v1/wallet/link', {
        chain
    });
}

/**
 * Deposit via crypto transaction (Primary deposit method)
 */
export function depositCrypto(amount: number, txHash: string, chain: 'solana' = 'solana', amountLamports?: number) {
    return apiPost<CryptoDepositResponse>('/v1/wallet/deposit/crypto', {
        amount,
        amount_lamports: amountLamports ?? Math.round(amount * 1e9),
        tx_hash: txHash,
        chain,
        currency: 'SOL'
    });
}

/** W-13: server-issued withdrawal challenge to sign verbatim. */
export function requestWithdrawChallenge(amountLamports: number) {
    return apiPost<{
        message: string;
        nonce: string;
        destination: string;
        amount_lamports: number;
        expires_in_secs: number;
    }>('/v1/wallet/withdraw/challenge', { amount_lamports: amountLamports });
}

/**
 * Transfer funds between internal wallets (SOL only)
 */
export function transferFunds(recipient: string, amount: number, idempotencyKey?: string) {
    return apiPost<{ status: string; message: string }>('/v1/wallet/transfer', {
        recipient,
        amount,
        amount_lamports: Math.round(amount * 1e9),
        idempotency_key: idempotencyKey,
    });
}

export function getWithdrawalSecurity() {
    return apiGet<WithdrawalSecurity>('/v1/wallet/withdrawal-security');
}

export function getMySecurityFlags() {
    return apiGet<{ flags: UserSecurityFlag[]; count: number }>('/v1/wallet/security-flags');
}

// ============ Query Keys ============

export const walletKeys = {
    all: ['wallet'] as const,
    detail: () => [...walletKeys.all, 'detail'] as const,
    transactions: (page?: number) => [...walletKeys.all, 'transactions', page] as const,
};

export interface WithdrawalPayout {
    id: string;
    reference: string;
    destination: string;
    amount_sol: number;
    status: 'requested' | 'funding' | 'paying' | 'submitted' | 'completed' | 'failed' | 'ops_required' | string;
    attempts: number;
    tx_hash?: string;
    created_at: string;
    updated_at: string;
}

// W-35: queued-withdrawal status polling.
export async function getWithdrawals(limit = 20): Promise<WithdrawalPayout[]> {
    const data = await apiGet<{ withdrawals: WithdrawalPayout[] }>(`/v1/wallet/withdrawals?limit=${limit}`);
    return data.withdrawals ?? [];
}
