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
import { ForumReportsQueue } from "@/components/admin/ForumReportsQueue";
import { MarketplaceFunnelDashboard } from "@/components/admin/MarketplaceFunnelDashboard";
import { ConfirmDialog } from "@/components/patterns/ConfirmDialog";
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
} from "@/components/workspace/Patterns";
import { Check } from "lucide-react";
import { getErrorMessage } from "@/lib/utils";

type AdminTab = "listings" | "forum" | "funnel";

export default function DashboardAdminModerationPage() {
    const { isAuthenticated } = useAuth();
    const { isAdmin } = useRole();
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<AdminTab>("listings");
    const [page, setPage] = useState(1);
    const [rejectTarget, setRejectTarget] = useState<{ id: string; title: string } | null>(null);
    const [rejectReason, setRejectReason] = useState("");
    const limit = 20;

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: moderationKeys.pending(page),
        queryFn: () => getPendingListings(page, limit),
        enabled: isAuthenticated && isAdmin && tab === "listings",
    });

    const approveMutation = useMutation({
        retry: false,
        mutationFn: (id: string) => approveListing(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: moderationKeys.all });
            queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
        },
    });

    const rejectMutation = useMutation({
        retry: false,
        mutationFn: ({ id, reason }: { id: string; reason?: string }) => rejectListing(id, reason),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: moderationKeys.all });
            queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
            setRejectTarget(null);
            setRejectReason("");
        },
    });

    if (!isAuthenticated) {
        return (
            <div className="ui-page">
                <PageHeading
                    title="Moderation"
                    description="Sign in to access admin tools."
                    actions={
                        <Link href="/login" className="ui-button">
                            Log in
                        </Link>
                    }
                />
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="ui-page">
                <PageHeading
                    title="Moderation"
                    description="Admin or moderator access is required."
                    actions={
                        <Link href="/dashboard" className="ui-button secondary">
                            Back to dashboard
                        </Link>
                    }
                />
            </div>
        );
    }

    const listings = data?.listings ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return (
        <div className="ui-page">
            <PageHeading
                eyebrow="Admin"
                title="Moderation"
                description="Review marketplace listings, forum reports, and funnel health."
                actions={
                    <Link href="/dashboard" className="ui-button secondary">
                        Dashboard
                    </Link>
                }
            />

            <nav className="ui-tabs" aria-label="Moderation views">
                <button
                    type="button"
                    onClick={() => setTab("listings")}
                    className={tab === "listings" ? "active" : ""}
                >
                    Listings
                </button>
                <button
                    type="button"
                    onClick={() => setTab("forum")}
                    className={tab === "forum" ? "active" : ""}
                >
                    Forum reports
                </button>
                <button
                    type="button"
                    onClick={() => setTab("funnel")}
                    className={tab === "funnel" ? "active" : ""}
                >
                    Funnel
                </button>
            </nav>

            {tab === "forum" ? (
                <ForumReportsQueue enabled={isAuthenticated && isAdmin} />
            ) : tab === "funnel" ? (
                <MarketplaceFunnelDashboard mode="admin" enabled={isAuthenticated && isAdmin} />
            ) : (
                <div data-testid="admin-listing-moderation" className="space-y-8">
                    <p className="ui-note">
                        Approve listings before they appear on browse, search, and map when{" "}
                        <code className="ui-code" style={{ padding: "2px 6px", display: "inline" }}>
                            MARKETPLACE_LISTING_MODERATION=enforce
                        </code>{" "}
                        is set on the API.
                    </p>

                    {isLoading && <Loading label="Loading queue…" />}

                    {error && (
                        <DataError error={error} retry={() => void refetch()} />
                    )}

                    {!isLoading && !error && listings.length === 0 && (
                        <EmptyState
                            title="No listings awaiting review"
                            description="New submissions will appear here when moderation is enforced."
                        />
                    )}

                    <ul className="space-y-3">
                        {listings.map((listing) => (
                            <li
                                key={listing.id}
                                className="ui-surface space-y-3"
                                data-testid={`pending-listing-${listing.id}`}
                            >
                                <div>
                                    <h2>{listing.title}</h2>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {listing.description}
                                    </p>
                                    <p className="ui-note mt-2">
                                        {listing.country} · {listing.proxy_type} · $
                                        {Number(listing.price_per_gb || 0).toFixed(4)}/GB
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        disabled={approveMutation.isPending}
                                        onClick={() => approveMutation.mutate(listing.id)}
                                        className="ui-button small"
                                    >
                                        <Check size={14} aria-hidden="true" /> Approve
                                    </button>
                                    <button
                                        type="button"
                                        disabled={rejectMutation.isPending}
                                        onClick={() => {
                                            setRejectReason("");
                                            setRejectTarget({ id: listing.id, title: listing.title });
                                        }}
                                        className="ui-button small secondary"
                                    >
                                        Reject
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void refetch()}
                                        className="ui-button small ghost"
                                    >
                                        Refresh
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>

                    {total > limit && (
                        <div className="ui-pagination">
                            <button
                                type="button"
                                disabled={page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                className="ui-button small secondary"
                            >
                                Previous
                            </button>
                            <span>
                                {page} / {totalPages}
                            </span>
                            <button
                                type="button"
                                disabled={page >= totalPages}
                                onClick={() => setPage((p) => p + 1)}
                                className="ui-button small secondary"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </div>
            )}

            <ConfirmDialog
                open={rejectTarget !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setRejectTarget(null);
                        setRejectReason("");
                    }
                }}
                title="Reject listing"
                description={
                    rejectTarget
                        ? `Reject “${rejectTarget.title}”? It will not appear on browse, search, or map.`
                        : undefined
                }
                confirmLabel="Reject listing"
                cancelLabel="Keep listing"
                destructive
                loading={rejectMutation.isPending}
                error={rejectMutation.error ? getErrorMessage(rejectMutation.error) : undefined}
                onConfirm={() => {
                    if (!rejectTarget) return;
                    rejectMutation.mutate({
                        id: rejectTarget.id,
                        reason: rejectReason.trim() || undefined,
                    });
                }}
            >
                <label className="ui-field">
                    Rejection reason (optional)
                    <input
                        className="ui-input w-full"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Optional note for the seller"
                    />
                </label>
            </ConfirmDialog>
        </div>
    );
}
