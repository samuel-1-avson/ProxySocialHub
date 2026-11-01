import type { NodeGeoPoint } from "@/lib/services/explorer";
import type { ExplorerListingPin, MapNodeUpdate } from "@/components/map/types";
import type { MapTopologyLink } from "@/lib/api/map-topology";

export type MapStyle = "satellite" | "terrain" | "minimal";

export interface GlobeMapProps {
  nodes: NodeGeoPoint[];
  onSelectNode: (node: NodeGeoPoint) => void;
  selectedNodeId?: string;
  listingPins?: ExplorerListingPin[];
  onSelectListing?: (pin: ExplorerListingPin) => void;
  selectedListingId?: string;
  showHeatmap?: boolean;
  mapStyle?: MapStyle;
  focusBounds?: [[number, number], [number, number]] | null;
  liveUpdates?: MapNodeUpdate[];
  /** Session-derived topology arcs (Phase 5); empty when flag off or no data. */
  topologyLinks?: MapTopologyLink[];
  topologyAvailable?: boolean;
}

export type GlobePoint =
  | { kind: "node"; node: NodeGeoPoint }
  | { kind: "listing"; pin: ExplorerListingPin };

export interface MapLabel {
  name: string;
  lat: number;
  lon: number;
  tier: number;
}

export interface CountryFeature {
  type: string;
  geometry: { type: string; coordinates: unknown };
  properties?: Record<string, string | number | undefined>;
}
