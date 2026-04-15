import { API_BASE_URL, fetchWithAuth } from './client';
import type { CreateSessionIntentResponse } from '../api/sessions';

export interface Session {
    id: string;
    type: 'rotating' | 'sticky';
    status: 'active' | 'terminated';
    credentials_user: string;
    credentials_pass: string;
    created_at: string;
    listing?: {
        id: string;
        price_per_gb?: number;
        price_per_hour?: number;
    };
    escrow_address?: string;
    tx_hash?: string;
    bytes_used?: number;
    bytes_limit?: number;
}

export async function createSession(type: 'rotating' | 'sticky', nodeId?: string): Promise<CreateSessionIntentResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, listing_id: nodeId }),
    });
    if (!response.ok) throw new Error('Failed to issue session intent');
    return response.json();
}

export async function getSessions(): Promise<Session[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/`);
    if (!response.ok) throw new Error('Failed to fetch sessions');
    const data = await response.json();
    if (data && Array.isArray(data.sessions)) {
        return data.sessions.map((item: any) => item.session || item);
    }
    return [];
}

export async function terminateSession(sessionId: string): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/${sessionId}/terminate`, {
        method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to terminate session');
}

export interface ProviderNode {
    id: string;
    name: string;
    ip_address: string;
    country: string;
    city: string;
    status: string;
    quality_score: number;
    latency_ms?: number;
    uptime_percent?: number;
    active_connections?: number;
    connection_type?: string;
}

export async function getProviderNodes(): Promise<{ nodes: ProviderNode[] }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/provider/nodes`);
    if (!response.ok) return { nodes: [] };
    return response.json();
}

export interface Order {
    id: string;
    buyer_id: string;
    seller_id: string;
    listing_id: string;
    bandwidth_gb: number;
    total_price: number;
    status: 'pending' | 'active' | 'completed' | 'disputed' | 'cancelled';
    escrow_pda?: string;
    tx_signature?: string;
    created_at: string;
}

export interface SolanaPaymentParams {
    program_id: string;
    escrow_pda: string;
    buyer_pubkey: string;
    seller_pubkey: string;
    amount_lamports: number;
    amount_sol: number;
    bandwidth_gb: number;
    oracle_pubkey: string;
}

export async function createOrder(listingId: string, bandwidthGb: number): Promise<Order> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId, bandwidth_gb: bandwidthGb }),
    });
    if (!response.ok) throw new Error('Failed to create order');
    const data = await response.json();
    return data.order;
}

export async function initiateSmartContractPayment(orderId: string): Promise<SolanaPaymentParams> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/orders/${orderId}/pay/solana`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to initiate payment');
    }
    return response.json();
}
