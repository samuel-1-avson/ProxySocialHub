"use client";

import Globe from "react-globe.gl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import type { NodeGeoPoint } from "@/lib/services/explorer";
import { deriveClusterLabels, labelsWithSizes } from "./cluster-labels";
import { featureCentroid } from "./geojson";
import {
  globePointAltitude,
  globePointColor,
  globePointLabel,
  globePointLat,
  globePointLng,
  globePointRadius,
  hexTooltip,
} from "./point-render";
import { isValidGlobeCoord } from "@/lib/geo/globe-coords";
import { STYLES } from "./styles";
import type { CountryFeature, GlobeMapProps, GlobePoint } from "./types";
import type { MapTopologyLink } from "@/lib/api/map-topology";

interface GlobeSceneProps extends GlobeMapProps {
  countries: CountryFeature[];
}

export default function GlobeScene({
  nodes,
  onSelectNode,
  selectedNodeId,
  listingPins = [],
  onSelectListing,
  selectedListingId,
  showHeatmap = false,
  mapStyle = "satellite",
  focusBounds,
  liveUpdates = [],
  topologyLinks = [],
  topologyAvailable = false,
  countries,
}: GlobeSceneProps) {
  const globeRef = useRef<ComponentRef<typeof Globe>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayNodes = useMemo(() => {
    const records = new Map(nodes.map((node) => [node.node_id, node]));
    for (const update of liveUpdates) {
      const previous = records.get(update.node_id);
      const lat = update.lat ?? previous?.lat;
      const lon = update.lon ?? previous?.lon;
      if (lat == null || lon == null || !isValidGlobeCoord(lat, lon)) continue;
      records.set(update.node_id, {
        ...previous,
        node_id: update.node_id,
        lat,
        lon,
        is_active: update.is_active,
        is_validator: previous?.is_validator ?? false,
        uptime_percent: update.uptime_percent,
        active_sessions: update.active_sessions,
        country: previous?.country ?? "",
        region: previous?.region ?? "",
      });
    }
    return [...records.values()];
  }, [nodes, liveUpdates]);
  const [size, setSize] = useState({ w: 800, h: 680 });

  const style = STYLES[mapStyle];
  const MAX_COUNTRY_LABELS = 48;

  const clusterLabels = useMemo(
    () => labelsWithSizes(deriveClusterLabels(displayNodes, listingPins)),
    [displayNodes, listingPins],
  );

  const countryLabels = useMemo(
    () =>
      countries
        .flatMap((f) => {
          const pt = featureCentroid(f);
          if (!pt || !isValidGlobeCoord(pt[0], pt[1])) return [];
          const name = String(
            f.properties?.NAME_EN || f.properties?.NAME || "",
          );
          if (!name) return [];
          return [
            { name, lat: pt[0], lon: pt[1], labelSize: 0.3, dotRadius: 0 },
          ];
        })
        .slice(0, MAX_COUNTRY_LABELS),
    [countries],
  );

  const activeLabels = useMemo(
    () =>
      mapStyle === "minimal"
        ? [...clusterLabels, ...countryLabels]
        : clusterLabels,
    [mapStyle, clusterLabels, countryLabels],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 10 && height > 10)
        setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const initControls = useCallback((): (() => void) => {
    const g = globeRef.current;
    if (!g) return () => {};
    try {
      const controls = g.controls() as {
        autoRotate: boolean;
        autoRotateSpeed: number;
        enableDamping: boolean;
        dampingFactor: number;
        enableZoom: boolean;
        enableRotate: boolean;
        enablePan: boolean;
        minDistance: number;
        maxDistance: number;
        zoomSpeed: number;
      };
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.3;
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.enableZoom = true;
      controls.enableRotate = true;
      controls.enablePan = false;
      controls.minDistance = 110;
      controls.maxDistance = 500;
      controls.zoomSpeed = 0.8;
      const canvas = g.renderer().domElement;
      canvas.style.cursor = "grab";
      const onDown = () => {
        controls.autoRotate = false;
        canvas.style.cursor = "grabbing";
      };
      const onUp = () => {
        canvas.style.cursor = "grab";
      };
      canvas.addEventListener("pointerdown", onDown, { passive: true });
      canvas.addEventListener("pointerup", onUp, { passive: true });
      return () => {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointerup", onUp);
      };
    } catch {
      return () => {};
    }
  }, []);

  useEffect(() => {
    let removeListeners: (() => void) | undefined;
    const t = setTimeout(() => {
      removeListeners = initControls();
    }, 500);
    return () => {
      clearTimeout(t);
      removeListeners?.();
    };
  }, [initControls, size.w, size.h]);

  useEffect(
    () => () => {
      try {
        globeRef.current?.renderer()?.dispose();
      } catch {
        /* dispose best-effort */
      }
    },
    [],
  );

  useEffect(() => {
    const g = globeRef.current;
    if (!g || !focusBounds) return;
    const [[swLat, swLon], [neLat, neLon]] = focusBounds;
    g.pointOfView(
      { lat: (swLat + neLat) / 2, lng: (swLon + neLon) / 2, altitude: 1.6 },
      1200,
    );
  }, [focusBounds]);

  // Face the plotted nodes — default Africa POV leaves US/Asia pins on the far side.
  const plottedFocusKey = useMemo(() => {
    const lats: number[] = [];
    const lons: number[] = [];
    for (const n of displayNodes) {
      if (!isValidGlobeCoord(n.lat, n.lon)) continue;
      lats.push(n.lat);
      lons.push(n.lon);
    }
    for (const p of listingPins) {
      if (!isValidGlobeCoord(p.lat, p.lon)) continue;
      lats.push(p.lat);
      lons.push(p.lon);
    }
    if (lats.length === 0) return "";
    const lat = lats.reduce((sum, v) => sum + v, 0) / lats.length;
    const lon = lons.reduce((sum, v) => sum + v, 0) / lons.length;
    return `${lat.toFixed(2)},${lon.toFixed(2)},${lats.length}`;
  }, [displayNodes, listingPins]);

  useEffect(() => {
    const g = globeRef.current;
    if (!g || focusBounds !== null) return;
    if (!plottedFocusKey) {
      g.pointOfView({ lat: 20, lng: 0, altitude: 2.2 }, 1200);
      return;
    }
    const [latStr, lonStr] = plottedFocusKey.split(",");
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    try {
      const controls = g.controls() as { autoRotate?: boolean };
      if (controls) controls.autoRotate = false;
    } catch {
      /* ignore */
    }
    g.pointOfView({ lat, lng: lon, altitude: 1.75 }, 1100);
  }, [focusBounds, plottedFocusKey]);

  // Soft rings on every plotted point so nodes stay visible while rotating.
  const presenceRings = useMemo(() => {
    const rings: { lat: number; lng: number; color: string }[] = [];
    for (const n of displayNodes) {
      if (!isValidGlobeCoord(n.lat, n.lon)) continue;
      rings.push({
        lat: n.lat,
        lng: n.lon,
        color: n.is_active ? "#10b981" : "#ef4444",
      });
    }
    for (const p of listingPins) {
      if (!isValidGlobeCoord(p.lat, p.lon)) continue;
      rings.push({ lat: p.lat, lng: p.lon, color: "#10b981" });
    }
    return rings;
  }, [displayNodes, listingPins]);

  const handlePointClick = useCallback(
    (point: object) => {
      try {
        const c = globeRef.current?.controls() as
          | { autoRotate: boolean }
          | undefined;
        if (c) c.autoRotate = false;
      } catch {
        /* ignore */
      }
      const p = point as GlobePoint;
      if (p.kind === "listing") {
        onSelectListing?.(p.pin);
      } else {
        onSelectNode(p.node);
      }
    },
    [onSelectNode, onSelectListing],
  );

  const validNodes = displayNodes.filter((n) =>
    isValidGlobeCoord(n.lat, n.lon),
  );
  const validListings = useMemo(
    () => listingPins.filter((p) => isValidGlobeCoord(p.lat, p.lon)),
    [listingPins],
  );

  const arcData = useMemo(
    () =>
      topologyLinks.filter(
        (link): link is MapTopologyLink =>
          isValidGlobeCoord(link.source.lat, link.source.lon) &&
          isValidGlobeCoord(link.target.lat, link.target.lon),
      ),
    [topologyLinks],
  );

  const globePoints = useMemo(
    (): GlobePoint[] => [
      ...validNodes.map((node) => ({ kind: "node" as const, node })),
      ...validListings.map((pin) => ({ kind: "listing" as const, pin })),
    ],
    [validNodes, validListings],
  );

  const selectedNode = selectedNodeId
    ? (validNodes.find((n) => n.node_id === selectedNodeId) ?? null)
    : null;
  const selectedListing = selectedListingId
    ? (validListings.find((p) => p.listing_id === selectedListingId) ?? null)
    : null;

  const ringTarget = useMemo(() => {
    if (selectedNode && isValidGlobeCoord(selectedNode.lat, selectedNode.lon)) {
      return { lat: selectedNode.lat, lng: selectedNode.lon };
    }
    if (
      selectedListing &&
      isValidGlobeCoord(selectedListing.lat, selectedListing.lon)
    ) {
      return { lat: selectedListing.lat, lng: selectedListing.lon };
    }
    return null;
  }, [selectedNode, selectedListing]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#050508" }}
      data-testid="explorer-globe-ready"
      data-globe-listings={validListings.length > 0 ? "true" : undefined}
      data-globe-topology={
        arcData.length > 0 ? "true" : topologyAvailable ? "empty" : undefined
      }
    >
      <Globe
        ref={globeRef}
        width={size.w}
        height={size.h}
        globeImageUrl={style.globeImage || undefined}
        bumpImageUrl={style.bump || undefined}
        backgroundImageUrl={style.background}
        atmosphereColor={style.atmosphere}
        atmosphereAltitude={0.22}
        polygonsData={countries}
        polygonCapColor={() => style.polyCapColor}
        polygonSideColor={() => style.polySideColor}
        polygonStrokeColor={() => style.polyStrokeColor}
        polygonAltitude={0.001}
        labelsData={activeLabels}
        labelLat={(d: object) => (d as { lat: number }).lat}
        labelLng={(d: object) => (d as { lon: number }).lon}
        labelText={(d: object) => (d as { name: string }).name}
        labelSize={(d: object) =>
          (d as { labelSize?: number }).labelSize ?? 0.2
        }
        labelDotRadius={(d: object) =>
          (d as { dotRadius?: number }).dotRadius ?? 0.1
        }
        labelColor={() => style.labelColor}
        labelAltitude={0.015}
        labelResolution={3}
        labelDotOrientation={() => "bottom" as const}
        pointsData={globePoints}
        pointLat={(p: object) => globePointLat(p as GlobePoint)}
        pointLng={(p: object) => globePointLng(p as GlobePoint)}
        pointColor={(p: object) =>
          globePointColor(p as GlobePoint, selectedNodeId, selectedListingId)
        }
        pointAltitude={(p: object) => globePointAltitude(p as GlobePoint)}
        pointRadius={(p: object) =>
          globePointRadius(p as GlobePoint, selectedNodeId, selectedListingId)
        }
        pointLabel={(p: object) => globePointLabel(p as GlobePoint)}
        onPointClick={handlePointClick}
        pointsMerge={false}
        ringsData={
          ringTarget
            ? [
                {
                  lat: ringTarget.lat,
                  lng: ringTarget.lng,
                  color: selectedListing ? "#10b981" : "#f59e0b",
                },
              ]
            : presenceRings
        }
        ringLat="lat"
        ringLng="lng"
        ringColor={(d: object) => (d as { color?: string }).color || "#10b981"}
        ringMaxRadius={ringTarget ? 0.55 : 0.7}
        ringPropagationSpeed={2.2}
        ringRepeatPeriod={ringTarget ? 900 : 1400}
        ringAltitude={0.03}
        hexBinPointsData={showHeatmap ? validNodes : []}
        hexBinPointWeight={(n: object) =>
          (Number((n as NodeGeoPoint).active_sessions) || 0) + 1
        }
        hexAltitude={(d: object) =>
          Math.min((d as { sumWeight: number }).sumWeight * 0.005, 0.25)
        }
        hexBinResolution={4}
        hexTopColor={() => "rgba(99,102,241,0.88)"}
        hexSideColor={() => "rgba(99,102,241,0.3)"}
        hexLabel={hexTooltip}
        arcsData={arcData}
        arcStartLat={(d: object) =>
          (d as { source: { lat: number } }).source.lat
        }
        arcStartLng={(d: object) =>
          (d as { source: { lon: number } }).source.lon
        }
        arcEndLat={(d: object) => (d as { target: { lat: number } }).target.lat}
        arcEndLng={(d: object) => (d as { target: { lon: number } }).target.lon}
        arcColor={(d: object) => (d as { color: string }).color}
        arcStroke={(d: object) => (d as { stroke_width: number }).stroke_width}
        arcAltitude={0.15}
      />
    </div>
  );
}
