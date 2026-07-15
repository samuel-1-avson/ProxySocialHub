import type { CountryFeature } from './types';

export function ringCentroid(ring: number[][]): [number, number] {
    let lat = 0;
    let lon = 0;
    for (const [lo, la] of ring) {
        lon += lo;
        lat += la;
    }
    return [lat / ring.length, lon / ring.length];
}

export function featureCentroid(f: CountryFeature): [number, number] | null {
    const geom = f.geometry;
    if (!geom || !geom.coordinates) return null;

    try {
        const { type, coordinates: c } = geom;
        if (type === 'Polygon') {
            const ring = (c as number[][][])[0];
            return ring ? ringCentroid(ring) : null;
        }
        if (type === 'MultiPolygon') {
            const polys = c as number[][][][];
            let best = polys[0]?.[0];
            for (const poly of polys) {
                if (poly[0] && best && poly[0].length > best.length) best = poly[0];
            }
            return best ? ringCentroid(best) : null;
        }
    } catch (err) {
        console.warn('[GlobeMap] skip malformed country feature', err);
    }
    return null;
}

export async function loadCountriesGeoJson(url: string): Promise<CountryFeature[]> {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Country borders failed (${res.status})`);
    }
    const data = (await res.json()) as { features?: CountryFeature[] };
    const features = data.features ?? [];
    if (features.length === 0) {
        throw new Error('Country borders GeoJSON is empty');
    }
    return features;
}
