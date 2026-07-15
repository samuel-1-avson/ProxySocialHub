import type { MapStyle } from './types';

export interface StyleConfig {
    globeImage: string;
    bump: string;
    background: string;
    atmosphere: string;
    polyCapColor: string;
    polySideColor: string;
    polyStrokeColor: string;
    labelColor: string;
}

const ASSET = '/map-assets';

export const GLOBE_TEXTURES = {
    earthNight: `${ASSET}/earth-night.jpg`,
    earthDay: `${ASSET}/earth-day.jpg`,
    earthTopology: `${ASSET}/earth-topology.png`,
    nightSky: `${ASSET}/night-sky.png`,
} as const;

export const COUNTRIES_GEOJSON_URL = `${ASSET}/geo/ne_110m_admin_0_countries.geojson`;

export const STYLES: Record<MapStyle, StyleConfig> = {
    satellite: {
        globeImage: GLOBE_TEXTURES.earthNight,
        bump: GLOBE_TEXTURES.earthTopology,
        background: GLOBE_TEXTURES.nightSky,
        atmosphere: '#6366f1',
        polyCapColor: 'rgba(0,0,0,0)',
        polySideColor: 'rgba(99,102,241,0.06)',
        polyStrokeColor: 'rgba(160,163,255,0.45)',
        labelColor: 'rgba(255,255,255,0.92)',
    },
    terrain: {
        globeImage: GLOBE_TEXTURES.earthDay,
        bump: GLOBE_TEXTURES.earthTopology,
        background: GLOBE_TEXTURES.nightSky,
        atmosphere: '#4a90d9',
        polyCapColor: 'rgba(0,0,0,0)',
        polySideColor: 'rgba(0,0,0,0.08)',
        polyStrokeColor: 'rgba(30,30,30,0.6)',
        labelColor: 'rgba(15,15,15,0.95)',
    },
    minimal: {
        globeImage: '',
        bump: '',
        background: GLOBE_TEXTURES.nightSky,
        atmosphere: '#6366f1',
        polyCapColor: 'rgba(12,16,40,0.92)',
        polySideColor: 'rgba(99,102,241,0.18)',
        polyStrokeColor: 'rgba(180,183,255,0.85)',
        labelColor: 'rgba(220,225,255,0.95)',
    },
};

export function textureUrlsForStyle(style: MapStyle): string[] {
    const cfg = STYLES[style];
    return [cfg.globeImage, cfg.bump, cfg.background].filter(Boolean);
}
