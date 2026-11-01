import type { NodeGeoPoint } from "@/lib/services/explorer";
import type { ExplorerListingPin } from "@/components/map/types";
import type { GlobePoint } from "./types";

function pointColor(n: NodeGeoPoint, selId?: string): string {
  if (selId === n.node_id) return "#f59e0b";
  if (n.is_validator) return "#a855f7";
  if (n.is_active) return "#10b981";
  return "#ef4444";
}

function pointRadius(n: NodeGeoPoint) {
  // Degrees of arc — keep large enough to see on a full-earth view.
  return n.is_validator ? 0.55 : 0.4;
}

function pointAltitude(n: NodeGeoPoint) {
  return n.is_active ? 0.04 : 0.02;
}

function listingPointColor(pin: ExplorerListingPin, selected: boolean): string {
  if (selected) return "#fbbf24";
  return pin.estimated ? "#34d399" : "#10b981";
}

function listingPointRadius(
  _pin: ExplorerListingPin,
  selected: boolean,
): number {
  return selected ? 0.5 : 0.38;
}

export function globePointLat(p: GlobePoint): number {
  return p.kind === "node" ? p.node.lat : p.pin.lat;
}

export function globePointLng(p: GlobePoint): number {
  return p.kind === "node" ? p.node.lon : p.pin.lon;
}

export function globePointColor(
  p: GlobePoint,
  selectedNodeId?: string,
  selectedListingId?: string,
): string {
  if (p.kind === "listing") {
    return listingPointColor(p.pin, p.pin.listing_id === selectedListingId);
  }
  return pointColor(p.node, selectedNodeId);
}

export function globePointRadius(
  p: GlobePoint,
  selectedNodeId?: string,
  selectedListingId?: string,
): number {
  if (p.kind === "listing") {
    return listingPointRadius(p.pin, p.pin.listing_id === selectedListingId);
  }
  return pointRadius(p.node);
}

export function globePointAltitude(p: GlobePoint): number {
  if (p.kind === "listing") return 0.02;
  return pointAltitude(p.node);
}

function listingTooltip(pin: ExplorerListingPin): string {
  const loc = [pin.country].filter(Boolean).join(", ") || "—";
  const price = pin.price_per_gb.toFixed(4);
  const est = pin.estimated ? " · estimated" : "";
  return `<div style="background:#0a0a15;border:1px solid rgba(16,185,129,.45);border-radius:10px;
                padding:10px 14px;font-family:monospace;color:#fff;min-width:190px;
                box-shadow:0 4px 28px rgba(0,0,0,.9);pointer-events:none;">
        <div style="color:#10b981;font-weight:700;font-size:10px;margin-bottom:5px;">
            ◆ Marketplace listing${est}
        </div>
        <div style="font-size:10px;color:#fff;font-weight:600;margin-bottom:6px;">${pin.title.replace(/[<>&"']/g, "")}</div>
        <div style="color:rgba(255,255,255,.45);font-size:9px;margin-bottom:2px;">📍 ${loc}</div>
        <div style="color:rgba(255,255,255,.35);font-size:9px;">$${price}/GB · click to inspect</div>
    </div>`;
}

function nodeTooltip(n: NodeGeoPoint): string {
  const sc = n.is_active ? "#10b981" : "#ef4444";
  const st = n.is_active ? "● Active" : "○ Offline";
  const ty = n.is_validator ? "⬡ Validator" : "◎ Proxy";
  const loc = [n.city, n.country || n.region].filter(Boolean).join(", ") || "—";
  return `<div style="background:#0a0a15;border:1px solid rgba(99,102,241,.4);border-radius:10px;
                padding:10px 14px;font-family:monospace;color:#fff;min-width:190px;
                box-shadow:0 4px 28px rgba(0,0,0,.9);pointer-events:none;">
        <div style="color:#6366f1;font-weight:700;font-size:10px;margin-bottom:5px;">
            ${n.node_id.slice(0, 22)}…
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:3px;">
            <span style="color:rgba(255,255,255,.4)">${ty}</span>
            <span style="color:${sc};font-weight:700;">${st}</span>
        </div>
        <div style="color:rgba(255,255,255,.45);font-size:9px;margin-bottom:2px;">📍 ${loc}</div>
        <div style="color:rgba(255,255,255,.35);font-size:9px;">
            ${(n.uptime_percent || 0).toFixed(1)}% up · ${n.active_sessions} sessions
        </div>
    </div>`;
}

export function globePointLabel(p: GlobePoint): string {
  if (p.kind === "listing") return listingTooltip(p.pin);
  return nodeTooltip(p.node);
}

export function hexTooltip(d: object): string {
  const hex = d as { points: NodeGeoPoint[]; sumWeight: number };
  const active = hex.points.filter((p) => p.is_active).length;
  return `<div style="background:#0a0a15;border:1px solid rgba(99,102,241,.3);border-radius:8px;
                padding:7px 12px;font-family:monospace;font-size:9px;color:#fff;pointer-events:none;">
        <span style="color:#6366f1;font-weight:700;">${hex.points.length}</span> nodes ·
        <span style="color:#10b981;">${active}</span> active ·
        <span style="color:#a855f7;">${Math.round(hex.sumWeight)}</span> sessions
    </div>`;
}
