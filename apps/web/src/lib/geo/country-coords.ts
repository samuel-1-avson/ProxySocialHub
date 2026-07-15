import { resolveRegionalHub } from '@/lib/geo/regional-hubs';

/** Country / region centroids for map fallback when lat/lon are missing. */
export const COUNTRY_COORDS: Record<string, [number, number]> = {
    US: [38, -97],
    'United States': [38, -97],
    USA: [38, -97],
    CA: [56, -106],
    Canada: [56, -106],
    MX: [23, -102],
    Mexico: [23, -102],
    GB: [52, -1],
    'United Kingdom': [52, -1],
    UK: [52, -1],
    DE: [51, 10],
    Germany: [51, 10],
    FR: [46, 2],
    France: [46, 2],
    NL: [52, 5],
    Netherlands: [52, 5],
    SE: [60, 15],
    Sweden: [60, 15],
    NO: [64, 15],
    Norway: [64, 15],
    FI: [64, 26],
    Finland: [64, 26],
    CH: [47, 8],
    Switzerland: [47, 8],
    PL: [52, 20],
    Poland: [52, 20],
    UA: [49, 32],
    Ukraine: [49, 32],
    TR: [39, 35],
    Turkey: [39, 35],
    ES: [40, -4],
    Spain: [40, -4],
    IT: [42, 12],
    Italy: [42, 12],
    PT: [39, -8],
    Portugal: [39, -8],
    RO: [45, 25],
    Romania: [45, 25],
    JP: [35, 135],
    Japan: [35, 135],
    SG: [1, 104],
    Singapore: [1, 104],
    HK: [22, 114],
    'Hong Kong': [22, 114],
    KR: [37, 127],
    'South Korea': [37, 127],
    IN: [20, 77],
    India: [20, 77],
    CN: [35, 103],
    China: [35, 103],
    AU: [-25, 133],
    Australia: [-25, 133],
    BR: [-10, -55],
    Brazil: [-10, -55],
    ZA: [-29, 25],
    'South Africa': [-29, 25],
    AE: [24, 54],
    UAE: [24, 54],
    CZ: [50, 15],
    'Czech Republic': [50, 15],
    AT: [47, 14],
    Austria: [47, 14],
    BE: [51, 4],
    Belgium: [51, 4],
    GR: [39, 22],
    Greece: [39, 22],
    DK: [56, 10],
    Denmark: [56, 10],
    IE: [53, -8],
    Ireland: [53, -8],
    HU: [47, 20],
    Hungary: [47, 20],
    RU: [60, 90],
    Russia: [60, 90],
    NZ: [-40.9, 174.9],
    'New Zealand': [-40.9, 174.9],
    AR: [-34, -64],
    Argentina: [-34, -64],
    NG: [9, 8],
    Nigeria: [9, 8],
    GH: [7.9, -1.0],
    Ghana: [7.9, -1.0],
    IL: [31, 35],
    Israel: [31, 35],
    ID: [-5, 120],
    Indonesia: [-5, 120],
    TH: [13, 101],
    Thailand: [13, 101],
    VN: [14, 108],
    Vietnam: [14, 108],
    MY: [3, 109],
    Malaysia: [3, 109],
    PH: [13, 122],
    Philippines: [13, 122],
};

const CITY_COORDS: Record<string, [number, number]> = {
    accra: [5.6037, -0.187],
    kumasi: [6.6885, -1.6244],
    tamale: [9.4035, -0.8429],
    tema: [5.6698, -0.0166],
    'cape coast': [5.1053, -1.2466],
    takoradi: [4.8845, -1.7554],
    'gh:accra': [5.6037, -0.187],
    'gh:kumasi': [6.6885, -1.6244],
    'gh:takoradi': [4.8845, -1.7554],
    'new york': [40.7128, -74.006],
    london: [51.5074, -0.1278],
    paris: [48.8566, 2.3522],
};

