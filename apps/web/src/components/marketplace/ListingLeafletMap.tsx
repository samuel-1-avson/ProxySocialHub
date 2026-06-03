'use client';

import { useEffect, useRef, useCallback } from 'react';
import 'leaflet/dist/leaflet.css';
import Supercluster from 'supercluster';
import type { Map as LeafletMapType, Marker, LatLngBounds } from 'leaflet';
import type { MarketplaceGeoPin } from '@/lib/api/marketplace';

export interface ListingMapPin extends MarketplaceGeoPin {
    lat: number;
    lon: number;
    estimated: boolean;
}

export interface MapBBox {
    west: number;
    south: number;
    east: number;
    north: number;
}

interface Props {
    pins: ListingMapPin[];
    onSelectPin: (pin: ListingMapPin) => void;
    selectedListingId?: string;
    focusBounds?: [[number, number], [number, number]] | null;
    onBoundsChange?: (bbox: MapBBox) => void;
}

function esc(s: string | number | undefined | null): string {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c),
    );
}

function markerHtml(
    price: number,
    count: number,
    selected: boolean,
    active: boolean,
    estimated: boolean,
): string {
    const color = selected ? '#f59e0b' : active ? '#10b981' : estimated ? '#d97706' : '#6366f1';
    const size = count > 1 ? 28 : 22;
    const border = estimated
        ? '2px dashed rgba(251,191,36,0.85)'
        : '2px solid rgba(255,255,255,0.3)';
    const label =
        count > 1
            ? `<span style="font-size:9px;font-weight:900;color:#fff;">${count}</span>`
            : `<span style="font-size:7px;font-weight:900;color:#fff;">${price.toFixed(4)}</span>`;
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border};box-shadow:0 0 12px ${color}88;display:flex;align-items:center;justify-content:center;cursor:pointer;">${label}</div>`;
}

function popupHtml(pin: ListingMapPin): string {
    const loc = [pin.city, pin.country].filter(Boolean).map(esc).join(', ') || '—';
    const locBadge = pin.estimated
        ? '<span style="color:#fbbf24;font-size:7px;font-weight:900;text-transform:uppercase;">Est. location</span>'
        : '<span style="color:#6ee7b7;font-size:7px;font-weight:900;text-transform:uppercase;">GPS</span>';
    return `<div style="background:#0a0a15;border:1px solid rgba(16,185,129,.35);border-radius:12px;padding:12px;min-width:220px;font-family:monospace;color:#fff;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:8px;font-weight:900;color:#10b981;text-transform:uppercase;letter-spacing:.2em;">Purchasable</div>
        ${locBadge}</div>
        <div style="font-size:11px;font-weight:700;margin-bottom:8px;">${esc(pin.title)}</div>
        <div style="font-size:9px;color:rgba(255,255,255,.5);margin-bottom:8px;">${loc} · ${esc(pin.proxy_type)}</div>
        <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:4px;"><span style="color:rgba(255,255,255,.4)">Price</span><span style="color:#fff;font-weight:700;">${pin.price_per_gb.toFixed(6)} SOL/GB</span></div>
        <div style="display:flex;justify-content:space-between;font-size:9px;"><span style="color:rgba(255,255,255,.4)">Uptime</span><span style="color:#fff;">${(pin.uptime_percent || 0).toFixed(1)}%</span></div>
    </div>`;
}

export default function ListingLeafletMap({ pins, onSelectPin, selectedListingId, focusBounds, onBoundsChange }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<LeafletMapType | null>(null);
    const markersRef = useRef<Marker[]>([]);
    const scRef = useRef<Supercluster | null>(null);
    const onSelectRef = useRef(onSelectPin);
    onSelectRef.current = onSelectPin;
    const onBoundsRef = useRef(onBoundsChange);
    onBoundsRef.current = onBoundsChange;

    const rebuildMarkers = useCallback(() => {
        const map = mapRef.current;
        if (!map) return;

        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        const plotted = pins.filter(p => Math.abs(p.lat) > 0.01 || Math.abs(p.lon) > 0.01);
        if (plotted.length === 0) return;

        const sc = new Supercluster({ radius: 55, maxZoom: 14, minZoom: 0 });
        sc.load(
            plotted.map(p => ({
                type: 'Feature' as const,
                properties: p,
                geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
            })),
        );
        scRef.current = sc;

        const b = map.getBounds();
        const bbox: [number, number, number, number] = [
            b.getWest(),
            b.getSouth(),
            b.getEast(),
            b.getNorth(),
        ];
        const zoom = map.getZoom();
        const clusters = sc.getClusters(bbox, zoom);

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const L = require('leaflet');

        clusters.forEach(feature => {
            const [lon, lat] = feature.geometry.coordinates;
            const props = feature.properties as ListingMapPin | { cluster: boolean; cluster_id: number };
            let clusterPins: ListingMapPin[];
            if ('cluster' in props && props.cluster) {
                const leaves = sc.getLeaves((props as { cluster_id: number }).cluster_id, Infinity);
                clusterPins = leaves.map(l => l.properties as ListingMapPin);
            } else {
                clusterPins = [props as ListingMapPin];
            }

            const count = clusterPins.length;
            const pin = clusterPins[0];
            const selected = clusterPins.some(p => p.listing_id === selectedListingId);
            const active = clusterPins.some(p => p.node_active);
            const estimated = clusterPins.some(p => p.estimated);
            const icon = L.divIcon({
                className: '',
                html: markerHtml(pin.price_per_gb, count, selected, active, estimated),
                iconSize: [count > 1 ? 28 : 22, count > 1 ? 28 : 22],
                iconAnchor: [14, 14],
            });

            const marker = L.marker([lat, lon], { icon });
            marker.bindPopup(popupHtml(pin), { className: 'leaflet-custom-popup', maxWidth: 280 });
            marker.on('click', () => onSelectRef.current(pin));
            marker.addTo(map);
            markersRef.current.push(marker);
        });
    }, [pins, selectedListingId]);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;
        let cancelled = false;

        (async () => {
            const L = (await import('leaflet')).default;
            if (cancelled || !containerRef.current) return;

            const map = L.map(containerRef.current, {
                center: [20, 0],
                zoom: 2,
                zoomControl: true,
                attributionControl: false,
            });

            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                maxZoom: 19,
            }).addTo(map);

            mapRef.current = map;
            const emitBounds = () => {
                const b = map.getBounds();
                onBoundsRef.current?.({
                    west: b.getWest(),
                    south: b.getSouth(),
                    east: b.getEast(),
                    north: b.getNorth(),
                });
            };
            map.on('moveend zoomend', () => {
                rebuildMarkers();
                emitBounds();
            });
            rebuildMarkers();
            emitBounds();
        })();

        return () => {
            cancelled = true;
            mapRef.current?.remove();
            mapRef.current = null;
        };
    }, [rebuildMarkers]);

    useEffect(() => {
        rebuildMarkers();
    }, [rebuildMarkers]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !focusBounds) return;
        const L = require('leaflet') as typeof import('leaflet');
        map.fitBounds(L.latLngBounds(focusBounds), { padding: [40, 40], maxZoom: 8 });
    }, [focusBounds]);

    return <div ref={containerRef} className="w-full h-full min-h-[480px] rounded-[2rem] overflow-hidden" />;
}
