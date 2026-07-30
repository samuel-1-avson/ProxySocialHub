"use client";

import { useAuth } from "@/lib/auth";
import {
    cancelOrder,
    getOrders,
    marketplaceKeys,
    orderCancelEligible,
    orderCredentialsEligible,
    orderStatusLabel,
    type Order,
} from "@/lib/api/marketplace";
import { getErrorMessage } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ROUTES } from "@/lib/navigation/routes";
import { useState } from "react";
import { AlertCircle, ArrowLeft, Loader2, Package } from "lucide-react";

function orderTotal(order: Order) {
    return order.total_price ?? order.price_total ?? 0;
}

export default function MarketplaceOrdersPage() {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const limit = 20;

    const { data, isLoading, error } = useQuery({
        queryKey: marketplaceKeys.orders(`page-${page}`),
        queryFn: () => getOrders(),
        enabled: isAuthenticated,
    });

    const cancelMutation = useMutation({
        mutationFn: (id: string) => cancelOrder(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
        },
    });

    const orders = data ?? [];
    const total = orders.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    if (!isAuthenticated) {
        return (
            <div className="max-w-3xl mx-auto px-4 py-16 text-center">
                <p className="text-muted-foreground mb-4">Sign in to view your marketplace orders.</p>
                <Link href="/login" className="text-purple-400 font-bold uppercase text-xs tracking-widest">
                    Log in
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
            <div>
                <Link
                    href="/marketplace"
                    className="inline-flex items-center gap-2 text-[10px] font-bold text-muted-foreground hover:text-purple-400 uppercase tracking-widest mb-3"
                >
                    <ArrowLeft size={12} /> Marketplace
                </Link>
                <div className="flex items-center gap-2 text-purple-500 font-bold uppercase tracking-wider text-xs mb-2">
                    <Package size={14} />
                    Buyer
                </div>
                <h1 className="text-3xl font-black tracking-tighter uppercase italic">
                    My <span className="text-purple-500">Orders</span>
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Track purchases, escrow status, and linked sessions.
                </p>
            </div>

            {isLoading && (
                <div className="flex flex-col items-center py-20 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                </div>
            )}

            {error && (
                <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-sm text-red-400">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <span>{error instanceof Error ? error.message : "Failed to load orders"}</span>
                </div>
            )}

            {!isLoading && !error && orders.length === 0 && (
                <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
                    <p className="text-muted-foreground mb-4">No marketplace orders yet.</p>
                    <Link href="/marketplace/map" className="text-purple-400 font-bold uppercase text-xs tracking-widest">
                        Browse the map
                    </Link>
                </div>
            )}

            <ul className="space-y-3">
                {orders.map((order: Order) => (
                    <li
                        key={order.id}
                        className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-2"
                    >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                                <h2 className="font-bold">{order.listing?.title ?? "Marketplace order"}</h2>
                                <p className="text-[10px] font-mono text-muted-foreground mt-1">
                                    {order.bandwidth_gb} GB · {orderTotal(order).toFixed(6)} SOL
                                </p>
                            </div>
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5">
                                {orderStatusLabel(order.status)}
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {orderCancelEligible(order.status) && (
                                <button
                                    type="button"
                                    disabled={cancelMutation.isPending}
                                    onClick={() => {
                                        if (!confirm("Cancel this order?")) return;
                                        cancelMutation.mutate(order.id, {
                                            onError: (err) => alert(getErrorMessage(err)),
                                        });
                                    }}
                                    className="px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400 text-[10px] font-bold uppercase tracking-widest"
                                >
                                    Cancel
                                </button>
                            )}
                            {orderCredentialsEligible(order.status) && (
                                <Link
                                    href={ROUTES.dashboardOrder(order.id)}
                                    className="px-3 py-1.5 rounded-lg border border-purple-500/20 text-purple-400 text-[10px] font-bold uppercase tracking-widest"
                                    data-testid={`order-credentials-link-${order.id}`}
                                >
                                    View credentials
                                </Link>
                            )}
                        </div>
                    </li>
                ))}
            </ul>

            {totalPages > 1 && (
                <div className="flex justify-center gap-2">
                    <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg border border-white/10 disabled:opacity-40"
                    >
                        Previous
                    </button>
                    <span className="text-xs text-muted-foreground self-center">
                        Page {page} / {totalPages}
                    </span>
                    <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg border border-white/10 disabled:opacity-40"
                    >
                        Next
                    </button>
                </div>
            )}
        </div>
    );
}
