// P3-10: Real-time wallet balance updates via WebSocket.
//
// Subscribes to the `user.wallet.<userID>` channel on the explorer WebSocket
// hub. When the server pushes a `wallet_update` message the caller's
// `onBalanceUpdate` callback receives the new balance in SOL so the wallet
// page refreshes without a full reload.

import { useEffect, useRef, useCallback } from 'react';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;
const RECONNECT_JITTER  = 500;

export interface WalletUpdate {
    balance_sol: number;
    pending_sol?: number;
    updated_at: string;
}

export interface UseWalletWSOptions {
    userID: string | null | undefined;
    onBalanceUpdate: (update: WalletUpdate) => void;
    enabled?: boolean;
}

/**
 * Connects to the WebSocket hub and subscribes to wallet balance updates
 * for the given userID.  Calls `onBalanceUpdate` whenever the server pushes
 * a new balance.  Reconnects with exponential backoff on disconnect.
 */
export function useWalletWS({ userID, onBalanceUpdate, enabled = true }: UseWalletWSOptions) {
    const wsRef = useRef<WebSocket | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unmountedRef = useRef(false);
    const retryRef = useRef(0);
    const cbRef = useRef(onBalanceUpdate);
    cbRef.current = onBalanceUpdate;

    const connect = useCallback(() => {
        if (unmountedRef.current || !userID) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws/explorer`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            retryRef.current = 0;
            // Subscribe to just the wallet topic for this user.
            ws.send(JSON.stringify({
                type: 'subscribe',
                topics: [`user.wallet.${userID}`],
            }));
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data as string);
                if (msg.type === 'wallet_update' && msg.data) {
                    cbRef.current(msg.data as WalletUpdate);
                }
            } catch {
                // ignore malformed messages
            }
        };

        ws.onclose = () => {
            if (unmountedRef.current) return;
            const delay = Math.min(
                RECONNECT_BASE_MS * 2 ** retryRef.current + Math.random() * RECONNECT_JITTER,
                RECONNECT_MAX_MS,
            );
            retryRef.current++;
            timerRef.current = setTimeout(connect, delay);
        };

        ws.onerror = () => ws.close();
    }, [userID]);

    useEffect(() => {
        if (!enabled || !userID) return;
        unmountedRef.current = false;
        connect();
        return () => {
            unmountedRef.current = true;
            wsRef.current?.close();
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [connect, enabled, userID]);
}
