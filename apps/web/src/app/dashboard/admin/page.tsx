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
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Check,
  Loader2,
  MessageSquare,
  Shield,
  X,
} from "lucide-react";
import { getErrorMessage } from "@/lib/utils";

type AdminTab = "listings" | "forum" | "funnel";

export default function DashboardAdminModerationPage() {
  const { isAuthenticated } = useAuth();
  const { isAdmin } = useRole();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<AdminTab>("listings");
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: moderationKeys.pending(page),
    queryFn: () => getPendingListings(page, limit),
    enabled: isAuthenticated && isAdmin && tab === "listings",
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveListing(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: moderationKeys.all });
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      rejectListing(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: moderationKeys.all });
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-muted-foreground mb-4">
          Sign in to access admin tools.
        </p>
        <Link
          href="/login"
          className="text-primary font-bold normal-case text-xs tracking-normal"
        >
          Log in
        </Link>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <Shield className="mx-auto text-muted-foreground/40" size={48} />
        <p className="text-muted-foreground">
          Admin or moderator access is required.
        </p>
        <Link
          href="/dashboard"
          className="text-primary font-bold normal-case text-xs tracking-normal"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  const listings = data?.listings ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-primary normal-case tracking-normal mb-3"
        >
          <ArrowLeft size={12} /> Dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tighter normal-case italic">
          Moderation <span className="text-primary">console</span>
        </h1>
      </div>

      <div className="flex gap-2 border-b border-border pb-2 flex-wrap">
        <button
          type="button"
          onClick={() => setTab("listings")}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold normal-case tracking-normal ${
            tab === "listings"
              ? "bg-primary/10 text-primary border border-primary/30"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Shield size={14} /> Listings
        </button>
        <button
          type="button"
          onClick={() => setTab("forum")}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold normal-case tracking-normal ${
            tab === "forum"
              ? "bg-primary/10 text-primary border border-primary/30"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare size={14} /> Forum reports
        </button>
        <button
          type="button"
          onClick={() => setTab("funnel")}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold normal-case tracking-normal ${
            tab === "funnel"
              ? "bg-primary/10 text-primary border border-primary/30"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart3 size={14} /> Funnel
        </button>
      </div>

      {tab === "forum" ? (
        <ForumReportsQueue enabled={isAuthenticated && isAdmin} />
      ) : tab === "funnel" ? (
        <MarketplaceFunnelDashboard
          mode="admin"
          enabled={isAuthenticated && isAdmin}
        />
      ) : (
        <div data-testid="admin-listing-moderation" className="space-y-8">
          <div>
            <div className="flex items-center gap-2 text-primary font-bold normal-case tracking-normal text-xs mb-2">
              <Shield size={14} />
              Marketplace listings
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Approve listings before they appear on browse, search, and map
              when{" "}
              <code className="text-xs bg-white/5 px-1 rounded">
                MARKETPLACE_LISTING_MODERATION=enforce
              </code>{" "}
              is set on the API.
            </p>
          </div>

          {isLoading && (
            <div className="flex flex-col items-center py-16 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-xs font-mono text-muted-foreground normal-case tracking-normal">
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
            <div className="text-center py-16 border border-dashed border-border rounded-2xl">
              <p className="text-muted-foreground">
                No listings awaiting review.
              </p>
            </div>
          )}

          <ul className="space-y-3">
            {listings.map((listing) => (
              <li
                key={listing.id}
                className="p-4 rounded-xl border border-border bg-white/[0.02] space-y-3"
                data-testid={`pending-listing-${listing.id}`}
              >
                <div>
                  <h2 className="font-bold">{listing.title}</h2>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {listing.description}
                  </p>
                  <p className="text-xs font-mono text-primary/80 mt-2">
                    {listing.country} · {listing.proxy_type} · $
                    {Number(listing.price_per_gb || 0).toFixed(4)}/GB
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate(listing.id)}
                    className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold normal-case tracking-normal inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <Check size={12} /> Approve
                  </button>
                  <button
                    type="button"
                    disabled={rejectMutation.isPending}
                    onClick={() => {
                      const reason = window.prompt(
                        "Rejection reason (optional):",
                        "",
                      );
                      if (reason === null) return;
                      rejectMutation.mutate({
                        id: listing.id,
                        reason: reason || undefined,
                      });
                    }}
                    className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold normal-case tracking-normal inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <X size={12} /> Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    className="px-4 py-2 rounded-lg border border-border text-xs font-bold normal-case tracking-normal text-muted-foreground hover:text-foreground"
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
                className="text-xs font-semibold normal-case tracking-normal text-muted-foreground disabled:opacity-30"
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
                className="text-xs font-semibold normal-case tracking-normal text-muted-foreground disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
