"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Ban,
  CalendarDays,
  Globe,
  MapPin,
  MessageSquare,
  Settings2,
  ShieldCheck,
  Star,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getProfile,
  getUserReviews,
  followUser,
  unfollowUser,
  blockUser,
  type UserPublicProfile,
} from "@/lib/api/profile";
import { getUserBadges } from "@/lib/api/badges";
import { getListings } from "@/lib/api/marketplace";
import { accountTierLabel, identityStatusLabel } from "@/lib/account-tier";
import { displayListingTitle } from "@/lib/listing-display";
import { Modal } from "@/components/patterns/Modal";
import {
  DataError,
  EmptyState,
  Loading,
  Stat,
  Status,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";

function externalLink(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
export function ProfileView({ username = "me" }: { username?: string }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const own =
    username === "me" ||
    (!!user && [user.id, user.username].includes(username));
  const identifier = own ? "me" : username;
  const key = ["public-profile", identifier, user?.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => getProfile(identifier),
    enabled: !own || isAuthenticated,
  });
  const profile = query.data;
  const [tab, setTab] = useState<"reviews" | "listings">("reviews");
  const [blockOpen, setBlockOpen] = useState(false);
  const reviews = useQuery({
    queryKey: ["profile-reviews", profile?.id],
    queryFn: () => getUserReviews(profile!.id),
    enabled: !!profile,
  });
  const listings = useQuery({
    queryKey: ["profile-listings", profile?.id],
    queryFn: () =>
      getListings({ seller_id: profile!.id, limit: 8, sort_by: "newest" }),
    enabled: !!profile,
  });
  const badges = useQuery({
    queryKey: ["profile-badges", profile?.id],
    queryFn: () => getUserBadges(profile!.id),
    enabled: !!profile,
  });
  const follow = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!profile) return;
      if (profile.is_following) await unfollowUser(profile.id);
      else await followUser(profile.id);
    },
    onSuccess: () => {
      client.setQueryData<UserPublicProfile>(key, (previous) =>
        previous
          ? {
              ...previous,
              is_following: !previous.is_following,
              followers_count: Math.max(
                0,
                (previous.followers_count ?? 0) +
                  (previous.is_following ? -1 : 1),
              ),
            }
          : previous,
      );
    },
  });
  const block = useMutation({
    retry: false,
    mutationFn: () => blockUser(profile!.id),
    onSuccess: () => {
      setBlockOpen(false);
      void client.invalidateQueries({ queryKey: ["public-profile"] });
      router.push("/marketplace");
    },
  });
  if (own && !isLoading && !isAuthenticated)
    return (
      <EmptyState
        title="Sign in to view your profile"
        description="Your account profile and editing tools are available after signing in."
        href="/login?next=%2Fprofile"
        action="Sign in"
      />
    );
  if (isLoading || query.isPending) return <Loading label="Loading profile…" />;
  if (query.isError || !profile)
    return (
      <div className="ui-page">
        <Link className="ui-link" href="/marketplace">
          ← Back to marketplace
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Profile unavailable</h1>
        <DataError
          title="This profile is unavailable"
          error={query.error}
          retry={() => void query.refetch()}
        />
      </div>
    );
  const name = profile.display_name || profile.username;
  const website = externalLink(profile.website);
  const hasRating =
    profile.reviews_count > 0 && Number.isFinite(profile.avg_rating);
  return (
    <div className="ui-page public-profile">
      <Link href="/marketplace" className="ui-button ghost self-start">
        <ArrowLeft size={15} />
        Marketplace
      </Link>
      <section className="profile-identity ui-surface">
        <div className="profile-cover" aria-hidden="true">
          {profile.cover_image_url && (
            <Image
              src={profile.cover_image_url}
              fill
              sizes="100vw"
              alt=""
              unoptimized
            />
          )}
        </div>
        <div className="profile-identity-content">
          <div className="profile-avatar">
            {profile.avatar_url ? (
              <Image
                src={profile.avatar_url}
                width={112}
                height={112}
                alt=""
                unoptimized
              />
            ) : (
              name.slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="profile-name">
            <p className="ui-eyebrow">
              {profile.business_name || profile.role} / Community profile
            </p>
            <h1>{name}</h1>
            <p>
              @{profile.username}
              {profile.professional_title
                ? " · " + profile.professional_title
                : ""}
            </p>
          </div>
          <div className="profile-actions">
            {own ? (
              <Link className="ui-button" href="/app/settings">
                <Settings2 size={15} />
                Edit profile
              </Link>
            ) : isAuthenticated ? (
              <>
                <button
                  className="ui-button"
                  type="button"
                  disabled={follow.isPending}
                  aria-pressed={!!profile.is_following}
                  onClick={() => follow.mutate()}
                >
                  <Users size={15} />
                  {follow.isPending
                    ? "Updating…"
                    : profile.is_following
                      ? "Following"
                      : "Follow"}
                </button>
                <Link
                  className="ui-button secondary"
                  href={"/messages?recipient=" + encodeURIComponent(profile.id)}
                >
                  <MessageSquare size={15} />
                  Message
                </Link>
              </>
            ) : (
              <Link
                className="ui-button"
                href={
                  "/login?next=" +
                  encodeURIComponent("/profile/" + profile.username)
                }
              >
                Sign in to connect
              </Link>
            )}
          </div>
        </div>
        <div className="profile-meta">
          <span>
            <ShieldCheck size={15} />
            Identity: {identityStatusLabel(profile.verified)}
          </span>
          <span>Account tier: {accountTierLabel(profile.trust_tier)}</span>
          {profile.location && (
            <span>
              <MapPin size={15} />
              {profile.location}
            </span>
          )}
          <span>
            <CalendarDays size={15} />
            Joined {shortDate(profile.created_at)}
          </span>
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer">
              <Globe size={15} />
              Website
              <ArrowUpRight size={12} />
            </a>
          )}
        </div>
      </section>
      {follow.isError && (
        <DataError title="Follow status was not updated" error={follow.error} />
      )}
      <div className="ui-stats">
        <Stat
          label="Followers"
          value={amount(profile.followers_count, 0)}
          detail="Community members following this account"
          icon={<Users size={18} />}
        />
        <Stat
          label="Following"
          value={amount(profile.following_count, 0)}
          detail="Accounts followed by this member"
          icon={<Users size={18} />}
        />
        <Stat
          label="Review rating"
          value={
            hasRating ? amount(profile.avg_rating, 1) + " / 5" : "No reviews"
          }
          detail={
            hasRating
              ? amount(profile.reviews_count, 0) + " published reviews"
              : "A rating has not been established"
          }
          icon={<Star size={18} />}
        />
      </div>
      <div className="profile-body">
        <aside className="profile-about ui-surface">
          <p className="ui-eyebrow">About this member</p>
          <h2>{profile.professional_title || "A member of the network"}</h2>
          <p>{profile.bio || "This member has not added a bio yet."}</p>
          {profile.total_bandwidth_sold != null && (
            <dl>
              <div>
                <dt>Bandwidth sold</dt>
                <dd>{amount(profile.total_bandwidth_sold)} GB</dd>
              </div>
            </dl>
          )}
          {profile.experience_years > 0 && (
            <p>{profile.experience_years} years of experience</p>
          )}
          {!!profile.languages?.length && (
            <p>Languages · {profile.languages.join(", ")}</p>
          )}
          {!!profile.skills?.length && (
            <div className="profile-tags">
              {profile.skills.map((skill) => (
                <span className="ui-tag" key={skill}>
                  {skill}
                </span>
              ))}
            </div>
          )}
          {Object.entries(profile.social_links ?? {}).flatMap(
            ([label, value]) => {
              const url = externalLink(value);
              return url
                ? [
                    <a
                      className="ui-link profile-social"
                      key={label}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {label}
                      <ArrowUpRight size={12} />
                    </a>,
                  ]
                : [];
            },
          )}
          <div className="profile-badges">
            <h3>Earned badges</h3>
            {badges.isPending ? (
              <p className="ui-subtle">Loading badges…</p>
            ) : badges.isError ? (
              <p className="ui-subtle">Badges are unavailable.</p>
            ) : !badges.data.badges.length ? (
              <p className="ui-subtle">No earned badges reported.</p>
            ) : (
              badges.data.badges.map((badge) => (
                <span
                  className="ui-tag"
                  key={badge.badge_id}
                  title={badge.badge?.description}
                >
                  {badge.badge?.name || "Earned badge"}
                </span>
              ))
            )}
          </div>
          {!own && isAuthenticated && (
            <button
              className="profile-block"
              type="button"
              onClick={() => setBlockOpen(true)}
            >
              <Ban size={14} />
              Block member
            </button>
          )}
        </aside>
        <section className="profile-content">
          <nav className="ui-tabs" aria-label="Profile content">
            <button
              type="button"
              aria-pressed={tab === "reviews"}
              className={tab === "reviews" ? "active" : ""}
              onClick={() => setTab("reviews")}
            >
              Reviews
            </button>
            <button
              type="button"
              aria-pressed={tab === "listings"}
              className={tab === "listings" ? "active" : ""}
              onClick={() => setTab("listings")}
            >
              Offers
            </button>
          </nav>
          {tab === "reviews" ? (
            reviews.isPending ? (
              <Loading label="Loading reviews…" />
            ) : reviews.isError ? (
              <DataError
                title="Reviews are unavailable"
                error={reviews.error}
                retry={() => void reviews.refetch()}
              />
            ) : !reviews.data.reviews.length ? (
              <EmptyState
                title="No reviews yet"
                description="Published reviews will appear here when available."
              />
            ) : (
              <div className="profile-review-list">
                {reviews.data.reviews.map((review) => (
                  <article
                    className="ui-surface profile-review"
                    key={review.id}
                  >
                    <header>
                      <div>
                        <strong>
                          {review.reviewer?.display_name ||
                            review.reviewer?.username ||
                            "Community member"}
                        </strong>
                        <span>{shortDate(review.created_at)}</span>
                      </div>
                      <span className="profile-rating">
                        <Star size={14} />
                        {amount(review.rating, 1)} / 5
                      </span>
                    </header>
                    {review.verified_purchase && (
                      <Status tone="good">Verified purchase</Status>
                    )}
                    <h3>{review.title}</h3>
                    <p>{review.content}</p>
                    {review.seller_response && (
                      <blockquote>
                        <strong>Provider response</strong>
                        <p>{review.seller_response}</p>
                      </blockquote>
                    )}
                  </article>
                ))}
              </div>
            )
          ) : listings.isPending ? (
            <Loading label="Loading offers…" />
          ) : listings.isError ? (
            <DataError
              title="Offers are unavailable"
              error={listings.error}
              retry={() => void listings.refetch()}
            />
          ) : !listings.data.listings.length ? (
            <EmptyState
              title="No published offers"
              description="This member has no offers in the current result set."
            />
          ) : (
            <div className="profile-offers">
              {listings.data.listings.map((listing) => (
                <Link
                  className="ui-surface profile-offer"
                  key={listing.id}
                  href={"/marketplace/" + listing.id}
                >
                  <div>
                    <Status
                      tone={listing.status === "active" ? "good" : "neutral"}
                    >
                      {listing.status}
                    </Status>
                    <span className="ui-subtle">
                      {listing.country || "Location not specified"}
                    </span>
                  </div>
                  <h3>{displayListingTitle(listing)}</h3>
                  <p>
                    {listing.proxy_type} · {listing.protocol}
                  </p>
                  <div>
                    <strong>
                      {"$" + amount(listing.price_per_gb, 4)}
                      <small> / GB</small>
                    </strong>
                    <span>
                      {amount(listing.available_bandwidth_gb)} GB available
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      <Modal
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title={"Block " + name + "?"}
        description="This member will be removed from your follows. Review the account before confirming."
        footer={
          <button
            type="button"
            className="ui-button danger"
            disabled={block.isPending}
            onClick={() => block.mutate()}
          >
            {block.isPending ? "Blocking…" : "Block member"}
          </button>
        }
      >
        {block.isError && (
          <DataError title="The member was not blocked" error={block.error} />
        )}
        <p className="ui-note">
          @{profile.username} · {profile.id}
        </p>
      </Modal>
    </div>
  );
}
