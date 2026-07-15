/** Major regional map hubs — city/region level clustering worldwide (not street GPS). */

import { HUBS_BY_COUNTRY } from '@/lib/geo/regional-hubs-data';
import type { RegionalHub } from '@/lib/geo/regional-hubs-types';

export type { RegionalHub } from '@/lib/geo/regional-hubs-types';

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

function placeKey(raw?: string): string {
    return (raw ?? '').trim().toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ');
}

function matchHubByText(hubs: RegionalHub[], raw?: string): RegionalHub | undefined {
    const key = placeKey(raw);
    if (!key) return undefined;
    for (const hub of hubs) {
        if (placeKey(hub.name) === key) return hub;
        for (const alias of hub.aliases) {
            const a = placeKey(alias);
            if (a === key || key.includes(a) || a.includes(key)) return hub;
        }
    }
    return undefined;
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
        return { name: hub.name, lat: hub.lat, lon: hub.lon };
    }
    return undefined;
}
