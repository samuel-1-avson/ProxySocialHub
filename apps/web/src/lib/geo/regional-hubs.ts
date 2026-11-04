/** Major regional map hubs — city/region level clustering worldwide (not street GPS). */

import { HUBS_BY_COUNTRY } from '@/lib/geo/regional-hubs-data';
import type { RegionalHub } from '@/lib/geo/regional-hubs-types';

export type { RegionalHub } from '@/lib/geo/regional-hubs-types';

/**
 * Bounds coordinate-to-hub snapping (mirrors maxRegionalHubSnapKm in
 * services/control-api/internal/geo/regional_hubs.go — keep in sync).
 * Coordinates are evidence of the real exit; a declared country is a claim.
 * If the closest hub in the claimed country is farther than this, the two
 * disagree (a Ghana node once snapped to Boston via a stale "US" listing
 * country), so no hub is returned and callers fall back instead of pinning
 * the wrong continent. Text (city/region) matches are not distance-bound.
 */
export const MAX_REGIONAL_HUB_SNAP_KM = 2500;

const COUNTRY_ALIASES: Record<string, string> = {
    GHANA: 'GH',
    GHA: 'GH',
    USA: 'US',
    'UNITED STATES': 'US',
    'UNITED STATES OF AMERICA': 'US',
    UK: 'GB',
    'UNITED KINGDOM': 'GB',
    NIGERIA: 'NG',
    NGA: 'NG',
    CHINA: 'CN',
    CHN: 'CN',
    INDIA: 'IN',
    IND: 'IN',
    GERMANY: 'DE',
    DEU: 'DE',
    FRANCE: 'FR',
    FRA: 'FR',
    SPAIN: 'ES',
    ESP: 'ES',
    ITALY: 'IT',
    ITA: 'IT',
    NETHERLANDS: 'NL',
    'THE NETHERLANDS': 'NL',
    NLD: 'NL',
    BELGIUM: 'BE',
    BEL: 'BE',
    SWITZERLAND: 'CH',
    CHE: 'CH',
    POLAND: 'PL',
    POL: 'PL',
    SWEDEN: 'SE',
    SWE: 'SE',
    NORWAY: 'NO',
    NOR: 'NO',
    AUSTRIA: 'AT',
    AUT: 'AT',
    PORTUGAL: 'PT',
    PRT: 'PT',
    IRELAND: 'IE',
    IRL: 'IE',
    ROMANIA: 'RO',
    ROU: 'RO',
    'CZECH REPUBLIC': 'CZ',
    CZECHIA: 'CZ',
    CZE: 'CZ',
    GREECE: 'GR',
    GRC: 'GR',
    TURKEY: 'TR',
    TÜRKIYE: 'TR',
    TURKIYE: 'TR',
    TUR: 'TR',
    RUSSIA: 'RU',
    'RUSSIAN FEDERATION': 'RU',
    RUS: 'RU',
    JAPAN: 'JP',
    JPN: 'JP',
    'SOUTH KOREA': 'KR',
    'REPUBLIC OF KOREA': 'KR',
    KOR: 'KR',
    SINGAPORE: 'SG',
    SGP: 'SG',
    AUSTRALIA: 'AU',
    AUS: 'AU',
    BRAZIL: 'BR',
    BRA: 'BR',
    MEXICO: 'MX',
    MEX: 'MX',
    CANADA: 'CA',
    CAN: 'CA',
    'SOUTH AFRICA': 'ZA',
    ZAF: 'ZA',
    EGYPT: 'EG',
    EGY: 'EG',
    KENYA: 'KE',
    KEN: 'KE',
    UAE: 'AE',
    'UNITED ARAB EMIRATES': 'AE',
    ARE: 'AE',
};

export function normalizeCountryCode(country?: string): string {
    const raw = (country ?? '').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();
    if (COUNTRY_ALIASES[upper]) return COUNTRY_ALIASES[upper];
    if (upper.length === 2) return upper;
    return '';
}

