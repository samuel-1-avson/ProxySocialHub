import { apiGet, apiPost } from './client';

export type UsageProofStatus = 'pending' | 'signed' | 'settling_confidential' | 'on_chain' | 'disputed';

export interface UsageProof {
    id: string;
    session_id: string;
    order_id: string;
    buyer_wallet: string;
    provider_wallet: string;
    bytes_uploaded: number;
    bytes_downloaded: number;
    total_bytes: number;
    request_count: number;
    period_start: string;
    period_end: string;
    message_hash: string;
    status: UsageProofStatus;
    provider_signature?: string;
    buyer_signature?: string;
    on_chain_tx_hash?: string;
    on_chain_slot?: number;
    created_at: string;
    updated_at: string;
}

export interface UsageProofResponse extends UsageProof {
    message_to_sign?: string;
    buyer_verified?: boolean;
    provider_verified?: boolean;
}

export interface UsageProofMessage {
    proof_id: string;
    message: string;
    message_hash: string;
    session_id: string;
    total_bytes: number;
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
export async function getUsageProof(id: string): Promise<UsageProofResponse> {
    return apiGet<UsageProofResponse>(`/v1/trustless/usage-proofs/${id}`);
}

/**
 * Sign a pending usage proof
 */
export async function getUsageProofMessage(id: string): Promise<UsageProofMessage> {
    return apiGet<UsageProofMessage>(`/v1/trustless/message/${id}`);
}

/**
 * Sign a pending usage proof.
 */
export async function signUsageProof(id: string, signature: string): Promise<UsageProofResponse> {
    return apiPost<UsageProofResponse>(`/v1/trustless/usage-proofs/${id}/sign`, { signature });
}

/**
 * Submit a fully signed proof to the blockchain
 */
export async function submitUsageProofOnChain(id: string): Promise<{ tx_hash: string }> {
    return apiPost<{ tx_hash: string }>(`/v1/trustless/usage-proofs/${id}/submit`);
}
