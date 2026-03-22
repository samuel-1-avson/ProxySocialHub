'use client';

/**
 * LeafletMap — Map Engine for the ProxyHubb Node Explorer
 *
 * Architecture:
 *  - react-leaflet MapContainer with CARTO dark tiles
 *  - supercluster for zoom-adaptive, radius-based clustering
 *  - Native canvas heatmap layer (no extra dependency)
 *  - Markers are DivIcon HTML — no DOM library dependencies
 *  - Popups are HTML string templates (safe — all values are escaped)
 *  - Zoom / pan triggers re-cluster without re-fetching data
 *  - Real-time node_update WS events update marker colours in place
 */

import { useEffect, useRef, useCallback } from 'react';
import 'leaflet/dist/leaflet.css';
import Supercluster from 'supercluster';
import type { Map as LeafletMap, Marker, LatLngBounds } from 'leaflet';
import type { NodeGeoPoint } from '@/lib/services/explorer';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MapNodeUpdate {
    node_id: string;
    is_active: boolean;
    uptime_percent: number;
    active_sessions: number;
    lat?: number;
    lon?: number;
}

interface Props {
    nodes: NodeGeoPoint[];
    onSelectNode: (node: NodeGeoPoint) => void;
    selectedNodeId?: string;
    showHeatmap?: boolean;
    focusBounds?: [[number, number], [number, number]] | null;
    liveUpdates?: MapNodeUpdate[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Escape a string for safe use inside an HTML attribute or text node */
function esc(s: string | number | undefined | null): string {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c)
    );
}

type NodeColor = '#10b981' | '#a855f7' | '#ef4444' | '#f59e0b';

function nodeColor(isActive: boolean, isValidator: boolean, isSelected: boolean): NodeColor {
    if (isSelected) return '#f59e0b';
    if (isValidator) return '#a855f7';
    if (isActive) return '#10b981';
    return '#ef4444';
}

function markerHtml(color: NodeColor, size: number, count: number, isActive: boolean): string {
    const ringColor = isActive ? color : 'rgba(255,255,255,0.1)';
    const innerColor = isActive ? color : 'rgba(255,255,255,0.2)';
    const glowColor = color;
    
    const pulse = isActive
        ? `<div style="position:absolute;inset:-8px;border-radius:50%;border:2px solid ${color}88;animation:nodePulse 3s ease-out infinite;filter:blur(1px);"></div>
           <div style="position:absolute;inset:-12px;border-radius:50%;border:1px solid ${color}44;animation:nodePulse 3s ease-out infinite 1s;filter:blur(2px);"></div>`
        : '';

    const label = count > 1 ? `<span style="font-size:${size > 22 ? 11 : 9}px;font-weight:900;color:#fff;text-shadow:0 0 4px rgba(0,0,0,0.8);">${count}</span>` : '';
    
    return `<div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">
        ${pulse}
        <div style="width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 30% 30%, ${innerColor}, rgba(0,0,0,0.8));border:2px solid ${ringColor};box-shadow:0 0 ${isActive ? 20 : 5}px ${glowColor}aa, inset 0 0 10px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1);">
            ${label}
        </div>
        ${isActive ? `<div style="position:absolute;bottom:-4px;width:12px;height:2px;background:${color};filter:blur(1px);border-radius:50%;opacity:0.6;"></div>` : ''}
    </div>`;
}

