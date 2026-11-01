"use client";

/**
 * GlobeMap — Interactive 3D WebGL node globe (Phase 3).
 * Assets are self-hosted under /map-assets/; labels derive from live pin clusters.
 */

import { Loader2, RefreshCw } from "lucide-react";
import GlobeScene from "./globe/GlobeScene";
import { useGlobeAssets } from "./globe/useGlobeAssets";
import type { GlobeMapProps, MapStyle } from "./globe/types";

export type { MapStyle } from "./globe/types";

export default function GlobeMap(props: GlobeMapProps) {
  const mapStyle: MapStyle = props.mapStyle ?? "satellite";
  const assets = useGlobeAssets(mapStyle);

  if (assets.status === "loading") {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#050508]"
        data-testid="explorer-globe-loading"
      >
        <Loader2 className="animate-spin text-primary" size={28} />
        <p className="text-xs font-semibold text-muted-foreground">
          Loading globe assets…
        </p>
      </div>
    );
  }

  if (assets.status === "error") {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-4 bg-[#050508] px-6 text-center"
        data-testid="explorer-globe-error"
      >
        <p className="text-xs font-semibold text-destructive">
          Globe assets failed to load
        </p>
        <p className="text-xs text-muted-foreground max-w-sm">
          {assets.message}
        </p>
        <button
          type="button"
          onClick={assets.retry}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-secondary text-xs font-semibold text-foreground hover:text-foreground"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      </div>
    );
  }

  return (
    <GlobeScene {...props} mapStyle={mapStyle} countries={assets.countries} />
  );
}
