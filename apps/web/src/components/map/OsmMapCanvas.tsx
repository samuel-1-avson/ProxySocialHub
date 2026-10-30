'use client';

/**
 * OpenStreetMap basemap when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is unset.
 * Same pin/listing interaction contract as the Google Maps canvas.
 */

import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ExplorerListingPin, ProxyMapCanvasProps } from './types';

function circleIcon(color: string, selected: boolean): L.DivIcon {
    const size = selected ? 18 : 14;
    return L.divIcon({
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:999px;background:${color};border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);"></span>`,
    });
}

function nodeColor(isActive: boolean, isValidator: boolean, isSelected: boolean): string {
    if (isSelected) return '#f59e0b';
    if (isValidator) return '#a855f7';
    if (isActive) return '#10b981';
    return '#ef4444';
}

export default function OsmMapCanvas({
    nodes,
    onSelectNode,
    selectedNodeId,
    focusBounds,
    listingPins = [],
    onSelectListing,
    onSelectListingGroup,
    selectedListingId,
    onBoundsChange,
}: ProxyMapCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const nodesLayerRef = useRef<L.LayerGroup | null>(null);
    const listingsLayerRef = useRef<L.LayerGroup | null>(null);

    const emitBounds = useCallback(() => {
        const map = mapRef.current;
        if (!map || !onBoundsChange) return;
        const b = map.getBounds();
        onBoundsChange({
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth(),
        });
    }, [onBoundsChange]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || mapRef.current) return;

        const map = L.map(el, {
            center: [20, 10],
            zoom: 2,
            minZoom: 1,
            maxZoom: 18,
            worldCopyJump: true,
            attributionControl: true,
        });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
            keepBuffer: 0,
        }).addTo(map);

        nodesLayerRef.current = L.layerGroup().addTo(map);
        listingsLayerRef.current = L.layerGroup().addTo(map);
        map.on('moveend', emitBounds);
        mapRef.current = map;
        emitBounds();

        return () => {
            map.off('moveend', emitBounds);
            map.remove();
            mapRef.current = null;
            nodesLayerRef.current = null;
            listingsLayerRef.current = null;
        };
    }, [emitBounds]);

    useEffect(() => {
        const map = mapRef.current;
        const layer = nodesLayerRef.current;
        if (!map || !layer) return;
        layer.clearLayers();

        for (const node of nodes) {
            if (Math.abs(node.lat) < 0.001 && Math.abs(node.lon) < 0.001) continue;
            const selected = selectedNodeId === node.node_id;
            const color = nodeColor(node.is_active, !!node.is_validator, selected);
            const marker = L.marker([node.lat, node.lon], {
                icon: circleIcon(color, selected),
                zIndexOffset: selected ? 1000 : node.is_active ? 100 : 10,
                title: node.node_id,
            });
            marker.on('click', () => onSelectNode(node));
            marker.addTo(layer);
        }
    }, [nodes, onSelectNode, selectedNodeId]);

    useEffect(() => {
        const layer = listingsLayerRef.current;
        if (!layer) return;
        layer.clearLayers();

        const groups = new Map<string, ExplorerListingPin[]>();
        for (const pin of listingPins) {
            if (Math.abs(pin.lat) < 0.001 && Math.abs(pin.lon) < 0.001) continue;
            const key = pin.node_id?.trim()
                ? `node:${pin.node_id.trim()}`
                : `coord:${pin.lat.toFixed(4)},${pin.lon.toFixed(4)}`;
            const bucket = groups.get(key) ?? [];
            bucket.push(pin);
            groups.set(key, bucket);
        }

        for (const group of groups.values()) {
            const pin = group[0];
            const selected = group.some((p) => p.listing_id === selectedListingId);
            const marker = L.marker([pin.lat, pin.lon], {
                icon: circleIcon(selected ? '#34d399' : '#059669', selected),
                zIndexOffset: selected ? 900 : 50,
                title: pin.title,
            });
            marker.on('click', () => {
                if (group.length > 1 && onSelectListingGroup) onSelectListingGroup(group);
                else onSelectListing?.(pin);
            });
            marker.addTo(layer);
        }
    }, [listingPins, onSelectListing, onSelectListingGroup, selectedListingId]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !focusBounds) return;
        const [[lat1, lng1], [lat2, lng2]] = focusBounds;
        map.fitBounds(
            [
                [lat1, lng1],
                [lat2, lng2],
            ],
            { padding: [40, 40], maxZoom: 8 },
        );
    }, [focusBounds]);

    return (
        <div className="relative w-full h-full min-h-[320px]">
            <div ref={containerRef} className="w-full h-full" data-testid="osm-map-canvas" />
            <div className="pointer-events-none absolute left-3 bottom-3 z-[500] rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground">
                OSM fallback · set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY for Google Maps
            </div>
        </div>
    );
}
