'use client';

/**
 * Google Maps engine for ProxyHubb (marketplace, explorer, network).
 * Flat dark roadmap only (2D).
 * Session Density uses an imperative HeatmapLayer + visualization library.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    GoogleMap,
    InfoWindowF,
    OverlayView,
    OverlayViewF,
    useJsApiLoader,
} from '@react-google-maps/api';
import Supercluster from 'supercluster';
import type { NodeGeoPoint } from '@/lib/services/explorer';
import { googleMapsMapId } from '@/lib/feature-flags';
import type { ExplorerListingPin, MapViewportBounds, ProxyMapCanvasProps } from './types';
import {
    clusterPopup,
    GOOGLE_MAP_DARK_STYLES,
    groupListingPins,
    listingClusterPopup,
    listingMarkerHtml,
    listingPopup,
    markerHtml,
    nodeColor,
    singleNodePopup,
} from './mapHelpers';

const CONTAINER_STYLE: React.CSSProperties = {
    width: '100%',
    height: '100%',
    minHeight: 480,
    borderRadius: 'inherit',
};

/** Stable refs — @react-google-maps/api re-applies center/zoom whenever the prop identity changes. */
const INITIAL_CENTER: google.maps.LatLngLiteral = { lat: 20, lng: 10 };
const INITIAL_ZOOM = 2;
const BOUNDS_DEBOUNCE_MS = 350;

/** Bump when libraries change so browsers don't reuse a Maps JS load without visualization. */
const MAPS_LOADER_ID = 'proxyhubb-google-maps-v3';

type GoogleProxyMapCanvasProps = ProxyMapCanvasProps & { apiKey: string };

type PopupState =
    | { kind: 'node'; position: google.maps.LatLngLiteral; html: string }
    | { kind: 'listing'; position: google.maps.LatLngLiteral; html: string; group?: ExplorerListingPin[] };

type ClusterFeat = {
    lat: number;
    lon: number;
    clusterNodes: NodeGeoPoint[];
};

function htmlToElement(html: string): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    wrap.style.cursor = 'pointer';
    wrap.style.lineHeight = '0';
    return wrap;
}

/** Advanced Marker when Map ID is set; OverlayView fallback otherwise. */
function HtmlMarker({
    map,
    useAdvanced,
    position,
    html,
    zIndex,
    onClick,
}: {
    map: google.maps.Map | null;
    useAdvanced: boolean;
    position: google.maps.LatLngLiteral;
    html: string;
    zIndex?: number;
    onClick: () => void;
}) {
    const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
    const onClickRef = useRef(onClick);
    onClickRef.current = onClick;

    useEffect(() => {
        if (!useAdvanced || !map || typeof google === 'undefined' || !google.maps.marker?.AdvancedMarkerElement) {
            return;
        }
        const content = htmlToElement(html);
        const handler = (e: Event) => {
            e.stopPropagation();
            onClickRef.current();
        };
        content.addEventListener('click', handler);
        const marker = new google.maps.marker.AdvancedMarkerElement({
            map,
            position,
            content,
            zIndex: zIndex ?? 100,
        });
        markerRef.current = marker;
        return () => {
            content.removeEventListener('click', handler);
            marker.map = null;
            markerRef.current = null;
        };
    }, [useAdvanced, map, html, position.lat, position.lng, zIndex]);

    const canUseAdvanced =
        useAdvanced &&
        typeof google !== 'undefined' &&
        Boolean(google.maps.marker?.AdvancedMarkerElement);

    if (canUseAdvanced) return null;

    return (
        <OverlayViewF
            position={position}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            getPixelPositionOffset={(width, height) => ({
                x: -(width / 2),
                y: -(height / 2),
            })}
            zIndex={zIndex}
        >
            <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                    e.stopPropagation();
                    onClick();
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onClick();
                    }
                }}
                dangerouslySetInnerHTML={{ __html: html }}
                style={{ cursor: 'pointer', lineHeight: 0 }}
            />
        </OverlayViewF>
    );
}

