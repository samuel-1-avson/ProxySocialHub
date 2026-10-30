'use client';

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import { BuyListingModal } from '@/components/BuyListingModal';
import { PageHeading } from '@/components/workspace/Patterns';
import { measured } from '@/lib/measurements';
import { CatalogProductBadge } from '@/components/marketplace/CatalogProductBadge';
import { ListingSocialPanel } from '@/components/marketplace/ListingSocialPanel';
import { ListingQASection } from '@/components/marketplace/ListingQASection';
import { MarketplaceDiscoverTabs } from '@/components/marketplace/MarketplaceDiscoverTabs';
import {
    getListing,
    getListingFacets,
    marketplaceKeys,
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
            <div className="ui-loading" role="status">Loading map…</div>
        ),
    },
);

export default function MarketplaceMapPage() {
    const searchParams = useSearchParams();
    const highlightListingId = searchParams.get('listing');
    return <MarketplaceMapContent key={highlightListingId ?? ''} highlightListingId={highlightListingId} />;
}

function MarketplaceMapContent({ highlightListingId }: { highlightListingId: string | null }) {
    const [proxyType, setProxyType] = useState('');
    const [protocol, setProtocol] = useState('');
    const [country, setCountry] = useState('');
    const [minPrice, setMinPrice] = useState('');
    const [maxPrice, setMaxPrice] = useState('');
    const [minUptime, setMinUptime] = useState('');
    const [maxLatency, setMaxLatency] = useState('');
    const [selectedListingId, setSelectedListingId] = useState<string | null>(highlightListingId);
    const setSelectedPin = useCallback((pin: MarketplaceListingMapPin | null) => setSelectedListingId(pin?.listing_id ?? null), []);
    const [filtersOpen, setFiltersOpen] = useState(!highlightListingId);
    const [selectedCluster, setSelectedCluster] = useState<MarketplaceListingMapPin[] | null>(null);
    const [selectedNode, setSelectedNode] = useState<NodeGeoPoint | null>(null);
    const [buyListing, setBuyListing] = useState<Listing | null>(null);
    const [buyLoading, setBuyLoading] = useState(false);
    const [buyError, setBuyError] = useState<string>();
    const [viewport, setViewport] = useState<MapBBox | null>(null);
    const [searchBBox, setSearchBBox] = useState<MapBBox | null>(null);
    const facets = useQuery({ queryKey: marketplaceKeys.facets(), queryFn: getListingFacets, staleTime: 60_000 });

    function changeFilter(setFilter: Dispatch<SetStateAction<string>>, value: string) {
        setFilter(value);
        setSearchBBox(null);
        setSelectedPin(null);
        setSelectedCluster(null);
        setSelectedNode(null);
    }

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
    }, [viewport, setSelectedPin]);

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

    // Keep the inspector on the current API record, including after a map refresh.
    const selectedPin = plotted.find(pin => pin.listing_id === selectedListingId) ?? null;

    const viewportPins = useMemo(() => {
        if (!viewport) return plotted;
        return plotted.filter(p => pinInBBox(p.lat, p.lon, viewport));
    }, [plotted, viewport]);
    const countries = useMemo(() => {
        const set = new Set<string>();
        for (const bucket of facets.data?.countries ?? []) set.add(bucket.value);
        if (country) set.add(country);
        for (const p of pins) {
            if (p.country) set.add(p.country);
        }
        return Array.from(set).sort();
    }, [pins, country, facets.data]);

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
        setFiltersOpen(false);
    }, [setSelectedPin]);

    const handleSelectListing = useCallback((pin: ExplorerListingPin) => {
        setSelectedPin(pin as MarketplaceListingMapPin);
        setSelectedCluster(null);
        setSelectedNode(null);
        setFiltersOpen(false);
    }, [setSelectedPin]);

    const handleSelectListingGroup = useCallback((pins: ExplorerListingPin[]) => {
        setSelectedCluster(pins as MarketplaceListingMapPin[]);
        setSelectedPin(null);
        setSelectedNode(null);
        setFiltersOpen(false);
    }, [setSelectedPin]);

    const handleBuy = useCallback(async (pin: MarketplaceListingMapPin) => {
        if (!pin.purchasable) return;
        setBuyLoading(true);
        setBuyError(undefined);
        setBuyListing(null);
        try {
            const res = await getListing(pin.listing_id);
            setBuyListing(res.listing);
        } catch (error) {
            setBuyError(error instanceof Error ? `Current offer terms are unavailable: ${error.message}` : 'Current offer terms are unavailable. Try the offer again before checkout.');
        } finally {
            setBuyLoading(false);
        }
    }, []);

    const handleBuyListing = useCallback((pin: ExplorerListingPin) => {
        void handleBuy(pin as MarketplaceListingMapPin);
    }, [handleBuy]);

    return (
        <div className="ui-page">
            <MarketplaceDiscoverTabs />
            {buyError && <p className="ui-error" role="alert">{buyError}</p>}
            {data && <p className="ui-note">{error ? 'Showing the last reported map records; refresh is unavailable.' : isFetching ? 'Refreshing map records…' : 'Map records loaded from the marketplace.'} {data.generated_at && !Number.isNaN(Date.parse(data.generated_at)) ? `Source updated ${new Date(data.generated_at).toLocaleString()}.` : 'Source timestamp not reported.'}</p>}
            <PageHeading
                eyebrow="Marketplace"
                title="Map"
                description={
                    searchBBox
                        ? "Proxy offers in the selected map area. Choose a pin to review its terms and reported evidence."
                        : "Proxy offers by reported location. Choose a pin to review its terms and evidence."
                }
                actions={
                    <>
                        <div>
                            <div className="ui-stat-label">Listings</div>
                            <div className="ui-stat-value">{data?.listing_count ?? pins.length}</div>
                        </div>
                        <div>
                            <div className="ui-stat-label">On map</div>
                            <div className="ui-stat-value">{plotted.length}</div>
                        </div>
                        <div>
                            <div className="ui-stat-label">Nodes</div>
                            <div className="ui-stat-value">{data?.node_count ?? 0}</div>
                        </div>
                    </>
                }
            />

            <div className="market-map">
                <div className="market-map-stage">
                    {viewport != null && (areaSearchStale || !searchBBox) ? (
                        <div className="market-map-float center">
                            <button type="button" className="ui-button small" onClick={searchThisArea} disabled={isFetching}>
                                {isFetching ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
                                Search this area
                            </button>
                            {searchBBox ? (
                                <button type="button" className="ui-button secondary small" onClick={clearAreaSearch}>
                                    <X size={14} aria-hidden="true" />
                                    Clear area
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                    {isLoading && !data ? (
                        <div className="ui-loading" role="status" style={{ position: "absolute", inset: 0 }}>
                            <Loader2 className="animate-spin" size={18} aria-hidden="true" />
                            Loading map data…
                        </div>
                    ) : null}
                    {isFetching && data ? (
                        <div className="market-map-float end" role="status">Updating…</div>
                    ) : null}
                    {error != null ? (
                        <div className="ui-error" role="alert" style={{ position: "absolute", top: 16, left: 16, zIndex: 2, maxWidth: 280 }}>
                            <p>Map data is unavailable.</p>
                            <button type="button" className="ui-button secondary small" onClick={() => refetch()}>Try again</button>
                        </div>
                    ) : null}
                    <div className="market-map-canvas">
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
                </div>

                <div className="market-map-side">
                    <details className="ui-surface market-map-filters" open={filtersOpen} onToggle={event => setFiltersOpen(event.currentTarget.open)}>
                        <summary className="market-map-filter-summary"><h2>Filters</h2><span>{filtersOpen ? 'Hide' : 'Show'}</span></summary>
                        <section aria-label="Map filters">
                        <div className="grid gap-3">
                            <label className="ui-field">Proxy type
                                <select aria-label="Proxy type" className="ui-select" value={proxyType} onChange={e => changeFilter(setProxyType, e.target.value)}>
                                    <option value="">All types</option>
                                    <option value="residential">Residential</option>
                                    <option value="mobile">Mobile</option>
                                    <option value="datacenter">Datacenter</option>
                                </select>
                            </label>
                            <label className="ui-field">Protocol
                                <select aria-label="Protocol" className="ui-select" value={protocol} onChange={e => changeFilter(setProtocol, e.target.value)}>
                                    <option value="">All protocols</option>
                                    <option value="http">HTTP</option>
                                    <option value="socks5">SOCKS5</option>
                                </select>
                            </label>
                            <label className="ui-field">Country
                                <select aria-label="Country" className="ui-select" value={country} onChange={e => changeFilter(setCountry, e.target.value)}>
                                    <option value="">All countries</option>
                                    {countries.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="ui-field">Minimum price
                                    <input className="ui-input" type="number" min="0" step="0.01" value={minPrice} aria-label="Minimum price" onChange={e => changeFilter(setMinPrice, e.target.value)} />
                                </label>
                                <label className="ui-field">Maximum price
                                    <input className="ui-input" type="number" min="0" step="0.01" value={maxPrice} aria-label="Maximum price" onChange={e => changeFilter(setMaxPrice, e.target.value)} />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="ui-field">Minimum uptime
                                    <input className="ui-input" type="number" min="0" max="100" step="1" value={minUptime} aria-label="Minimum uptime percent" onChange={e => changeFilter(setMinUptime, e.target.value)} />
                                </label>
                                <label className="ui-field">Maximum latency
                                    <input className="ui-input" type="number" min="0" step="1" value={maxLatency} aria-label="Maximum latency milliseconds" onChange={e => changeFilter(setMaxLatency, e.target.value)} />
                                </label>
                            </div>
                            <button
                                type="button"
                                className="ui-button secondary block"
                                onClick={() => {
                                    setProxyType('');
                                    setProtocol('');
                                    setCountry('');
                                    setMinPrice('');
                                    setMaxPrice('');
                                    setMinUptime('');
                                    setMaxLatency('');
                                    setSearchBBox(null);
                                    setSelectedPin(null);
                                    setSelectedCluster(null);
                                    setSelectedNode(null);
                                }}
                            >
                                Reset filters
                            </button>
                        </div>
                        </section>
                    </details>

                    {selectedCluster && selectedCluster.length > 1 ? (
                        <section className="ui-surface">
                            <div className="ui-section-heading">
                                <h2>{selectedCluster.length} listings here</h2>
                                <button type="button" className="ui-button ghost" onClick={() => setSelectedCluster(null)}>Close</button>
                            </div>
                            <p className="ui-note">These listings share a location. Choose one to review.</p>
                            <ul className="market-choice-list">
                                {selectedCluster.map(p => (
                                    <li key={p.listing_id}>
                                        <button type="button" onClick={() => { setSelectedPin(p); setSelectedCluster(null); }}>
                                            <span>{p.title}</span>
                                            <small>{measured(p.price_per_gb, 4, 'USD / GB')} · Uptime {measured(p.uptime_percent, 1, '%')}</small>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : selectedPin ? (
                        <section className="ui-surface">
                            <div className="ui-section-heading">
                                <h2>{selectedPin.title}</h2>
                                <button type="button" className="ui-button ghost" onClick={() => setSelectedPin(null)}>Close</button>
                            </div>
                            <CatalogProductBadge product={selectedPin.catalog_product} />
                            <dl className="market-kv">
                                <div>
                                    <dt>Location</dt>
                                    <dd>
                                        {[selectedPin.city, selectedPin.country].filter(Boolean).join(', ') || 'Not reported'}
                                        <span className="ui-note" style={{ display: 'block' }}>{geoSourceLabel(selectedPin)}</span>
                                    </dd>
                                </div>
                                {selectedPin.network_class ? <div><dt>Network</dt><dd style={{ textTransform: 'capitalize' }}>{selectedPin.network_class}</dd></div> : null}
                                {selectedPin.trust_label ? <div><dt>Reported trust</dt><dd>{selectedPin.trust_label}</dd></div> : null}
                                <div><dt>Price</dt><dd>{measured(selectedPin.price_per_gb, 4, 'USD / GB')}</dd></div>
                                <div><dt>Available</dt><dd>{measured(selectedPin.available_bandwidth_gb, 1, 'GB')}</dd></div>
                                <div><dt>In use</dt><dd>{measured(selectedPin.active_sessions, 0)}{selectedPin.max_concurrency ? `/${selectedPin.max_concurrency}` : ''} buyers</dd></div>
                                <div>
                                    <dt>Reported uptime</dt>
                                    <dd>{measured(selectedPin.uptime_percent, 1, '%')}{selectedPin.sla_source === 'gateway' ? ' (gateway)' : ''}</dd>
                                </div>
                                {selectedPin.quality_score != null ? <div><dt>Reported quality</dt><dd>{selectedPin.quality_score.toFixed(0)}</dd></div> : null}
                                {selectedPin.success_rate != null ? <div><dt>Reported success</dt><dd>{selectedPin.success_rate.toFixed(0)}%</dd></div> : null}
                                <div>
                                    <dt>Offer proof</dt>
                                    <dd>{selectedPin.listing_offer_verified ? 'Provider signed' : 'Unsigned'}</dd>
                                </div>
                                {selectedPin.latency_ms != null && selectedPin.latency_ms > 0 ? <div><dt>Latency</dt><dd>{selectedPin.latency_ms} ms</dd></div> : null}
                            </dl>
                            <p className="ui-note">Quality and uptime are reports from the source. Live connectivity requires a successful routed request.</p>
                            {selectedPin.estimated ? <p className="ui-note">The pin shows a regional area, not a street address.</p> : null}
                            {!selectedPin.purchasable ? <p className="ui-note">This listing is not currently purchasable.</p> : null}
                            <button
                                type="button"
                                data-testid="marketplace-map-buy-btn"
                                className="ui-button block"
                                disabled={buyLoading || !selectedPin.purchasable}
                                onClick={() => handleBuy(selectedPin)}
                            >
                                {buyLoading ? 'Loading…' : selectedPin.purchasable ? 'Buy bandwidth' : 'Unavailable'}
                            </button>
                            <ListingSocialPanel
                                listingId={selectedPin.listing_id}
                                listingTitle={selectedPin.title}
                                pricePerGb={selectedPin.price_per_gb}
                                location={[selectedPin.city, selectedPin.country].filter(Boolean).join(', ')}
                                compact
                            />
                            <ListingQASection listingId={selectedPin.listing_id} compact />
                            <Link className="ui-link" href={`/marketplace/${selectedPin.listing_id}`}>Open the full listing</Link>
                        </section>
                    ) : selectedNode ? (
                        <section className="ui-surface">
                            <div className="ui-section-heading">
                                <h2>{selectedNode.title || [selectedNode.city, selectedNode.country || selectedNode.region].filter(Boolean).join(', ') || 'Network node'}</h2>
                                <button type="button" className="ui-button ghost" onClick={() => setSelectedNode(null)}>Close</button>
                            </div>
                            <dl className="market-kv">
                                <div><dt>Reported status</dt><dd>{selectedNode.status || 'Not reported'}</dd></div>
                                <div><dt>Reported trust</dt><dd>{selectedNode.trust_label || 'Not reported'}</dd></div>
                                {selectedNode.network_class ? <div><dt>Network</dt><dd style={{ textTransform: 'capitalize' }}>{selectedNode.network_class}</dd></div> : null}
                                <div><dt>Location</dt><dd>{[selectedNode.city, selectedNode.country || selectedNode.region].filter(Boolean).join(', ') || 'Not reported'}</dd></div>
                                {selectedNode.quality_score != null ? <div><dt>Reported quality</dt><dd>{selectedNode.quality_score.toFixed(0)}</dd></div> : null}
                                <div><dt>Reported uptime</dt><dd>{measured(selectedNode.uptime_percent, 1, '%')}</dd></div>
                                <div><dt>Sessions</dt><dd>{measured(selectedNode.active_sessions, 0)}</dd></div>
                            </dl>
                            <p className="ui-note">This is an approximate hub location. Select a listing pin to buy bandwidth.</p>
                        </section>
                    ) : (
                        <section className="ui-empty">
                            <h2>Nothing selected</h2>
                            <p>Select a listing or node on the map.</p>
                        </section>
                    )}

                    <section className="ui-surface">
                        <h2>In view ({viewportPins.length})</h2>
                        <ul className="market-choice-list">
                            {viewportPins.slice(0, 20).map(p => (
                                <li key={p.listing_id}>
                                    <button
                                        type="button"
                                        className={selectedPin?.listing_id === p.listing_id ? 'active' : ''}
                                        aria-current={selectedPin?.listing_id === p.listing_id ? 'true' : undefined}
                                        onClick={() => { setSelectedPin(p); setSelectedCluster(null); setSelectedNode(null); setFiltersOpen(false); }}
                                    >
                                        <span>{p.title}</span>
                                        <small>
                                            {[p.city, p.country].filter(Boolean).join(', ') || p.country || 'Location not reported'}
                                            {' · '}{measured(p.price_per_gb, 4, 'USD / GB')}
                                        </small>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                </div>
            </div>

            {buyListing && (
                <BuyListingModal
                    listing={buyListing}
                    surface="map"
                    onClose={() => { setBuyListing(null); setSelectedPin(null); }}
                    onSuccess={() => { void refetch(); }}
                />
            )}
        </div>
    );

}
