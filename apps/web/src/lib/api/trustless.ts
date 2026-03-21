import { apiGet, apiPost } from './client';

export type UsageProofStatus = 'pending' | 'signed' | 'settling' | 'on_chain' | 'disputed';

export interface UsageProof {
    id: string;
    session_id: string;
    buyer_id: string;
    provider_id: string;
    bytes_transferred: number;
    start_time: string;
    end_time: string;
    status: UsageProofStatus;
    provider_signature?: string;
    buyer_signature?: string;
    tx_hash?: string;
    created_at: string;
    updated_at: string;
}

/**
 * Get all usage proofs for the current user (either as buyer or provider)
 */
export async function getUsageProofs(params?: { status?: UsageProofStatus; role?: 'buyer' | 'provider' }): Promise<UsageProof[]> {
    return apiGet<UsageProof[]>('/v1/trustless/usage-proofs', params);
}

/**
 * Get a specific usage proof by ID
 */
export async function getUsageProof(id: string): Promise<UsageProof> {
    return apiGet<UsageProof>(`/v1/trustless/usage-proofs/${id}`);
}

/**
 * Sign a pending usage proof
 */
export async function signUsageProof(id: string, signature: string): Promise<UsageProof> {
    return apiPost<UsageProof>(`/v1/trustless/usage-proofs/${id}/sign`, { signature });
}

/**
 * Submit a fully signed proof to the blockchain
 */
export async function submitUsageProofOnChain(id: string): Promise<{ tx_hash: string }> {
    return apiPost<{ tx_hash: string }>(`/v1/trustless/usage-proofs/${id}/submit`);
}
