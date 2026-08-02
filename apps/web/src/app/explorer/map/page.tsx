'use client';

/**
 * Node Map Page — Proxy Explorer
 *
 * Data flow:
 *  1. GET /v1/marketplace/map?include_nodes=true → server-resolved nodes + listings
 *  2. WS  /v1/explorer/ws                        → node_update events
 *  3. Google Maps 2D / tilt-3D (roadmap only; no satellite)
 *  4. Optional in-map buy                        → NEXT_PUBLIC_EXPLORER_MAP_BUY_ENABLED
 *  5. Legacy WebGL globe only if NEXT_PUBLIC_LEGACY_EXPLORER_GLOBE
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { BuyListingModal } from '@/components/BuyListingModal';
import type { NodeGeoPoint } from '@/lib/services/explorer';
import { useMapPoints } from '@/lib/hooks/useMapPoints';
import { useMapLinks } from '@/lib/hooks/useMapLinks';
import { globeTopologyEnabled, legacyExplorerGlobeEnabled } from '@/lib/feature-flags';
import type { ExplorerListingPin, MapViewMode } from '@/components/map/types';
import { geoSourceLabel } from '@/lib/map/geo-labels';
import {
    getListing,
    type Listing,
    type MarketplaceMapFilters,
} from '@/lib/api/marketplace';
import type { MarketplaceListingMapPin } from '@/lib/map/marketplace-map-adapters';
import { ListingSlaBadge } from '@/components/marketplace/ListingSlaBadge';
import { ROUTES } from '@/lib/navigation/routes';
import { explorerMapBuyEnabled } from '@/lib/navigation/explorer-nav';
import { bboxNearlyEqual, bboxToParam, type MapBBox } from '@/lib/geo/bbox';
import type { MapStyle } from './GlobeMap';
import {
    ArrowLeft, Globe, MapPin, Server, Shield,
    Radio, Activity, RefreshCw, Layers, Zap, Map,
    Search, ShoppingCart, Loader2,
} from 'lucide-react';
import { motion } from 'framer-motion';

const GlobeMap = dynamic(() => import('./GlobeMap'), {
    ssr: false,
    loading: () => (
        <div className="w-full h-full flex items-center justify-center bg-[#050508]">
            <div className="text-[10px] font-black text-white/20 uppercase tracking-widest animate-pulse">
                Initialising 3D globe…
            </div>
        </div>
    ),
});

const MapCanvas = dynamic(() => import('@/components/map/ProxyMapCanvas'), {
    ssr: false,
    loading: () => (
        <div className="w-full h-full flex items-center justify-center bg-[#050508]">
            <div className="text-[10px] font-black text-white/20 uppercase tracking-widest animate-pulse">
                Initialising map…
            </div>
        </div>
    ),
});

// ─── Animations ───────────────────────────────────────────────────────────────

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NodeMapPage() {
    const [mounted, setMounted] = useState(false);
    const [selectedNode, setSelectedNode] = useState<NodeGeoPoint | null>(null);
    const [selectedListing, setSelectedListing] = useState<ExplorerListingPin | null>(null);
    const [showListingsLayer, setShowListingsLayer] = useState(true);
    const [showValidatorsOnly, setShowValidatorsOnly] = useState(false);
    const [showActiveOnly, setShowActiveOnly] = useState(false);
    const [selectedRegion, setSelectedRegion] = useState<string>('all');
    const [showHeatmap, setShowHeatmap] = useState(false);
    const [mapStyle, setMapStyle] = useState<MapStyle>('minimal');
    const legacyGlobe = legacyExplorerGlobeEnabled();
    const [mapMode, setMapMode] = useState<'globe' | 'map'>('map');
    const [viewMode, setViewMode] = useState<MapViewMode>('2d');
    const [searchQuery, setSearchQuery] = useState('');
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [viewport, setViewport] = useState<MapBBox | null>(null);
    const [searchBBox, setSearchBBox] = useState<MapBBox | null>(null);
    const [buyListing, setBuyListing] = useState<Listing | null>(null);
    const [buyLoading, setBuyLoading] = useState(false);
    const mapBuyEnabled = explorerMapBuyEnabled();
    const showLegacyGlobe = legacyGlobe && mapMode === 'globe';
    /** Listings on Google/Leaflet canvas (not legacy globe checkout path). */
    const listingsPlottedOnMap = showListingsLayer && !showLegacyGlobe;

    const toggleListingsLayer = useCallback(() => {
        setShowListingsLayer((on) => !on);
    }, []);

    useEffect(() => { setMounted(true); }, []);

    const bboxParam = searchBBox ? bboxToParam(searchBBox) : undefined;
    const mapListingFilters = useMemo<MarketplaceMapFilters>(() => ({
        purchasable_only: false,
        include_nodes: true,
        active_nodes_only: showActiveOnly,
        validator: showValidatorsOnly ? true : undefined,
        bbox: bboxParam,
    }), [bboxParam, showActiveOnly, showValidatorsOnly]);

    const {
        nodes: mapNodes,
        listingPins,
        isLoading,
        isFetching: mapFetching,
        error,
        refetch: refetchMap,
        liveUpdates,
        wsConnected,
        data: marketplaceMapData,
    } = useMapPoints({
        filters: mapListingFilters,
        enabled: mounted,
        showListings: showListingsLayer,
        live: true,
        includeCatalog: false,
        refetchInterval: searchBBox ? false : 60_000,
    });

    const topologyFlagOn = globeTopologyEnabled();
    const { links: topologyLinks, topologyAvailable } = useMapLinks({
        enabled: mounted && showLegacyGlobe && topologyFlagOn,
        live: mounted && showLegacyGlobe && topologyFlagOn,
        refetchInterval: 60_000,
    });

    const areaSearchStale = useMemo(() => {
        if (!viewport) return false;
        if (!searchBBox) return true;
        return !bboxNearlyEqual(viewport, searchBBox);
    }, [viewport, searchBBox]);

    const searchThisArea = useCallback(() => {
        if (!viewport) return;
        setSearchBBox(viewport);
        setSelectedListing(null);
    }, [viewport]);

    const clearAreaSearch = useCallback(() => {
        setSearchBBox(null);
    }, []);

    useEffect(() => {
        if (isLoading) return;
        if (marketplaceMapData) setLastUpdated(new Date());
    }, [marketplaceMapData, isLoading]);

    const nodes = useMemo(() => {
        let list = mapNodes;
        if (selectedRegion !== 'all') {
            list = list.filter(n =>
                n.region === selectedRegion || n.country === selectedRegion
            );
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            list = list.filter(n =>
                n.node_id.toLowerCase().includes(q) ||
                n.city?.toLowerCase().includes(q) ||
                n.country?.toLowerCase().includes(q) ||
                n.isp?.toLowerCase().includes(q)
            );
        }
        return list;
    }, [mapNodes, selectedRegion, searchQuery]);

    const totalActive = nodes.filter(n => n.is_active).length;
    const totalValidator = nodes.filter(n => n.is_validator).length;
    const mappedCount = nodes.filter(n => Math.abs(n.lat) > 0.01 || Math.abs(n.lon) > 0.01).length;
    const unmapped = nodes.length - mappedCount;

    // ── Auto-zoom bounds when a region is selected ──
    const focusBounds = useMemo((): [[number, number], [number, number]] | null => {
        if (selectedRegion === 'all') return null;
        const inBounds = nodes.filter(n => Math.abs(n.lat) > 0.01 || Math.abs(n.lon) > 0.01);
        if (inBounds.length === 0) return null;
        const lats = inBounds.map(n => n.lat);
        const lons = inBounds.map(n => n.lon);
        return [
            [Math.min(...lats) - 3, Math.min(...lons) - 3],
            [Math.max(...lats) + 3, Math.max(...lons) + 3],
        ];
    }, [nodes, selectedRegion]);

    // ── Region breakdown ──
    const regionBreakdownSource = mapNodes;

    const regionBreakdown = useMemo(() => {
        const acc: Record<string, number> = {};
        for (const n of regionBreakdownSource) {
            const k = n.region || n.country || 'Unknown';
            acc[k] = (acc[k] || 0) + 1;
        }
        return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 12);
    }, [regionBreakdownSource]);

    const regionBreakdownTotal = regionBreakdownSource.length || 1;

    const handleSelectNode = useCallback((node: NodeGeoPoint) => {
        setSelectedNode(node);
        setSelectedListing(null);
    }, []);

    const handleSelectListing = useCallback((pin: ExplorerListingPin) => {
        setSelectedListing(pin as MarketplaceListingMapPin);
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
                proxy_type: (pin.proxy_type ?? 'residential') as Listing['proxy_type'],
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
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-8 font-mono">

            {/* ── Header ── */}
            <motion.header variants={item} className="flex flex-col gap-6 border-b border-white/5 pb-8">
                <div className="flex flex-wrap items-center gap-4">
                    <Link href="/explorer" className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary transition-colors uppercase tracking-[0.3em] w-fit">
                        <ArrowLeft size={14} /> Back to Grid
                    </Link>
                    <Link href={ROUTES.marketplaceMap} className="flex items-center gap-2 text-[10px] font-black text-emerald-400/80 hover:text-emerald-400 transition-colors uppercase tracking-[0.3em] w-fit">
                        Buy on map →
                    </Link>
                </div>
                {!mapBuyEnabled && (
                    <div
                        role="status"
                        className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-100/90"
                    >
                        <div className="flex items-start gap-2 flex-1">
                            <Search size={14} className="mt-0.5 shrink-0 text-amber-400" aria-hidden />
                            <p>
                                <span className="font-black uppercase tracking-wider text-amber-300">Discovery map.</span>{' '}
                                Browse nodes and listing pins here. To purchase bandwidth with wallet checkout, use the{' '}
                                <Link href={ROUTES.marketplaceMap} className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2">
                                    marketplace map
                                </Link>
                                .
                            </p>
                        </div>
                        <Link
                            href={ROUTES.marketplaceMap}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/25 transition-colors shrink-0"
                        >
                            <ShoppingCart size={12} aria-hidden />
                            Open marketplace map
                        </Link>
                    </div>
                )}
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
                    <div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">
                            Grid Telemetry // {showLegacyGlobe ? '3D Globe' : viewMode === '3d' ? '3D Map' : '2D Map'}
                        </div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-4">
                            {showLegacyGlobe ? <Globe className="text-primary" size={32} /> : <MapPin className="text-primary" size={32} />}
                            {showLegacyGlobe ? 'Node Globe' : viewMode === '3d' ? 'Network 3D Map' : 'Network Wide Map'}
                        </h1>
                        <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mt-2">
                            {showLegacyGlobe
                                ? 'Legacy WebGL globe · prefer Google 2D/3D for production'
                                : viewMode === '3d'
                                    ? 'Live relay nodes · Google Maps tilt-3D · minimal vector roadmap'
                                    : 'Live relay nodes · Google Maps 2D · minimal vector roadmap'}
                        </p>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        {([
                            { label: 'Total', value: nodes.length, color: 'text-white' },
                            { label: 'Active', value: totalActive, color: 'text-emerald-400' },
                            { label: 'Validators', value: totalValidator, color: 'text-purple-400' },
                            { label: 'Plotted', value: mappedCount, color: 'text-primary' },
                            ...(showListingsLayer
                                ? [{
                                    label: 'Listings',
                                    value: listingPins.length,
                                    color: 'text-emerald-400',
                                    testId: 'explorer-map-stat-listings',
                                }]
                                : []),
                        ] as Array<{ label: string; value: number; color: string; testId?: string }>).map(s => (
                            <GlassCard key={s.label} className="!p-4 border-white/5 bg-white/[0.01] rounded-2xl text-center min-w-[72px]">
                                <div className={`text-xl font-black ${s.color}`} data-testid={s.testId}>{s.value}</div>
                                <div className="text-[8px] font-black text-white/30 uppercase tracking-widest mt-0.5">{s.label}</div>
                            </GlassCard>
                        ))}
                    </div>
                </div>

                {/* Status bar */}
                <div className="flex items-center gap-4 text-[9px] font-bold uppercase tracking-wider flex-wrap">
                    <div className={`flex items-center gap-2 ${error ? 'text-rose-400' : isLoading ? 'text-amber-400' : 'text-emerald-400'}`}>
                        <div className={`w-2 h-2 rounded-full ${error ? 'bg-rose-500 animate-pulse' : isLoading ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                        {error ? 'Disconnected' : isLoading ? 'Syncing…' : 'Live'}
                    </div>
                    <div
                        className={`flex items-center gap-2 ${wsConnected ? 'text-blue-400' : 'text-white/20'}`}
                        data-testid="explorer-map-ws-status"
                    >
                        <Zap size={9} /> {wsConnected ? 'WS Connected' : 'WS Connecting…'}
                    </div>
                    <div className="flex items-center gap-2 text-emerald-400/80" data-testid="explorer-map-live-active">
                        <Activity size={9} /> {totalActive} live active
                    </div>
                    {lastUpdated && (
                        <span className="text-white/20" data-testid="explorer-map-updated">
                            Updated {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}
                    <button onClick={() => refetchMap()} className="flex items-center gap-1.5 text-white/20 hover:text-primary transition-colors">
                        <RefreshCw size={10} /> Refresh
                    </button>
                </div>
            </motion.header>

            {/* ── Map + Sidebar ── */}
            <motion.div variants={item} className="grid grid-cols-1 xl:grid-cols-4 gap-6">

                {/* Map */}
                <div className="xl:col-span-3">
                    <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] overflow-hidden !p-0">
                        {/* Toolbar */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-3 border-b border-white/5 gap-3 flex-wrap">
                            <div className="flex items-center gap-3">
                                <Radio size={13} className={`text-primary ${isLoading ? 'animate-pulse' : ''}`} />
                                <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">
                                    {isLoading
                                        ? 'Fetching nodes…'
                                        : error
                                            ? 'Load failed'
                                            : `${mappedCount} of ${nodes.length} nodes plotted`}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    value={selectedRegion}
                                    onChange={e => setSelectedRegion(e.target.value)}
                                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[9px] font-bold text-white/70 uppercase tracking-wider focus:outline-none focus:border-primary/50"
                                >
                                    <option value="all">All Regions</option>
                                    {regionBreakdown.map(([r]) => <option key={r} value={r}>{r}</option>)}
                                </select>
                                <button
                                    onClick={() => setShowValidatorsOnly(v => !v)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-bold uppercase tracking-wider transition-all ${showValidatorsOnly ? 'bg-purple-500/20 border-purple-500/50 text-purple-400' : 'bg-white/5 border-white/10 text-white/50 hover:text-white/70'}`}
                                >
                                    <Shield size={9} /> Validators
                                </button>
                                <button
                                    onClick={() => setShowActiveOnly(v => !v)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-bold uppercase tracking-wider transition-all ${showActiveOnly ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-white/5 border-white/10 text-white/50 hover:text-white/70'}`}
                                >
                                    <Activity size={9} /> Active Only
                                </button>
                            </div>
                            {/* Legend */}
                            <div className="flex items-center gap-3">
                                {[
                                    { color: 'bg-emerald-500', label: 'Active' },
                                    { color: 'bg-purple-500', label: 'Validator' },
                                    { color: 'bg-rose-500', label: 'Offline' },
                                    ...(showListingsLayer ? [{ color: 'bg-emerald-400', label: 'Listing' }] : []),
                                ].map(l => (
                                    <div key={l.label} className="flex items-center gap-1.5">
                                        <div className={`w-2 h-2 rounded-full ${l.color}`} />
                                        <span className="text-[8px] font-black text-white/30 uppercase hidden sm:block">{l.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Map viewport */}
                        <div style={{ height: '720px' }} className="relative bg-[#050508]">
                            {mounted && (
                                <div className="w-full h-full">
                                    {showLegacyGlobe ? (
                                        <GlobeMap
                                            nodes={nodes}
                                            onSelectNode={handleSelectNode}
                                            selectedNodeId={selectedNode?.node_id}
                                            listingPins={showListingsLayer ? listingPins : []}
                                            onSelectListing={handleSelectListing}
                                            selectedListingId={selectedListing?.listing_id}
                                            showHeatmap={showHeatmap}
                                            mapStyle={mapStyle}
                                            focusBounds={focusBounds}
                                            liveUpdates={liveUpdates}
                                            topologyLinks={topologyFlagOn ? topologyLinks : []}
                                            topologyAvailable={topologyFlagOn && topologyAvailable}
                                        />
                                    ) : (
                                        <MapCanvas
                                            nodes={nodes}
                                            onSelectNode={handleSelectNode}
                                            selectedNodeId={selectedNode?.node_id}
                                            showHeatmap={showHeatmap}
                                            focusBounds={focusBounds}
                                            liveUpdates={liveUpdates}
                                            listingPins={listingsPlottedOnMap ? listingPins : []}
                                            onSelectListing={handleSelectListing}
                                            selectedListingId={selectedListing?.listing_id}
                                            onBoundsChange={setViewport}
                                            viewMode={viewMode}
                                        />
                                    )}
                                </div>
                            )}

                            {showLegacyGlobe && showListingsLayer && (
                                <div className="absolute top-4 right-4 z-[1000] max-w-xs px-4 py-3 rounded-2xl bg-[#0a0a15]/90 border border-emerald-500/30 backdrop-blur-sm shadow-xl">
                                    <p className="text-[9px] font-black text-emerald-300 uppercase tracking-widest leading-relaxed">
                                        Emerald pins are marketplace listings. Use 2D/3D map or marketplace map to buy.
                                    </p>
                                    <Link
                                        href={ROUTES.marketplaceMap}
                                        className="mt-2 inline-block text-[9px] font-black text-primary uppercase tracking-widest hover:text-primary/80"
                                    >
                                        Open marketplace map →
                                    </Link>
                                </div>
                            )}

                            {!showLegacyGlobe && viewport != null && (areaSearchStale || !searchBBox) ? (
                                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex gap-2">
                                    <button
                                        type="button"
                                        onClick={searchThisArea}
                                        disabled={mapFetching}
                                        className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-[10px] font-black uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/30 shadow-lg disabled:opacity-50"
                                    >
                                        {mapFetching ? (
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
                                            className="px-3 py-2 rounded-full bg-white/10 border border-white/20 text-[10px] font-black uppercase tracking-widest text-white/60 hover:text-white"
                                        >
                                            Clear area
                                        </button>
                                    )}
                                </div>
                            ) : null}

                            {/* Engine Toggle Floating Button */}
                            <div className="absolute bottom-6 left-6 z-[1000] flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setMapMode('map'); setViewMode('2d'); }}
                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-[0.2em] transition-all backdrop-blur-md ${
                                        !showLegacyGlobe && viewMode === '2d'
                                            ? 'bg-primary/20 border-primary/50 text-white shadow-[0_0_20px_rgba(99,102,241,0.3)]'
                                            : 'bg-black/60 border-white/10 text-white/40 hover:text-white/60'
                                    }`}
                                >
                                    <MapPin size={12} /> 2D Map
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setMapMode('map'); setViewMode('3d'); }}
                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-[0.2em] transition-all backdrop-blur-md ${
                                        !showLegacyGlobe && viewMode === '3d'
                                            ? 'bg-primary/20 border-primary/50 text-white shadow-[0_0_20px_rgba(99,102,241,0.3)]'
                                            : 'bg-black/60 border-white/10 text-white/40 hover:text-white/60'
                                    }`}
                                >
                                    <Globe size={12} /> 3D Map
                                </button>
                                {legacyGlobe && (
                                    <button
                                        type="button"
                                        onClick={() => setMapMode('globe')}
                                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-[0.2em] transition-all backdrop-blur-md ${
                                            showLegacyGlobe
                                                ? 'bg-primary/20 border-primary/50 text-white shadow-[0_0_20px_rgba(99,102,241,0.3)]'
                                                : 'bg-black/60 border-white/10 text-white/40 hover:text-white/60'
                                        }`}
                                    >
                                        <Globe size={12} /> 3D Globe
                                    </button>
                                )}
                            </div>

                            {/* Error overlay */}
                            {error != null ? (
                                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 px-5 py-3 bg-[#0a0a15]/90 border border-rose-500/40 rounded-2xl backdrop-blur-sm shadow-xl">
                                    <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse flex-shrink-0" />
                                    <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest whitespace-nowrap">API Unavailable</span>
                                    <button onClick={() => refetchMap()} className="ml-2 px-2 py-1 bg-rose-500/15 border border-rose-500/30 rounded-lg text-[8px] font-black text-rose-400 uppercase tracking-wider hover:bg-rose-500/25 transition-all">
                                        Retry
                                    </button>
                                </div>
                            ) : null}

                            {/* Empty state */}
                            {!isLoading && error == null && nodes.length === 0 ? (
                                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2 px-6 py-4 bg-[#0a0a15]/90 border border-white/10 rounded-2xl backdrop-blur-sm text-center max-w-xs">
                                    <Globe size={20} className="text-white/20" />
                                    <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">
                                        {selectedRegion !== 'all' || showValidatorsOnly || showActiveOnly
                                            ? 'No nodes match filters'
                                            : 'No nodes registered yet'}
                                    </p>
                                    {(selectedRegion !== 'all' || showValidatorsOnly || showActiveOnly) && (
                                        <button
                                            onClick={() => { setSelectedRegion('all'); setShowValidatorsOnly(false); setShowActiveOnly(false); }}
                                            className="px-3 py-1 bg-primary/10 border border-primary/20 rounded-lg text-[8px] font-black text-primary uppercase tracking-widest hover:bg-primary/20 transition-all">
                                            Clear Filters
                                        </button>
                                    )}
                                </div>
                            ) : null}

                            {isLoading && (
                                <div className="absolute top-4 right-4 z-[1000] flex items-center gap-2 px-3 py-2 bg-[#0a0a15]/80 border border-white/10 rounded-xl backdrop-blur-sm">
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                    <span className="text-[8px] font-black text-white/40 uppercase tracking-widest">Syncing…</span>
                                </div>
                            )}
                        </div>
                    </GlassCard>
                </div>

                {/* Sidebar */}
                <div className="xl:col-span-1 space-y-4">
                    {/* Search & Discovery */}
                    <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] !p-5 space-y-4">
                        <div className="text-[9px] font-black text-white/40 uppercase tracking-widest flex items-center gap-2">
                            <Layers size={10} /> Search Network
                        </div>
                        <div className="relative group">
                            <div className="absolute -inset-0.5 bg-primary/20 blur opacity-0 group-hover:opacity-100 transition-opacity rounded-xl" />
                            <input
                                type="text"
                                placeholder="Search Town, ISP, or HW ID..."
                                className="w-full bg-white/[0.02] border border-white/10 rounded-xl py-3 pl-4 pr-10 text-[10px] font-black uppercase tracking-widest text-white placeholder:text-white/10 outline-none focus:border-primary/40 focus:bg-white/[0.05] transition-all relative z-10"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white z-20"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </GlassCard>

                    {selectedListing ? (
                        <GlassCard className="border-emerald-500/20 bg-emerald-500/[0.02] rounded-[2rem] !p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Market listing</span>
                                <button onClick={() => setSelectedListing(null)} className="text-white/20 hover:text-white text-xs">✕</button>
                            </div>
                            <h2 className="text-sm font-black text-white leading-tight">{selectedListing.title}</h2>
                            <p className="text-[9px] text-white/40 uppercase tracking-widest">
                                {selectedListing.country || '—'} · {selectedListing.price_per_gb.toFixed(6)} SOL/GB
                            </p>
                            <p className="text-[8px] text-white/30 uppercase tracking-widest">
                                {geoSourceLabel(selectedListing as MarketplaceListingMapPin)}
                            </p>
                            <ListingSlaBadge
                                uptimePercent={selectedListing.uptime_percent ?? 0}
                                slaSource={selectedListing.sla_source}
                                listingOfferVerified={selectedListing.listing_offer_verified}
                                listingOfferSigner={selectedListing.listing_offer_signer}
                                listingOfferError={selectedListing.listing_offer_verification_error}
                            />
                            {mapBuyEnabled && (selectedListing as MarketplaceListingMapPin).purchasable && (
                                <button
                                    type="button"
                                    onClick={() => handleBuy(selectedListing as MarketplaceListingMapPin)}
                                    disabled={buyLoading}
                                    className="flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-emerald-500/25 border border-emerald-500/50 text-emerald-300 text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500/35 transition-all disabled:opacity-50"
                                >
                                    {buyLoading ? (
                                        <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                        <ShoppingCart size={12} />
                                    )}
                                    Buy on map
                                </button>
                            )}
                            <Link
                                href={`/marketplace/map?listing=${selectedListing.listing_id}`}
                                className="block w-full text-center py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500/25 transition-all"
                            >
                                Buy on marketplace map →
                            </Link>
                            <Link
                                href={`/marketplace/${selectedListing.listing_id}`}
                                className="block text-center text-[8px] font-black text-white/30 uppercase tracking-widest hover:text-emerald-400"
                            >
                                Listing details
                            </Link>
                            {!mapBuyEnabled && (
                                <Link
                                    href={ROUTES.marketplaceMap}
                                    className="block text-center text-[8px] font-black text-white/30 uppercase tracking-widest hover:text-emerald-400"
                                >
                                    Open marketplace map
                                </Link>
                            )}
                        </GlassCard>
                    ) : selectedNode ? (
                        <GlassCard className="border-primary/20 bg-primary/[0.02] rounded-[2rem] !p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black text-primary uppercase tracking-widest">Selected Node</span>
                                <button onClick={() => setSelectedNode(null)} className="text-white/20 hover:text-white text-xs">✕</button>
                            </div>
                            <div className="space-y-1.5">
                                {[
                                    { label: 'Node ID', value: `${selectedNode.node_id.slice(0, 14)}…`, mono: true },
                                    { label: 'Status', value: selectedNode.is_active ? '● Active' : '○ Offline', color: selectedNode.is_active ? 'text-emerald-400' : 'text-rose-400' },
                                    { label: 'Type', value: selectedNode.is_validator ? '⬡ Validator' : '◎ Proxy', color: selectedNode.is_validator ? 'text-purple-400' : 'text-blue-400' },
                                    { label: 'Country', value: selectedNode.country || '—' },
                                    { label: 'Region', value: selectedNode.region || '—' },
                                    { label: 'City', value: selectedNode.city || '—' },
                                    { label: 'ISP', value: selectedNode.isp || '—' },
                                    { label: 'Uptime', value: `${(selectedNode.uptime_percent || 0).toFixed(2)}%` },
                                    { label: 'Sessions', value: String(selectedNode.active_sessions || 0) },
                                    {
                                        label: 'Coords',
                                        value: (Math.abs(selectedNode.lat) > 0.01)
                                            ? `${selectedNode.lat.toFixed(3)}, ${selectedNode.lon.toFixed(3)}`
                                            : 'Estimated',
                                    },
                                ].map(f => (
                                    <div key={f.label} className="flex justify-between items-center py-1 border-b border-white/[0.04]">
                                        <span className="text-[8px] font-black text-white/30 uppercase tracking-wider">{f.label}</span>
                                        <span className={`text-[9px] font-black truncate max-w-[120px] ${(f as any).color || ((f as any).mono ? 'text-primary font-mono' : 'text-white')}`}>
                                            {f.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <Link href={`/explorer/nodes/${selectedNode.node_id}`}
                                className="block w-full text-center py-2 rounded-xl bg-primary/10 border border-primary/20 text-primary text-[9px] font-black uppercase tracking-widest hover:bg-primary/20 transition-all">
                                Full Details →
                            </Link>
                        </GlassCard>
                    ) : (
                        <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] !p-6 text-center">
                            <MapPin size={32} className="mx-auto text-white/10 mb-3" />
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-widest leading-relaxed">
                                Click any node marker to inspect it
                            </p>
                        </GlassCard>
                    )}

                    {/* Map controls */}
                    <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] !p-5 space-y-4">
                        <div className="text-[9px] font-black text-white/40 uppercase tracking-widest flex items-center gap-2">
                            <Layers size={10} /> Map Controls
                        </div>

                        <div>
                            <p className="text-[8px] font-black text-white/25 uppercase tracking-widest mb-2">View</p>
                            <div className="grid grid-cols-2 gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => { setMapMode('map'); setViewMode('2d'); }}
                                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl border text-[8px] font-bold uppercase tracking-wider transition-all ${
                                        !showLegacyGlobe && viewMode === '2d'
                                            ? 'bg-primary/20 border-primary/50 text-primary'
                                            : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
                                    }`}
                                >
                                    <Map size={9} />
                                    <span>2D</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setMapMode('map'); setViewMode('3d'); }}
                                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl border text-[8px] font-bold uppercase tracking-wider transition-all ${
                                        !showLegacyGlobe && viewMode === '3d'
                                            ? 'bg-primary/20 border-primary/50 text-primary'
                                            : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
                                    }`}
                                >
                                    <Globe size={9} />
                                    <span>3D</span>
                                </button>
                            </div>
                            <p className="text-[7px] text-white/25 mt-2 leading-relaxed">
                                Minimal vector roadmap only — no satellite imagery.
                            </p>
                        </div>

                        {legacyGlobe && showLegacyGlobe && (
                            <div>
                                <p className="text-[8px] font-black text-white/25 uppercase tracking-widest mb-2">Legacy Globe Style</p>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {([
                                        { id: 'minimal', label: 'Minimal' },
                                        { id: 'terrain', label: 'Terrain' },
                                        { id: 'satellite', label: 'Night' },
                                    ] as { id: MapStyle; label: string }[]).map(s => (
                                        <button
                                            key={s.id}
                                            type="button"
                                            onClick={() => setMapStyle(s.id)}
                                            className={`px-2 py-2 rounded-xl border text-[8px] font-bold uppercase tracking-wider transition-all ${
                                                mapStyle === s.id
                                                    ? 'bg-primary/20 border-primary/50 text-primary'
                                                    : 'bg-white/5 border-white/10 text-white/40'
                                            }`}
                                        >
                                            {s.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={toggleListingsLayer}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-[9px] font-bold uppercase tracking-wider transition-all ${showListingsLayer ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-white/5 border-white/10 text-white/50 hover:text-white/70'}`}
                        >
                            <span>Marketplace listings</span>
                            <span className="text-[8px] opacity-60">
                                {showListingsLayer ? 'ON' : 'OFF'}
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setShowHeatmap(h => !h)}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-[9px] font-bold uppercase tracking-wider transition-all ${showHeatmap ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' : 'bg-white/5 border-white/10 text-white/50 hover:text-white/70'}`}
                        >
                            <span>Session Density</span>
                            <div className={`w-8 h-4 rounded-full transition-all relative ${showHeatmap ? 'bg-indigo-500' : 'bg-white/20'}`}>
                                <div className={`absolute top-0 w-4 h-4 rounded-full bg-white transition-transform ${showHeatmap ? 'translate-x-4' : 'translate-x-0'}`} />
                            </div>
                        </button>
                        <div className="space-y-2">
                            {[
                                { color: 'bg-emerald-500', label: 'Active Proxy', desc: 'Online, serving traffic' },
                                { color: 'bg-purple-500', label: 'Validator', desc: 'High-stake validator node' },
                                { color: 'bg-rose-500', label: 'Offline', desc: 'No recent heartbeat' },
                                { color: 'bg-amber-400', label: 'Selected', desc: 'Currently inspected' },
                            ].map(i => (
                                <div key={i.label} className="flex items-start gap-2">
                                    <div className={`w-2.5 h-2.5 rounded-full ${i.color} mt-0.5 flex-shrink-0`} />
                                    <div>
                                        <span className="text-[8px] font-black text-white/60 uppercase">{i.label}</span>
                                        <p className="text-[7px] text-white/25">{i.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </GlassCard>

                    {/* Region breakdown */}
                    <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] !p-5">
                        <div className="text-[9px] font-black text-white/40 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <Globe size={10} /> Region Distribution
                        </div>
                        {regionBreakdown.length === 0 ? (
                            <p className="text-[8px] font-black text-white/20 uppercase tracking-widest text-center py-4">No nodes yet</p>
                        ) : (
                            <div className="space-y-1.5 max-h-52 overflow-y-auto">
                                {regionBreakdown.map(([region, count]) => {
                                    const total = regionBreakdownTotal;
                                    return (
                                        <div key={region}
                                            className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-1 py-1 rounded transition-colors"
                                            onClick={() => setSelectedRegion(selectedRegion === region ? 'all' : region)}>
                                            <div className="flex-1 bg-white/[0.03] rounded-full h-1.5 overflow-hidden">
                                                <div className={`h-full rounded-full transition-all ${selectedRegion === region ? 'bg-amber-400' : 'bg-primary'}`}
                                                    style={{ width: `${(count / total) * 100}%` }} />
                                            </div>
                                            <span
                                                data-testid={`explorer-map-region-${region}`}
                                                className={`text-[8px] font-black uppercase w-20 text-right truncate ${selectedRegion === region ? 'text-amber-400' : 'text-white/40'}`}
                                            >
                                                {region}
                                            </span>
                                            <span className="text-[8px] font-black text-white w-4 text-right">{count}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {selectedRegion !== 'all' && (
                            <button onClick={() => setSelectedRegion('all')}
                                className="mt-3 w-full text-center text-[8px] font-bold text-primary hover:text-primary/80 uppercase tracking-wider transition-colors">
                                Clear Filter ✕
                            </button>
                        )}
                    </GlassCard>

                    {unmapped > 0 && (
                        <div className="text-[8px] font-black text-amber-400/60 uppercase tracking-widest text-center px-3 py-2.5 bg-amber-500/5 rounded-xl border border-amber-500/10 leading-relaxed">
                            ⚠ {unmapped} node{unmapped > 1 ? 's' : ''} missing GPS
                            <p className="text-[7px] text-white/20 normal-case mt-0.5 font-normal">GeoIP backfill will resolve these automatically</p>
                        </div>
                    )}
                </div>
            </motion.div>

            {/* ── Node table ── */}
            <motion.section variants={item}>
                <h2 className="text-sm font-black uppercase tracking-tighter text-white flex items-center gap-2 mb-4">
                    <Server size={14} className="text-primary" /> Located Nodes
                    {mappedCount > 0 && <span className="text-[9px] font-bold text-white/30 ml-1">({mappedCount} with coordinates)</span>}
                </h2>
                <GlassCard className="overflow-hidden border-white/5 bg-white/[0.01] rounded-[2rem]">
                    {nodes.length === 0 ? (
                        <div className="py-16 text-center">
                            <Server size={40} className="text-white/5 mx-auto mb-4" />
                            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">No nodes registered</p>
                            <p className="text-[8px] text-white/10 max-w-xs mx-auto">
                                Nodes appear here once providers join the network with location data.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-white/5 text-white/40 text-[9px] uppercase tracking-[0.2em] font-black">
                                        <th className="px-5 py-3">Node</th>
                                        <th className="px-5 py-3">Type</th>
                                        <th className="px-5 py-3">Location</th>
                                        <th className="px-5 py-3">ISP</th>
                                        <th className="px-5 py-3 text-right">Uptime</th>
                                        <th className="px-5 py-3 text-right">Sessions</th>
                                        <th className="px-5 py-3 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.04]">
                                    {nodes.slice(0, 100).map((n) => (
                                        <tr key={n.node_id}
                                            onClick={() => setSelectedNode(n)}
                                            className={`hover:bg-white/[0.03] transition-colors cursor-pointer ${selectedNode?.node_id === n.node_id ? 'bg-primary/5' : ''}`}>
                                            <td className="px-5 py-2.5">
                                                <Link href={`/explorer/nodes/${n.node_id}`}
                                                    className="font-mono text-primary hover:text-primary/80 text-[10px] font-bold"
                                                    onClick={e => e.stopPropagation()}>
                                                    {n.node_id.slice(0, 14)}…
                                                </Link>
                                            </td>
                                            <td className="px-5 py-2.5">
                                                <span className={`text-[8px] font-black px-2 py-0.5 rounded-md uppercase ${n.is_validator ? 'text-purple-400 bg-purple-400/10' : 'text-blue-400 bg-blue-400/10'}`}>
                                                    {n.is_validator ? 'Validator' : 'Proxy'}
                                                </span>
                                            </td>
                                            <td className="px-5 py-2.5">
                                                <div className="flex items-center gap-1.5">
                                                    <MapPin size={8} className="text-white/20 flex-shrink-0" />
                                                    <span className="text-[9px] text-white/60">
                                                        {[n.city, n.country || n.region].filter(Boolean).join(', ') || '—'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-5 py-2.5">
                                                <span className="text-[9px] text-white/40">{n.isp || '—'}</span>
                                            </td>
                                            <td className="px-5 py-2.5 text-right font-mono text-[10px] font-black text-white">
                                                {(n.uptime_percent || 0).toFixed(1)}%
                                            </td>
                                            <td className="px-5 py-2.5 text-right font-mono text-[10px] font-black text-white">
                                                {n.active_sessions}
                                            </td>
                                            <td className="px-5 py-2.5 text-center">
                                                <span className={`inline-block w-2 h-2 rounded-full ${n.is_active ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </GlassCard>
            </motion.section>

            {buyListing && (
                <BuyListingModal
                    listing={buyListing}
                    surface="explorer_map"
                    onClose={() => setBuyListing(null)}
                    onSuccess={() => {
                        setBuyListing(null);
                        void refetchMap();
                    }}
                />
            )}
        </motion.div>
    );
}
