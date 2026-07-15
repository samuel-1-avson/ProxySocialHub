import { publicApiGet } from './client';

export interface MapLinkEndpoint {
    id: string;
    label: string;
    lat: number;
    lon: number;
}

export interface MapTopologyLink {
    id: string;
    kind: string;
    source: MapLinkEndpoint;
    target: MapLinkEndpoint;
    active_sessions: number;
    latency_ms: number;
    stroke_width: number;
    color: string;
    geo_precision: string;
    provenance: string;
    updated_at: string;
}

export interface MapLinksResponse {
    links: MapTopologyLink[];
    meta: {
        count: number;
        window_minutes: number;
        topology_available: boolean;
    };
}

export interface MapLinksFilters {
    min_sessions?: number;
    limit?: number;
    kinds?: string;
    bbox?: string;
}

export function getMapLinks(filters?: MapLinksFilters) {
    const params: Record<string, string> = {};
    if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                params[key] = String(value);
            }
        });
    }
    return publicApiGet<MapLinksResponse>('/v1/map/links', params);
}
