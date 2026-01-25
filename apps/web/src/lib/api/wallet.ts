/**
 * Wallet API Module
 * All wallet-related API calls and types
 */

import { apiGet, apiPost } from './client';

// ============ Types ============

export interface Wallet {
    id: string;
    balance_ghs: number;
    balance_tao: number;
    balance?: number; // Legacy/Unified
    currency: string;
    transactions?: WalletTransaction[];
    linked_solana_address?: string;
    linked_bittensor_addr?: string;
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

export interface StakingPosition {
    id: string;
    amount: number;
    currency: string;
    apy: number;
    start_time: string;
    status: 'active' | 'unstaked';
    accrued_yield: number;
    current_yield?: number;
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
export function linkWallet(address: string, chain: 'solana' | 'bittensor', signature?: string, message?: string) {
    return apiPost<{ status: string; message: string }>('/v1/wallet/link', {
        wallet_address: address,
        chain,
        signature,
        message
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
        chain,
        currency: 'TAO'
    });
}

/**
 * Get active staking positions
 */
export function getStakes() {
    return apiGet<StakingPosition[]>('/v1/staking/');
}

/**
 * Stake funds for yield
 */
export function stakeFunds(amount: number) {
    return apiPost<{ message: string; stake: StakingPosition }>('/v1/staking/stake', { amount });
}

/**
 * Unstake funds and claim yield
 */
export function unstakeFunds(stakeId: string) {
    return apiPost<{ message: string; yield: number; total: number }>(`/v1/staking/unstake/${stakeId}`);
}

/**
 * Transfer funds between internal wallets
 */
export function transferFunds(recipient: string, amount: number, currency: 'TAO' | 'GHS') {
    return apiPost<{ status: string; message: string }>('/v1/wallet/transfer', { recipient, amount, currency });
}

/**
 * Initiate the bittensor devnet faucet
 */
export function startFaucet() {
    return apiPost<{ status: string; message: string }>('/v1/wallet/faucet/start', { wallet_name: 'proxyhubb' });
}

/**
 * Get faucet status and cooldown
 */
export function getFaucetStatus() {
    return apiGet<{ status: string; message: string; elapsed_seconds: number }>('/v1/wallet/faucet/status');
}

// ============ Query Keys ============

export const walletKeys = {
    all: ['wallet'] as const,
    detail: () => [...walletKeys.all, 'detail'] as const,
    transactions: (page?: number) => [...walletKeys.all, 'transactions', page] as const,
    stakes: () => [...walletKeys.all, 'stakes'] as const,
};
