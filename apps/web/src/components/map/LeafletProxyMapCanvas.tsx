'use client';

/**
 * Leaflet fallback map engine (CARTO tiles) used when
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is unset.
 */

import { useEffect, useRef, useCallback } from 'react';
import 'leaflet/dist/leaflet.css';
import Supercluster from 'supercluster';
import type { Map as LeafletMap, Marker } from 'leaflet';
import type { NodeGeoPoint } from '@/lib/services/explorer';
import type { ProxyMapCanvasProps } from './types';
import {
    clusterPopup,
    groupListingPins,
    listingClusterPopup,
    listingMarkerHtml,
    listingPopup,
    markerHtml,
    nodeColor,
    singleNodePopup,
} from './mapHelpers';

export type { ExplorerListingPin, MapNodeUpdate, MapViewportBounds, ProxyMapCanvasProps } from './types';

const MAP_CSS = `
.leaflet-container { background: #050508; font-family: monospace; }
.leaflet-control-attribution { background: rgba(0,0,0,.6)!important; color: rgba(255,255,255,.2)!important; font-size: 8px!important; border-top-left-radius: 8px!important; }
.leaflet-control-attribution a { color: rgba(99,102,241,.6)!important; }
.leaflet-control-zoom { border: none!important; margin-left: 24px!important; margin-top: 24px!important; }
.leaflet-control-zoom a { background: rgba(10,10,15,0.8)!important; color: rgba(255,255,255,0.6)!important; border: 1px solid rgba(255,255,255,0.05)!important; border-radius: 8px!important; margin-bottom: 4px!important; backdrop-filter: blur(8px); }
.leaflet-control-zoom a:hover { background: rgba(99,102,241,0.2)!important; color: #6366f1!important; border-color: rgba(99,102,241,0.4)!important; }
.leaflet-custom-popup .leaflet-popup-content-wrapper { background: transparent; border: none; box-shadow: none; padding: 0; }
.leaflet-custom-popup .leaflet-popup-content { margin: 0; }
.leaflet-custom-popup .leaflet-popup-tip-container { display: none; }
.leaflet-marker-icon { transition: transform .3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
@keyframes nodePulse { 0% { transform: scale(0.6); opacity: 0.8; } 100% { transform: scale(2.2); opacity: 0; } }
`;

