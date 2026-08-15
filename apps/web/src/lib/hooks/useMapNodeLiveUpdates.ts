'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapNodeUpdate } from '@/components/map/types';
import type { ExplorerNodeWsUpdate } from '@/lib/services/explorer';
import { useExplorerWS } from './useExplorerWS';

const BATCH_MS = 250;
const MAX_LIVE_UPDATES = 200;

export interface UseMapNodeLiveUpdatesOptions {
    enabled?: boolean;
}

/**
 * Batches explorer `node_update` WebSocket events for map components (2D canvas / 3D globe).
 */
export function useMapNodeLiveUpdates(options: UseMapNodeLiveUpdatesOptions = {}) {
    const { enabled = true } = options;
    const pendingUpdatesRef = useRef<MapNodeUpdate[]>([]);
    const [liveUpdates, setLiveUpdates] = useState<MapNodeUpdate[]>([]);
    const [wsConnected, setWsConnected] = useState(false);

    const onNodeUpdate = useCallback((data: ExplorerNodeWsUpdate) => {
        pendingUpdatesRef.current.push({
            node_id: data.node_id,
            opaque_node_id: data.opaque_node_id,
            is_active: data.is_active,
            uptime_percent: data.uptime_percent,
            active_sessions: data.active_sessions,
            lat: data.lat,
            lon: data.lon,
        });
    }, []);

    useExplorerWS({
        enabled,
        topics: ['nodes'],
        onOpen: useCallback(() => setWsConnected(true), []),
        onNodeUpdate,
        onInitial: useCallback(() => setWsConnected(true), []),
    });

    useEffect(() => {
        if (!enabled) return;
        const id = setInterval(() => {
            if (pendingUpdatesRef.current.length === 0) return;
            const batch = pendingUpdatesRef.current.splice(0);
            setLiveUpdates((prev) => [...prev.slice(-MAX_LIVE_UPDATES), ...batch]);
        }, BATCH_MS);
        return () => clearInterval(id);
    }, [enabled]);

    return { liveUpdates, wsConnected };
}
