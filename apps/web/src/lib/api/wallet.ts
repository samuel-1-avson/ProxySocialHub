/**
 * Wallet API Module
 * All wallet-related API calls and types
 */

import { apiGet, apiPost, apiPut, apiDeleteWithBody } from './client';

// ============ Types ============

export interface Wallet {
    id: string;
    balance_sol: number;
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
    withdrawal_whitelist: string[];
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
    balance_after?: number;
    type: 'deposit' | 'withdrawal' | 'purchase' | 'earning' | 'refund' | string;
    description: string;
    reference?: string;
    tx_hash?: string;
    solscan_url?: string;
    status?: 'pending' | 'completed' | 'failed' | string;
    created_at: string;
}

export interface DepositRequest {
    amount: number;
    email: string;
}

export interface DepositResponse {
    status: string;
    reference: string;
    message: string;
    authorization_url: string;
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
export async function getWallet() {
    const data = await apiGet<{ wallet: Wallet }>('/v1/wallet');
    return data.wallet;
}

/**
 * Get wallet transactions
 */
export async function getTransactions(limit = 20, offset = 0) {
    const data = await apiGet<{ wallet: Wallet }>('/v1/wallet');
    const all = data.wallet.transactions ?? [];
    return {
        transactions: all.slice(offset, offset + limit),
        total: all.length,
    };
}

/**
 * Initiate a deposit via Paystack (Admin/Legacy only)
 * @deprecated Use depositCrypto for user deposits
 */
export function depositWallet(amount: number, email: string) {
    void amount;
    void email;
    throw new Error('Fiat deposits are disabled. Use depositCrypto with /v1/wallet/deposit/crypto.');
}

/**
 * Verify a fiat deposit (Admin/Legacy only)
 * @deprecated
 */
export function verifyDeposit(reference: string) {
    void reference;
    throw new Error('Fiat deposit verification is disabled.');
}

/**
 * Initiate a withdrawal (Mobile Money - Providers only)
 */
export interface WithdrawSolOptions {
    nonce?: string;
    signature?: string;
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
    }>('/v1/wallet/withdraw/sol', { amount, nonce: opts?.nonce, signature: opts?.signature });
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
export function depositCrypto(amount: number, txHash: string, chain: 'solana' = 'solana') {
    return apiPost<CryptoDepositResponse>('/v1/wallet/deposit/crypto', {
        amount,
        tx_hash: txHash,
        chain,
        currency: 'SOL'
    });
}

/**
 * Transfer funds between internal wallets (SOL only)
 */
export function transferFunds(recipient: string, amount: number) {
    return apiPost<{ status: string; message: string }>('/v1/wallet/transfer', { recipient, amount });
}

export function getWithdrawalSecurity() {
    return apiGet<WithdrawalSecurity>('/v1/wallet/withdrawal-security');
}

export function updateWithdrawalWhitelist(addresses: string[]) {
    return apiPut<{ withdrawal_whitelist: string[]; message: string }>('/v1/wallet/withdrawal-security/whitelist', {
        addresses,
    });
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