export default function LeafletProxyMapCanvas({
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
}: ProxyMapCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<LeafletMap | null>(null);
    const mapInitRef = useRef(false);
    const markersRef = useRef<Marker[]>([]);
    const listingMarkersRef = useRef<Marker[]>([]);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const scRef = useRef<Supercluster | null>(null);
    const nodeMapRef = useRef<Map<string, NodeGeoPoint>>(new Map());

    useEffect(() => {
        const container = containerRef.current;
        if (!container || mapRef.current) return;

        let cancelled = false;

        void import('leaflet').then((L) => {
            if (cancelled || !containerRef.current) return;
            if (mapRef.current || mapInitRef.current) return;

            const el = containerRef.current;
            if ((el as HTMLElement & { _leaflet_id?: number })._leaflet_id != null) {
                return;
            }

            mapInitRef.current = true;

            delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
            L.Icon.Default.mergeOptions({ iconRetinaUrl: '', iconUrl: '', shadowUrl: '' });

            const map = L.map(el, {
                center: [20, 10],
                zoom: 2,
                minZoom: 1,
                maxZoom: 18,
                zoomControl: true,
                attributionControl: true,
                scrollWheelZoom: true,
                preferCanvas: true,
            });

            if (cancelled) {
                map.remove();
                mapInitRef.current = false;
                return;
            }

            L.tileLayer(
                'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
                {
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
                    subdomains: 'abcd',
                    maxZoom: 20,
                },
            ).addTo(map);

            mapRef.current = map;
            const emitBounds = () => {
                const b = map.getBounds();
                onBoundsChange?.({
                    west: b.getWest(),
                    south: b.getSouth(),
                    east: b.getEast(),
                    north: b.getNorth(),
                });
            };
            map.on('moveend zoomend', emitBounds);
            emitBounds();

            if (!document.getElementById('leaflet-map-engine-css')) {
                const style = document.createElement('style');
                style.id = 'leaflet-map-engine-css';
                style.textContent = MAP_CSS;
                document.head.appendChild(style);
            }

            setTimeout(() => map.invalidateSize(), 100);
            setTimeout(() => map.invalidateSize(), 500);
        });

        return () => {
            cancelled = true;
            mapInitRef.current = false;
            mapRef.current?.remove();
            mapRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- map must init once per mount
    }, []);

    const renderMarkers = useCallback(async (currentNodes: NodeGeoPoint[], selId?: string) => {
        const map = mapRef.current;
        if (!map) return;

        const L = (await import('leaflet')).default;

        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        if (currentNodes.length === 0) return;

        const sc = new Supercluster({ radius: 60, maxZoom: 16, minZoom: 0 });
        const features: GeoJSON.Feature<GeoJSON.Point, NodeGeoPoint>[] = currentNodes
            .filter(n => Math.abs(n.lat) > 0.001 || Math.abs(n.lon) > 0.001)
            .map(n => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
                properties: n,
            }));

        sc.load(features);
        scRef.current = sc;

        const zoom = map.getZoom();
        const bounds = map.getBounds();
        const bbox: [number, number, number, number] = [
            bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
        ];

        const clusters = sc.getClusters(bbox, zoom);

        clusters.forEach(feature => {
            const [lon, lat] = feature.geometry.coordinates;
            const props = feature.properties as NodeGeoPoint & { cluster?: boolean; cluster_id?: number };

            let clusterNodes: NodeGeoPoint[];
            let isCluster = false;

            if (props.cluster && props.cluster_id != null) {
                isCluster = true;
                const leaves = sc.getLeaves(props.cluster_id, Infinity);
                clusterNodes = leaves.map(l => l.properties as NodeGeoPoint);
            } else {
                clusterNodes = [props as NodeGeoPoint];
            }

            const count = clusterNodes.length;
            const isActive = clusterNodes.some(n => n.is_active);
            const isValidator = clusterNodes.some(n => n.is_validator);
            const isSelected = selId ? clusterNodes.some(n => n.node_id === selId) : false;
            const color = nodeColor(isActive, isValidator, isSelected);
            const size = isSelected
                ? Math.min(26 + count * 2, 44)
                : isCluster
                    ? Math.min(22 + count, 40)
                    : 20;

            const icon = L.divIcon({
                html: markerHtml(color, size, count, isActive),
                className: '',
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2],
            });

            const marker = L.marker([lat, lon], { icon });

            const popupHtml = count === 1
                ? singleNodePopup(clusterNodes[0], color)
                : clusterPopup(clusterNodes, color);

            marker.bindPopup(popupHtml, { className: 'leaflet-custom-popup', maxWidth: 280 });

            marker.on('click', () => {
                const target = clusterNodes.find(n => n.is_active) ?? clusterNodes[0];
                onSelectNode(target);
            });

            marker.addTo(map);
            markersRef.current.push(marker);
        });
    }, [onSelectNode]);

    const renderListingMarkers = useCallback(async () => {
        const map = mapRef.current;
        if (!map) return;
        const L = (await import('leaflet')).default;

        listingMarkersRef.current.forEach(m => m.remove());
        listingMarkersRef.current = [];

        if (!listingPins.length) return;

        const groups = groupListingPins(
            listingPins.filter(p => Math.abs(p.lat) > 0.01 || Math.abs(p.lon) > 0.01),
        );

        for (const group of groups) {
            const pin = group[0];
            const count = group.length;
            const selected = count === 1
                ? group[0].listing_id === selectedListingId
                : group.some(p => p.listing_id === selectedListingId);
            const minPrice = Math.min(...group.map(p => p.price_per_gb));
            const size = count > 1 ? 30 : 24;
            const icon = L.divIcon({
                html: listingMarkerHtml(minPrice, selected, !!pin.estimated, count),
                className: '',
                iconSize: [size, size + (count > 1 ? 10 : 0)],
                iconAnchor: [size / 2, size / 2],
            });
            const marker = L.marker([pin.lat, pin.lon], { icon, zIndexOffset: 500 });

            const popupHtml = count === 1
                ? listingPopup(pin, { buyAction: Boolean(onBuyListing) })
                : listingClusterPopup(group);
            const popup = L.popup({ className: 'leaflet-custom-popup', maxWidth: 280 }).setContent(popupHtml);
            marker.bindPopup(popup);

            marker.on('popupopen', () => {
                const el = popup.getElement();
                if (!el) return;
                el.querySelectorAll<HTMLButtonElement>('.ph-listing-cluster-row').forEach(btn => {
                    btn.onclick = (e) => {
                        e.preventDefault();
                        const id = btn.getAttribute('data-listing-id');
                        const picked = group.find(p => p.listing_id === id);
                        if (picked) {
                            onSelectListing?.(picked);
                            map.closePopup();
                        }
                    };
                });
                el.querySelectorAll<HTMLButtonElement>('.ph-listing-buy').forEach(btn => {
                    btn.onclick = (e) => {
                        e.preventDefault();
                        const id = btn.getAttribute('data-listing-id');
                        const picked = group.find(p => p.listing_id === id)
                            ?? listingPins.find(p => p.listing_id === id);
                        if (picked) {
                            onSelectListing?.(picked);
                            onBuyListing?.(picked);
                            map.closePopup();
                        }
                    };
                });
            });

            marker.on('click', () => {
                if (count === 1) {
                    onSelectListing?.(pin);
                    return;
                }
                onSelectListingGroup?.(group);
            });

            marker.addTo(map);
            listingMarkersRef.current.push(marker);
        }
    }, [listingPins, onSelectListing, onSelectListingGroup, onBuyListing, selectedListingId]);

    const drawHeatmap = useCallback((currentNodes: NodeGeoPoint[]) => {
        const map = mapRef.current;
        const canvas = canvasRef.current;
        if (!map || !canvas) return;

        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const node of currentNodes) {
            if (Math.abs(node.lat) < 0.001 && Math.abs(node.lon) < 0.001) continue;
            const point = map.latLngToContainerPoint([node.lat, node.lon]);
            const weight = node.is_active ? 1 + node.active_sessions * 0.3 : 0.3;
            const radius = Math.min(20 + weight * 12, 70);
            const alpha = Math.min(0.25 + weight * 0.04, 0.55);

            const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
            gradient.addColorStop(0, `rgba(99,102,241,${alpha})`);
            gradient.addColorStop(0.4, `rgba(139,92,246,${alpha * 0.6})`);
            gradient.addColorStop(1, 'rgba(99,102,241,0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const refresh = () => {
            const allNodes = Array.from(nodeMapRef.current.values());
            void renderMarkers(allNodes, selectedNodeId);
            void renderListingMarkers();
            if (showHeatmap) drawHeatmap(allNodes);
            if (onBoundsChange) {
                const b = map.getBounds();
                onBoundsChange({
                    west: b.getWest(),
                    south: b.getSouth(),
                    east: b.getEast(),
                    north: b.getNorth(),
                });
            }
        };

        map.on('zoomend moveend', refresh);
        return () => { map.off('zoomend moveend', refresh); };
    }, [selectedNodeId, showHeatmap, renderMarkers, renderListingMarkers, drawHeatmap, onBoundsChange]);

    useEffect(() => {
        nodeMapRef.current = new Map(nodes.map(n => [n.node_id, n]));
        void renderMarkers(nodes, selectedNodeId);
        void renderListingMarkers();
    }, [nodes, selectedNodeId, renderMarkers, renderListingMarkers]);

    useEffect(() => {
        void renderListingMarkers();
    }, [listingPins, selectedListingId, renderListingMarkers]);

    useEffect(() => {
        if (liveUpdates.length === 0) return;

        let changed = false;
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
                nodeMapRef.current.set(key, {
                    ...existing,
                    is_active: upd.is_active,
                    uptime_percent: upd.uptime_percent,
                    active_sessions: upd.active_sessions,
                    lat: upd.lat ?? existing.lat,
                    lon: upd.lon ?? existing.lon,
                });
                changed = true;
            }
            // Skip unknown WS ids — avoids ghost UUID pins beside opaque marketplace markers.
        }

        if (changed) {
            const allNodes = Array.from(nodeMapRef.current.values());
            void renderMarkers(allNodes, selectedNodeId);
            if (showHeatmap) drawHeatmap(allNodes);
        }
    }, [liveUpdates, selectedNodeId, showHeatmap, renderMarkers, drawHeatmap]);

    // Fit only when focus *values* change — refetch recreates the same bbox array.
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
                map.setView([20, 10], 2, { animate: true });
            }
            return;
        }

        if (prevKey === focusBoundsKey) return;

        const timer = setTimeout(() => {
            map.fitBounds(focusBounds, { padding: [60, 60], maxZoom: 6, animate: true });
        }, 80);
        return () => clearTimeout(timer);
    }, [focusBounds, focusBoundsKey]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !selectedNodeId) return;

        const node = nodeMapRef.current.get(selectedNodeId);
        if (node && (Math.abs(node.lat) > 0.001 || Math.abs(node.lon) > 0.001)) {
            map.panTo([node.lat, node.lon]);
            map.closePopup();
        }
    }, [selectedNodeId]);

    useEffect(() => {
        if (showHeatmap) {
            drawHeatmap(Array.from(nodeMapRef.current.values()));
        } else {
            const canvas = canvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx?.clearRect(0, 0, canvas.width, canvas.height);
            }
        }
    }, [showHeatmap, drawHeatmap]);

    return (
        <div
            data-testid="proxy-map-canvas"
            data-map-engine="leaflet"
            className="leaflet-map-root"
            style={{ position: 'relative', width: '100%', height: '100%', minHeight: 480, borderRadius: 'inherit' }}
        >
            <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 480, borderRadius: 'inherit' }} />
            <canvas
                ref={canvasRef}
                style={{
                    position: 'absolute', top: 0, left: 0,
                    width: '100%', height: '100%',
                    pointerEvents: 'none', zIndex: 500,
                    opacity: showHeatmap ? 1 : 0,
                    transition: 'opacity .3s ease',
                }}
            />
        </div>
    );
}
