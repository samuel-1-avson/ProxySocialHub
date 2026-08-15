/**
 * Client feature flags (build-time via NEXT_PUBLIC_*).
 */

function envFlag(name: string): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

export function isUnifiedNetworkEnabled(): boolean {
    return envFlag('NEXT_PUBLIC_UNIFIED_NETWORK');
}

/** Live explorer WS node updates on marketplace map. */
export function mapLiveOnMarketplaceEnabled(): boolean {
    return envFlag('NEXT_PUBLIC_MAP_LIVE_ON_MARKETPLACE');
}

/**
 * Legacy WebGL explorer globe — removed from product UI.
 * Flags kept as no-ops so old env configs do not break builds.
 */
export function legacyExplorerGlobeEnabled(): boolean {
    return false;
}

/** Real session-derived topology arcs on the legacy 3D globe (disabled). */
export function globeTopologyEnabled(): boolean {
    return false;
}

export function googleMapsApiKey(): string {
    return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
}

/** Optional Cloud Map ID for vector basemap + Advanced Markers (GCP Map Management). */
export function googleMapsMapId(): string {
    return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? '').trim();
}

/** Force-show or hide the global Testnet/devnet honesty strip. */
export function showTestnetBannerForced(): boolean | null {
    const raw = process.env.NEXT_PUBLIC_SHOW_TESTNET_BANNER?.trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes') return true;
    if (raw === '0' || raw === 'false' || raw === 'no') return false;
    return null;
}
