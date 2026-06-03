"use client";

import { useAuth } from "@/lib/auth";
import {
    approveListing,
    getPendingListings,
    moderationKeys,
    rejectListing,
} from "@/lib/api/moderation";
import { marketplaceKeys } from "@/lib/api/marketplace";
import { useRole } from "@/hooks/useRole";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AlertCircle, ArrowLeft, Check, Loader2, Shield, X } from "lucide-react";
import { getErrorMessage } from "@/lib/utils";

export default function DashboardAdminModerationPage() {
    const { isAuthenticated } = useAuth();
    const { isAdmin } = useRole();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const limit = 20;

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: moderationKeys.pending(page),
        queryFn: () => getPendingListings(page, limit),
        enabled: isAuthenticated && isAdmin,
    });

    const approveMutation = useMutation({
        mutationFn: (id: string) => approveListing(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: moderationKeys.all });
            queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
        },
    });

    const rejectMutation = useMutation({
        mutationFn: ({ id, reason }: { id: string; reason?: string }) => rejectListing(id, reason),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: moderationKeys.all });
            queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
        },
    });

    if (!isAuthenticated) {
        return (
            <div className="max-w-3xl mx-auto px-4 py-16 text-center">
                <p className="text-muted-foreground mb-4">Sign in to access admin tools.</p>
                <Link href="/login" className="text-primary font-bold uppercase text-xs tracking-widest">
                    Log in
                </Link>
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
                <Shield className="mx-auto text-muted-foreground/40" size={48} />
                <p className="text-muted-foreground">Admin or moderator access is required.</p>
                <Link href="/dashboard" className="text-primary font-bold uppercase text-xs tracking-widest">
                    Back to dashboard
                </Link>
            </div>
        );
    }

    const listings = data?.listings ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return (
        <div className="max-w-4xl mx-auto px-4 py-10 space-y-8" data-testid="admin-listing-moderation">
            <div>
                <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 text-[10px] font-bold text-muted-foreground hover:text-primary uppercase tracking-widest mb-3"
                >
                    <ArrowLeft size={12} /> Dashboard
                </Link>
                <div className="flex items-center gap-2 text-primary font-bold uppercase tracking-wider text-xs mb-2">
                    <Shield size={14} />
                    Marketplace moderation
                </div>
                <h1 className="text-3xl font-black tracking-tighter uppercase italic">
                    Pending <span className="text-primary">listings</span>
                </h1>
                <p className="text-sm text-muted-foreground mt-2">
                    Approve listings before they appear on browse, search, and map when{" "}
                    <code className="text-xs bg-white/5 px-1 rounded">MARKETPLACE_LISTING_MODERATION=enforce</code>{" "}
                    is set on the API.
                </p>
            </div>

            {isLoading && (
                <div className="flex flex-col items-center py-16 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                        Loading queue…
                    </p>
                </div>
            )}

            {error && (
                <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-sm text-red-400">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <span>{getErrorMessage(error)}</span>
                </div>
            )}

            {!isLoading && !error && listings.length === 0 && (
                <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
                    <p className="text-muted-foreground">No listings awaiting review.</p>
                </div>
            )}

            <ul className="space-y-3">
                {listings.map((listing) => (
                    <li
                        key={listing.id}
                        className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-3"
                        data-testid={`pending-listing-${listing.id}`}
                    >
                        <div>
                            <h2 className="font-bold">{listing.title}</h2>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {listing.description}
                            </p>
                            <p className="text-[10px] font-mono text-primary/80 mt-2">
                                {listing.country} · {listing.proxy_type} · {listing.price_per_gb} USD/GB
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                disabled={approveMutation.isPending}
                                onClick={() => approveMutation.mutate(listing.id)}
                                className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1 disabled:opacity-50"
                            >
                                <Check size={12} /> Approve
                            </button>
                            <button
                                type="button"
                                disabled={rejectMutation.isPending}
                                onClick={() => {
                                    const reason = window.prompt("Rejection reason (optional):", "");
                                    if (reason === null) return;
                                    rejectMutation.mutate({ id: listing.id, reason: reason || undefined });
                                }}
                                className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1 disabled:opacity-50"
                            >
                                <X size={12} /> Reject
                            </button>
                            <button
                                type="button"
                                onClick={() => void refetch()}
                                className="px-4 py-2 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
                            >
                                Refresh
                            </button>
                        </div>
                    </li>
                ))}
            </ul>

            {total > limit && (
                <div className="flex justify-center items-center gap-6">
                    <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="text-[10px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-30"
                    >
                        Previous
                    </button>
                    <span className="text-sm font-mono">
                        {page} / {totalPages}
                    </span>
                    <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="text-[10px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-30"
                    >
                        Next
                    </button>
                </div>
            )}
        </div>
    );
}
