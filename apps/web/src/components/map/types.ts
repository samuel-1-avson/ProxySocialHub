import type { NodeGeoPoint } from '@/lib/services/explorer';

export interface MapNodeUpdate {
    node_id: string;
    is_active: boolean;
    uptime_percent: number;
    active_sessions: number;
    lat?: number;
    lon?: number;
}

export interface ExplorerListingPin {
    listing_id: string;
    title: string;
    lat: number;
    lon: number;
    price_per_gb: number;
    country?: string;
    city?: string;
    node_id?: string;
    estimated?: boolean;
    uptime_percent?: number;
    sla_source?: string;
    listing_offer_verified?: boolean;
    listing_offer_signer?: string;
    listing_offer_verification_error?: string;
}

export interface MapViewportBounds {
    west: number;
    south: number;
    east: number;
    north: number;
}

export interface ProxyMapCanvasProps {
    nodes: NodeGeoPoint[];
    onSelectNode: (node: NodeGeoPoint) => void;
    selectedNodeId?: string;
    showHeatmap?: boolean;
    focusBounds?: [[number, number], [number, number]] | null;
    liveUpdates?: MapNodeUpdate[];
    listingPins?: ExplorerListingPin[];
    onSelectListing?: (pin: ExplorerListingPin) => void;
    onSelectListingGroup?: (pins: ExplorerListingPin[]) => void;
    selectedListingId?: string;
    onBoundsChange?: (bounds: MapViewportBounds) => void;
}
