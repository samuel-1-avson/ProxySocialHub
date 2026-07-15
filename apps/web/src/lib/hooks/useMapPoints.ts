'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    getMarketplaceMapPoints,
    marketplaceKeys,
    type MarketplaceMapFilters,
    type MarketplaceMapPoint,
    type MarketplaceMapResponse,
} from '@/lib/api/marketplace';
import {
    marketplacePointToListingPin,
    marketplacePointToNode,
    type MarketplaceListingMapPin,
} from '@/lib/map/marketplace-map-adapters';
import type { NodeGeoPoint } from '@/lib/services/explorer';
import { useMapNodeLiveUpdates } from '@/lib/hooks/useMapNodeLiveUpdates';

const PLOTTED_EPS = 0.01;

export interface UseMapPointsOptions {
    filters: MarketplaceMapFilters;
    enabled?: boolean;
    /** When false, `listingPins` is empty; nodes still load when `include_nodes` is set. */
    showListings?: boolean;
    /** Subscribe to explorer `node_update` WebSocket events. */
    live?: boolean;
    staleTime?: number;
    refetchInterval?: number | false;
    /** Request catalog_product on listing map points (default true). */
    includeCatalog?: boolean;
}

export interface UseMapPointsResult {
    data: MarketplaceMapResponse | undefined;
    points: MarketplaceMapPoint[];
    nodes: NodeGeoPoint[];
    listingPins: MarketplaceListingMapPin[];
    isLoading: boolean;
    isFetching: boolean;
    error: unknown;
    refetch: () => void;
    liveUpdates: ReturnType<typeof useMapNodeLiveUpdates>['liveUpdates'];
    wsConnected: boolean;
}

/**
 * Shared marketplace map data hook for explorer, marketplace, and network embed surfaces.
 * Coordinates are server-resolved; consumers must not re-snap lat/lon client-side.
 */
export function useMapPoints(options: UseMapPointsOptions): UseMapPointsResult {
    const {
        filters,
        enabled = true,
        showListings = true,
        live = false,
        staleTime = 30_000,
        refetchInterval = 60_000,
        includeCatalog = true,
    } = options;

    const requestFilters = useMemo(
        () => ({
            ...filters,
            ...(includeCatalog ? { include_catalog: true } : {}),
        }),
        [filters, includeCatalog],
    );

    const { data, isFetching, error, refetch } = useQuery({
        queryKey: marketplaceKeys.map(requestFilters),
        queryFn: () => getMarketplaceMapPoints(requestFilters),
        enabled,
        staleTime,
        refetchInterval,
    });

    const { liveUpdates, wsConnected } = useMapNodeLiveUpdates({
        enabled: live && enabled,
    });

    const nodes = useMemo(
        () => (data?.points ?? []).filter((p) => p.kind === 'node').map(marketplacePointToNode),
        [data?.points],
    );

    const listingPins = useMemo(() => {
        if (!showListings) return [];
        return (data?.points ?? [])
            .filter((p) => p.kind === 'listing')
            .map(marketplacePointToListingPin)
            .filter((p) => Math.abs(p.lat) > PLOTTED_EPS || Math.abs(p.lon) > PLOTTED_EPS);
    }, [data?.points, showListings]);

    return {
        data,
        points: data?.points ?? [],
        nodes,
        listingPins,
        isLoading: isFetching && !data,
        isFetching,
        error,
        refetch: () => {
            void refetch();
        },
        liveUpdates,
        wsConnected,
    };
}