function singleNodePopup(node: NodeGeoPoint, color: NodeColor): string {
    const location = [node.city, node.country || node.region].filter(Boolean).map(esc).join(', ') || '—';
    const coords = (Math.abs(node.lat) > 0.01 || Math.abs(node.lon) > 0.01)
        ? `${node.lat.toFixed(3)}, ${node.lon.toFixed(3)}` : '';
    const typeLabel = node.is_validator ? '⬡ Validator' : '◎ Proxy Node';
    const statusColor = node.is_active ? '#10b981' : '#ef4444';
    const statusText = node.is_active ? '● Active' : '○ Offline';

    return `<div style="background:#0a0a15;border:1px solid rgba(99,102,241,.3);border-radius:12px;padding:12px;min-width:220px;font-family:monospace;color:#fff;box-shadow:0 8px 32px rgba(0,0,0,.5);">
        <div style="font-size:8px;font-weight:900;color:${color};text-transform:uppercase;letter-spacing:.2em;margin-bottom:6px;">${typeLabel}</div>
        <div style="font-size:10px;color:#6366f1;word-break:break-all;margin-bottom:8px;font-weight:700;">${esc(node.node_id.slice(0, 26))}…</div>
        <div style="display:grid;gap:4px;background:rgba(255,255,255,.02);padding:8px;border-radius:8px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;font-size:9px;"><span style="color:rgba(255,255,255,.4)">Status</span><span style="color:${statusColor};font-weight:700;">${statusText}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:9px;"><span style="color:rgba(255,255,255,.4)">Location</span><span style="color:#fff;font-weight:600;max-width:130px;text-align:right;">${location}</span></div>
            ${node.isp ? `<div style="display:flex;justify-content:space-between;font-size:9px;gap:8px;"><span style="color:rgba(255,255,255,.4)">ISP</span><span style="color:#94a3b8;max-width:130px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(node.isp)}</span></div>` : ''}
            ${coords ? `<div style="display:flex;justify-content:space-between;font-size:9px;"><span style="color:rgba(255,255,255,.4)">Coords</span><span style="color:#94a3b8;">${coords}</span></div>` : ''}
            <div style="display:flex;justify-content:space-between;font-size:9px;"><span style="color:rgba(255,255,255,.4)">Uptime</span><span style="color:#fff;font-weight:600;">${(node.uptime_percent || 0).toFixed(1)}%</span></div>
            ${node.active_sessions ? `<div style="display:flex;justify-content:space-between;font-size:9px;"><span style="color:rgba(255,255,255,.4)">Sessions</span><span style="color:#fff;font-weight:600;">${node.active_sessions}</span></div>` : ''}
        </div>
        <a href="/explorer/nodes/${esc(node.node_id)}" style="display:block;text-align:center;padding:6px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:8px;color:#6366f1;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.15em;text-decoration:none;">View Details →</a>
    </div>`;
}

function clusterPopup(nodes: NodeGeoPoint[], color: NodeColor): string {
    const location = [nodes[0].city, nodes[0].country || nodes[0].region].filter(Boolean).map(esc).join(', ') || '—';
    const rows = nodes.map(n => {
        const sc = n.is_active ? '#10b981' : '#ef4444';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);gap:6px;">
            <div style="flex:1;min-width:0;">
                <div style="font-size:9px;color:#6366f1;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(n.node_id.slice(0, 18))}…</div>
                <div style="font-size:8px;color:rgba(255,255,255,.4);">${(n.uptime_percent || 0).toFixed(1)}% up · ${n.active_sessions} sess</div>
            </div>
            <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                <span style="font-size:8px;color:${sc};font-weight:700;">${n.is_active ? '●' : '○'}</span>
                <a href="/explorer/nodes/${esc(n.node_id)}" style="font-size:7px;color:#6366f1;text-decoration:none;">details</a>
            </div>
        </div>`;
    }).join('');

    return `<div style="background:#0a0a15;border:1px solid rgba(99,102,241,.3);border-radius:12px;padding:12px;min-width:240px;max-width:270px;font-family:monospace;color:#fff;box-shadow:0 8px 32px rgba(0,0,0,.5);">
        <div style="font-size:8px;font-weight:900;color:${color};text-transform:uppercase;letter-spacing:.2em;margin-bottom:6px;">${nodes.length} Nodes</div>
        <div style="font-size:9px;color:rgba(255,255,255,.4);margin-bottom:8px;">📍 ${location}</div>
        <div style="max-height:220px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(99,102,241,.3) transparent;">${rows}</div>
    </div>`;
}