/** Lowercase words of a place name; spaces, hyphens and punctuation separate words. */
function placeTokens(raw?: string): string[] {
    return (raw ?? '').trim().toLowerCase().split(/[\s\-_,.;:()/\\'"`]+/).filter(Boolean);
}

/** Spacing-insensitive key so typed names like "Capecoast" still hit "Cape Coast". */
function compactKey(key: string): string {
    return key.replace(/ /g, '');
}

function containsTokenRun(hay: string[], needle: string[]): boolean {
    if (needle.length === 0 || needle.length > hay.length) return false;
    for (let i = 0; i + needle.length <= hay.length; i++) {
        if (needle.every((word, j) => hay[i + j] === word)) return true;
    }
    return false;
}

/**
 * Mirrors matchRegionalHubByText in the Go control-api: exact name/alias first,
 * then the longest whole-word match ("western north" beats "western"). Whole
 * words only, so short names cannot hide inside others ("wa" in "Kwadaso").
 */
function matchHubByText(hubs: RegionalHub[], raw?: string): RegionalHub | undefined {
    const keyTokens = placeTokens(raw);
    if (keyTokens.length === 0) return undefined;
    const key = keyTokens.join(' ');
    let best: RegionalHub | undefined;
    let bestScore = 0;
    for (const hub of hubs) {
        for (const candidate of [hub.name, ...hub.aliases]) {
            const candTokens = placeTokens(candidate);
            if (candTokens.length === 0) continue;
            const cand = candTokens.join(' ');
            if (cand === key || compactKey(cand) === compactKey(key)) return hub;
            if (containsTokenRun(keyTokens, candTokens) || containsTokenRun(candTokens, keyTokens)) {
                if (cand.length > bestScore) {
                    best = hub;
                    bestScore = cand.length;
                }
            }
        }
    }
    return best;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestHub(hubs: RegionalHub[], lat: number, lon: number): RegionalHub {
    let best = hubs[0];
    let bestDist = haversineKm(lat, lon, best.lat, best.lon);
    for (const hub of hubs.slice(1)) {
        const d = haversineKm(lat, lon, hub.lat, hub.lon);
        if (d < bestDist) {
            best = hub;
            bestDist = d;
        }
    }
    return best;
}

/** Country codes that have regional hubs, i.e. the countries a node location can be set to. */
export function hubCountryCodes(): string[] {
    return Object.keys(HUBS_BY_COUNTRY).sort();
}

/** Closest hub in any country to a device position; used to snap "Use my location" to a city. */
export function nearestHubWorldwide(
    lat: number,
    lon: number,
): { country: string; hub: RegionalHub; km: number } | undefined {
    let best: { country: string; hub: RegionalHub; km: number } | undefined;
    for (const [country, hubs] of Object.entries(HUBS_BY_COUNTRY)) {
        for (const hub of hubs) {
            const km = haversineKm(lat, lon, hub.lat, hub.lon);
            if (!best || km < best.km) best = { country, hub, km };
        }
    }
    return best;
}

/** Returns hubs configured for a country, if any. */
export function regionalHubsForCountry(country?: string): RegionalHub[] {
    const cc = normalizeCountryCode(country);
    if (!cc) return [];
    return HUBS_BY_COUNTRY[cc] ?? [];
}

export function resolveRegionalHub(
    country?: string,
    city?: string,
    region?: string,
    lat = 0,
    lon = 0,
): { name: string; lat: number; lon: number } | undefined {
    const hubs = regionalHubsForCountry(country);
    if (hubs.length === 0) return undefined;

    for (const hint of [city, region]) {
        const byText = matchHubByText(hubs, hint);
        if (byText) return { name: byText.name, lat: byText.lat, lon: byText.lon };
    }
    if (Math.abs(lat) > 0.01 || Math.abs(lon) > 0.01) {
        const hub = nearestHub(hubs, lat, lon);
        if (haversineKm(lat, lon, hub.lat, hub.lon) > MAX_REGIONAL_HUB_SNAP_KM) return undefined;
        return { name: hub.name, lat: hub.lat, lon: hub.lon };
    }
    return undefined;
}
