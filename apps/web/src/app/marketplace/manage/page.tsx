"use client";

import { useAuth } from "@/lib/auth";
import { deleteListing, getMyListings, marketplaceKeys, type Listing } from "@/lib/api/marketplace";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
    AlertCircle,
    ArrowLeft,
    FileCode,
    Loader2,
    Plus,
    Trash2,
    ExternalLink,
} from "lucide-react";

export default function ManageListingsPage() {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const limit = 20;

    const { data, isLoading, error } = useQuery({
        queryKey: marketplaceKeys.myListings(page),
        queryFn: () => getMyListings(page, limit),
        enabled: isAuthenticated,
    });

    const removeMutation = useMutation({
        mutationFn: (id: string) => deleteListing(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
        },
    });

    const listings = data?.listings ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    if (!isAuthenticated) {
        return (
            <div className="max-w-3xl mx-auto px-4 py-16 text-center">
                <p className="text-muted-foreground mb-4">Sign in to manage your marketplace listings.</p>
                <Link href="/login" className="text-purple-400 font-bold uppercase text-xs tracking-widest">
                    Log in
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <Link
                        href="/marketplace"
                        className="inline-flex items-center gap-2 text-[10px] font-bold text-muted-foreground hover:text-purple-400 uppercase tracking-widest mb-3"
                    >
                        <ArrowLeft size={12} /> Marketplace
                    </Link>
                    <div className="flex items-center gap-2 text-purple-500 font-bold uppercase tracking-wider text-xs mb-2">
                        <FileCode size={14} />
                        Seller
                    </div>
                    <h1 className="text-3xl font-black tracking-tighter uppercase italic">
                        My <span className="text-purple-500">Listings</span>
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Create, review, and remove proxy listings tied to your provider nodes.
                    </p>
                </div>
                <Link
                    href="/marketplace/create"
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                >
                    <Plus size={14} /> New listing
                </Link>
            </div>

            {isLoading && (
                <div className="flex flex-col items-center py-20 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Loading listings…</p>
                </div>
            )}

            {error && (
                <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-sm text-red-400">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <span>{error instanceof Error ? error.message : "Failed to load listings"}</span>
                </div>
            )}

            {!isLoading && !error && listings.length === 0 && (
                <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
                    <p className="text-muted-foreground mb-4">You have no listings yet.</p>
                    <Link
                        href="/marketplace/create"
                        className="text-purple-400 font-bold uppercase text-xs tracking-widest"
                    >
                        Create your first listing
                    </Link>
                </div>
            )}

            <ul className="space-y-3">
                {listings.map((listing: Listing) => (
                    <li
                        key={listing.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-white/10 bg-white/[0.02] hover:border-purple-500/20 transition-colors"
                    >
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="font-bold truncate">{listing.title}</h2>
                                <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground">
                                    {listing.status}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{listing.description}</p>
                            <p className="text-[10px] font-mono text-purple-400/80 mt-2">
                                {listing.price_per_gb} USD/GB · {listing.available_bandwidth_gb} GB avail ·{" "}
                                {listing.orders_count} orders
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Link
                                href={`/marketplace/${listing.id}`}
                                className="px-3 py-2 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-widest hover:bg-white/5 inline-flex items-center gap-1"
                            >
                                View <ExternalLink size={12} />
                            </Link>
                            <button
                                type="button"
                                disabled={removeMutation.isPending}
                                onClick={() => {
                                    if (!confirm(`Delete listing "${listing.title}"?`)) return;
                                    removeMutation.mutate(listing.id);
                                }}
                                className="px-3 py-2 rounded-lg border border-red-500/20 text-red-400 text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/10 inline-flex items-center gap-1 disabled:opacity-50"
                            >
                                <Trash2 size={12} /> Delete
                            </button>
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
