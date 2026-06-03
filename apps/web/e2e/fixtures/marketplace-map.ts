/** Shared marketplace map fixtures for Playwright specs. */

export const verifiedMapListingId = 'verified-map-1';

export const verifiedMapPoint = {
    id: `listing:${verifiedMapListingId}`,
    kind: 'listing' as const,
    listing_id: verifiedMapListingId,
    lat: 30.2672,
    lon: -97.7431,
    title: 'Verified Austin Residential',
    country: 'US',
    city: 'Austin',
    isp: 'ProxyHubb Test ISP',
    status: 'active',
    purchasable: true,
    proxy_type: 'residential',
    protocol: 'http',
    price_per_gb: 0.0025,
    available_bandwidth_gb: 50,
    uptime_percent: 99.7,
    latency_ms: 42,
    sla_source: 'gateway',
    geo_source: 'gateway',
    listing_offer_verified: true,
    listing_offer_signer: 'GXdz7cj6JK4qvQzgrwkBPJUkgcFMW68jQwonMQqAzrkF',
    heartbeat_verified: true,
    heartbeat_signer: 'GXdz7cj6JK4qvQzgrwkBPJUkgcFMW68jQwonMQqAzrkF',
};

export function mockListingDetail(overrides: Record<string, unknown> = {}) {
    return {
        id: verifiedMapPoint.listing_id,
        seller_id: 'seller-1',
        node_id: 'node-1',
        title: verifiedMapPoint.title,
        description: 'Verified listing for map E2E',
        price_per_gb: verifiedMapPoint.price_per_gb,
        min_purchase_gb: 1,
        available_bandwidth_gb: verifiedMapPoint.available_bandwidth_gb,
        max_concurrency: 5,
        proxy_type: 'residential',
        protocol: 'http',
        status: 'active',
        country: 'US',
        city: 'Austin',
        uptime_percent: 99.7,
        avg_latency_ms: 42,
        success_rate: 100,
        quality_score: 98,
        listing_offer_verified: true,
        created_at: '2026-06-02T14:31:00Z',
        ...overrides,
    };
}

export function mockMapResponse() {
    return {
        points: [verifiedMapPoint],
        total: 1,
        listing_count: 1,
        node_count: 0,
    };
}
