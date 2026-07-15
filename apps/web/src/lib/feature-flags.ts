/**
 * Client feature flags (build-time via NEXT_PUBLIC_*).
 */

export function isUnifiedNetworkEnabled(): boolean {
    const raw = process.env.NEXT_PUBLIC_UNIFIED_NETWORK?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Live explorer WS node updates on marketplace map (Phase 2). */
export function mapLiveOnMarketplaceEnabled(): boolean {
    const raw = process.env.NEXT_PUBLIC_MAP_LIVE_ON_MARKETPLACE?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Real session-derived topology arcs on the 3D globe (Phase 5). */
export function globeTopologyEnabled(): boolean {
    const raw = process.env.NEXT_PUBLIC_GLOBE_TOPOLOGY?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}
