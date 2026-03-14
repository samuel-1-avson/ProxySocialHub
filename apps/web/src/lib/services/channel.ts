import { API_BASE_URL, fetchWithAuth } from './client';

export interface ChannelState {
    nonce: number;
    total_amount: number;
    total_bytes: number;
    signature: string;
    timestamp?: number;
}

export interface StateChannel {
    id: string;
    session_id: string;
    buyer_id: string;
    provider_id: string;
    status: 'open' | 'closing' | 'closed' | 'disputed';
    escrow_pubkey: string;
    last_state: ChannelState;
    total_deposit: number;
    expires_at: string;
    created_at: string;
}

export async function openChannel(sessionId: string, amountLamports: number): Promise<StateChannel> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/channels/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, amount: amountLamports }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to open channel');
    }

    const data = await response.json();
    return data.channel;
}

export async function updateChannelState(channelId: string, nonce: number, totalAmount: number, totalBytes: number, signature: string): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/channels/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channel_id: channelId,
            nonce,
            total_amount: totalAmount,
            total_bytes: totalBytes,
            signature
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update channel state');
    }
}

// State channel signing is handled in StreamingSessionCard.tsx using the Solana
// wallet adapter's signMessage function (useWallet hook). No stub needed here.
