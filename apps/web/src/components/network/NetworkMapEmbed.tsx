'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { MarketplaceMapFilters } from '@/lib/api/marketplace';
import { useMapPoints } from '@/lib/hooks/useMapPoints';
import type { MarketplaceListingMapPin } from '@/lib/map/marketplace-map-adapters';
import type { ExplorerListingPin } from '@/components/map/types';
import type { NodeGeoPoint } from '@/lib/services/explorer';

const ProxyMapCanvas = dynamic(
    () => import('@/components/map/ProxyMapCanvas'),
    {
        ssr: false,
        loading: () => (
            <div className="flex flex-1 min-h-[380px] items-center justify-center bg-[#050508]">
                <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" />
                    Loading map…
                </span>
            </div>
        ),
    },
);

const MAP_FILTERS: MarketplaceMapFilters = {
    purchasable_only: true,
    include_nodes: true,
    active_nodes_only: true,
};

/**
 * Compact marketplace + node map for the unified /network shell (preview; checkout on full map).
 */
export function NetworkMapEmbed() {
    const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
    const [selectedListingId, setSelectedListingId] = useState<string | undefined>();

    const { nodes, listingPins, isLoading, error, refetch } = useMapPoints({
        filters: MAP_FILTERS,
    });

    const handleSelectNode = (node: NodeGeoPoint) => {
        setSelectedNodeId(node.node_id);
        setSelectedListingId(undefined);
    };

    const handleSelectListing = (pin: ExplorerListingPin) => {
        setSelectedListingId(pin.listing_id);
        setSelectedNodeId(undefined);
    };

    if (error) {
        return (
            <div
                className="flex flex-1 min-h-[380px] flex-col items-center justify-center gap-3 p-6 text-center"
                data-testid="network-map-embed-error"
            >
                <p className="text-sm text-destructive/90">Could not load map data.</p>
                <button
                    type="button"
                    onClick={() => refetch()}
                    className="text-xs font-bold text-primary hover:underline"
                >
                    Retry
                </button>
                <Link
                    href="/marketplace/map"
                    className="text-xs font-bold text-muted-foreground hover:text-foreground"
                >
                    Open marketplace map
                </Link>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div
                className="flex flex-1 min-h-[380px] items-center justify-center bg-[#050508]"
                data-testid="network-map-embed-loading"
            >
                <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" />
                    Loading map…
                </span>
            </div>
        );
    }

    const selectedListing = selectedListingId
        ? (listingPins.find((p) => p.listing_id === selectedListingId) as MarketplaceListingMapPin | undefined)
        : undefined;

    return (
        <div className="relative flex flex-1 flex-col min-h-[380px]" data-testid="network-map-embed">
            <ProxyMapCanvas
                nodes={nodes}
                listingPins={listingPins}
                onSelectNode={handleSelectNode}
                onSelectListing={handleSelectListing}
                selectedNodeId={selectedNodeId}
                selectedListingId={selectedListingId}
            />
            <div className="absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2">
                <Link
                    href="/marketplace/map"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-card"
                    data-testid="network-map-full-link"
                >
                    Full map &amp; buy
                    <ExternalLink size={10} />
                </Link>
                {selectedListing && (
                    <Link
                        href={`/marketplace/map?listing=${encodeURIComponent(selectedListing.listing_id)}`}
                        className="rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-bold text-success hover:bg-success/20"
                    >
                        View listing on map
                    </Link>
                )}
                {selectedNodeId && (
                    <Link
                        href="/explorer/map"
                        className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20"
                    >
                        Open network map
                    </Link>
                )}
            </div>
            <p className="absolute bottom-3 left-3 z-[1000] max-w-[240px] rounded-lg border border-border bg-secondary px-2 py-1 text-xs font-mono text-muted-foreground">
                Preview. Filters, Q&amp;A, and wallet checkout on the marketplace map.
            </p>
        </div>
    );
}
