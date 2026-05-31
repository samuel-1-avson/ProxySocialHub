import { API_BASE_URL, fetchWithAuth } from './client';

export interface Wallet {
    id: string;
    balance_sol: number;
    on_chain_sol?: number;
    available_sol?: number;
    solana_network?: string;
    transactions: WalletTransaction[];
    linked_solana_address?: string;
}

export interface WalletTransaction {
    id: string;
    amount: number;
    balance_after?: number;
    type: string;
    description: string;
    tx_hash?: string;
    solscan_url?: string;
    status?: string;
    created_at: string;
}

export async function getWallet(): Promise<Wallet> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet`);
    if (!response.ok) throw new Error('Failed to fetch wallet');
    const data = await response.json();
    return data.wallet;
}

export async function depositWallet(amount: number, email: string): Promise<{ status: string; reference: string; message: string; authorization_url: string }> {
    void amount;
    void email;
    throw new Error('Fiat deposits are disabled. Use depositCrypto with /v1/wallet/deposit/crypto.');
}

export async function linkWallet(address: string, chain: 'solana', signature?: string, message?: string): Promise<{ status: string; message: string }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: address, chain, signature, message }),
    });
    if (!response.ok) throw new Error('Failed to link wallet');
    return response.json();
}

export async function depositCrypto(amount: number, txHash: string, chain: 'solana', destinationAddress?: string): Promise<{ status: string; message: string; credited_sol?: number; tx_hash?: string; solscan_url?: string; new_balance?: number }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/deposit/crypto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, tx_hash: txHash, currency: 'SOL', chain, destination_address: destinationAddress }),
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to submit crypto deposit');
    }
    return response.json();
}

export async function verifyDeposit(reference: string): Promise<{ status: string; message: string }> {
    void reference;
    throw new Error('Fiat deposit verification is disabled.');
}

export async function withdrawWallet(
    amount: number,
    phone: string,
    network: string,
    opts?: { nonce?: string; signature?: string }
): Promise<{ status: string; reference: string; tx_hash?: string; solscan_url?: string; new_balance: number }> {
    void phone;
    void network;

    const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/withdraw/sol`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, nonce: opts?.nonce, signature: opts?.signature }),
    });
    if (!response.ok) throw new Error('Failed to initiate withdrawal');
    const data = await response.json();
    return {
        status: data.status,
        reference: data.tx_hash || '',
        tx_hash: data.tx_hash,
        solscan_url: data.solscan_url,
        new_balance: data.new_balance,
    };
}

export async function transferFunds(recipient: string, amount: number): Promise<{ status: string; message: string }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, amount }),
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to transfer funds');
    }
    return response.json();
}
