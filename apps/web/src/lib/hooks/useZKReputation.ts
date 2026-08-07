/**
 * Reputation hook — telemetry only. Client-side ZK verification was removed
 * (FE-04); do not cache fake local tokens or claim proofs are verified.
 */

import { useState, useEffect, useCallback } from 'react';
import { getAccessTokenSilently } from '@/lib/auth';
import { getReputationTelemetry } from '@/lib/api/marketplace';

export interface ReputationState {
    /** Always false until a real server-side verifier ships. */
    isVerified: boolean;
    token: string | null;
    loading: boolean;
    error: string | null;
    settledProofCount: number;
}

export function useZKReputation() {
    const [state, setState] = useState<ReputationState>({
        isVerified: false,
        token: null,
        loading: false,
        error: null,
        settledProofCount: 0,
    });

    const loadTelemetry = useCallback(async () => {
        if (typeof window === 'undefined') {
            return;
        }

        // Clear any legacy fake local ZK tokens from older builds.
        try {
            localStorage.removeItem('ph_reputation_token');
            localStorage.removeItem('ph_reputation_expiry');
        } catch {
            /* ignore */
        }

        const authToken = await getAccessTokenSilently();
        if (!authToken) {
            setState({
                isVerified: false,
                token: null,
                loading: false,
                error: null,
                settledProofCount: 0,
            });
            return;
        }

        setState((prev) => ({ ...prev, loading: true, error: null }));

        try {
            const telemetry = await getReputationTelemetry();
            const proofCount = telemetry.settled_proof_count ?? 0;
            setState({
                isVerified: false,
                token: null,
                loading: false,
                error: null,
                settledProofCount: proofCount,
            });
        } catch (err) {
            const status = (err as { status?: number })?.status;
            if (status === 401 || status === 403 || status === 404 || status === 501) {
                setState({
                    isVerified: false,
                    token: null,
                    loading: false,
                    error: null,
                    settledProofCount: 0,
                });
                return;
            }
            setState((prev) => ({
                ...prev,
                loading: false,
                error: (err as Error).message,
            }));
        }
    }, []);

    useEffect(() => {
        loadTelemetry();
    }, [loadTelemetry]);

    return state;
}
