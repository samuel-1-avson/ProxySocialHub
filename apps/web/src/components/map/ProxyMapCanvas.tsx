'use client';

/**
 * ProxyMapCanvas — prefers Google Maps when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set.
 * Falls back to Leaflet + CARTO when the key is missing (local/e2e without Maps billing).
 */

import { googleMapsApiKey } from '@/lib/feature-flags';
import GoogleProxyMapCanvas from './GoogleProxyMapCanvas';
import LeafletProxyMapCanvas from './LeafletProxyMapCanvas';
import type { ProxyMapCanvasProps } from './types';

export type {
    ExplorerListingPin,
    MapNodeUpdate,
    MapViewMode,
    MapViewportBounds,
    ProxyMapCanvasProps,
} from './types';

function ProxyMapCanvas(props: ProxyMapCanvasProps) {
    const apiKey = googleMapsApiKey();
    if (apiKey) {
        return <GoogleProxyMapCanvas apiKey={apiKey} {...props} />;
    }
    return <LeafletProxyMapCanvas {...props} />;
}

export default ProxyMapCanvas;
export { ProxyMapCanvas };
