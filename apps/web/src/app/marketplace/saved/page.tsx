"use client";

import { useAuth } from "@/lib/auth";
import { getSavedListings, marketplaceKeys, unsaveListing } from "@/lib/api/marketplace";
import { displayListingTitle } from "@/lib/listing-display";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AlertCircle, ArrowLeft, Bookmark, Heart, Loader2 } from "lucide-react";

export default function SavedListingsPage() {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const limit = 20;

    const { data, isLoading, error } = useQuery({
        queryKey: [...marketplaceKeys.saved(), page],
        queryFn: () => getSavedListings(page, limit),
        enabled: isAuthenticated,
    });

    const unsaveMutation = useMutation({
        mutationFn: (listingId: string) => unsaveListing(listingId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
        },
    });

    const entries = data?.saved ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    if (!isAuthenticated) {
        return (
            <div className="max-w-3xl mx-auto px-4 py-16 text-center">
                <p className="text-muted-foreground mb-4">Sign in to view saved listings.</p>
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
                    <Bookmark size={14} />
                    Buyer
                </div>
                <h1 className="text-3xl font-black tracking-tighter uppercase italic">
                    Saved <span className="text-purple-500">Listings</span>
                </h1>
            </div>

            {isLoading && (
                <div className="flex flex-col items-center py-20 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                </div>
            )}

            {error && (
                <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-sm text-red-400">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <span>{error instanceof Error ? error.message : "Failed to load saved listings"}</span>
                </div>
            )}

            {!isLoading && !error && entries.length === 0 && (
                <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
                    <p className="text-muted-foreground mb-4">No saved listings yet.</p>
                    <Link href="/marketplace" className="text-purple-400 font-bold uppercase text-xs tracking-widest">
                        Browse marketplace
                    </Link>
                </div>
            )}

            <ul className="space-y-3">
                {entries.map((entry) => {
                    const listing = entry.listing;
                    if (!listing) return null;
                    return (
                        <li
                            key={entry.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-white/10 bg-white/[0.02]"
                        >
                            <div className="min-w-0">
                                <Link href={`/marketplace/${listing.id}`} className="font-bold hover:text-purple-400">
                                    {displayListingTitle(listing)}
                                </Link>
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{listing.description}</p>
                                <p className="text-[10px] font-mono text-purple-400/80 mt-2">
                                    {Number(listing.price_per_gb || 0).toFixed(6)} SOL/GB · {listing.available_bandwidth_gb} GB avail
                                </p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <Link
                                    href={`/marketplace/${listing.id}`}
                                    className="px-3 py-2 rounded-lg border border-purple-500/20 text-purple-400 text-[10px] font-bold uppercase tracking-widest"
                                >
                                    View
                                </Link>
                                <button
                                    type="button"
                                    disabled={unsaveMutation.isPending}
                                    onClick={() => unsaveMutation.mutate(listing.id)}
                                    className="px-3 py-2 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-widest hover:bg-white/5 inline-flex items-center gap-1"
                                >
                                    <Heart size={12} /> Remove
                                </button>
                            </div>
                        </li>
                    );
                })}
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
