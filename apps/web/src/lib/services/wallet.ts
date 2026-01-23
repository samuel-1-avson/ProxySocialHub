import { API_BASE_URL, fetchWithAuth } from './client';

export interface Wallet {
    id: string;
    balance_ghs: number;
    balance_tao: number;
    currency: string;
    transactions: WalletTransaction[];
    linked_solana_address?: string;
    linked_bittensor_addr?: string;
}

export interface WalletTransaction {
    id: string;
    amount: number;
    balance_after: number;
    type: string;
    description: string;
    tx_hash?: string;
    status?: string;
    created_at: string;
}

export async function getWallet(): Promise<Wallet> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/`);
    if (!response.ok) throw new Error('Failed to fetch wallet');
    const data = await response.json();
    return data.wallet;
}

export async function depositWallet(amount: number, email: string): Promise<{ status: string; reference: string; message: string; authorization_url: string }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, email }),
    });
    if (!response.ok) throw new Error('Failed to initiate deposit');
    return response.json();
}

export async function linkWallet(address: string, chain: 'solana' | 'bittensor', signature?: string, message?: string): Promise<{ status: string; message: string }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: address, chain, signature, message }),
    });
    if (!response.ok) throw new Error('Failed to link wallet');
    return response.json();
}

export async function depositCrypto(amount: number, txHash: string): Promise<{ status: string; message: string }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/deposit/crypto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, tx_hash: txHash, currency: 'TAO', chain: 'solana' }),
    });
    if (!response.ok) throw new Error('Failed to submit crypto deposit');
    return response.json();
}

export async function verifyDeposit(reference: string): Promise<{ status: string; message: string }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/verify?reference=${reference}`);
    if (!response.ok) throw new Error('Failed to verify deposit');
    return response.json();
}

export async function withdrawWallet(amount: number, phone: string, network: string): Promise<{ status: string; reference: string; new_balance: number }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, phone, network }),
    });
    if (!response.ok) throw new Error('Failed to initiate withdrawal');
    return response.json();
}
