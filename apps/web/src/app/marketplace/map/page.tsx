'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Globe, Loader2, MapPin, Search, ShoppingCart, X } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { BuyListingModal } from '@/components/BuyListingModal';
import { CatalogProductBadge } from '@/components/marketplace/CatalogProductBadge';
import { ListingSocialPanel } from '@/components/marketplace/ListingSocialPanel';
import { ListingQASection } from '@/components/marketplace/ListingQASection';
import { MarketplaceDiscoverTabs } from '@/components/marketplace/MarketplaceDiscoverTabs';
import {
    getListing,
    type Listing,
    type MarketplaceMapFilters,
} from '@/lib/api/marketplace';
import { mapLiveOnMarketplaceEnabled } from '@/lib/feature-flags';
import { useMapPoints } from '@/lib/hooks/useMapPoints';
import { bboxNearlyEqual, bboxToParam, pinInBBox, type MapBBox } from '@/lib/geo/bbox';
import type { NodeGeoPoint } from '@/lib/services/explorer';
import type { MarketplaceListingMapPin } from '@/lib/map/marketplace-map-adapters';
import { geoSourceLabel } from '@/lib/map/geo-labels';
import type { ExplorerListingPin } from '@/components/map/types';

const ProxyMapCanvas = dynamic(
    () => import('@/components/map/ProxyMapCanvas'),
    {
        ssr: false,
        loading: () => (
            <div className="w-full h-full min-h-[480px] flex items-center justify-center bg-[#050508] rounded-[2rem]">
                <span className="text-[10px] font-black text-white/20 uppercase tracking-widest animate-pulse">
                    Loading map…
                </span>
            </div>
        ),
    },
);

