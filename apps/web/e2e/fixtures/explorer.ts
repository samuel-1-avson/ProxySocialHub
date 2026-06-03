/** Shared explorer E2E fixtures. */

import { mockMapResponse } from './marketplace-map';

export const EXPLORER_NODE_IDS = {
    primary: 'explorer-node-e2e-1',
    secondary: 'explorer-node-e2e-2',
} as const;

export const mockExplorerNodeGeo = {
    nodes: [
        {
            node_id: EXPLORER_NODE_IDS.primary,
            lat: 30.2672,
            lon: -97.7431,
            is_active: true,
            is_validator: false,
            uptime_percent: 99.5,
            active_sessions: 2,
            country: 'US',
            region: 'us-central',
            city: 'Austin',
            isp: 'ProxyHubb Test ISP',
        },
        {
            node_id: EXPLORER_NODE_IDS.secondary,
            lat: 32.7767,
            lon: -96.797,
            is_active: true,
            is_validator: false,
            uptime_percent: 96.2,
            active_sessions: 1,
            country: 'US',
            region: 'us-central',
            city: 'Dallas',
            isp: 'ProxyHubb Test ISP',
        },
    ],
};

export const mockExplorerMetrics = {
    total_nodes: 2,
    active_nodes: 2,
    total_sessions: 10,
    active_sessions: 3,
    time_series_available: true,
};

export function mockExplorerDecentralizationStatus(
    overrides: Record<string, unknown> = {},
) {
    return {
        chain: 'solana',
        window_slots: 256,
        latest_attested_slot: 42_000,
        recent_slots_analyzed: 256,
        unique_writers: 3,
        min_writers_required: 2,
        slots_meeting_quorum: 256,
        conflicting_slots: 0,
        quorum_ratio: 1,
        explorer_mode: 'multi_writer_quorum',
        fully_decentralized: true,
        last_updated: new Date().toISOString(),
        ...overrides,
    };
}

export function mockExplorerNodesList() {
    return {
        nodes: mockExplorerNodeGeo.nodes,
        total: mockExplorerNodeGeo.nodes.length,
        page: 1,
        page_size: 20,
    };
}

export function mockExplorerNodeDetail(nodeId: string) {
    const isPrimary = nodeId === EXPLORER_NODE_IDS.primary;
    return {
        node_id: nodeId,
        chain: 'solana',
        region: 'us-central',
        country: 'US',
        city: isPrimary ? 'Austin' : 'Dallas',
        is_active: true,
        is_validator: false,
        uptime_percent: isPrimary ? 99.5 : 96.2,
        latency_ms: isPrimary ? 45 : 72,
        quality_score: isPrimary ? 92 : 85,
        success_rate: isPrimary ? 0.99 : 0.96,
        active_sessions: isPrimary ? 2 : 1,
        total_sessions: isPrimary ? 100 : 80,
        bandwidth_gb: isPrimary ? 10.5 : 8.2,
        bytes_up: 0,
        bytes_down: 0,
        last_heartbeat: new Date().toISOString(),
        version: '1.0.0-e2e',
    };
}

export const mockExplorerGate503Body = {
    error: 'explorer full decentralization gate active; quorum requirements not satisfied',
    message: 'explorer full decentralization gate active; quorum requirements not satisfied',
};

export { mockMapResponse };
