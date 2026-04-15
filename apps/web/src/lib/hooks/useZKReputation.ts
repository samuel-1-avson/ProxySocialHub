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
        if (typeof window === 'undefined') {
            return;
        }

        // 1. Check Cache
        const cachedToken = localStorage.getItem(REPUTATION_CACHE_KEY);
        const cachedExpiry = localStorage.getItem(REPUTATION_EXPIRY_KEY);

        if (cachedToken && cachedExpiry && new Date(cachedExpiry) > new Date()) {
            setState({ isVerified: true, token: cachedToken, loading: false, error: null });
            return;
        }

        const authToken = localStorage.getItem('proxyhubb_token');
        if (!authToken) {
            setState({ isVerified: false, token: null, loading: false, error: null });
            return;
        }

        setState(prev => ({ ...prev, loading: true, error: null }));

        try {
            const telemetry = await getReputationTelemetry();
            const proofCount = telemetry.settled_proof_count ?? 0;
            const proofs = Array.isArray(telemetry.proofs) ? telemetry.proofs : [];

            if (proofCount <= 0 || proofs.length === 0) {
                setState({ isVerified: false, token: null, loading: false, error: null });
                return;
            }

            const repProof = {
                settled_proof_count: proofCount,
                total_bytes_settled: telemetry.total_bytes_settled ?? 0,
                proof_refs: proofs.slice(0, 8).map((proof) => proof.id ?? proof.session_id ?? proof.created_at ?? 'unknown')
            };

            const { token, expires_at } = await verifyReputationProof(repProof);

            localStorage.setItem(REPUTATION_CACHE_KEY, token);
            localStorage.setItem(REPUTATION_EXPIRY_KEY, expires_at);

            setState({ isVerified: true, token, loading: false, error: null });
        } catch (err) {
            const status = (err as any)?.status;
            if (status === 401 || status === 403 || status === 404 || status === 501) {
                setState({ isVerified: false, token: null, loading: false, error: null });
                return;
            }

            setState(prev => ({
                ...prev,
                loading: false,
                error: (err as Error).message
            }));
        }
    }, []);

    useEffect(() => {
        proveReputation();
    }, [proveReputation]);

    return state;
}