// ─── Map CSS (injected once) ──────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function LeafletMapComponent({
    nodes,
    onSelectNode,
    selectedNodeId,
    showHeatmap = false,
    focusBounds,
    liveUpdates = [],
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<LeafletMap | null>(null);
    const markersRef = useRef<Marker[]>([]);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const scRef = useRef<Supercluster | null>(null);

    // Keep a mutable node map so live WS updates can be merged without
    // triggering a full re-render of the map.
    const nodeMapRef = useRef<Map<string, NodeGeoPoint>>(new Map());

    // ── Initialise Leaflet map once ──
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        import('leaflet').then(L => {
            delete (L.Icon.Default.prototype as any)._getIconUrl;
            L.Icon.Default.mergeOptions({ iconRetinaUrl: '', iconUrl: '', shadowUrl: '' });

            const map = L.map(containerRef.current!, {
                center: [20, 10],
                zoom: 2,
                minZoom: 1,
                maxZoom: 18,
                zoomControl: true,
                attributionControl: true,
                scrollWheelZoom: true,
                preferCanvas: true,
            });

            L.tileLayer(
                'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
                {
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
                    subdomains: 'abcd',
                    maxZoom: 20,
                }
            ).addTo(map);

            mapRef.current = map;

            // Inject CSS once
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
            mapRef.current?.remove();
            mapRef.current = null;
        };
    }, []);

    // ── Rebuild supercluster + markers whenever node list or selection changes ──
    const renderMarkers = useCallback(async (currentNodes: NodeGeoPoint[], selId?: string) => {
        const map = mapRef.current;
        if (!map) return;

        const L = (await import('leaflet')).default;

        // Clear existing markers
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        if (currentNodes.length === 0) return;

        // Build supercluster with zoom-adaptive radius
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
            bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()
        ];

        const clusters = sc.getClusters(bbox, zoom);

        clusters.forEach(feature => {
            const [lon, lat] = feature.geometry.coordinates;
            const props = feature.properties as any;

            let clusterNodes: NodeGeoPoint[];
            let isCluster = false;

            if (props.cluster) {
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

    // Re-render markers on zoom/pan so clusters update to the new zoom level
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const refresh = () => {
            const allNodes = Array.from(nodeMapRef.current.values());
            renderMarkers(allNodes, selectedNodeId);
            if (showHeatmap) drawHeatmap(allNodes);
        };

        map.on('zoomend moveend', refresh);
        return () => { map.off('zoomend moveend', refresh); };
    }, [selectedNodeId, showHeatmap, renderMarkers]);

    // ── Sync node map ref + render when `nodes` prop changes ──
    useEffect(() => {
        nodeMapRef.current = new Map(nodes.map(n => [n.node_id, n]));
        renderMarkers(nodes, selectedNodeId);
    }, [nodes, selectedNodeId, renderMarkers]);

    // ── Apply live WS updates to the node map without a full re-render ──
    useEffect(() => {
        if (liveUpdates.length === 0) return;

        let changed = false;
        for (const upd of liveUpdates) {
            const existing = nodeMapRef.current.get(upd.node_id);
            if (existing) {
                nodeMapRef.current.set(upd.node_id, {
                    ...existing,
                    is_active: upd.is_active,
                    uptime_percent: upd.uptime_percent,
                    active_sessions: upd.active_sessions,
                    lat: upd.lat ?? existing.lat,
                    lon: upd.lon ?? existing.lon,
                });
                changed = true;
            } else if (upd.lat && upd.lon && Math.abs(upd.lat) > 0.001) {
                // Brand-new node arrived via WS
                nodeMapRef.current.set(upd.node_id, {
                    node_id: upd.node_id,
                    lat: upd.lat,
                    lon: upd.lon,
                    is_active: upd.is_active,
                    is_validator: false,
                    uptime_percent: upd.uptime_percent,
                    active_sessions: upd.active_sessions,
                    country: '', region: '',
                });
                changed = true;
            }
        }

        if (changed) {
            const allNodes = Array.from(nodeMapRef.current.values());
            renderMarkers(allNodes, selectedNodeId);
            if (showHeatmap) drawHeatmap(allNodes);
        }
    }, [liveUpdates, selectedNodeId, showHeatmap, renderMarkers]);

    // ── Auto-zoom to focusBounds ──
    useEffect(() => {
        if (!mapRef.current || !focusBounds) return;
        const timer = setTimeout(() => {
            mapRef.current?.fitBounds(focusBounds, { padding: [60, 60], maxZoom: 6, animate: true });
        }, 80);
        return () => clearTimeout(timer);
    }, [focusBounds]);

    // ── Reset to world view when region filter cleared ──
    useEffect(() => {
        if (!mapRef.current || focusBounds !== null) return;
        mapRef.current.setView([20, 10], 2, { animate: true });
    }, [focusBounds]);

    // ── Fly to selected node ──
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !selectedNodeId) return;

        const node = nodeMapRef.current.get(selectedNodeId);
        if (node && (Math.abs(node.lat) > 0.001 || Math.abs(node.lon) > 0.001)) {
            map.flyTo([node.lat, node.lon], 12, { animate: true, duration: 1.5 });
            // Close any existing popups to prevent UI clutter on fly-to
            map.closePopup();
        }
    }, [selectedNodeId]);

    // ── Heatmap canvas (drawn natively, no extra library) ──
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
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 'inherit' }}>
            <div ref={containerRef} style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} />
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
