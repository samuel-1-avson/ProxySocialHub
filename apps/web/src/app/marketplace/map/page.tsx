"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { Globe, Loader2, MapPin, Search, ShoppingCart, X } from "lucide-react";
import { PageHeading, Stat } from "@/components/workspace/Patterns";
import { GlassCard } from "@/components/ui/glass-card";
import { LazyBuyListingModal as BuyListingModal } from "@/components/marketplace/LazyBuyListingModal";
import { CatalogProductBadge } from "@/components/marketplace/CatalogProductBadge";
import { ListingSocialPanel } from "@/components/marketplace/ListingSocialPanel";
import { ListingQASection } from "@/components/marketplace/ListingQASection";
import { MarketplaceDiscoverTabs } from "@/components/marketplace/MarketplaceDiscoverTabs";
import {
  getListing,
  type Listing,
  type MarketplaceMapFilters,
} from "@/lib/api/marketplace";
import { mapLiveOnMarketplaceEnabled } from "@/lib/feature-flags";
import { useMapPoints } from "@/lib/hooks/useMapPoints";
import {
  bboxNearlyEqual,
  bboxToParam,
  pinInBBox,
  type MapBBox,
} from "@/lib/geo/bbox";
import type { NodeGeoPoint } from "@/lib/services/explorer";
import type { MarketplaceListingMapPin } from "@/lib/map/marketplace-map-adapters";
import { geoSourceLabel } from "@/lib/map/geo-labels";
import type { ExplorerListingPin } from "@/components/map/types";

const ProxyMapCanvas = dynamic(
  () => import("@/components/map/ProxyMapCanvas"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full min-h-[480px] flex items-center justify-center bg-card rounded-[2rem]">
        <span className="text-xs font-black text-muted-foreground uppercase tracking-wide animate-pulse">
          Loading map…
        </span>
      </div>
    ),
  },
);

export default function MarketplaceMapPage() {
  const searchParams = useSearchParams();
  const highlightListingId = searchParams.get("listing");
  return <MarketplaceMapContent key={highlightListingId || "all"} highlightListingId={highlightListingId} />;
}

