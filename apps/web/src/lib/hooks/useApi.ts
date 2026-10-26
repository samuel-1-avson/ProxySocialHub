/**
 * React Query Hooks
 * Custom hooks for data fetching with loading/error states
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as walletApi from '../api/wallet';
import * as sessionsApi from '../api/sessions';
import * as usageApi from '../api/usage';
import * as circlesApi from '../api/circles';
import * as marketplaceApi from '../api/marketplace';

// ============ Wallet Hooks ============

/** Custodial / platform ledger wallet (GET /v1/wallet). Not the Solana adapter. */
export function usePlatformWallet() {
    return useQuery({
        queryKey: walletApi.walletKeys.detail(),
        queryFn: walletApi.getWallet,
    });
}

/** @deprecated Use usePlatformWallet — name collided with @solana/wallet-adapter-react useWallet */
export function useWallet() {
    return usePlatformWallet();
}

export function useTransactions(limit = 20, offset = 0) {
    return useQuery({
        queryKey: walletApi.walletKeys.transactions(offset / limit),
        queryFn: () => walletApi.getTransactions(limit, offset),
    });
}


export function useWithdraw() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({
            amount,
            phone,
            network,
            nonce,
            signature,
        }: walletApi.WithdrawRequest & walletApi.WithdrawSolOptions) =>
            walletApi.withdrawWallet(amount, phone, network, { nonce, signature }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: walletApi.walletKeys.all });
        },
    });
}

// ============ Sessions Hooks ============

export function useSessions() {
    return useQuery({
        queryKey: sessionsApi.sessionKeys.lists(),
        queryFn: sessionsApi.getSessions,
    });
}

export function useSession(id: string) {
    return useQuery({
        queryKey: sessionsApi.sessionKeys.detail(id),
        queryFn: () => sessionsApi.getSession(id),
        enabled: !!id,
    });
}

export function useSessionUsage(id: string) {
    return useQuery({
        queryKey: sessionsApi.sessionKeys.usage(id),
        queryFn: () => usageApi.getSessionUsage(id),
        enabled: !!id,
        refetchInterval: 30000, // Refetch every 30 seconds
    });
}

export function useCreateSession() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: sessionsApi.createSessionIntent,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: sessionsApi.sessionKeys.intents() });
        },
    });
}

export function useCreateSessionIntent() {
    return useMutation({
        mutationFn: sessionsApi.createSessionIntent,
    });
}

export function useTerminateSession() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: sessionsApi.terminateSession,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: sessionsApi.sessionKeys.all });
        },
    });
}

export function useTotalUsage() {
    return useQuery({
        queryKey: sessionsApi.sessionKeys.totalUsage(),
        queryFn: usageApi.getUserUsage,
    });
}

// ============ Circles Hooks ============

export function useCircles() {
    return useQuery({
        queryKey: circlesApi.circleKeys.lists(),
        queryFn: circlesApi.getCircles,
    });
}

export function useCircle(id: string) {
    return useQuery({
        queryKey: circlesApi.circleKeys.detail(id),
        queryFn: () => circlesApi.getCircle(id),
        enabled: !!id,
    });
}

export function useCircleMembers(id: string) {
    return useQuery({
        queryKey: circlesApi.circleKeys.members(id),
        queryFn: () => circlesApi.getCircleMembers(id),
        enabled: !!id,
    });
}

export function useCircleStats(id: string) {
    return useQuery({
        queryKey: circlesApi.circleKeys.stats(id),
        queryFn: () => circlesApi.getCircleStats(id),
        enabled: !!id,
    });
}

export function useCreateCircle() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: circlesApi.createCircle,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: circlesApi.circleKeys.all });
        },
    });
}

export function useJoinCircle() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, message }: { id: string; message?: string }) =>
            circlesApi.joinCircle(id, message),
        onSuccess: (_, { id }) => {
            queryClient.invalidateQueries({ queryKey: circlesApi.circleKeys.detail(id) });
            queryClient.invalidateQueries({ queryKey: circlesApi.circleKeys.members(id) });
        },
    });
}

export function useLeaveCircle() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: circlesApi.leaveCircle,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: circlesApi.circleKeys.all });
        },
    });
}

// ============ Marketplace Hooks ============

export function useListings(
    filters?: marketplaceApi.ListingFilters,
    options?: { enabled?: boolean },
) {
    return useQuery({
        queryKey: marketplaceApi.marketplaceKeys.listings(filters),
        queryFn: () => marketplaceApi.getListings(filters!),
        enabled: options?.enabled !== false && filters !== undefined,
    });
}

export function useListing(id: string) {
    return useQuery({
        queryKey: marketplaceApi.marketplaceKeys.listing(id),
        queryFn: () => marketplaceApi.getListing(id),
        enabled: !!id,
    });
}

export function useFeaturedListings() {
    return useQuery({
        queryKey: marketplaceApi.marketplaceKeys.featured(),
        queryFn: () => marketplaceApi.getFeaturedListings(),
    });
}

export function useListingFacets() {
    return useQuery({
        queryKey: marketplaceApi.marketplaceKeys.facets(),
        queryFn: marketplaceApi.getListingFacets,
        staleTime: 5 * 60 * 1000,
    });
}

export function useListingCollections() {
    return useQuery({
        queryKey: marketplaceApi.marketplaceKeys.collections(),
        queryFn: async () => {
            const data = await marketplaceApi.getListingCollections();
            return data.collections ?? [];
        },
        staleTime: 5 * 60 * 1000,
    });
}

export function useListingCollection(slug: string | null, page = 1) {
    return useQuery({
        queryKey: marketplaceApi.marketplaceKeys.collection(slug ?? '', page),
        queryFn: () => marketplaceApi.getListingCollection(slug!, page),
        enabled: Boolean(slug),
    });
}

export function useSearchListings(query: string) {
    return useQuery({
        queryKey: marketplaceApi.marketplaceKeys.search(query),
        queryFn: () => marketplaceApi.searchListings(query),
        enabled: query.length > 2,
    });
}

export function useOrders(status?: string) {
    return useQuery({
        queryKey: marketplaceApi.marketplaceKeys.orders(status),
        queryFn: () => marketplaceApi.getOrders(status as any),
    });
}

export function useCreateOrder() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: marketplaceApi.createOrder,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: marketplaceApi.marketplaceKeys.all });
            queryClient.invalidateQueries({ queryKey: walletApi.walletKeys.all });
        },
    });
}

export function useCancelOrder() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: marketplaceApi.cancelOrder,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: marketplaceApi.marketplaceKeys.all });
        },
    });
}
