'use client';

/**
 * Google Photorealistic / Maps 3D canvas for the explorer infrastructure map.
 * Falls back to the classic react-globe.gl scene when maps3d fails to load.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { NodeGeoPoint } from '@/lib/services/explorer';
import { isValidGlobeCoord } from '@/lib/geo/globe-coords';
import {
    getGoogleMapsApiKey,
    loadGoogleMaps3D,
    loadGoogleMarkerLibrary,
} from '@/lib/map/load-google-maps';
import type {
    Maps3DLibrary,
    Maps3DMapElement,
    Maps3DMarkerElement,
    MarkerLibraryLoose,
} from '@/lib/map/google-maps3d-types';
import type { GlobeMapProps, MapStyle } from './globe/types';

const WORLD_VIEW = {
    center: { lat: 20, lng: 8, altitude: 0 },
    range: 18_500_000,
    tilt: 0,
    heading: 0,
} as const;

const NODE_RANGE = 2_400_000;
const FLY_MS = 1400;

function modeForStyle(style: MapStyle, MapMode: Maps3DLibrary['MapMode']): string {
    if (style === 'satellite') return MapMode.SATELLITE;
    if (style === 'terrain') return MapMode.HYBRID;
    return MapMode.HYBRID;
}

function nodePinColor(node: NodeGeoPoint, selected: boolean): string {
    if (selected) return '#f59e0b';
    if (node.is_validator) return '#a855f7';
    if (node.is_active) return '#10b981';
    return '#ef4444';
}

function boundsCenter(
    focusBounds: [[number, number], [number, number]],
): { lat: number; lng: number; range: number } {
    const [[south, west], [north, east]] = focusBounds;
    const lat = (south + north) / 2;
    const lng = (west + east) / 2;
    const span = Math.max(Math.abs(north - south), Math.abs(east - west), 2);
    const range = Math.min(18_500_000, Math.max(400_000, span * 120_000));
    return { lat, lng, range };
}

type MarkerKind = 'node' | 'listing';

type MarkerMeta = {
    kind: MarkerKind;
    id: string;
    el: Maps3DMarkerElement;
};

export default function GoogleMaps3DCanvas({
    nodes,
    onSelectNode,
    selectedNodeId,
    listingPins = [],
    onSelectListing,
    selectedListingId,
    mapStyle = 'satellite',
    focusBounds,
    onEngineError,
    resetSignal = 0,
}: GlobeMapProps & {
    onEngineError?: (message: string) => void;
    resetSignal?: number;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<Maps3DMapElement | null>(null);
    const libRef = useRef<Maps3DLibrary | null>(null);
    const pinLibRef = useRef<MarkerLibraryLoose | null>(null);
    const markersRef = useRef<MarkerMeta[]>([]);
    const nodeMapRef = useRef<Map<string, NodeGeoPoint>>(new Map());
    const listingMapRef = useRef<Map<string, (typeof listingPins)[number]>>(new Map());
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Init Map3DElement once
    useEffect(() => {
        let cancelled = false;
        const host = hostRef.current;
        if (!host) return;
        if (!getGoogleMapsApiKey()) {
            const msg = 'Google Maps API key is not set';
            setError(msg);
            onEngineError?.(msg);
            return;
        }

        (async () => {
            try {
                const [maps3d, markerLib] = await Promise.all([
                    loadGoogleMaps3D(),
                    loadGoogleMarkerLibrary(),
                ]);
                if (cancelled || !hostRef.current) return;

                libRef.current = maps3d;
                pinLibRef.current = markerLib;

                const map = new maps3d.Map3DElement({
                    center: { ...WORLD_VIEW.center },
                    range: WORLD_VIEW.range,
                    tilt: WORLD_VIEW.tilt,
                    heading: WORLD_VIEW.heading,
                    mode: modeForStyle(mapStyle, maps3d.MapMode),
                });
                map.style.width = '100%';
                map.style.height = '100%';
                map.style.display = 'block';
                map.style.border = '0';

                hostRef.current.replaceChildren(map);
                mapRef.current = map;
                setReady(true);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to load Google Maps 3D';
                if (!cancelled) {
                    setError(message);
                    onEngineError?.(message);
                }
            }
        })();

        return () => {
            cancelled = true;
            markersRef.current = [];
            mapRef.current = null;
            if (host) host.replaceChildren();
        };
        // Intentionally once on mount — style updates handled below
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Map style → mode
    useEffect(() => {
        const map = mapRef.current;
        const lib = libRef.current;
        if (!map || !lib || !ready) return;
        map.mode = modeForStyle(mapStyle, lib.MapMode);
    }, [mapStyle, ready]);

    // Sync markers
    useEffect(() => {
        const map = mapRef.current;
        const lib = libRef.current;
        const pinLib = pinLibRef.current;
        if (!map || !lib || !pinLib || !ready) return;

        for (const m of markersRef.current) {
            m.el.remove();
        }
        markersRef.current = [];
        nodeMapRef.current = new Map(nodes.map((n) => [n.node_id, n]));
        listingMapRef.current = new Map(listingPins.map((p) => [p.listing_id, p]));

        const addPin = (
            kind: MarkerKind,
            id: string,
            lat: number,
            lon: number,
            color: string,
            label: string,
            title: string,
        ) => {
            if (!isValidGlobeCoord(lat, lon)) return;
            const marker = new lib.Marker3DInteractiveElement({
                position: { lat, lng: lon, altitude: 0 },
                altitudeMode: lib.AltitudeMode?.CLAMP_TO_GROUND ?? 'CLAMP_TO_GROUND',
                drawsWhenOccluded: true,
                label,
                title,
            });
            const pin = new pinLib.PinElement({
                background: color,
                borderColor: '#ffffff',
                glyphColor: '#0b0b12',
                scale: kind === 'listing' ? 0.9 : selectedNodeId === id || selectedListingId === id ? 1.25 : 1,
            });
            marker.append(pin);
            marker.addEventListener('gmp-click', () => {
                if (kind === 'node') {
                    const node = nodeMapRef.current.get(id);
                    if (node) onSelectNode(node);
                } else {
                    const listing = listingMapRef.current.get(id);
                    if (listing) onSelectListing?.(listing);
                }
            });
            map.append(marker);
            markersRef.current.push({ kind, id, el: marker });
        };

        for (const node of nodes) {
            addPin(
                'node',
                node.node_id,
                node.lat,
                node.lon,
                nodePinColor(node, node.node_id === selectedNodeId),
                node.is_validator ? 'V' : 'N',
                `${node.node_id.slice(0, 12)}…`,
            );
        }
        for (const pin of listingPins) {
            addPin(
                'listing',
                pin.listing_id,
                pin.lat,
                pin.lon,
                pin.listing_id === selectedListingId ? '#f59e0b' : '#10b981',
                '$',
                pin.title,
            );
        }
    }, [
        nodes,
        listingPins,
        selectedNodeId,
        selectedListingId,
        onSelectNode,
        onSelectListing,
        ready,
    ]);

    // Fly to selection / region bounds / world
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready) return;

        if (selectedNodeId) {
            const node = nodeMapRef.current.get(selectedNodeId);
            if (node && isValidGlobeCoord(node.lat, node.lon)) {
                map.flyCameraTo({
                    center: { lat: node.lat, lng: node.lon, altitude: 0 },
                    range: NODE_RANGE,
                    tilt: 45,
                    heading: map.heading ?? 0,
                    durationMillis: FLY_MS,
                });
                return;
            }
        }

        if (selectedListingId) {
            const pin = listingMapRef.current.get(selectedListingId);
            if (pin && isValidGlobeCoord(pin.lat, pin.lon)) {
                map.flyCameraTo({
                    center: { lat: pin.lat, lng: pin.lon, altitude: 0 },
                    range: NODE_RANGE,
                    tilt: 45,
                    heading: map.heading ?? 0,
                    durationMillis: FLY_MS,
                });
                return;
            }
        }

        if (focusBounds) {
            const c = boundsCenter(focusBounds);
            map.flyCameraTo({
                center: { lat: c.lat, lng: c.lng, altitude: 0 },
                range: c.range,
                tilt: 35,
                heading: 0,
                durationMillis: FLY_MS,
            });
            return;
        }
    }, [selectedNodeId, selectedListingId, focusBounds, ready]);

    const resetWorld = () => {
        const map = mapRef.current;
        if (!map) return;
        map.flyCameraTo({
            center: { ...WORLD_VIEW.center },
            range: WORLD_VIEW.range,
            tilt: WORLD_VIEW.tilt,
            heading: WORLD_VIEW.heading,
            durationMillis: FLY_MS,
        });
    };

    useEffect(() => {
        if (!ready || resetSignal <= 0) return;
        resetWorld();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetSignal, ready]);

    return (
        <div className="relative w-full h-full min-h-[320px] bg-[#050508]" data-testid="explorer-maps3d">
            <div ref={hostRef} className="absolute inset-0" />
            {!ready && !error ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#050508]/85">
                    <Loader2 className="animate-spin text-primary" size={28} />
                    <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">
                        Loading Google Photorealistic 3D…
                    </p>
                </div>
            ) : null}
            {ready ? (
                <>
                    <div className="pointer-events-none absolute left-3 bottom-3 z-[500] rounded-md border border-white/10 bg-black/70 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-white/45">
                        Google Photorealistic 3D
                    </div>
                    <div className="absolute right-3 bottom-3 z-[500] flex gap-1.5">
                        <button
                            type="button"
                            onClick={resetWorld}
                            className="rounded-lg border border-white/15 bg-black/70 px-2.5 py-1.5 text-[8px] font-black uppercase tracking-widest text-white/70 hover:text-white"
                            data-testid="maps3d-reset"
                        >
                            Reset world
                        </button>
                    </div>
                </>
            ) : null}
        </div>
    );
}
