'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMapLinks, type MapLinksFilters, type MapTopologyLink } from '@/lib/api/map-topology';
import { useExplorerWS } from './useExplorerWS';

export const mapLinksKeys = {
    all: ['map-links'] as const,
    list: (filters: MapLinksFilters) => [...mapLinksKeys.all, filters] as const,
};

export interface UseMapLinksOptions {
    enabled?: boolean;
    /** Subscribe to explorer WS `links` topic and refetch on link_update. */
    live?: boolean;
    filters?: MapLinksFilters;
    staleTime?: number;
    refetchInterval?: number | false;
}

export interface UseMapLinksResult {
    links: MapTopologyLink[];
    topologyAvailable: boolean;
    isLoading: boolean;
    error: unknown;
    refetch: () => void;
}

export function useMapLinks(options: UseMapLinksOptions = {}): UseMapLinksResult {
    const {
        enabled = true,
        live = false,
        filters = {},
        staleTime = 30_000,
        refetchInterval = 60_000,
    } = options;

    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: mapLinksKeys.list(filters),
        queryFn: () => getMapLinks(filters),
        enabled,
        staleTime,
        refetchInterval: live ? false : refetchInterval,
    });

    const onLinkUpdate = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: mapLinksKeys.all });
    }, [queryClient]);

    useExplorerWS({
        enabled: enabled && live,
        topics: ['links'],
        onLinkUpdate,
    });

    return {
        links: query.data?.links ?? [],
        topologyAvailable: query.data?.meta.topology_available ?? false,
        isLoading: query.isLoading,
        error: query.error,
        refetch: () => {
            void query.refetch();
        },
    };
}
