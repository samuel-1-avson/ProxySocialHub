import type { MapLinksResponse } from '../../src/lib/api/map-topology';

/** Single GH → US session-aggregate arc for globe topology E2E. */
export function mockMapLinksResponse(): MapLinksResponse {
    return {
        links: [
            {
                id: 'gh:accra->us:virginia',
                kind: 'session_aggregate',
                source: { id: 'gh:accra', label: 'Accra, GH', lat: 5.6, lon: -0.19 },
                target: { id: 'us:virginia', label: 'Virginia, US', lat: 37.43, lon: -78.66 },
                active_sessions: 2,
                latency_ms: 120,
                stroke_width: 2,
                color: '#38bdf8',
                geo_precision: 'country_region',
                provenance: 'session_intents',
                updated_at: new Date().toISOString(),
            },
        ],
        meta: {
            count: 1,
            window_minutes: 60,
            topology_available: true,
        },
    };
}

export function mockMapLinksEmpty(): MapLinksResponse {
    return {
        links: [],
        meta: {
            count: 0,
            window_minutes: 60,
            topology_available: false,
        },
    };
}