function buildFlatMapOptions(mapId: string): google.maps.MapOptions {
    const base: google.maps.MapOptions = {
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        rotateControl: false,
        backgroundColor: '#050508',
        minZoom: 1,
        maxZoom: 18,
        gestureHandling: 'greedy',
        mapTypeId: 'roadmap',
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
        tilt: 0,
        heading: 0,
        tiltInteractionEnabled: false,
        headingInteractionEnabled: false,
    };

    if (mapId) {
        base.mapId = mapId;
    } else {
        // Raster + JSON styles = classic flat dark roadmap (no globe sphere).
        base.styles = GOOGLE_MAP_DARK_STYLES;
    }

    return base;
}

export default function GoogleProxyMapCanvas({
    apiKey,
    nodes,
    onSelectNode,
    selectedNodeId,
    showHeatmap = false,
    focusBounds,
    liveUpdates = [],
    listingPins = [],
    onSelectListing,
    onSelectListingGroup,
    onBuyListing,
    selectedListingId,
    onBoundsChange,
}: GoogleProxyMapCanvasProps) {
    const mapId = googleMapsMapId();
    const useAdvanced = Boolean(mapId);
    const keptLoadedRef = useRef(false);
    const onBoundsChangeRef = useRef(onBoundsChange);
    onBoundsChangeRef.current = onBoundsChange;
    const lastEmittedBoundsRef = useRef<MapViewportBounds | null>(null);
    const heatmapLayerRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);
    const [heatmapError, setHeatmapError] = useState<string | null>(null);

    // Always load visualization for Session Density. New loader id busts stale
    // sessions that previously loaded Maps JS without the visualization library.
    const libraries = useMemo((): ('marker' | 'visualization')[] => ['marker', 'visualization'], []);
    const mapIds = useMemo(() => (mapId ? [mapId] : undefined), [mapId]);

    const { isLoaded, loadError } = useJsApiLoader({
        id: MAPS_LOADER_ID,
        googleMapsApiKey: apiKey,
        libraries,
        ...(mapIds ? { mapIds } : {}),
    });
    if (isLoaded) keptLoadedRef.current = true;
    const showMap = keptLoadedRef.current || isLoaded;

    const mapRef = useRef<google.maps.Map | null>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const nodeMapRef = useRef<Map<string, NodeGeoPoint>>(new Map());
    const clusterIndexRef = useRef<Supercluster<NodeGeoPoint> | null>(null);
    const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [zoom, setZoom] = useState(2);
    const [bbox, setBbox] = useState<[number, number, number, number]>([-180, -85, 180, 85]);
    const [popup, setPopup] = useState<PopupState | null>(null);
    const [clusterTick, setClusterTick] = useState(0);
    const [statusTick, setStatusTick] = useState(0);

    // Freeze options after first create — re-passing a new object snaps the camera.
    const mapOptionsRef = useRef<google.maps.MapOptions | null>(null);
    if (!mapOptionsRef.current) {
        mapOptionsRef.current = buildFlatMapOptions(mapId);
    }
    const mapOptions = mapOptionsRef.current;

    useEffect(() => {
        if (!document.getElementById('google-map-engine-css')) {
            const style = document.createElement('style');
            style.id = 'google-map-engine-css';
            style.textContent = `
@keyframes nodePulse { 0% { transform: scale(0.6); opacity: 0.8; } 100% { transform: scale(2.2); opacity: 0; } }
.gm-style-iw, .gm-style-iw-c, .gm-style-iw-d { background: transparent !important; box-shadow: none !important; padding: 0 !important; }
.gm-style-iw-tc { display: none !important; }
.gm-style-iw button[aria-label="Close"] { display: none !important; }
.gm-ui-hover-effect { display: none !important; }
`;
            document.head.appendChild(style);
        }
    }, []);

    const emitBounds = useCallback((map: google.maps.Map) => {
        const b = map.getBounds();
        if (!b) return;
        const ne = b.getNorthEast();
        const sw = b.getSouthWest();
        const next: [number, number, number, number] = [sw.lng(), sw.lat(), ne.lng(), ne.lat()];
        const nextZoom = map.getZoom() ?? 2;

        setZoom(z => (Math.round(z) === Math.round(nextZoom) ? z : nextZoom));
        setBbox(prev => {
            if (
                Math.abs(prev[0] - next[0]) < 0.02 &&
                Math.abs(prev[1] - next[1]) < 0.02 &&
                Math.abs(prev[2] - next[2]) < 0.02 &&
                Math.abs(prev[3] - next[3]) < 0.02
            ) {
                return prev;
            }
            return next;
        });

        const bounds: MapViewportBounds = {
            west: sw.lng(),
            south: sw.lat(),
            east: ne.lng(),
            north: ne.lat(),
        };
        const prev = lastEmittedBoundsRef.current;
        if (
            prev &&
            Math.abs(prev.west - bounds.west) < 0.02 &&
            Math.abs(prev.south - bounds.south) < 0.02 &&
            Math.abs(prev.east - bounds.east) < 0.02 &&
            Math.abs(prev.north - bounds.north) < 0.02
        ) {
            return;
        }
        lastEmittedBoundsRef.current = bounds;
        onBoundsChangeRef.current?.(bounds);
    }, []);

    const scheduleEmitBounds = useCallback((map: google.maps.Map) => {
        if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
        boundsTimerRef.current = setTimeout(() => emitBounds(map), BOUNDS_DEBOUNCE_MS);
    }, [emitBounds]);

    const onLoad = useCallback((map: google.maps.Map) => {
        mapRef.current = map;
        setMapInstance(map);
        if (mapOptionsRef.current) {
            delete mapOptionsRef.current.center;
            delete mapOptionsRef.current.zoom;
        }
        map.setTilt(0);
        map.setHeading(0);
        emitBounds(map);
    }, [emitBounds]);

    const onUnmount = useCallback(() => {
        if (heatmapLayerRef.current) {
            heatmapLayerRef.current.setMap(null);
            heatmapLayerRef.current = null;
        }
        mapRef.current = null;
        setMapInstance(null);
        if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
    }, []);

    const handleIdle = useCallback(() => {
        if (mapRef.current) scheduleEmitBounds(mapRef.current);
    }, [scheduleEmitBounds]);

    const handleMapClick = useCallback(() => {
        setPopup(null);
    }, []);

    // Rebuild node index when the REST node set changes (positions).
    useEffect(() => {
        nodeMapRef.current = new Map(nodes.map(n => [n.node_id, n]));
        const sc = new Supercluster<NodeGeoPoint>({ radius: 60, maxZoom: 16, minZoom: 0 });
        const features: GeoJSON.Feature<GeoJSON.Point, NodeGeoPoint>[] = nodes
            .filter(n => Math.abs(n.lat) > 0.001 || Math.abs(n.lon) > 0.001)
            .map(n => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
                properties: n,
            }));
        sc.load(features);
        clusterIndexRef.current = sc;
        setClusterTick(t => t + 1);
        setStatusTick(t => t + 1);
    }, [nodes]);

    // Live WS: match opaque marketplace ids; never invent ghost UUID markers.
    useEffect(() => {
        if (liveUpdates.length === 0) return;
        let statusChanged = false;
        let positionChanged = false;
        for (const upd of liveUpdates) {
            const lookupKeys = [upd.opaque_node_id, upd.node_id].filter(Boolean) as string[];
            let key = '';
            let existing: NodeGeoPoint | undefined;
            for (const k of lookupKeys) {
                const hit = nodeMapRef.current.get(k);
                if (hit) {
                    key = k;
                    existing = hit;
                    break;
                }
            }
            if (existing && key) {
                const nextLat = upd.lat ?? existing.lat;
                const nextLon = upd.lon ?? existing.lon;
                const moved =
                    (upd.lat != null && Math.abs(upd.lat - existing.lat) > 1e-6) ||
                    (upd.lon != null && Math.abs(upd.lon - existing.lon) > 1e-6);
                nodeMapRef.current.set(key, {
                    ...existing,
                    is_active: upd.is_active,
                    uptime_percent: upd.uptime_percent,
                    active_sessions: upd.active_sessions,
                    lat: nextLat,
                    lon: nextLon,
                });
                if (moved) positionChanged = true;
                else statusChanged = true;
            }
            // Do not insert unknown WS node_ids — marketplace map uses opaque ids and
            // inserting raw UUIDs creates duplicate ghost pins.
        }
        if (positionChanged) {
            const sc = new Supercluster<NodeGeoPoint>({ radius: 60, maxZoom: 16, minZoom: 0 });
            const features: GeoJSON.Feature<GeoJSON.Point, NodeGeoPoint>[] = Array.from(nodeMapRef.current.values())
                .filter(n => Math.abs(n.lat) > 0.001 || Math.abs(n.lon) > 0.001)
                .map(n => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
                    properties: n,
                }));
            sc.load(features);
            clusterIndexRef.current = sc;
            setClusterTick(t => t + 1);
        } else if (statusChanged) {
            setStatusTick(t => t + 1);
        }
    }, [liveUpdates]);

    const nodeClusters = useMemo((): ClusterFeat[] => {
        void clusterTick;
        void statusTick;
        const index = clusterIndexRef.current;
        if (!index) return [];
        const clusters = index.getClusters(bbox, Math.round(zoom));
        return clusters.map(f => {
            const { geometry, properties: props } = f;
            const [lon, lat] = geometry.coordinates;
            let clusterNodes: NodeGeoPoint[];
            if ('cluster' in props && props.cluster) {
                const leaves = index.getLeaves(props.cluster_id as number, Infinity);
                clusterNodes = leaves.map(l => {
                    const id = (l.properties as NodeGeoPoint).node_id;
                    return nodeMapRef.current.get(id) ?? (l.properties as NodeGeoPoint);
                });
            } else {
                const id = (props as NodeGeoPoint).node_id;
                clusterNodes = [nodeMapRef.current.get(id) ?? (props as NodeGeoPoint)];
            }
            return { lat, lon, clusterNodes };
        });
    }, [clusterTick, statusTick, bbox, zoom]);

    const listingGroups = useMemo(
        () => groupListingPins(
            (listingPins ?? []).filter(p => Math.abs(p.lat) > 0.01 || Math.abs(p.lon) > 0.01),
        ),
        [listingPins],
    );

    // Imperative Session Density heatmap — never throws into React render.
    useEffect(() => {
        const map = mapRef.current;
        if (!showHeatmap || !map || !isLoaded) {
            if (heatmapLayerRef.current) {
                heatmapLayerRef.current.setMap(null);
                heatmapLayerRef.current = null;
            }
            setHeatmapError(null);
            return;
        }

        void statusTick;
        void clusterTick;

        try {
            if (!google.maps?.visualization?.HeatmapLayer) {
                setHeatmapError('Session density library still loading — try again in a moment');
                return;
            }

            const data = Array.from(nodeMapRef.current.values())
                .filter(n => Math.abs(n.lat) > 0.001 || Math.abs(n.lon) > 0.001)
                .map(n => ({
                    location: new google.maps.LatLng(n.lat, n.lon),
                    weight: n.is_active ? 1 + (Number(n.active_sessions) || 0) * 0.3 : 0.3,
                }));

            if (data.length === 0) {
                if (heatmapLayerRef.current) {
                    heatmapLayerRef.current.setMap(null);
                    heatmapLayerRef.current = null;
                }
                setHeatmapError(null);
                return;
            }

            if (!heatmapLayerRef.current) {
                heatmapLayerRef.current = new google.maps.visualization.HeatmapLayer({
                    data,
                    map,
                    radius: 28,
                    opacity: 0.55,
                    dissipating: true,
                });
            } else {
                heatmapLayerRef.current.setData(data);
                heatmapLayerRef.current.setMap(map);
            }
            setHeatmapError(null);
        } catch (err) {
            console.warn('[GoogleProxyMapCanvas] heatmap failed', err);
            setHeatmapError('Session density unavailable');
            if (heatmapLayerRef.current) {
                heatmapLayerRef.current.setMap(null);
                heatmapLayerRef.current = null;
            }
        }
    }, [showHeatmap, isLoaded, statusTick, clusterTick, mapInstance]);

    // Fit only when the focus *values* change — refetch often recreates the same bbox array.
    const focusBoundsKey = focusBounds
        ? focusBounds.flat().map(n => n.toFixed(4)).join(',')
        : '';
    const prevFocusKeyRef = useRef<string>('');
    useEffect(() => {
        const map = mapRef.current;
        const prevKey = prevFocusKeyRef.current;
        prevFocusKeyRef.current = focusBoundsKey;

        if (!map) return;

        if (!focusBounds || !focusBoundsKey) {
            if (prevKey) {
                map.setCenter(INITIAL_CENTER);
                map.setZoom(INITIAL_ZOOM);
            }
            return;
        }

        if (prevKey === focusBoundsKey) return;

        const [[south, west], [north, east]] = focusBounds;
        const bounds = new google.maps.LatLngBounds(
            { lat: south, lng: west },
            { lat: north, lng: east },
        );
        const timer = setTimeout(() => {
            map.fitBounds(bounds, 60);
            const z = map.getZoom();
            if (z != null && z > 6) map.setZoom(6);
        }, 80);
        return () => clearTimeout(timer);
    }, [focusBounds, focusBoundsKey]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !selectedNodeId) return;
        const node = nodeMapRef.current.get(selectedNodeId);
        if (node && (Math.abs(node.lat) > 0.001 || Math.abs(node.lon) > 0.001)) {
            map.panTo({ lat: node.lat, lng: node.lon });
            setPopup(null);
        }
    }, [selectedNodeId]);

    const handleListingPopupOpen = useCallback((group: ExplorerListingPin[], html: string) => {
        const pin = group[0];
        setPopup({
            kind: 'listing',
            position: { lat: pin.lat, lng: pin.lon },
            html,
            group: group.length > 1 ? group : undefined,
        });
    }, []);

    useEffect(() => {
        if (!popup || popup.kind !== 'listing') return;
        const attach = () => {
            document.querySelectorAll<HTMLButtonElement>('.ph-listing-cluster-row').forEach(btn => {
                btn.onclick = (e) => {
                    e.preventDefault();
                    const id = btn.getAttribute('data-listing-id');
                    const picked = popup.group?.find(p => p.listing_id === id)
                        ?? listingPins.find(p => p.listing_id === id);
                    if (picked) {
                        onSelectListing?.(picked);
                        setPopup(null);
                    }
                };
            });
            document.querySelectorAll<HTMLButtonElement>('.ph-listing-buy').forEach(btn => {
                btn.onclick = (e) => {
                    e.preventDefault();
                    const id = btn.getAttribute('data-listing-id');
                    const picked = listingPins.find(p => p.listing_id === id);
                    if (picked) {
                        onSelectListing?.(picked);
                        onBuyListing?.(picked);
                        setPopup(null);
                    }
                };
            });
        };
        const t = setTimeout(attach, 50);
        return () => clearTimeout(t);
    }, [popup, onSelectListing, onBuyListing, listingPins]);

    if (loadError) {
        return (
            <div
                data-testid="proxy-map-canvas"
                data-map-engine="google-error"
                style={{ ...CONTAINER_STYLE, display: 'grid', placeItems: 'center', background: '#050508', color: '#f87171', padding: 24, textAlign: 'center' }}
            >
                <div>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>Google Maps failed to load</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{String(loadError.message || loadError)}</div>
                </div>
            </div>
        );
    }

    if (!showMap) {
        return (
            <div
                data-testid="proxy-map-canvas"
                data-map-engine="google-loading"
                style={{ ...CONTAINER_STYLE, display: 'grid', placeItems: 'center', background: '#050508', color: 'rgba(255,255,255,0.4)' }}
            >
                Loading Google Maps…
            </div>
        );
    }

    return (
        <div
            data-testid="proxy-map-canvas"
            data-map-engine="google"
            data-map-view="2d"
            data-map-id={mapId ? 'cloud' : 'json-styles'}
            data-map-rendering="raster"
            className="google-map-container"
            style={{ position: 'relative', width: '100%', height: '100%', minHeight: 480, borderRadius: 'inherit' }}
        >
            {heatmapError && showHeatmap ? (
                <div
                    className="absolute top-3 left-1/2 z-[1000] -translate-x-1/2 rounded-xl border border-amber-500/40 bg-[#0a0a15]/90 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-amber-300 backdrop-blur-sm"
                    role="status"
                >
                    {heatmapError}
                </div>
            ) : null}

            <GoogleMap
                mapContainerStyle={CONTAINER_STYLE}
                options={mapOptions}
                onLoad={onLoad}
                onUnmount={onUnmount}
                onIdle={handleIdle}
                onClick={handleMapClick}
            >
                {nodeClusters.map(({ lat, lon, clusterNodes }) => {
                    const count = clusterNodes.length;
                    const isActive = clusterNodes.some(n => n.is_active);
                    const isValidator = clusterNodes.some(n => n.is_validator);
                    const isSelected = selectedNodeId
                        ? clusterNodes.some(n => n.node_id === selectedNodeId)
                        : false;
                    const color = nodeColor(isActive, isValidator, isSelected);
                    const size = isSelected
                        ? Math.min(26 + count * 2, 44)
                        : count > 1
                            ? Math.min(22 + count, 40)
                            : 20;
                    const html = markerHtml(color, size, count, isActive);
                    const key = count === 1
                        ? `node-${clusterNodes[0].node_id}`
                        : `cluster-${lat.toFixed(4)}-${lon.toFixed(4)}-${count}`;

                    return (
                        <HtmlMarker
                            key={key}
                            map={mapInstance}
                            useAdvanced={useAdvanced}
                            position={{ lat, lng: lon }}
                            html={html}
                            zIndex={isSelected ? 900 : 100}
                            onClick={() => {
                                const target = clusterNodes.find(n => n.is_active) ?? clusterNodes[0];
                                onSelectNode(target);
                                setPopup({
                                    kind: 'node',
                                    position: { lat, lng: lon },
                                    html: count === 1
                                        ? singleNodePopup(clusterNodes[0], color)
                                        : clusterPopup(clusterNodes, color),
                                });
                            }}
                        />
                    );
                })}

                {listingGroups.map(group => {
                    const pin = group[0];
                    const count = group.length;
                    const selected = count === 1
                        ? group[0].listing_id === selectedListingId
                        : group.some(p => p.listing_id === selectedListingId);
                    const minPrice = Math.min(...group.map(p => p.price_per_gb));
                    const html = listingMarkerHtml(minPrice, selected, !!pin.estimated, count);
                    const key = count === 1
                        ? `listing-${pin.listing_id}`
                        : `listing-group-${pin.lat.toFixed(4)}-${pin.lon.toFixed(4)}`;

                    return (
                        <HtmlMarker
                            key={key}
                            map={mapInstance}
                            useAdvanced={useAdvanced}
                            position={{ lat: pin.lat, lng: pin.lon }}
                            html={html}
                            zIndex={selected ? 850 : 80}
                            onClick={() => {
                                if (count === 1) {
                                    onSelectListing?.(pin);
                                    setPopup({
                                        kind: 'listing',
                                        position: { lat: pin.lat, lng: pin.lon },
                                        html: listingPopup(pin),
                                    });
                                } else if (onSelectListingGroup) {
                                    onSelectListingGroup(group);
                                } else {
                                    handleListingPopupOpen(group, listingClusterPopup(group));
                                }
                            }}
                        />
                    );
                })}

                {popup ? (
                    <InfoWindowF
                        position={popup.position}
                        onCloseClick={() => setPopup(null)}
                        options={{ pixelOffset: new google.maps.Size(0, -12), maxWidth: 320 }}
                    >
                        <div dangerouslySetInnerHTML={{ __html: popup.html }} />
                    </InfoWindowF>
                ) : null}
            </GoogleMap>
        </div>
    );
}
