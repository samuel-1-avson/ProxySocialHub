/**
 * Payment Channels API Module (L2)
 * High-frequency state updates and off-chain settlement
 */

import { apiPost } from './client';

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

/**
 * Open a new L2 payment channel for a session
 */
export async function openChannel(sessionId: string, amountLamports: number) {
    const data = await apiPost<{ channel: StateChannel }>('/v1/channels/open', {
        session_id: sessionId,
        amount: amountLamports
    });
    return data.channel;
}

/**
 * Submit a signed state update to the validator
 */
export async function updateChannelState(channelId: string, nonce: number, totalAmount: number, totalBytes: number, signature: string) {
    return apiPost('/v1/channels/update', {
        channel_id: channelId,
        nonce,
        total_amount: totalAmount,
        total_bytes: totalBytes,
        signature
    });
}

/**
 * Generate a cryptographic signature for a state update.
 * Uses the connected Solana wallet to sign an Ed25519 message
 * encoding the channel state transition.
 *
 * @param signMessage - The wallet adapter's signMessage function (from useWallet())
 */
export async function signStateUpdate(
    channelId: string,
    nonce: number,
    amount: number,
    bytes: number,
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
    if (!signMessage) {
        throw new Error('Wallet not connected: signStateUpdate requires a connected Solana wallet with signMessage support');
    }

    // Encode the state update as a deterministic message
    const encoder = new TextEncoder();
    const message = encoder.encode(
        `proxyhubb:channel_state:${channelId}:${nonce}:${amount}:${bytes}`
    );

    const signatureBytes = await signMessage(message);

    // Return base58-encoded signature
    return Buffer.from(signatureBytes).toString('base64');
}