export const REGION_COORDS: Record<string, [number, number]> = {
    'us-east': [39, -77],
    'us-west': [37, -122],
    'eu-west': [51, 0],
    'eu-central': [50, 10],
    'ap-southeast': [1, 104],
    'ap-northeast': [35, 135],
    'sa-east': [-23, -46],
    'af-south': [-29, 25],
    'me-south': [24, 54],
    'north-america': [45, -100],
    europe: [50, 10],
    asia: [25, 90],
    oceania: [-25, 133],
    'south-america': [-15, -60],
    africa: [5, 20],
};

function stableJitter(anchor: string): [number, number] {
    if (!anchor) return [0, 0];
    let hash = 2166136261;
    for (let i = 0; i < anchor.length; i++) {
        hash ^= anchor.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const lat = ((hash % 7) - 3) * 0.02;
    const lon = (((hash >> 4) % 5) - 2) * 0.02;
    return [lat, lon];
}

function cityCentroid(city: string, country?: string): [number, number] | undefined {
    const key = city.trim().toLowerCase();
    if (!key) return undefined;
    if (CITY_COORDS[key]) return CITY_COORDS[key];
    const cc = country?.trim().toUpperCase();
    if (cc && CITY_COORDS[`${cc}:${key}`]) return CITY_COORDS[`${cc}:${key}`];
    return undefined;
}

function countryCentroid(country: string, anchor: string): [number, number] | undefined {
    const key = country.trim();
    if (!key) return undefined;
    const c = COUNTRY_COORDS[key] ?? COUNTRY_COORDS[key.toUpperCase()];
    if (!c) return undefined;
    const [jLat, jLon] = stableJitter(anchor);
    return [c[0] + jLat, c[1] + jLon];
}

/** Stable grouping key: listings on the same node share one map location. */
export function mapGeoAnchor(nodeId?: string, sellerId?: string, listingId?: string): string {
    if (nodeId?.trim()) return `node:${nodeId.trim()}`;
    if (sellerId?.trim()) return `seller:${sellerId.trim()}`;
    if (listingId?.trim()) return `listing:${listingId.trim()}`;
    return '';
}

/** Node map fallback when explorer/geo lat/lon are unset (before GeoIP backfill). */
export function resolveNodeCoords(node: {
    lat: number;
    lon: number;
    country: string;
    region: string;
    city?: string;
    node_id?: string;
}): { lat: number; lon: number } {
    const hub = resolveRegionalHub(node.country, node.city, node.region, node.lat, node.lon);
    if (hub) return { lat: hub.lat, lon: hub.lon };
    const city = cityCentroid(node.city ?? '', node.country);
    if (city) return { lat: city[0], lon: city[1] };
    const anchor = mapGeoAnchor(node.node_id);
    const country = countryCentroid(node.country, anchor);
    if (country) return { lat: country[0], lon: country[1] };
    if (node.region) {
        const lc = node.region.toLowerCase();
        for (const [key, coords] of Object.entries(REGION_COORDS)) {
            if (lc.includes(key) || key.includes(lc)) {
                return { lat: coords[0], lon: coords[1] };
            }
        }
    }
    return { lat: node.lat, lon: node.lon };
}

/** Fallback when API coords are missing; uses city then stable country anchor (same node = same pin). */
export function resolveListingCoords(pin: {
    lat: number;
    lon: number;
    country?: string;
    city?: string;
    node_id?: string;
    seller_id?: string;
    listing_id?: string;
}): { lat: number; lon: number; estimated: boolean } {
    const hub = resolveRegionalHub(pin.country, pin.city, undefined, pin.lat, pin.lon);
    if (hub) {
        return { lat: hub.lat, lon: hub.lon, estimated: true };
    }
    const city = cityCentroid(pin.city ?? '', pin.country);
    if (city) return { lat: city[0], lon: city[1], estimated: true };
    const anchor = mapGeoAnchor(pin.node_id, pin.seller_id, pin.listing_id);
    const country = countryCentroid(pin.country ?? '', anchor);
    if (country) return { lat: country[0], lon: country[1], estimated: true };
    return { lat: pin.lat, lon: pin.lon, estimated: true };
}
