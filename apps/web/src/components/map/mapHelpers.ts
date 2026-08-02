import type { NodeGeoPoint } from '@/lib/services/explorer';
import type { ExplorerListingPin } from './types';

/** Escape a string for safe use inside an HTML attribute or text node */
export function esc(s: string | number | undefined | null): string {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c)
    );
}

export type NodeColor = '#10b981' | '#a855f7' | '#ef4444' | '#f59e0b';

export function nodeColor(isActive: boolean, isValidator: boolean, isSelected: boolean): NodeColor {
    if (isSelected) return '#f59e0b';
    if (isValidator) return '#a855f7';
    if (isActive) return '#10b981';
    return '#ef4444';
}

export function markerHtml(color: NodeColor, size: number, count: number, isActive: boolean): string {
    const ringColor = isActive ? color : 'rgba(255,255,255,0.1)';
    const innerColor = isActive ? color : 'rgba(255,255,255,0.2)';
    const glowColor = color;

    const pulse = isActive
        ? `<div style="position:absolute;inset:-8px;border-radius:50%;border:2px solid ${color}88;animation:nodePulse 3s ease-out infinite;filter:blur(1px);"></div>
           <div style="position:absolute;inset:-12px;border-radius:50%;border:1px solid ${color}44;animation:nodePulse 3s ease-out infinite 1s;filter:blur(2px);"></div>`
        : '';

    const label = count > 1
        ? `<span style="font-size:${size > 22 ? 11 : 9}px;font-weight:900;color:#fff;text-shadow:0 0 4px rgba(0,0,0,0.8);">${count}</span>`
        : '';

    return `<div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">
        ${pulse}
        <div style="width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 30% 30%, ${innerColor}, rgba(0,0,0,0.8));border:2px solid ${ringColor};box-shadow:0 0 ${isActive ? 20 : 5}px ${glowColor}aa, inset 0 0 10px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1);">
            ${label}
        </div>
        ${isActive ? `<div style="position:absolute;bottom:-4px;width:12px;height:2px;background:${color};filter:blur(1px);border-radius:50%;opacity:0.6;"></div>` : ''}
    </div>`;
}

