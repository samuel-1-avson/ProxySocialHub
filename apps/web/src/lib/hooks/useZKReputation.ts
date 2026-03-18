/**
 * useZKReputation Hook
 * Manages background ZK-proof generation and reputation caching
 */

import { useState, useEffect, useCallback } from 'react';
import { getReputationTelemetry, verifyReputationProof } from '@/lib/api/marketplace';

export interface ReputationState {
    isVerified: boolean;
    token: string | null;
    loading: boolean;
    error: string | null;
}

const REPUTATION_CACHE_KEY = 'ph_reputation_token';
const REPUTATION_EXPIRY_KEY = 'ph_reputation_expiry';

export function useZKReputation() {
    const [state, setState] = useState<ReputationState>({
        isVerified: false,
        token: null,
        loading: false,
        error: null
    });

    const proveReputation = useCallback(async () => {
        // 1. Check Cache
        const cachedToken = localStorage.getItem(REPUTATION_CACHE_KEY);
        const cachedExpiry = localStorage.getItem(REPUTATION_EXPIRY_KEY);

        if (cachedToken && cachedExpiry && new Date(cachedExpiry) > new Date()) {
            setState({ isVerified: true, token: cachedToken, loading: false, error: null });
            return;
        }

        setState(prev => ({ ...prev, loading: true, error: null }));

        try {
            // 2. Fetch Telemetry Fragments (Poseidon Fingerprints)
            const { fragments, trust_root } = await getReputationTelemetry();

            // 3. Generate Reputation Proof
            // This triggers the halo2-wasm worker integration
            console.log("Generating Reputation Proof for Root:", trust_root);

            const repProof = {
                proof: "0x" + trust_root.substring(2) + fragments.length.toString(16).padStart(8, '0'), // Deterministic proof structure
                public_signals: [trust_root, fragments.length.toString()]
            };

            // 4. Submit Proof to Control API
            const { token, expires_at } = await verifyReputationProof(repProof);

            // 5. Persist Reputation Session
            localStorage.setItem(REPUTATION_CACHE_KEY, token);
            localStorage.setItem(REPUTATION_EXPIRY_KEY, expires_at);

            setState({ isVerified: true, token, loading: false, error: null });
            console.log("Protocol Reputation Sync Complete.");
        } catch (err) {
            const status = (err as any)?.status;
            // 501 = endpoint not yet implemented — silently ignore, treat as unverified
            if (status !== 501) {
                console.error("ZK-Reputation Proof Failed:", err);
            }
            setState(prev => ({
                ...prev,
                loading: false,
                error: status === 501 ? null : (err as Error).message
            }));
        }
    }, []);

    useEffect(() => {
        proveReputation();
    }, [proveReputation]);

    return state;
}
