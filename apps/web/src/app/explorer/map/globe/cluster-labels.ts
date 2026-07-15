import type { ExplorerListingPin } from '@/components/map/types';
import type { NodeGeoPoint } from '@/lib/services/explorer';
import type { MapLabel } from './types';

const LABEL_GRID_DEG = 1.5;

function bucketKey(lat: number, lon: number): string {
    const latBucket = Math.round(lat / LABEL_GRID_DEG) * LABEL_GRID_DEG;
    const lonBucket = Math.round(lon / LABEL_GRID_DEG) * LABEL_GRID_DEG;
    return `${latBucket}:${lonBucket}`;
}

interface Bucket {
    lat: number;
    lon: number;
    weight: number;
    name: string;
}

function upsertBucket(
    buckets: Map<string, Bucket>,
    lat: number,
    lon: number,
    name: string,
    weight: number,
) {
    if (Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001) return;
    const key = bucketKey(lat, lon);
    const label = name.trim() || 'Cluster';
    const existing = buckets.get(key);
    if (!existing) {
        buckets.set(key, { lat, lon, weight, name: label });
        return;
    }
    existing.weight += weight;
}

/**
 * Derive map labels from live node/listing clusters instead of a static world-city table.
 */
export function deriveClusterLabels(
    nodes: NodeGeoPoint[],
    listings: ExplorerListingPin[],
    maxLabels = 120,
): MapLabel[] {
    const buckets = new Map<string, Bucket>();

    for (const n of nodes) {
        const name = n.city || n.region || n.country || 'Nodes';
        upsertBucket(buckets, n.lat, n.lon, name, n.is_active ? 2 : 1);
    }
    for (const pin of listings) {
        const name = pin.city || pin.country || pin.title;
        upsertBucket(buckets, pin.lat, pin.lon, name, 1);
    }

    return [...buckets.values()]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, maxLabels)
        .map((b) => ({
            name: b.name,
            lat: b.lat,
            lon: b.lon,
            tier: Math.min(5, Math.max(1, Math.ceil(b.weight / 2))),
        }));
}

export function labelsWithSizes(labels: MapLabel[]) {
    return labels.map((c) => ({
        ...c,
        labelSize: 0.12 + c.tier * 0.06,
        dotRadius: 0.06 + c.tier * 0.035,
    }));
}
