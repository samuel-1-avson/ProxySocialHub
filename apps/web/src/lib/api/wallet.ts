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
    chain: 'solana' | 'bittensor';
}

export interface CryptoDepositResponse {
    status: string;
    credited_tao: number;
    new_balance: number;
    message?: string;
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
 * Initiate a deposit via Paystack (Admin/Legacy only)
 * @deprecated Use depositCrypto for user deposits
 */
export function deposit(data: DepositRequest) {
    return apiPost<DepositResponse>('/v1/wallet/deposit', data);
}

/**
 * Verify a fiat deposit (Admin/Legacy only)
 * @deprecated
 */
export function verifyDeposit(reference: string) {
    return apiPost<{ status: string; message: string }>('/v1/wallet/verify', { reference });
}

/**
 * Initiate a withdrawal (Mobile Money - Providers only)
 */
export function withdraw(data: WithdrawRequest) {
    return apiPost<WithdrawResponse>('/v1/wallet/withdraw', data);
}

/**
 * Link a blockchain wallet
 */
export function linkWallet(address: string, chain: 'solana' | 'bittensor', signature: string, message: string, label?: string) {
    return apiPost<{ status: string; message: string }>('/v1/wallet/link', {
        wallet_address: address,
        chain,
        signature,
        message,
        label
    });
}

/**
 * Deposit via crypto transaction (Primary deposit method)
 * Verifies on-chain transaction and credits wallet
 */
export function depositCrypto(amount: number, txHash: string, chain: 'solana' | 'bittensor' = 'solana') {
    return apiPost<CryptoDepositResponse>('/v1/wallet/deposit/crypto', {
        amount,
        tx_hash: txHash,
        chain
    });
}

// ============ Query Keys ============

export const walletKeys = {
    all: ['wallet'] as const,
    detail: () => [...walletKeys.all, 'detail'] as const,
    transactions: (page?: number) => [...walletKeys.all, 'transactions', page] as const,
};
