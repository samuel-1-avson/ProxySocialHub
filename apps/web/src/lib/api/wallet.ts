/**
 * Wallet API Module
 * All wallet-related API calls and types
 */

import { apiGet, apiPost, apiDeleteWithBody } from './client';

// ============ Types ============

export interface Wallet {
    id: string;
    balance_sol: number;
    transactions?: WalletTransaction[];
    linked_solana_address?: string;
    created_at: string;
    updated_at?: string;
}

export interface WalletTransaction {
    id: string;
    wallet_id?: string;
    amount: number;
    balance_after: number;
    type: 'deposit' | 'withdrawal' | 'purchase' | 'earning' | 'refund' | string;
    description: string;
    reference?: string;
    tx_hash?: string;
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
    credited_sol: number;
    new_balance: number;
    message?: string;
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
export function getTransactions(limit = 20, offset = 0) {
    return apiGet<{ transactions: WalletTransaction[]; total: number }>(
        '/v1/wallet/transactions',
        { limit: limit.toString(), offset: offset.toString() }
    );
}

/**
 * Initiate a deposit via Paystack (Admin/Legacy only)
 * @deprecated Use depositCrypto for user deposits
 */
export function depositWallet(amount: number, email: string) {
    return apiPost<DepositResponse>('/v1/wallet/deposit', { amount, email });
}

/**
 * Verify a fiat deposit (Admin/Legacy only)
 * @deprecated
 */
export function verifyDeposit(reference: string) {
    return apiGet<{ status: string; message: string }>(`/v1/wallet/verify?reference=${reference}`);
}

/**
 * Initiate a withdrawal (Mobile Money - Providers only)
 */
export function withdrawWallet(amount: number, phone: string, network: string) {
    return apiPost<WithdrawResponse>('/v1/wallet/withdraw', { amount, phone, network });
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

// ============ Query Keys ============

export const walletKeys = {
    all: ['wallet'] as const,
    detail: () => [...walletKeys.all, 'detail'] as const,
    transactions: (page?: number) => [...walletKeys.all, 'transactions', page] as const,
};
