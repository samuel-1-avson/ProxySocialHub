'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Globe, Loader2, MapPin, Search, ShoppingCart, X } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { BuyListingModal } from '@/components/BuyListingModal';
import {
    getListing,
    getMarketplaceMapPoints,
    marketplaceKeys,
    type Listing,
    type MarketplaceMapFilters,
} from '@/lib/api/marketplace';
import { bboxNearlyEqual, bboxToParam, pinInBBox, type MapBBox } from '@/lib/geo/bbox';
import type { NodeGeoPoint } from '@/lib/services/explorer';
import {
    marketplacePointToListingPin,
    marketplacePointToNode,
    type MarketplaceListingMapPin,
} from '@/lib/map/marketplace-map-adapters';

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

function geoSourceLabel(pin: MarketplaceListingMapPin) {
    switch (pin.geo_source) {
        case 'gateway':
            return 'Gateway GPS';
        case 'explorer':
            return 'Explorer GPS';
        case 'provider':
            return 'Provider node';
        case 'country_centroid':
            return 'Estimated country';
        default:
            return pin.estimated ? 'Estimated location' : 'Resolved location';
    }
}

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
    const [selectedNode, setSelectedNode] = useState<NodeGeoPoint | null>(null);
    const [buyListing, setBuyListing] = useState<Listing | null>(null);
    const [buyLoading, setBuyLoading] = useState(false);
    const [viewport, setViewport] = useState<MapBBox | null>(null);
    const [searchBBox, setSearchBBox] = useState<MapBBox | null>(null);

    useEffect(() => {
        setSearchBBox(null);
        setSelectedPin(null);
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
        active_nodes_only: false,
        bbox: bboxParam,
    }), [bboxParam, country, maxLatency, maxPrice, minPrice, minUptime, protocol, proxyType]);

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: marketplaceKeys.map(mapFilters),
        queryFn: () => getMarketplaceMapPoints(mapFilters),
        staleTime: 30_000,
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
    }, [viewport]);

    const clearAreaSearch = useCallback(() => {
        setSearchBBox(null);
    }, []);

    const pins = useMemo((): MarketplaceListingMapPin[] => {
        const raw = data?.points ?? [];
        return raw.filter(point => point.kind === 'listing').map(marketplacePointToListingPin);
    }, [data?.points]);

    const nodes = useMemo((): NodeGeoPoint[] => {
        const raw = data?.points ?? [];
        return raw.filter(point => point.kind === 'node').map(marketplacePointToNode);
    }, [data?.points]);

    const plotted = pins.filter(p => Math.abs(p.lat) > 0.01 || Math.abs(p.lon) > 0.01);

    useEffect(() => {
        if (!highlightListingId || plotted.length === 0) return;
        const pin = plotted.find(p => p.listing_id === highlightListingId);
        if (pin) {
            setSelectedPin(pin);
            setSelectedNode(null);
        }
    }, [highlightListingId, plotted]);

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
                isp: pin.isp,
                uptime_percent: pin.uptime_percent ?? 0,
                avg_latency_ms: 0,
                success_rate: 100,
                quality_score: 100,
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
                listing_offer_signer: pin.listing_offer_signer,
                listing_offer_signed_at: pin.listing_offer_signed_at,
                listing_offer_verification_error: pin.listing_offer_verification_error,
            });
        } finally {
            setBuyLoading(false);
        }
    }, []);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-8 pb-24 font-mono"
        >
            <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 border-b border-white/5 pb-8">
                <div>
                    <Link
                        href="/marketplace"
                        className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary uppercase tracking-[0.3em] mb-4"
                    >
                        <ArrowLeft size={14} /> Node Market
                    </Link>
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-3">
                        <MapPin className="text-emerald-400" size={32} />
                        Buy on Map
                    </h1>
                    <p className="text-[11px] text-white/30 uppercase tracking-widest mt-2">
                        Purchasable proxy listings by geography · click a point to buy
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
                        {viewport && (areaSearchStale || !searchBBox) && (
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
                        )}
                        {(isLoading || isFetching) && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
                                <Loader2 className="animate-spin text-primary" size={32} />
                            </div>
                        )}
                        {error && (
                            <div className="absolute top-4 left-4 z-10 px-4 py-2 bg-rose-500/10 border border-rose-500/30 rounded-xl text-[10px] text-rose-400">
                                Failed to load map data.{' '}
                                <button type="button" onClick={() => refetch()} className="underline">
                                    Retry
                                </button>
                            </div>
                        )}
                        <ProxyMapCanvas
                            nodes={nodes}
                            onSelectNode={(node) => {
                                setSelectedNode(node);
                                setSelectedPin(null);
                            }}
                            selectedNodeId={selectedNode?.node_id}
                            listingPins={plotted}
                            onSelectListing={(pin) => {
                                setSelectedPin(pin as MarketplaceListingMapPin);
                                setSelectedNode(null);
                            }}
                            selectedListingId={selectedPin?.listing_id}
                            focusBounds={focusBounds}
                            onBoundsChange={setViewport}
                        />
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

                    {selectedPin ? (
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
                                <div className="flex justify-between">
                                    <span className="text-white/30">Price</span>
                                    <span className="text-emerald-400 font-black">
                                        {selectedPin.price_per_gb.toFixed(6)} SOL/GB
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-white/30">Available</span>
                                    <span className="text-white">
                                        {selectedPin.available_bandwidth_gb.toFixed(1)} GB
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
                                <div className="flex justify-between">
                                    <span className="text-white/30">Offer proof</span>
                                    <span className={selectedPin.listing_offer_verified ? 'text-cyan-300' : 'text-white/40'}>
                                        {selectedPin.listing_offer_verified ? 'Provider signed' : 'Unsigned'}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-white/30">Heartbeat proof</span>
                                    <span className={selectedPin.heartbeat_verified ? 'text-emerald-300' : 'text-white/40'}>
                                        {selectedPin.heartbeat_verified ? 'Provider signed' : 'Unsigned'}
                                    </span>
                                </div>
                                {selectedPin.heartbeat_signer && (
                                    <div className="flex justify-between gap-3">
                                        <span className="text-white/30">Heartbeat signer</span>
                                        <span className="text-white/50 text-right truncate max-w-[160px]" title={selectedPin.heartbeat_signer}>
                                            {selectedPin.heartbeat_signer}
                                        </span>
                                    </div>
                                )}
                                {selectedPin.listing_offer_signer && (
                                    <div className="flex justify-between gap-3">
                                        <span className="text-white/30">Signer</span>
                                        <span className="text-white/50 text-right truncate max-w-[160px]" title={selectedPin.listing_offer_signer}>
                                            {selectedPin.listing_offer_signer}
                                        </span>
                                    </div>
                                )}
                                {selectedPin.latency_ms != null && selectedPin.latency_ms > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-white/30">Latency</span>
                                        <span className="text-white">{selectedPin.latency_ms} ms</span>
                                    </div>
                                )}
                                {selectedPin.estimated && (
                                    <p className="text-amber-400/80 text-[8px] uppercase tracking-wider pt-1">
                                        Approximate location (country centroid)
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
                            <h2 className="text-sm font-black text-white leading-tight break-all">
                                {selectedNode.node_id.slice(0, 24)}…
                            </h2>
                            <div className="space-y-1 text-[9px]">
                                <div className="flex justify-between gap-3">
                                    <span className="text-white/30">Status</span>
                                    <span className={selectedNode.is_active ? 'text-emerald-400 font-black' : 'text-rose-400 font-black'}>
                                        {selectedNode.is_active ? 'Active' : 'Offline'}
                                    </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                    <span className="text-white/30">Type</span>
                                    <span className="text-white">{selectedNode.is_validator ? 'Validator' : 'Proxy node'}</span>
                                </div>
                                <div className="flex justify-between gap-3">
                                    <span className="text-white/30">Location</span>
                                    <span className="text-white text-right">
                                        {[selectedNode.city, selectedNode.country || selectedNode.region].filter(Boolean).join(', ') || '—'}
                                    </span>
                                </div>
                                {selectedNode.isp && (
                                    <div className="flex justify-between gap-3">
                                        <span className="text-white/30">ISP</span>
                                        <span className="text-white text-right truncate max-w-[140px]">{selectedNode.isp}</span>
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
                            <Link
                                href={`/explorer/nodes/${selectedNode.node_id}`}
                                className="block w-full text-center py-2 rounded-xl bg-primary/15 border border-primary/35 text-primary text-[9px] font-black uppercase tracking-widest hover:bg-primary/25 transition-all"
                            >
                                Node details →
                            </Link>
                            <p className="text-[8px] text-white/25 uppercase tracking-widest leading-relaxed">
                                Node markers show network availability. Select an emerald price marker to buy bandwidth.
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
                                        onClick={() => setSelectedPin(p)}
                                        className={`w-full text-left px-3 py-2 rounded-lg border text-[9px] font-bold uppercase tracking-wide transition-all ${
                                            selectedPin?.listing_id === p.listing_id
                                                ? 'border-emerald-500/40 bg-emerald-500/10 text-white'
                                                : 'border-white/5 bg-white/[0.02] text-white/60 hover:border-white/15'
                                        }`}
                                    >
                                        <span className="block truncate">{p.title}</span>
                                        <span className="text-white/30">
                                            {p.country} · {p.price_per_gb.toFixed(6)} SOL
                                            {p.estimated ? ' · est.' : ' · gps'}
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
