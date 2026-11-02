"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Star, Users, Wifi } from "lucide-react";
import {
  fetchListingSocialContext,
  type ListingSocialContext,
} from "@/lib/api/listing-social";
import { QuickMessageModal } from "@/components/QuickMessageModal";
import {
  FollowFeedHint,
  FollowProviderButton,
} from "@/components/social/FollowProviderButton";
import { useAuth } from "@/lib/auth";

interface ListingSocialPanelProps {
  listingId: string;
  listingTitle: string;
  pricePerGb?: number;
  location?: string;
  compact?: boolean;
  className?: string;
}

export function ListingSocialPanel({
  listingId,
  listingTitle,
  pricePerGb,
  location,
  compact = false,
  className = "",
}: ListingSocialPanelProps) {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["listing-social", listingId, user?.id];
  const {
    data: context,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => fetchListingSocialContext(listingId),
  });
  const [messageOpen, setMessageOpen] = useState(false);

  if (isPending)
    return (
      <div role="status" className={"listing-social-loading " + className}>
        <Loader2 size={15} className="animate-spin" />
        Loading provider context…
      </div>
    );
  if (isError || !context?.provider)
    return (
      <div className={"listing-social-unavailable " + className}>
        <p>Provider context is unavailable.</p>
        <button
          className="ui-link"
          onClick={() => void refetch()}
          type="button"
        >
          Try again
        </button>
      </div>
    );

  const provider = context.provider;
  const profileHref = "/profile/" + (provider.username || provider.id);
  const hasReviews = provider.reviews_count > 0;
  return (
    <>
      <section
        aria-label="About the provider"
        className={
          "listing-social-card ui-surface " +
          (compact ? "compact " : "") +
          className
        }
      >
        <p className="ui-eyebrow">Your provider</p>
        <div className="listing-provider-identity">
          <div className="listing-provider-avatar">
            {provider.avatar_url ? (
              <Image
                src={provider.avatar_url}
                alt=""
                width={44}
                height={44}
                unoptimized
              />
            ) : (
              <span>
                {(provider.display_name ||
                  provider.username ||
                  "?")[0]?.toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <Link href={profileHref} className="listing-provider-name">
              {provider.display_name || provider.username || "Provider"}
            </Link>
            <div className="listing-provider-rating">
              <Star size={13} aria-hidden="true" />
              {hasReviews && Number.isFinite(provider.avg_rating)
                ? provider.avg_rating.toFixed(1)
                : "No reviews yet"}
              {hasReviews && <span>· {provider.reviews_count} reviews</span>}
            </div>
          </div>
        </div>
        <div className="listing-provider-facts">
          <span>
            <Users size={14} aria-hidden="true" />
            {context.active_sessions_count ?? "…"} active /{" "}
            {context.total_sessions_count ?? "…"} total sessions
          </span>
          {provider.is_online && (
            <span>
              <Wifi size={14} aria-hidden="true" />
              Online
            </span>
          )}
          {!compact && provider.response_time_min > 0 && (
            <span>Typical reply · {provider.response_time_min} min</span>
          )}
        </div>
        <div className="listing-provider-actions">
          {context.allow_direct_message && (
            <button
              type="button"
              onClick={() => setMessageOpen(true)}
              className="ui-button secondary"
            >
              <MessageSquare size={15} />
              Message provider
            </button>
          )}
          {isAuthenticated && user?.id !== provider.id && (
            <FollowProviderButton
              providerId={provider.id}
              providerName={provider.display_name || provider.username}
              isFollowed={context.is_followed}
              compact={compact}
              onFollowChange={(followed) =>
                queryClient.setQueryData<ListingSocialContext | null>(
                  queryKey,
                  (previous) =>
                    previous
                      ? { ...previous, is_followed: followed }
                      : previous,
                )
              }
            />
          )}
        </div>
        {!compact && isAuthenticated && user?.id !== provider.id && (
          <FollowFeedHint />
        )}
        {context.has_existing_session && context.existing_session_id && (
          <Link
            className="ui-link text-sm"
            href={"/app/connections/" + context.existing_session_id}
          >
            View your active session →
          </Link>
        )}
      </section>
      <QuickMessageModal
        isOpen={messageOpen}
        onClose={() => setMessageOpen(false)}
        listingId={listingId}
        listingTitle={listingTitle}
        providerId={provider.id}
        providerName={provider.display_name || provider.username}
        providerAvatar={provider.avatar_url}
        providerOnline={provider.is_online}
        pricePerGb={pricePerGb}
        location={location}
      />
    </>
  );
}
