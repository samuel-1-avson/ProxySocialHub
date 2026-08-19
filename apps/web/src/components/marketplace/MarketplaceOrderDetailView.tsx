'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, Loader2, Package } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
    getOrder,
    getOrderProxyCredentials,
    marketplaceKeys,
    orderCredentialsEligible,
    orderStatusDescription,
    orderStatusLabel,
    type MarketplaceProxyCredentials,
} from '@/lib/api/marketplace';
import { MarketplaceOrderCredentials } from '@/components/marketplace/MarketplaceOrderCredentials';
import { ExtensionConnectCard } from '@/components/marketplace/ExtensionConnectCard';
import { formatListingTotalUSD } from '@/lib/listing-price';

function orderTotal(order: { total_price?: number; price_total?: number }) {
    return order.total_price ?? order.price_total ?? 0;
}

type MarketplaceOrderDetailViewProps = {
    orderId: string;
    backHref: string;
    backLabel: string;
};

export function MarketplaceOrderDetailView({
    orderId,
    backHref,
    backLabel,
}: MarketplaceOrderDetailViewProps) {
    const { isAuthenticated } = useAuth();

    const orderQuery = useQuery({
        queryKey: marketplaceKeys.order(orderId),
        queryFn: () => getOrder(orderId),
        enabled: isAuthenticated && Boolean(orderId),
    });

    const credentialsEligible = orderCredentialsEligible(orderQuery.data?.status ?? '');

    const credentialsQuery = useQuery({
        queryKey: marketplaceKeys.orderCredentials(orderId),
        queryFn: async () => {
            const response = await getOrderProxyCredentials(orderId);
            const creds = (response.proxy_credentials ?? {}) as MarketplaceProxyCredentials;
            return {
                ...creds,
                session_capability: response.session_capability ?? creds.session_capability,
                session_capability_note: response.session_capability_note ?? creds.session_capability_note,
            };
        },
        enabled: isAuthenticated && Boolean(orderId) && credentialsEligible,
        retry: 2,
        refetchInterval: (query) => (query.state.error && !query.state.data ? 3000 : false),
    });

    if (!isAuthenticated) {
        return (
            <div className="max-w-3xl mx-auto px-4 py-16 text-center">
                <p className="text-muted-foreground mb-4">Sign in to view this order.</p>
                <Link href="/login" className="text-purple-400 font-bold uppercase text-xs tracking-widest">
                    Log in
                </Link>
            </div>
        );
    }

    const order = orderQuery.data;

    return (
        <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
            <div>
                <Link
                    href={backHref}
                    className="inline-flex items-center gap-2 text-[10px] font-bold text-muted-foreground hover:text-purple-400 uppercase tracking-widest mb-3"
                >
                    <ArrowLeft size={12} /> {backLabel}
                </Link>
                <div className="flex items-center gap-2 text-purple-500 font-bold uppercase tracking-wider text-xs mb-2">
                    <Package size={14} />
                    Order detail
                </div>
                <h1 className="text-3xl font-black tracking-tighter uppercase italic">
                    {order?.listing?.title ?? 'Marketplace order'}
                </h1>
            </div>

            {orderQuery.isLoading && (
                <div className="flex flex-col items-center py-16 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                </div>
            )}

            {orderQuery.error && (
                <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-sm text-red-400">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <span>{orderQuery.error instanceof Error ? orderQuery.error.message : 'Failed to load order'}</span>
                </div>
            )}

            {order && (
                <div className="space-y-6">
                    <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[10px] font-mono text-muted-foreground break-all">{order.id}</p>
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5">
                                {orderStatusLabel(order.status)}
                            </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {order.bandwidth_gb} GB · {formatListingTotalUSD(orderTotal(order))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {credentialsQuery.data
                                ? 'Escrow confirmed. Proxy credentials are available.'
                                : orderStatusDescription(order.status)}
                        </p>
                    </div>

                    {credentialsEligible && credentialsQuery.isLoading && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading proxy credentials…
                        </div>
                    )}

                    {credentialsEligible && credentialsQuery.data && (
                        <>
                            <ExtensionConnectCard
                                orderId={order.id}
                                listingTitle={order.listing?.title}
                            />
                            <MarketplaceOrderCredentials
                                credentials={credentialsQuery.data}
                                orderId={order.id}
                            />
                        </>
                    )}

                    {credentialsEligible && credentialsQuery.isError && (
                        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-sm text-amber-200">
                            <AlertCircle size={18} className="shrink-0 mt-0.5" />
                            <span>
                                Credentials are not available yet. If you just paid, wait for escrow confirmation and
                                refresh this page.
                            </span>
                        </div>
                    )}

                    {!credentialsEligible && (
                        <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] text-sm text-muted-foreground">
                            Proxy credentials appear here after escrow payment is confirmed and the order becomes active.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
