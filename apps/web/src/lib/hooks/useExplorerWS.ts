import { useEffect, useRef, useCallback } from 'react';
import { getExplorerWsUrl } from '../ws-url';

export interface WSUpdate {
    type: 'initial' | 'new_transaction' | 'new_block' | 'node_update';
    data: any;
    timestamp: string;
}

export interface UseExplorerWSOptions {
    onNewTransaction?: (data: any) => void;
    onNewBlock?: (data: any) => void;
    onNodeUpdate?: (data: any) => void;
    onInitial?: (data: any) => void;
    /** Fired when the socket opens (before initial payload). */
    onOpen?: () => void;
    /** Fired when the socket closes (before reconnect attempt). */
    onClose?: () => void;
    enabled?: boolean;
    /** If provided, send a subscribe message on connect so the server only
     *  sends updates for these topics. Omit to receive all topics. */
    topics?: string[];
}

// P1-15: Exponential-backoff constants.
const RECONNECT_BASE_MS = 1_000;   // 1 s initial delay
const RECONNECT_MAX_MS  = 30_000;  // 30 s ceiling
const RECONNECT_JITTER  = 500;     // ±500 ms random jitter

/**
 * Connects to the explorer WebSocket hub and calls the provided callbacks
 * when real-time updates arrive. Reconnects with exponential backoff.
 */
export function useExplorerWS(options: UseExplorerWSOptions = {}) {
    const { enabled = true } = options;
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unmounted = useRef(false);
    // P1-15: track retry count so each successive failure waits longer.
    const retryCount = useRef(0);

    const callbacksRef = useRef(options);
    callbacksRef.current = options;

    const connect = useCallback(() => {
        if (typeof window === 'undefined' || unmounted.current) return;

        const url = getExplorerWsUrl();

        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            if (reconnectTimer.current) {
                clearTimeout(reconnectTimer.current);
                reconnectTimer.current = null;
            }
            // Successful connection — reset backoff counter.
            retryCount.current = 0;
            callbacksRef.current.onOpen?.();

            // Send subscription filter if caller specified topics.
            const t = callbacksRef.current.topics;
            if (t && t.length > 0) {
                ws.send(JSON.stringify({ type: 'subscribe', topics: t }));
            }
        };

        ws.onmessage = (event) => {
            try {
                const update: WSUpdate = JSON.parse(event.data);
                const cbs = callbacksRef.current;
                switch (update.type) {
                    case 'initial':
                        cbs.onInitial?.(update.data);
                        break;
                    case 'new_transaction':
                        cbs.onNewTransaction?.(update.data);
                        break;
                    case 'new_block':
                        cbs.onNewBlock?.(update.data);
                        break;
                    case 'node_update':
                        cbs.onNodeUpdate?.(update.data);
                        break;
                }
            } catch (err) {
                console.warn('[ExplorerWS] Failed to parse message:', err, event.data?.slice?.(0, 200));
            }
        };

        ws.onclose = () => {
            wsRef.current = null;
            callbacksRef.current.onClose?.();
            if (!unmounted.current) {
                // P1-15: Exponential backoff with jitter.
                const delay = Math.min(
                    RECONNECT_BASE_MS * Math.pow(2, retryCount.current),
                    RECONNECT_MAX_MS,
                ) + (Math.random() * RECONNECT_JITTER * 2 - RECONNECT_JITTER);
                retryCount.current += 1;
                reconnectTimer.current = setTimeout(connect, Math.max(delay, 0));
            }
        };

        ws.onerror = () => {
            ws.close();
        };
    }, []);

    useEffect(() => {
        if (!enabled) return;
        unmounted.current = false;
        retryCount.current = 0;
        connect();
        return () => {
            unmounted.current = true;
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            wsRef.current?.close();
        };
    }, [enabled, connect]);
}