export default function MarketplaceMapPage() {
    const searchParams = useSearchParams();
    const highlightListingId = searchParams.get('listing');
    const [proxyType, setProxyType] = useState('');
    const [protocol, setProtocol] = useState('');
    const [country, setCountry] = useState('');
    const [minPrice, setMinPrice] = useState('');
    const [maxPrice, setMaxPrice] = useState('');
    const [minUptime, setMinUptime] = useState('');
    const [maxLatency, setMaxLatency] = useState('');
    const [selectedPin, setSelectedPin] = useState<MarketplaceListingMapPin | null>(null);
    const [selectedCluster, setSelectedCluster] = useState<MarketplaceListingMapPin[] | null>(null);
    const [selectedNode, setSelectedNode] = useState<NodeGeoPoint | null>(null);
    const [buyListing, setBuyListing] = useState<Listing | null>(null);
    const [buyLoading, setBuyLoading] = useState(false);
    const [viewport, setViewport] = useState<MapBBox | null>(null);
    const [searchBBox, setSearchBBox] = useState<MapBBox | null>(null);

    useEffect(() => {
        setSearchBBox(null);
        setSelectedPin(null);
        setSelectedCluster(null);
        setSelectedNode(null);
    }, [proxyType, protocol, country, minPrice, maxPrice, minUptime, maxLatency]);

    const bboxParam = searchBBox ? bboxToParam(searchBBox) : undefined;
    const mapFilters = useMemo<MarketplaceMapFilters>(() => ({
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
    }), [bboxParam, country, maxLatency, maxPrice, minPrice, minUptime, protocol, proxyType]);

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
        setViewport(prev => (prev && bboxNearlyEqual(prev, bounds) ? prev : bounds));
    }, []);

    const pins = mapListingPins;
    const nodes = mapNodes;

    const plotted = useMemo(
        () => pins.filter(p => Math.abs(p.lat) > 0.01 || Math.abs(p.lon) > 0.01),
        [pins],
    );

    useEffect(() => {
        if (!highlightListingId || plotted.length === 0) return;
        const pin = plotted.find(p => p.listing_id === highlightListingId);
        if (!pin) return;
        setSelectedPin(prev => {
            if (prev?.listing_id === pin.listing_id) return prev;
            return pin;
        });
    }, [highlightListingId, plotted]);

    // When deep-linking to a listing, clear competing selection once on first highlight.
    useEffect(() => {
        if (!highlightListingId) return;
        setSelectedCluster(null);
        setSelectedNode(null);
    }, [highlightListingId]);

    const viewportPins = useMemo(() => {
        if (!viewport) return plotted;
        return plotted.filter(p => pinInBBox(p.lat, p.lon, viewport));
    }, [plotted, viewport]);
    const countries = useMemo(() => {
        const set = new Set<string>();
        for (const p of pins) {
            if (p.country) set.add(p.country);
        }
        return Array.from(set).sort();
    }, [pins]);

    const focusBounds = useMemo((): [[number, number], [number, number]] | null => {
        if (!country || plotted.length === 0) return null;
        const lats = plotted.map(p => p.lat);
        const lons = plotted.map(p => p.lon);
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
        try {
            const res = await getListing(pin.listing_id);
            setBuyListing(res.listing);
        } catch {
            setBuyListing({
                id: pin.listing_id,
                seller_id: pin.seller_id ?? '',
                node_id: pin.node_id ?? '',
                title: pin.title,
                description: '',
                price_per_gb: pin.price_per_gb,
                min_purchase_gb: 1,
                available_bandwidth_gb: pin.available_bandwidth_gb,
                max_concurrency: 5,
                proxy_type: pin.proxy_type as Listing['proxy_type'],
                protocol: pin.protocol ?? 'http',
                status: pin.status ?? 'active',
                country: pin.country,
                uptime_percent: pin.uptime_percent ?? 0,
                avg_latency_ms: pin.latency_ms ?? 0,
                success_rate: pin.success_rate ?? 0,
                quality_score: pin.quality_score ?? 0,
                views_count: 0,
                saves_count: 0,
                orders_count: 0,
                total_sales: 0,
                rating: 0,
                staked_amount: 0,
                priority_rank: 0,
                is_priority: false,
                created_at: new Date().toISOString(),
                listing_offer_verified: pin.listing_offer_verified,
            });
        } finally {
            setBuyLoading(false);
        }
    }, []);

    const handleBuyListing = useCallback((pin: ExplorerListingPin) => {
        void handleBuy(pin as MarketplaceListingMapPin);
    }, [handleBuy]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-8 pb-24 font-mono"
        >
            <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 border-b border-white/5 pb-8">
                <div>
                    <div className="flex flex-wrap items-center gap-4 mb-4">
                        <MarketplaceDiscoverTabs />
                        <Link
                            href="/community/feed"
                            className="text-[10px] font-black text-white/25 hover:text-primary uppercase tracking-[0.3em]"
                        >
                            Community feed →
                        </Link>
                    </div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-3">
                        <MapPin className="text-emerald-400" size={32} />
                        Marketplace map
                    </h1>
                    <p className="text-[11px] text-white/30 uppercase tracking-widest mt-2">
                        Geographic view of purchasable proxies · click a pin to buy on the map
                        {searchBBox && (
                            <span className="text-amber-400/90"> · area filter on</span>
                        )}
                    </p>
                </div>
                <div className="flex gap-3 flex-wrap">
                    <GlassCard className="!p-4 min-w-[80px] text-center">
                        <div className="text-xl font-black text-white">{data?.listing_count ?? pins.length}</div>
                        <div className="text-[8px] text-white/30 uppercase tracking-widest">Listings</div>
                    </GlassCard>
                    <GlassCard className="!p-4 min-w-[80px] text-center">
                        <div className="text-xl font-black text-emerald-400">{plotted.length}</div>
                        <div className="text-[8px] text-white/30 uppercase tracking-widest">On map</div>
                    </GlassCard>
                    <GlassCard className="!p-4 min-w-[80px] text-center">
                        <div className="text-xl font-black text-primary">{data?.node_count ?? 0}</div>
                        <div className="text-[8px] text-white/30 uppercase tracking-widest">Nodes</div>
                    </GlassCard>
                </div>
            </header>

            <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
                <div className="xl:col-span-3 relative">
                    <GlassCard className="!p-0 overflow-hidden border-white/5 min-h-[520px]">
                        {viewport != null && (areaSearchStale || !searchBBox) ? (
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex gap-2">
                                <button
                                    type="button"
                                    onClick={searchThisArea}
                                    disabled={isFetching}
                                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-[10px] font-black uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/30 shadow-lg disabled:opacity-50"
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
                                        className="flex items-center gap-1 px-3 py-2 rounded-full bg-white/5 border border-white/15 text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white"
                                        title="Show all listings"
                                    >
                                        <X size={12} />
                                        Clear
                                    </button>
                                )}
                            </div>
                        ) : null}
                        {(isLoading && !data) && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
                                <Loader2 className="animate-spin text-primary" size={32} />
                            </div>
                        )}
                        {isFetching && data ? (
                            <div className="absolute top-4 right-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 border border-white/10 pointer-events-none">
                                <Loader2 className="animate-spin text-emerald-400" size={12} />
                                <span className="text-[9px] font-black uppercase tracking-widest text-white/50">Updating…</span>
                            </div>
                        ) : null}
                        {error != null ? (
                            <div className="absolute top-4 left-4 z-10 px-4 py-2 bg-rose-500/10 border border-rose-500/30 rounded-xl text-[10px] text-rose-400">
                                Failed to load map data.{' '}
                                <button type="button" onClick={() => refetch()} className="underline">
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
                    <GlassCard className="!p-5 space-y-4 border-white/5">
                        <div className="text-[9px] font-black text-white/40 uppercase tracking-widest flex items-center gap-2">
                            <Globe size={10} /> Filters
                        </div>
                        <select
                            value={proxyType}
                            onChange={e => setProxyType(e.target.value)}
                            className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2 text-[10px] font-black uppercase text-white"
                        >
                            <option value="">All types</option>
                            <option value="residential">Residential</option>
                            <option value="mobile">Mobile</option>
                            <option value="datacenter">Datacenter</option>
                        </select>
                        <select
                            value={protocol}
                            onChange={e => setProtocol(e.target.value)}
                            className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2 text-[10px] font-black uppercase text-white"
                        >
                            <option value="">All protocols</option>
                            <option value="http">HTTP</option>
                            <option value="socks5">SOCKS5</option>
                        </select>
                        <select
                            value={country}
                            onChange={e => setCountry(e.target.value)}
                            className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2 text-[10px] font-black uppercase text-white"
                        >
                            <option value="">All countries</option>
                            {countries.map(c => (
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
                                value={minPrice}
                                onChange={e => setMinPrice(e.target.value)}
                                placeholder="Min price"
                                className="min-w-0 bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2 text-[10px] font-black uppercase text-white placeholder:text-white/20"
                            />
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={maxPrice}
                                onChange={e => setMaxPrice(e.target.value)}
                                placeholder="Max price"
                                className="min-w-0 bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2 text-[10px] font-black uppercase text-white placeholder:text-white/20"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="1"
                                value={minUptime}
                                onChange={e => setMinUptime(e.target.value)}
                                placeholder="Min uptime"
                                className="min-w-0 bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2 text-[10px] font-black uppercase text-white placeholder:text-white/20"
                            />
                            <input
                                type="number"
                                min="0"
                                step="1"
                                value={maxLatency}
                                onChange={e => setMaxLatency(e.target.value)}
                                placeholder="Max ms"
                                className="min-w-0 bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2 text-[10px] font-black uppercase text-white placeholder:text-white/20"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setProxyType('');
                                setProtocol('');
                                setCountry('');
                                setMinPrice('');
                                setMaxPrice('');
                                setMinUptime('');
                                setMaxLatency('');
                                setSearchBBox(null);
                            }}
                            className="w-full py-2 rounded-xl border border-white/10 bg-white/[0.03] text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-white hover:border-white/20"
                        >
                            Reset filters
                        </button>
                    </GlassCard>

                    {selectedCluster && selectedCluster.length > 1 ? (
                        <GlassCard className="!p-6 space-y-4 border-amber-500/20 bg-amber-500/[0.02]">
                            <div className="flex justify-between items-start">
                                <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">
                                    {selectedCluster.length} listings at this location
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setSelectedCluster(null)}
                                    className="text-white/20 hover:text-white text-xs"
                                >
                                    ✕
                                </button>
                            </div>
                            <p className="text-[8px] text-white/35 uppercase tracking-wider leading-relaxed">
                                Same node or coordinates — pick a listing below or tap one in the map popup.
                            </p>
                            <ul className="space-y-2 max-h-[280px] overflow-y-auto">
                                {selectedCluster.map(p => (
                                    <li key={p.listing_id}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedPin(p);
                                                setSelectedCluster(null);
                                            }}
                                            className="w-full text-left px-3 py-2.5 rounded-lg border border-white/10 bg-white/[0.03] text-[9px] font-bold uppercase tracking-wide text-white/70 hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-white transition-all"
                                        >
                                            <span className="block truncate text-white">{p.title}</span>
                                            <span className="text-white/35">
                                                ${p.price_per_gb.toFixed(4)}/GB · {(p.uptime_percent || 0).toFixed(1)}% up
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </GlassCard>
                    ) : selectedPin ? (
                        <GlassCard className="!p-6 space-y-4 border-emerald-500/20 bg-emerald-500/[0.02]">
                            <div className="flex justify-between items-start">
                                <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">
                                    Selected
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setSelectedPin(null)}
                                    className="text-white/20 hover:text-white text-xs"
                                >
                                    ✕
                                </button>
                            </div>
                            <h2 className="text-sm font-black text-white leading-tight">{selectedPin.title}</h2>
                            <CatalogProductBadge product={selectedPin.catalog_product} className="mt-2" />
                            <div className="space-y-1 text-[9px]">
                                <div className="flex justify-between">
                                    <span className="text-white/30">Location</span>
                                    <span className="text-white text-right">
                                        {[selectedPin.city, selectedPin.country].filter(Boolean).join(', ') || '—'}
                                        <span
                                            className={`block text-[8px] uppercase tracking-wider mt-0.5 ${
                                                selectedPin.estimated ? 'text-amber-400/90' : 'text-emerald-400/80'
                                            }`}
                                        >
                                            {geoSourceLabel(selectedPin)}
                                        </span>
                                    </span>
                                </div>
                                {selectedPin.network_class && (
                                    <div className="flex justify-between">
                                        <span className="text-white/30">Network</span>
                                        <span className="text-white capitalize">{selectedPin.network_class}</span>
                                    </div>
                                )}
                                {selectedPin.trust_label && (
                                    <div className="flex justify-between">
                                        <span className="text-white/30">Trust</span>
                                        <span className="text-cyan-300">{selectedPin.trust_label}</span>
                                    </div>
                                )}
                                <div className="flex justify-between">
                                    <span className="text-white/30">Price</span>
                                    <span className="text-emerald-400 font-black">
                                        ${selectedPin.price_per_gb.toFixed(4)}/GB
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-white/30">Available</span>
                                    <span className="text-white">
                                        {selectedPin.available_bandwidth_gb.toFixed(1)} GB
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-white/30">In use</span>
                                    <span className="text-emerald-400">
                                        {selectedPin.active_sessions || 0}
                                        {selectedPin.max_concurrency ? `/${selectedPin.max_concurrency}` : ''} buyers
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-white/30">Uptime</span>
                                    <span className="text-white">
                                        {(selectedPin.uptime_percent || 0).toFixed(1)}%
                                        {selectedPin.sla_source === 'gateway' && (
                                            <span className="text-emerald-500/80 ml-1">(live)</span>
                                        )}
                                    </span>
                                </div>
                                {selectedPin.quality_score != null && (
                                    <div className="flex justify-between">
                                        <span className="text-white/30">Quality</span>
                                        <span className="text-white">{selectedPin.quality_score.toFixed(0)}</span>
                                    </div>
                                )}
                                {selectedPin.success_rate != null && (
                                    <div className="flex justify-between">
                                        <span className="text-white/30">Success</span>
                                        <span className="text-white">{selectedPin.success_rate.toFixed(0)}%</span>
                                    </div>
                                )}
                                <div className="flex justify-between">
                                    <span className="text-white/30">Offer proof</span>
                                    <span className={selectedPin.listing_offer_verified ? 'text-cyan-300' : 'text-white/40'}>
                                        {selectedPin.listing_offer_verified ? 'Provider signed' : 'Unsigned'}
                                    </span>
                                </div>
                                {selectedPin.latency_ms != null && selectedPin.latency_ms > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-white/30">Latency</span>
                                        <span className="text-white">{selectedPin.latency_ms} ms</span>
                                    </div>
                                )}
                                {selectedPin.estimated && (
                                    <p className="text-amber-400/80 text-[8px] uppercase tracking-wider pt-1">
                                        Pin shows a regional hub area (major city), not an exact street address.
                                    </p>
                                )}
                                {!selectedPin.purchasable && (
                                    <p className="text-rose-400/80 text-[8px] uppercase tracking-wider pt-1">
                                        This listing is not currently purchasable.
                                    </p>
                                )}
                            </div>
                            <button
                                type="button"
                                data-testid="marketplace-map-buy-btn"
                                disabled={buyLoading || !selectedPin.purchasable}
                                onClick={() => handleBuy(selectedPin)}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <ShoppingCart size={14} />
                                {buyLoading ? 'Loading…' : selectedPin.purchasable ? 'Buy bandwidth' : 'Unavailable'}
                            </button>
                            <ListingSocialPanel
                                listingId={selectedPin.listing_id}
                                listingTitle={selectedPin.title}
                                pricePerGb={selectedPin.price_per_gb}
                                location={[selectedPin.city, selectedPin.country].filter(Boolean).join(', ')}
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
                                className="block text-center text-[9px] font-black text-white/40 uppercase tracking-widest hover:text-primary"
                            >
                                Full listing →
                            </Link>
                        </GlassCard>
                    ) : selectedNode ? (
                        <GlassCard className="!p-6 space-y-4 border-primary/20 bg-primary/[0.02]">
                            <div className="flex justify-between items-start">
                                <span className="text-[9px] font-black text-primary uppercase tracking-widest">
                                    Network node
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setSelectedNode(null)}
                                    className="text-white/20 hover:text-white text-xs"
                                >
                                    ✕
                                </button>
                            </div>
                            <h2 className="text-sm font-black text-white leading-tight">
                                {selectedNode.title
                                    || [selectedNode.city, selectedNode.country || selectedNode.region].filter(Boolean).join(', ')
                                    || 'Network node'}
                            </h2>
                            <div className="space-y-1 text-[9px]">
                                <div className="flex justify-between gap-3">
                                    <span className="text-white/30">Status</span>
                                    <span className={selectedNode.is_active ? 'text-emerald-400 font-black' : 'text-rose-400 font-black'}>
                                        {selectedNode.is_active ? 'Active' : 'Offline'}
                                    </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                    <span className="text-white/30">Trust</span>
                                    <span className="text-white">
                                        {selectedNode.trust_label
                                            || (selectedNode.is_validator ? 'High quality' : 'Standard')}
                                    </span>
                                </div>
                                {selectedNode.network_class && (
                                    <div className="flex justify-between gap-3">
                                        <span className="text-white/30">Network</span>
                                        <span className="text-white capitalize">{selectedNode.network_class}</span>
                                    </div>
                                )}
                                <div className="flex justify-between gap-3">
                                    <span className="text-white/30">Location</span>
                                    <span className="text-white text-right">
                                        {[selectedNode.city, selectedNode.country || selectedNode.region].filter(Boolean).join(', ') || '—'}
                                    </span>
                                </div>
                                {selectedNode.quality_score != null && (
                                    <div className="flex justify-between gap-3">
                                        <span className="text-white/30">Quality</span>
                                        <span className="text-white">{selectedNode.quality_score.toFixed(0)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between gap-3">
                                    <span className="text-white/30">Uptime</span>
                                    <span className="text-white">{(selectedNode.uptime_percent || 0).toFixed(1)}%</span>
                                </div>
                                <div className="flex justify-between gap-3">
                                    <span className="text-white/30">Sessions</span>
                                    <span className="text-white">{selectedNode.active_sessions || 0}</span>
                                </div>
                            </div>
                            <p className="text-[8px] text-white/25 uppercase tracking-widest leading-relaxed">
                                Approximate hub location only. Select an emerald price marker to buy bandwidth.
                            </p>
                        </GlassCard>
                    ) : (
                        <GlassCard className="!p-6 text-center border-white/5">
                            <MapPin size={28} className="mx-auto text-white/10 mb-2" />
                            <p className="text-[9px] font-black text-white/25 uppercase tracking-widest">
                                Select a listing or node on the map
                            </p>
                        </GlassCard>
                    )}

                    <GlassCard className="!p-4 border-white/5 max-h-[240px] overflow-y-auto">
                        <div className="text-[9px] font-black text-white/40 uppercase tracking-widest mb-3">
                            In view ({viewportPins.length})
                        </div>
                        <ul className="space-y-2">
                            {viewportPins.slice(0, 20).map(p => (
                                <li key={p.listing_id}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedPin(p);
                                            setSelectedCluster(null);
                                        }}
                                        className={`w-full text-left px-3 py-2 rounded-lg border text-[9px] font-bold uppercase tracking-wide transition-all ${
                                            selectedPin?.listing_id === p.listing_id
                                                ? 'border-emerald-500/40 bg-emerald-500/10 text-white'
                                                : 'border-white/5 bg-white/[0.02] text-white/60 hover:border-white/15'
                                        }`}
                                    >
                                        <span className="block truncate">{p.title}</span>
                                        <span className="text-white/30">
                                            {[p.city, p.country].filter(Boolean).join(', ') || p.country || '—'}
                                            {' · '}
                                            ${p.price_per_gb.toFixed(4)}/GB
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </GlassCard>
                </div>
            </div>

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
