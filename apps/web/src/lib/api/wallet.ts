/**
 * Wallet API Module
 * All wallet-related API calls and types
 */

import { apiGet, apiPost } from './client';

// ============ Types ============

export interface Wallet {
    id: string;
    user_id: string;
    balance: number;
    currency: string;
    linked_solana_address?: string;
    linked_bittensor_addr?: string;
    created_at: string;
    updated_at: string;
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
    chain: 'solana' | 'bittensor';
    signature?: string;
    message?: string;
}

export interface CryptoDepositRequest {
    amount: number;
    tx_hash: string;
}

// ============ API Functions ============

/**
 * Get user's wallet
 */
export function getWallet() {
    return apiGet<Wallet>('/v1/wallet');
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
 * Initiate a deposit via Paystack
 */
export function deposit(data: DepositRequest) {
    return apiPost<DepositResponse>('/v1/wallet/deposit', data);
}

/**
 * Verify a deposit
 */
export function verifyDeposit(reference: string) {
    return apiPost<{ status: string; message: string }>('/v1/wallet/verify', { reference });
}

/**
 * Initiate a withdrawal (Mobile Money)
 */
export function withdraw(data: WithdrawRequest) {
    return apiPost<WithdrawResponse>('/v1/wallet/withdraw', data);
}

/**
 * Link a blockchain wallet
 */
export function linkWallet(data: LinkWalletRequest) {
    return apiPost<{ status: string; message: string }>('/v1/wallet/link', data);
}

/**
 * Deposit via crypto transaction
 */
export function depositCrypto(data: CryptoDepositRequest) {
    return apiPost<{ status: string; message: string }>('/v1/wallet/deposit/crypto', data);
}

// ============ Query Keys ============

export const walletKeys = {
    all: ['wallet'] as const,
    detail: () => [...walletKeys.all, 'detail'] as const,
    transactions: (page?: number) => [...walletKeys.all, 'transactions', page] as const,
};
