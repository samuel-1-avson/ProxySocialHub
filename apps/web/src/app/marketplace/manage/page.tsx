"use client";

import { useAuth } from "@/lib/auth";
import { deleteListing, getMyListings, marketplaceKeys, updateListing, type Listing } from "@/lib/api/marketplace";
import { displayListingTitle } from "@/lib/listing-display";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import {
    AlertCircle,
    ArrowLeft,
    FileCode,
    Loader2,
    Plus,
    Trash2,
    ExternalLink,
    Pause,
    Play,
    Pencil,
    Package,
} from "lucide-react";
import { getErrorMessage } from "@/lib/utils";

export default function ManageListingsPage() {
    const { isAuthenticated } = useAuth();
    const searchParams = useSearchParams();
    const submittedPendingReview = searchParams.get("submitted") === "pending_review";
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const limit = 20;
    const [editing, setEditing] = useState<Listing | null>(null);
    const [editForm, setEditForm] = useState({
        title: "",
        description: "",
        price_per_gb: "",
        available_bandwidth_gb: "",
    });

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

    const statusMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: 'active' | 'paused' }) =>
            updateListing(id, { status }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
        },
    });

    const editMutation = useMutation({
        mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateListing>[1] }) =>
            updateListing(id, payload),
        onSuccess: () => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
        },
    });

    const openEdit = (listing: Listing) => {
        setEditing(listing);
        setEditForm({
            title: listing.title,
            description: listing.description ?? "",
            price_per_gb: String(listing.price_per_gb),
            available_bandwidth_gb: String(listing.available_bandwidth_gb),
        });
    };

    const submitEdit = () => {
        if (!editing) return;
        const price = parseFloat(editForm.price_per_gb);
        const bandwidth = parseFloat(editForm.available_bandwidth_gb);
        if (!editForm.title.trim()) return;
        if (Number.isNaN(price) || price <= 0) return;
        if (Number.isNaN(bandwidth) || bandwidth <= 0) return;
        editMutation.mutate({
            id: editing.id,
            payload: {
                title: editForm.title.trim(),
                description: editForm.description.trim(),
                price_per_gb: price,
                available_bandwidth_gb: bandwidth,
            },
        });
    };

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
                <div className="flex flex-wrap gap-2">
                    <Link
                        href="/marketplace/manage/products"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-violet-500/30 text-violet-300 hover:bg-violet-500/10 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                    >
                        Catalog products
                    </Link>
                    <Link
                        href="/marketplace/create"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                    >
                        <Plus size={14} /> New listing
                    </Link>
                </div>
            </div>

            {submittedPendingReview && (
                <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-sm">
                    <p className="font-bold text-amber-300 uppercase text-xs tracking-widest mb-1">
                        Submitted for review
                    </p>
                    <p className="text-muted-foreground">
                        Your listing is not visible on the public marketplace until a moderator approves it.
                    </p>
                </div>
            )}

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
                                <h2 className="font-bold truncate">{displayListingTitle(listing)}</h2>
                                <span
                                    className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                                        listing.status === "pending_review"
                                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                            : "bg-white/5 text-muted-foreground"
                                    }`}
                                >
                                    {listing.status === "pending_review" ? "Under review" : listing.status}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{listing.description}</p>
                            <p className="text-[10px] font-mono text-purple-400/80 mt-2">
                                {Number(listing.price_per_gb || 0).toFixed(4)} USD/GB · {listing.available_bandwidth_gb} GB avail ·{" "}
                                {listing.orders_count} orders
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                disabled={listing.status === "pending_review"}
                                title={
                                    listing.status === "pending_review"
                                        ? "Editing is disabled until moderation approves this listing"
                                        : undefined
                                }
                                onClick={() => openEdit(listing)}
                                className="px-3 py-2 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-widest hover:bg-white/5 inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <Pencil size={12} /> Edit
                            </button>
                            <Link
                                href={`/marketplace/${listing.id}`}
                                className="px-3 py-2 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-widest hover:bg-white/5 inline-flex items-center gap-1"
                            >
                                View <ExternalLink size={12} />
                            </Link>
                            {listing.status === "pending_review" ? (
                                <span className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-400/80">
                                    Awaiting approval
                                </span>
                            ) : listing.status === 'active' ? (
                                <button
                                    type="button"
                                    disabled={statusMutation.isPending}
                                    onClick={() => statusMutation.mutate({ id: listing.id, status: 'paused' })}
                                    className="px-3 py-2 rounded-lg border border-amber-500/20 text-amber-400 text-[10px] font-bold uppercase tracking-widest hover:bg-amber-500/10 inline-flex items-center gap-1 disabled:opacity-50"
                                >
                                    <Pause size={12} /> Pause
                                </button>
                            ) : listing.status === 'paused' ? (
                                <button
                                    type="button"
                                    disabled={statusMutation.isPending}
                                    onClick={() => statusMutation.mutate({ id: listing.id, status: 'active' })}
                                    className="px-3 py-2 rounded-lg border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500/10 inline-flex items-center gap-1 disabled:opacity-50"
                                >
                                    <Play size={12} /> Activate
                                </button>
                            ) : null}
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

            {editing && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
                    role="dialog"
                    aria-labelledby="edit-listing-title"
                >
                    <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 space-y-4">
                        <h2 id="edit-listing-title" className="text-lg font-black uppercase tracking-tight">
                            Edit listing
                        </h2>
                        <label className="block space-y-1">
                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Title</span>
                            <input
                                value={editForm.title}
                                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-purple-500/40"
                            />
                        </label>
                        <label className="block space-y-1">
                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Description</span>
                            <textarea
                                rows={3}
                                value={editForm.description}
                                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-purple-500/40 resize-none"
                            />
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                            <label className="block space-y-1">
                                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">SOL / GB</span>
                                <input
                                    type="number"
                                    min={0}
                                    step="0.0001"
                                    value={editForm.price_per_gb}
                                    onChange={(e) => setEditForm((f) => ({ ...f, price_per_gb: e.target.value }))}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono outline-none focus:border-purple-500/40"
                                />
                            </label>
                            <label className="block space-y-1">
                                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Available GB</span>
                                <input
                                    type="number"
                                    min={0}
                                    step="1"
                                    value={editForm.available_bandwidth_gb}
                                    onChange={(e) =>
                                        setEditForm((f) => ({ ...f, available_bandwidth_gb: e.target.value }))
                                    }
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono outline-none focus:border-purple-500/40"
                                />
                            </label>
                        </div>
                        {editMutation.isError && (
                            <p className="text-sm text-red-400">{getErrorMessage(editMutation.error)}</p>
                        )}
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setEditing(null)}
                                className="px-4 py-2 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-widest"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={editMutation.isPending}
                                onClick={submitEdit}
                                className="px-4 py-2 rounded-lg bg-purple-600 text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
