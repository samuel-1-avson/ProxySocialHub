"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";

type NodeRecord = Record<string, unknown>;

export default function PublicNodeMap({ nodes }: { nodes: NodeRecord[] }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<LayerGroup | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const points = useMemo(() => nodes.filter((node) =>
    typeof node.lat === "number" && Number.isFinite(node.lat) && Math.abs(node.lat) <= 90 &&
    typeof node.lon === "number" && Number.isFinite(node.lon) && Math.abs(node.lon) <= 180 &&
    node.geo_source !== "unknown",
  ), [nodes]);

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    void import("leaflet").then((L) => {
      if (cancelled || !element.current) return;
      const instance = L.map(element.current, {
        center: [20, 0], zoom: 2, minZoom: 1, maxZoom: 7,
        scrollWheelZoom: false, worldCopyJump: true,
      });
      map.current = instance;
      markers.current = L.layerGroup().addTo(instance);
      observer = new ResizeObserver(() => instance.invalidateSize());
      observer.observe(element.current);
      setReady(true);
    }).catch(() => {
      if (!cancelled) setError("The geographic map could not load. Reported regions remain available below.");
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
      markers.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import("leaflet").then((L) => {
      if (cancelled || !map.current) return;
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 7, keepBuffer: 0,
      });
      tiles.on("tileerror", () => setError("Map tiles are unavailable. Node records and region counts remain available."));
      tiles.on("tileload", () => setError(undefined));
      tiles.addTo(map.current);
      dispose = () => { tiles.off(); tiles.remove(); };
    });
    return () => { cancelled = true; dispose?.(); };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !markers.current || !map.current) return;
      markers.current.clearLayers();
      const groups = new Map<string, NodeRecord[]>();
      for (const point of points) {
        const key = `${point.lat}:${point.lon}`;
        groups.set(key, [...(groups.get(key) || []), point]);
      }
      for (const group of groups.values()) {
        const active = group.filter((node) => node.is_active === true).length;
        const summary = `${group.length} reported nodes · ${active} active`;
        const popup = document.createElement("div");
        const heading = document.createElement("strong");
        heading.textContent = summary;
        popup.append(heading);
        for (const node of group) {
          if (typeof node.node_id !== "string" || !node.node_id) continue;
          const row = document.createElement("p");
          const link = document.createElement("a");
          link.href = `/nodes/${encodeURIComponent(node.node_id)}`;
          link.textContent = `${typeof node.country === "string" ? node.country : "Region unreported"} · ${node.node_id.slice(0, 14)}`;
          row.append(link);
          popup.append(row);
        }
        L.marker([group[0].lat as number, group[0].lon as number], {
          title: summary, keyboard: true,
          icon: L.divIcon({
            className: `public-node-marker${active ? " active" : ""}`,
            html: `<span>${group.length}</span>`, iconSize: [30, 30], iconAnchor: [15, 15],
          }),
        }).bindPopup(popup).addTo(markers.current);
      }
      if (!fitted.current && points.length) {
        fitted.current = true;
        map.current.fitBounds(points.map((node) => [node.lat as number, node.lon as number]), { padding: [36, 36], maxZoom: 4 });
      }
    });
    return () => { cancelled = true; };
  }, [ready, points]);

  return (
    <>
      {error && <p className="ui-error" role="alert">{error}</p>}
      <div ref={element} className="public-node-map" role="region" aria-label="Geographic node map" data-testid="public-node-map" aria-busy={!ready} />
      <p className="ui-note">Pan or zoom to inspect reported regions. Positions are rounded to roughly 5°; they do not identify a provider’s address.</p>
    </>
  );
}