export function singleNodePopup(node: NodeGeoPoint, color: NodeColor): string {
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

export function listingLocationKey(pin: ExplorerListingPin): string {
    if (pin.node_id?.trim()) return `node:${pin.node_id.trim()}`;
    return `coord:${pin.lat.toFixed(4)},${pin.lon.toFixed(4)}`;
}

export function groupListingPins(pins: ExplorerListingPin[]): ExplorerListingPin[][] {
    const groups = new Map<string, ExplorerListingPin[]>();
    for (const pin of pins) {
        const key = listingLocationKey(pin);
        const bucket = groups.get(key) ?? [];
        bucket.push(pin);
        groups.set(key, bucket);
    }
    return Array.from(groups.values());
}

export function listingMarkerHtml(price: number, selected: boolean, estimated: boolean, count: number): string {
    const color = selected ? '#f59e0b' : estimated ? '#d97706' : '#10b981';
    const border = estimated ? '2px dashed rgba(251,191,36,.85)' : '2px solid rgba(255,255,255,.35)';
    const size = count > 1 ? 30 : 24;
    const label = count > 1
        ? `<span style="font-size:11px;font-weight:900;color:#fff;line-height:1;">${count}</span>`
        : `<span style="font-size:7px;font-weight:900;color:#fff;">${price.toFixed(4)}</span>`;
    const sublabel = count > 1
        ? `<span style="position:absolute;bottom:-10px;left:50%;transform:translateX(-50%);font-size:6px;font-weight:800;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;">listings</span>`
        : '';
    return `<div style="position:relative;width:${size}px;height:${size}px;">
        <div style="width:100%;height:100%;border-radius:${count > 1 ? '50%' : '6px'};background:${color};border:${border};box-shadow:0 0 14px ${color}88;display:flex;align-items:center;justify-content:center;cursor:pointer;">
            ${label}
        </div>
        ${sublabel}
    </div>`;
}

function listingLocationLabel(pin: ExplorerListingPin & { city?: string }): string {
    const parts = [pin.city, pin.country].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : (pin.country || '—');
}

function catalogPopupLine(pin: { catalog_product?: { title?: string; slug?: string } }): string {
    const title = pin.catalog_product?.title?.trim();
    if (!title) return '';
    const slug = pin.catalog_product?.slug?.trim();
    const label = slug ? `/${slug}` : 'Catalog';
    return `<div style="font-size:8px;font-weight:800;color:#c4b5fd;text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px;">Catalog · ${esc(label)} · ${esc(title)}</div>`;
}

export function listingPopup(
    pin: ExplorerListingPin & { city?: string; catalog_product?: { title?: string; slug?: string } },
    opts?: { buyAction?: boolean },
): string {
    const loc = esc(listingLocationLabel(pin));
    const catalogLine = catalogPopupLine(pin);
    const buyCtl = opts?.buyAction
        ? `<button type="button" class="ph-listing-buy" data-listing-id="${esc(pin.listing_id)}" style="display:block;width:100%;text-align:center;padding:6px;background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.35);border-radius:8px;color:#10b981;font-size:8px;font-weight:900;text-transform:uppercase;cursor:pointer;font-family:monospace;">Buy →</button>`
        : `<a href="/marketplace/map?listing=${esc(pin.listing_id)}" style="display:block;text-align:center;padding:6px;background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.35);border-radius:8px;color:#10b981;font-size:8px;font-weight:900;text-transform:uppercase;text-decoration:none;">Buy on map →</a>`;
    return `<div style="background:#0a0a15;border:1px solid rgba(16,185,129,.35);border-radius:12px;padding:12px;min-width:200px;font-family:monospace;color:#fff;">
        <div style="font-size:8px;font-weight:900;color:#10b981;text-transform:uppercase;letter-spacing:.2em;margin-bottom:4px;">Market listing</div>
        ${catalogLine}
        <div style="font-size:11px;font-weight:700;margin-bottom:6px;">${esc(pin.title)}</div>
        <div style="font-size:9px;color:rgba(255,255,255,.5);margin-bottom:8px;">${loc} · ${pin.price_per_gb.toFixed(6)} SOL/GB</div>
        ${buyCtl}
    </div>`;
}

export function listingClusterPopup(pins: (ExplorerListingPin & { city?: string })[]): string {
    const loc = esc(listingLocationLabel(pins[0]));
    const minPrice = Math.min(...pins.map(p => p.price_per_gb));
    const rows = pins.map(p => {
        const verified = p.listing_offer_verified ? 'signed' : 'unsigned';
        return `<button type="button" data-listing-id="${esc(p.listing_id)}" class="ph-listing-cluster-row" style="display:block;width:100%;text-align:left;padding:8px 0;border:none;border-bottom:1px solid rgba(255,255,255,.06);background:transparent;cursor:pointer;font-family:monospace;">
            <div style="font-size:10px;font-weight:700;color:#fff;margin-bottom:2px;">${esc(p.title)}</div>
            <div style="font-size:8px;color:rgba(255,255,255,.45);">${p.price_per_gb.toFixed(6)} SOL/GB · ${verified}</div>
        </button>`;
    }).join('');

    return `<div style="background:#0a0a15;border:1px solid rgba(16,185,129,.35);border-radius:12px;padding:12px;min-width:240px;max-width:280px;font-family:monospace;color:#fff;box-shadow:0 8px 32px rgba(0,0,0,.5);">
        <div style="font-size:8px;font-weight:900;color:#10b981;text-transform:uppercase;letter-spacing:.2em;margin-bottom:4px;">${pins.length} listings here</div>
        <div style="font-size:9px;color:rgba(255,255,255,.45);margin-bottom:8px;">📍 ${loc} · from ${minPrice.toFixed(6)} SOL/GB</div>
        <div style="max-height:220px;overflow-y:auto;scrollbar-width:thin;">${rows}</div>
        <div style="font-size:7px;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.12em;margin-top:8px;text-align:center;">Tap a listing to select</div>
    </div>`;
}

export function clusterPopup(nodes: NodeGeoPoint[], color: NodeColor): string {
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

/** Dark basemap styles for Google Maps JavaScript API */
export const GOOGLE_MAP_DARK_STYLES: google.maps.MapTypeStyle[] = [
    { elementType: 'geometry', stylers: [{ color: '#0a0a12' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a12' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#1f2937' }] },
    { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#374151' }] },
    { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#111827' }] },
    { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050508' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#374151' }] },
];