function MarketplaceMapContent({ highlightListingId }: { highlightListingId: string | null }) {
  const [proxyType, setProxyType] = useState("");
  const [protocol, setProtocol] = useState("");
  const [country, setCountry] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minUptime, setMinUptime] = useState("");
  const [maxLatency, setMaxLatency] = useState("");
  const [chosenPin, setSelectedPin] =
    useState<MarketplaceListingMapPin | null | undefined>(undefined);
  const [selectedCluster, setSelectedCluster] = useState<
    MarketplaceListingMapPin[] | null
  >(null);
  const [selectedNode, setSelectedNode] = useState<NodeGeoPoint | null>(null);
  const [buyListing, setBuyListing] = useState<Listing | null>(null);
  const [buyLoading, setBuyLoading] = useState(false);
  const [buyError, setBuyError] = useState<{
    listingId: string;
    message: string;
  } | null>(null);
  const [viewport, setViewport] = useState<MapBBox | null>(null);
  const [searchBBox, setSearchBBox] = useState<MapBBox | null>(null);

  function resetMapSelection() {
    setSearchBBox(null);
    setSelectedPin(null);
    setSelectedCluster(null);
    setSelectedNode(null);
  }

  const bboxParam = searchBBox ? bboxToParam(searchBBox) : undefined;
  const mapFilters = useMemo<MarketplaceMapFilters>(
    () => ({
      proxy_type: proxyType || undefined,
      protocol: protocol || undefined,
      country: country || undefined,
      min_price: minPrice || undefined,
      max_price: maxPrice || undefined,
      min_uptime: minUptime || undefined,
      max_latency: maxLatency || undefined,
      purchasable_only: true,
      include_nodes: true,
      active_nodes_only: true,
      bbox: bboxParam,
    }),
    [
      bboxParam,
      country,
      maxLatency,
      maxPrice,
      minPrice,
      minUptime,
      protocol,
      proxyType,
    ],
  );

  const {
    data,
    listingPins: mapListingPins,
    nodes: mapNodes,
    isLoading,
    error,
    refetch,
    isFetching,
    liveUpdates,
  } = useMapPoints({
    filters: mapFilters,
    live: mapLiveOnMarketplaceEnabled(),
    includeCatalog: true,
    refetchInterval: searchBBox ? false : 60_000,
  });

  const areaSearchStale = useMemo(() => {
    if (!viewport) return false;
    if (!searchBBox) return true;
    return !bboxNearlyEqual(viewport, searchBBox);
  }, [viewport, searchBBox]);

  const searchThisArea = useCallback(() => {
    if (!viewport) return;
    setSearchBBox(viewport);
    setSelectedPin(null);
    setSelectedCluster(null);
  }, [viewport]);

  const clearAreaSearch = useCallback(() => {
    setSearchBBox(null);
  }, []);

  const handleBoundsChange = useCallback((bounds: MapBBox) => {
    setViewport((prev) =>
      prev && bboxNearlyEqual(prev, bounds) ? prev : bounds,
    );
  }, []);

  const pins = mapListingPins;
  const nodes = mapNodes;

  const plotted = useMemo(
    () => pins.filter((p) => Math.abs(p.lat) > 0.01 || Math.abs(p.lon) > 0.01),
    [pins],
  );

  const selectedPin = chosenPin === undefined
    ? plotted.find((pin) => pin.listing_id === highlightListingId) ?? null
    : chosenPin;

  const viewportPins = useMemo(() => {
    if (!viewport) return plotted;
    return plotted.filter((p) => pinInBBox(p.lat, p.lon, viewport));
  }, [plotted, viewport]);
  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const p of pins) {
      if (p.country) set.add(p.country);
    }
    return Array.from(set).sort();
  }, [pins]);

  const focusBounds = useMemo(():
    | [[number, number], [number, number]]
    | null => {
    if (!country || plotted.length === 0) return null;
    const lats = plotted.map((p) => p.lat);
    const lons = plotted.map((p) => p.lon);
    return [
      [Math.min(...lats) - 2, Math.min(...lons) - 2],
      [Math.max(...lats) + 2, Math.max(...lons) + 2],
    ];
  }, [country, plotted]);

  const handleSelectNode = useCallback((node: NodeGeoPoint) => {
    setSelectedNode(node);
    setSelectedPin(null);
    setSelectedCluster(null);
  }, []);

  const handleSelectListing = useCallback((pin: ExplorerListingPin) => {
    setSelectedPin(pin as MarketplaceListingMapPin);
    setSelectedCluster(null);
    setSelectedNode(null);
  }, []);

  const handleSelectListingGroup = useCallback((pins: ExplorerListingPin[]) => {
    setSelectedCluster(pins as MarketplaceListingMapPin[]);
    setSelectedPin(null);
    setSelectedNode(null);
  }, []);

  const handleBuy = useCallback(async (pin: MarketplaceListingMapPin) => {
    if (!pin.purchasable) return;
    setBuyLoading(true);
    setBuyError(null);
    try {
      const result = await getListing(pin.listing_id);
      if (
        result.listing.status !== "active" ||
        result.listing.available_bandwidth_gb <= 0
      ) {
        throw new Error(
          "This offer is no longer available. Refresh the map to find another listing.",
        );
      }
      setBuyListing(result.listing);
    } catch (error) {
      setBuyError({
        listingId: pin.listing_id,
        message:
          error instanceof Error
            ? error.message
            : "Listing terms could not be loaded. Please try again.",
      });
    } finally {
      setBuyLoading(false);
    }
  }, []);

  const handleBuyListing = useCallback(
    (pin: ExplorerListingPin) => {
      void handleBuy(pin as MarketplaceListingMapPin);
    },
    [handleBuy],
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="marketplace-map-page space-y-6 pb-16"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <MarketplaceDiscoverTabs />
        <Link href="/community/feed" className="ui-link text-sm">
          Community feed →
        </Link>
      </div>
      <PageHeading
        eyebrow="Discover / Geographic view"
        title="Marketplace map"
        description="Explore available offers by region. Select a listing to inspect its terms before buying."
        actions={
          <Link href="/marketplace" className="ui-button secondary">
            Browse all offers
          </Link>
        }
      />
      <div className="ui-stats">
        <Stat
          label="Available listings"
          detail="Purchasable offers in the current result set"
          value={data ? (data.listing_count ?? pins.length) : "—"}
          icon={<ShoppingCart size={18} />}
        />
        <Stat
          label="Plotted locations"
          detail="Offers with geographic coordinates"
          value={data ? plotted.length : "—"}
          icon={<MapPin size={18} />}
        />
        <Stat
          label="Network nodes"
          detail="Reported nodes in the current result set"
          value={data ? (data.node_count ?? nodes.length) : "—"}
          icon={<Globe size={18} />}
        />
      </div>
      {searchBBox && (
        <p className="workflow-note">
          Results are filtered to the selected map area.{" "}
          <button type="button" className="ui-link" onClick={clearAreaSearch}>
            Show all areas
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 relative">
          <GlassCard className="!p-0 overflow-hidden border-border min-h-[520px]">
            {viewport != null && (areaSearchStale || !searchBBox) ? (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex gap-2">
                <button
                  type="button"
                  onClick={searchThisArea}
                  disabled={isFetching}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-xs font-semibold tracking-wide text-primary hover:bg-emerald-500/30 shadow-lg disabled:opacity-50"
                >
                  {isFetching ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Search size={12} />
                  )}
                  Search this area
                </button>
                {searchBBox && (
                  <button
                    type="button"
                    onClick={clearAreaSearch}
                    className="flex items-center gap-1 px-3 py-2 rounded-full bg-secondary border border-border text-xs font-semibold tracking-wide text-muted-foreground hover:text-foreground"
                    title="Show all listings"
                  >
                    <X size={12} />
                    Clear
                  </button>
                )}
              </div>
            ) : null}
            {isLoading && !data && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none">
                <Loader2 className="animate-spin text-primary" size={32} />
              </div>
            )}
            {isFetching && data ? (
              <div className="absolute top-4 right-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border pointer-events-none">
                <Loader2 className="animate-spin text-primary" size={12} />
                <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                  Updating…
                </span>
              </div>
            ) : null}
            {error != null ? (
              <div className="absolute top-4 left-4 z-10 px-4 py-2 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-400">
                Failed to load map data.{" "}
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="underline"
                >
                  Retry
                </button>
              </div>
            ) : null}
            <div className="h-[520px] min-h-[520px]">
              <ProxyMapCanvas
                nodes={nodes}
                onSelectNode={handleSelectNode}
                selectedNodeId={selectedNode?.node_id}
                listingPins={plotted}
                onSelectListing={handleSelectListing}
                onSelectListingGroup={handleSelectListingGroup}
                onBuyListing={handleBuyListing}
                selectedListingId={selectedPin?.listing_id}
                focusBounds={focusBounds}
                onBoundsChange={handleBoundsChange}
                liveUpdates={liveUpdates}
              />
            </div>
          </GlassCard>
        </div>

        <div className="xl:col-span-1 space-y-4">
          <GlassCard className="!p-5 space-y-4 border-border map-filters">
            <div className="text-xs font-black text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Globe size={10} /> Filters
            </div>
            <select
              aria-label="Proxy type"
              value={proxyType}
              onChange={(e) => { setProxyType(e.target.value); resetMapSelection(); }}
              className="w-full bg-secondary border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground"
            >
              <option value="">All types</option>
              <option value="residential">Residential</option>
              <option value="mobile">Mobile</option>
              <option value="datacenter">Datacenter</option>
            </select>
            <select
              aria-label="Protocol"
              value={protocol}
              onChange={(e) => { setProtocol(e.target.value); resetMapSelection(); }}
              className="w-full bg-secondary border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground"
            >
              <option value="">All protocols</option>
              <option value="http">HTTP</option>
              <option value="socks5">SOCKS5</option>
            </select>
            <select
              aria-label="Country"
              value={country}
              onChange={(e) => { setCountry(e.target.value); resetMapSelection(); }}
              className="w-full bg-secondary border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground"
            >
              <option value="">All countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                aria-label="Minimum price per GB"
                value={minPrice}
                onChange={(e) => { setMinPrice(e.target.value); resetMapSelection(); }}
                placeholder="Min price"
                className="min-w-0 bg-secondary border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground placeholder:text-muted-foreground"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                aria-label="Maximum price per GB"
                value={maxPrice}
                onChange={(e) => { setMaxPrice(e.target.value); resetMapSelection(); }}
                placeholder="Max price"
                className="min-w-0 bg-secondary border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                aria-label="Minimum uptime percent"
                value={minUptime}
                onChange={(e) => { setMinUptime(e.target.value); resetMapSelection(); }}
                placeholder="Min uptime"
                className="min-w-0 bg-secondary border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground placeholder:text-muted-foreground"
              />
              <input
                type="number"
                min="0"
                step="1"
                aria-label="Maximum latency in milliseconds"
                value={maxLatency}
                onChange={(e) => { setMaxLatency(e.target.value); resetMapSelection(); }}
                placeholder="Max ms"
                className="min-w-0 bg-secondary border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setProxyType("");
                setProtocol("");
                setCountry("");
                setMinPrice("");
                setMaxPrice("");
                setMinUptime("");
                setMaxLatency("");
                resetMapSelection();
              }}
              className="w-full py-2 rounded-xl border border-border bg-secondary text-xs font-semibold tracking-wide text-muted-foreground hover:text-foreground hover:border-border"
            >
              Reset filters
            </button>
          </GlassCard>

          {selectedCluster && selectedCluster.length > 1 ? (
            <GlassCard className="!p-6 space-y-4 border-amber-500/20 bg-amber-500/[0.02]">
              <div className="flex justify-between items-start">
                <span className="text-xs font-black text-amber-400 uppercase tracking-wide">
                  {selectedCluster.length} listings at this location
                </span>
                <button
                  type="button"
                  aria-label="Close location group"
                  onClick={() => setSelectedCluster(null)}
                  className="text-muted-foreground hover:text-foreground text-xs"
                >
                  ✕
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider leading-relaxed">
                Same node or coordinates — pick a listing below or tap one in
                the map popup.
              </p>
              <ul className="space-y-2 max-h-[280px] overflow-y-auto">
                {selectedCluster.map((p) => (
                  <li key={p.listing_id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPin(p);
                        setSelectedCluster(null);
                      }}
                      className="w-full text-left px-3 py-2.5 rounded-lg border border-border bg-secondary text-xs font-bold uppercase tracking-wide text-muted-foreground hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-foreground transition-all"
                    >
                      <span className="block truncate text-foreground">
                        {p.title}
                      </span>
                      <span className="text-muted-foreground">
                        ${p.price_per_gb.toFixed(4)}/GB ·{" "}
                        {p.uptime_percent != null
                          ? p.uptime_percent.toFixed(1) + "% up"
                          : "Uptime unavailable"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </GlassCard>
          ) : selectedPin ? (
            <GlassCard className="!p-6 space-y-4 border-emerald-500/20 bg-emerald-500/[0.02]">
              <div className="flex justify-between items-start">
                <span className="text-xs font-black text-primary uppercase tracking-wide">
                  Selected
                </span>
                <button
                  type="button"
                  aria-label="Close selected listing"
                  onClick={() => setSelectedPin(null)}
                  className="text-muted-foreground hover:text-foreground text-xs"
                >
                  ✕
                </button>
              </div>
              <h2 className="text-sm font-black text-foreground leading-tight">
                {selectedPin.title}
              </h2>
              <CatalogProductBadge
                product={selectedPin.catalog_product}
                className="mt-2"
              />
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location</span>
                  <span className="text-foreground text-right">
                    {[selectedPin.city, selectedPin.country]
                      .filter(Boolean)
                      .join(", ") || "—"}
                    <span
                      className={`block text-[11px] uppercase tracking-wider mt-0.5 ${
                        selectedPin.estimated
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-primary/80"
                      }`}
                    >
                      {geoSourceLabel(selectedPin)}
                    </span>
                  </span>
                </div>
                {selectedPin.network_class && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Network</span>
                    <span className="text-foreground capitalize">
                      {selectedPin.network_class}
                    </span>
                  </div>
                )}
                {selectedPin.trust_label && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Trust</span>
                    <span className="text-primary">
                      {selectedPin.trust_label}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Price</span>
                  <span className="text-primary font-black">
                    ${selectedPin.price_per_gb.toFixed(4)}/GB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Available</span>
                  <span className="text-foreground">
                    {selectedPin.available_bandwidth_gb.toFixed(1)} GB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">In use</span>
                  <span className="text-primary">
                    {selectedPin.active_sessions ?? "—"}
                    {selectedPin.max_concurrency
                      ? `/${selectedPin.max_concurrency}`
                      : ""}{" "}
                    buyers
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Uptime</span>
                  <span className="text-foreground">
                    {selectedPin.uptime_percent != null
                      ? selectedPin.uptime_percent.toFixed(1) + "%"
                      : "—"}
                    {selectedPin.sla_source === "gateway" && (
                      <span className="text-emerald-500/80 ml-1">
                        (gateway)
                      </span>
                    )}
                  </span>
                </div>
                {selectedPin.quality_score != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quality</span>
                    <span className="text-foreground">
                      {selectedPin.quality_score.toFixed(0)}
                    </span>
                  </div>
                )}
                {selectedPin.success_rate != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Success</span>
                    <span className="text-foreground">
                      {selectedPin.success_rate.toFixed(0)}%
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Offer proof</span>
                  <span
                    className={
                      selectedPin.listing_offer_verified
                        ? "text-primary"
                        : "text-muted-foreground"
                    }
                  >
                    {selectedPin.listing_offer_verified
                      ? "Provider signed"
                      : "Unsigned"}
                  </span>
                </div>
                {selectedPin.latency_ms != null &&
                  selectedPin.latency_ms > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Latency</span>
                      <span className="text-foreground">
                        {selectedPin.latency_ms} ms
                      </span>
                    </div>
                  )}
                {selectedPin.estimated && (
                  <p className="text-amber-400/80 text-[11px] uppercase tracking-wider pt-1">
                    Pin shows a regional hub area (major city), not an exact
                    street address.
                  </p>
                )}
                {!selectedPin.purchasable && (
                  <p className="text-rose-400/80 text-[11px] uppercase tracking-wider pt-1">
                    This listing is not currently purchasable.
                  </p>
                )}
              </div>
              <button
                type="button"
                data-testid="marketplace-map-buy-btn"
                disabled={buyLoading || !selectedPin.purchasable}
                onClick={() => handleBuy(selectedPin)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-primary text-xs font-semibold tracking-wide hover:bg-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShoppingCart size={14} />
                {buyLoading
                  ? "Loading…"
                  : selectedPin.purchasable
                    ? "Buy bandwidth"
                    : "Unavailable"}
              </button>
              {buyError?.listingId === selectedPin.listing_id && (
                <div role="alert" className="ui-error">
                  <strong>Couldn’t load purchase terms</strong>
                  <p>{buyError.message}</p>
                  <button
                    type="button"
                    disabled={buyLoading}
                    className="ui-button small secondary"
                    onClick={() => void handleBuy(selectedPin)}
                  >
                    Try again
                  </button>
                </div>
              )}
              <ListingSocialPanel
                listingId={selectedPin.listing_id}
                listingTitle={selectedPin.title}
                pricePerGb={selectedPin.price_per_gb}
                location={[selectedPin.city, selectedPin.country]
                  .filter(Boolean)
                  .join(", ")}
                compact
                className="border-emerald-500/10"
              />
              <ListingQASection
                listingId={selectedPin.listing_id}
                compact
                className="border-emerald-500/10"
              />
              <Link
                href={`/marketplace/${selectedPin.listing_id}`}
                className="block text-center text-xs font-black text-muted-foreground uppercase tracking-wide hover:text-primary"
              >
                Full listing →
              </Link>
            </GlassCard>
          ) : selectedNode ? (
            <GlassCard className="!p-6 space-y-4 border-primary/20 bg-primary/[0.02]">
              <div className="flex justify-between items-start">
                <span className="text-xs font-black text-primary uppercase tracking-wide">
                  Network node
                </span>
                <button
                  type="button"
                  aria-label="Close selected node"
                  onClick={() => setSelectedNode(null)}
                  className="text-muted-foreground hover:text-foreground text-xs"
                >
                  ✕
                </button>
              </div>
              <h2 className="text-sm font-black text-foreground leading-tight">
                {selectedNode.title ||
                  [
                    selectedNode.city,
                    selectedNode.country || selectedNode.region,
                  ]
                    .filter(Boolean)
                    .join(", ") ||
                  "Network node"}
              </h2>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Status</span>
                  <span
                    className={
                      selectedNode.is_active
                        ? "text-primary font-black"
                        : "text-rose-400 font-black"
                    }
                  >
                    {selectedNode.is_active ? "Active" : "Offline"}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Trust</span>
                  <span className="text-foreground">
                    {selectedNode.trust_label ||
                      (selectedNode.is_validator ? "High quality" : "Standard")}
                  </span>
                </div>
                {selectedNode.network_class && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Network</span>
                    <span className="text-foreground capitalize">
                      {selectedNode.network_class}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Location</span>
                  <span className="text-foreground text-right">
                    {[
                      selectedNode.city,
                      selectedNode.country || selectedNode.region,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </span>
                </div>
                {selectedNode.quality_score != null && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Quality</span>
                    <span className="text-foreground">
                      {selectedNode.quality_score.toFixed(0)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Uptime</span>
                  <span className="text-foreground">
                    {selectedNode.uptime_percent != null
                      ? selectedNode.uptime_percent.toFixed(1) + "%"
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Sessions</span>
                  <span className="text-foreground">
                    {selectedNode.active_sessions ?? "—"}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide leading-relaxed">
                Approximate hub location only. Select an emerald price marker to
                buy bandwidth.
              </p>
            </GlassCard>
          ) : (
            <GlassCard className="!p-6 text-center border-border">
              <MapPin
                size={28}
                className="mx-auto text-muted-foreground mb-2"
              />
              <p className="text-xs font-black text-muted-foreground uppercase tracking-wide">
                Select a listing or node on the map
              </p>
            </GlassCard>
          )}

          <GlassCard className="!p-4 border-border max-h-[240px] overflow-y-auto">
            <div className="text-xs font-black text-muted-foreground uppercase tracking-wide mb-3">
              In view ({viewportPins.length})
            </div>
            <ul className="space-y-2">
              {viewportPins.slice(0, 20).map((p) => (
                <li key={p.listing_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPin(p);
                      setSelectedCluster(null);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wide transition-all ${
                      selectedPin?.listing_id === p.listing_id
                        ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-border"
                    }`}
                  >
                    <span className="block truncate">{p.title}</span>
                    <span className="text-muted-foreground">
                      {[p.city, p.country].filter(Boolean).join(", ") ||
                        p.country ||
                        "—"}
                      {" · "}${p.price_per_gb.toFixed(4)}/GB
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </GlassCard>
        </div>
      </div>

      {buyError && selectedPin?.listing_id !== buyError.listingId && (
        <div role="alert" className="ui-error">
          <strong>Couldn’t load purchase terms</strong>
          <p>{buyError.message}</p>
        </div>
      )}
      {buyListing && (
        <BuyListingModal
          listing={buyListing}
          surface="map"
          onClose={() => {
            setBuyListing(null);
            setSelectedPin(null);
          }}
          onSuccess={() => {
            void refetch();
          }}
        />
      )}
    </motion.div>
  );
}
