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
 * Legacy WebGL globe (deprecated). Primary Explorer UX is Google Maps 2D / tilt-3D.
 * Keep off unless explicitly validating old globe topology paths.
 */
export function legacyExplorerGlobeEnabled(): boolean {
    return envFlag('NEXT_PUBLIC_LEGACY_EXPLORER_GLOBE');
}

/** Real session-derived topology arcs on the legacy 3D globe. */
export function globeTopologyEnabled(): boolean {
    return envFlag('NEXT_PUBLIC_GLOBE_TOPOLOGY');
}

export function googleMapsApiKey(): string {
    return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
}

/** Optional Cloud Map ID for vector basemap + Advanced Markers (GCP Map Management). */
export function googleMapsMapId(): string {
    return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? '').trim();
}
