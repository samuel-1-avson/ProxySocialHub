"use client";

import { useCallback, useEffect, useState } from "react";
import { COUNTRIES_GEOJSON_URL, textureUrlsForStyle } from "./styles";
import { loadCountriesGeoJson } from "./geojson";
import type { CountryFeature, MapStyle } from "./types";

export type GlobeAssetsState =
  | { status: "loading" }
  | { status: "ready"; countries: CountryFeature[] }
  | { status: "error"; message: string; retry: () => void };

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Texture failed: ${url}`));
    img.src = url;
  });
}

async function loadTextures(style: MapStyle): Promise<void> {
  const urls = textureUrlsForStyle(style);
  await Promise.all(urls.map(preloadImage));
}

export function useGlobeAssets(mapStyle: MapStyle): GlobeAssetsState {
  const [loaded, setLoaded] = useState<{
    key: string;
    state: GlobeAssetsState;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const key = mapStyle + ":" + attempt;
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [countries] = await Promise.all([
          loadCountriesGeoJson(COUNTRIES_GEOJSON_URL),
          loadTextures(mapStyle),
        ]);
        if (!cancelled) {
          setLoaded({ key, state: { status: "ready", countries } });
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Globe assets failed to load";
          setLoaded({ key, state: { status: "error", message, retry } });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mapStyle, attempt, retry, key]);

  return loaded?.key === key ? loaded.state : { status: "loading" };
}
