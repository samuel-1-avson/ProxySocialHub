"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import {
    getProfile,
    followUser,
    unfollowUser,
    blockUser,
    getUserReviews,
    type UserPublicProfile,
    type Review,
} from "@/lib/api/profile";
import { getUserBadges, type UserBadge } from "@/lib/api/badges";
import { accountTierLabel, identityStatusLabel } from "@/lib/account-tier";
import { getListings, type Listing } from "@/lib/api/marketplace";
import { socialProfileUrl } from "@/lib/utils";
import { ConfirmDialog } from "@/components/patterns/ConfirmDialog";
import {
    PageHeading,
    Loading,
    EmptyState,
    Stat,
} from "@/components/workspace/Patterns";
import {
    Star,
    ShieldCheck,
    UserCheck,
    Users,
    ExternalLink,
    Twitter,
    Github,
    Linkedin,
    Loader2,
} from "lucide-react";

interface ProfileViewProps {
    username?: string;
}

export function ProfileView({ username: propUsername }: ProfileViewProps) {
    const params = useParams();
    const router = useRouter();
    const { user: currentUser, isAuthenticated } = useAuth();

    const targetUsername = propUsername ?? (params?.username as string) ?? "me";

    const [profile, setProfile] = useState<UserPublicProfile | null>(null);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [badges, setBadges] = useState<UserBadge[]>([]);
    const [listings, setListings] = useState<Listing[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [isFollowing, setIsFollowing] = useState(false);
    const [activeTab, setActiveTab] = useState<"listings" | "reviews">("reviews");
    const [followLoading, setFollowLoading] = useState(false);
    const [followError, setFollowError] = useState("");
    const [blockOpen, setBlockOpen] = useState(false);
    const [blockLoading, setBlockLoading] = useState(false);
    const [blockError, setBlockError] = useState("");

    const isOwnProfile =
        targetUsername === "me" ||
        (currentUser && (targetUsername === currentUser.id || targetUsername === currentUser.username));

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            setError("");
            try {
                const identifier = isOwnProfile ? "me" : targetUsername;
                const userData = await getProfile(identifier);
                setProfile(userData);
                setIsFollowing(userData.is_following || false);

                try {
                    const reviewsData = await getUserReviews(userData.id);
                    setReviews(reviewsData.reviews || []);
                } catch {
                    setReviews([]);
                }

                try {
                    const listingData = await getListings({
                        seller_id: userData.id,
                        limit: 8,
                        sort_by: "newest",
                    });
                    setListings(listingData.listings || []);
                } catch {
                    setListings([]);
                }

                try {
                    const badgeData = await getUserBadges(userData.id);
                    setBadges(badgeData.badges || []);
                } catch {
                    setBadges([]);
                }
            } catch (err) {
                console.error("Profile fetch error:", err);
                setError(err instanceof Error ? err.message : "Failed to load profile");
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [targetUsername, isOwnProfile, isAuthenticated]);

    const handleFollow = async () => {
        if (!profile || !isAuthenticated) return;
        setFollowLoading(true);
        setFollowError("");
        try {
            if (isFollowing) {
                await unfollowUser(profile.id);
                setIsFollowing(false);
                setProfile((p) => (p ? { ...p, followers_count: p.followers_count - 1 } : null));
            } else {
                await followUser(profile.id);
                setIsFollowing(true);
                setProfile((p) => (p ? { ...p, followers_count: p.followers_count + 1 } : null));
            }
        } catch (err) {
            setFollowError(err instanceof Error ? err.message : "Could not update follow status.");
        } finally {
            setFollowLoading(false);
        }
    };

    const handleBlock = async () => {
        if (!profile || !isAuthenticated) return;
        setBlockLoading(true);
        setBlockError("");
        try {
            await blockUser(profile.id);
            setBlockOpen(false);
            router.push("/");
        } catch {
            setBlockError("Could not block this user.");
        } finally {
            setBlockLoading(false);
        }
    };

    if (loading) {
        return <Loading label="Loading profile…" />;
    }

    if (error || !profile) {
        return (
            <div className="ui-page">
                <EmptyState
                    title="Profile not found"
                    description={error || "No account with this username."}
                    href="/marketplace"
                    action="Browse marketplace"
                />
            </div>
        );
    }

    const showListingsTab =
        profile.role === "provider" || profile.role === "both" || listings.length > 0;

    return (
        <div className="ui-page">
            <PageHeading
                eyebrow={profile.location || "Location not listed"}
                title={profile.display_name || profile.username}
                description={`${accountTierLabel(profile.trust_tier)} · Identity: ${identityStatusLabel(profile.verified)}`}
                actions={
                    isOwnProfile ? (
                        <Link href="/dashboard/settings/identity" className="ui-button">
                            Edit profile
                        </Link>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => void handleFollow()}
                                disabled={followLoading}
                                className={`ui-button ${isFollowing ? "secondary" : ""}`}
                            >
                                {followLoading ? (
                                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                                ) : isFollowing ? (
                                    <UserCheck size={16} aria-hidden="true" />
                                ) : (
                                    <Users size={16} aria-hidden="true" />
                                )}
                                {isFollowing ? "Following" : "Follow"}
                            </button>
                            <Link href={`/messages?to=${profile.id}`} className="ui-button secondary">
                                Message
                            </Link>
                            <button
                                type="button"
                                onClick={() => {
                                    setBlockError("");
                                    setBlockOpen(true);
                                }}
                                className="ui-button secondary"
                            >
                                Block
                            </button>
                        </div>
                    )
                }
            />

            {followError ? (
                <p className="text-sm" role="alert">
                    {followError}
                </p>
            ) : null}

            <section className="ui-surface">
                <div className="flex flex-col sm:flex-row gap-6 items-start min-w-0">
                    <span className="ui-region overflow-hidden" style={{ width: 72, height: 72, fontSize: 24 }}>
                        {profile.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                            (profile.display_name?.[0] || profile.username?.[0] || "?").toUpperCase()
                        )}
                    </span>
                    <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="text-sm text-muted-foreground">@{profile.username}</span>
                            {profile.verified ? (
                                <span className="ui-status good">
                                    <ShieldCheck size={14} aria-hidden="true" /> Verified
                                </span>
                            ) : null}
                            {profile.is_online ? (
                                <span className="ui-status good">Online</span>
                            ) : (
                                <span className="ui-status neutral">Offline</span>
                            )}
                        </div>
                        {profile.professional_title ? (
                            <p className="text-sm text-foreground">
                                {profile.professional_title}
                                {profile.experience_years > 0
                                    ? ` (${profile.experience_years}y exp)`
                                    : ""}
                            </p>
                        ) : null}
                        <p className="ui-note">
                            Joined{" "}
                            {new Date(profile.created_at).toLocaleDateString([], {
                                month: "short",
                                year: "numeric",
                            })}
                        </p>
                        {profile.social_links && (
                            <div className="flex items-center gap-3 flex-wrap">
                                {Object.entries(profile.social_links).map(([platform, handle]) => {
                                    const href = socialProfileUrl(platform, handle);
                                    if (!href) return null;
                                    const Icon =
                                        platform === "twitter" || platform === "x"
                                            ? Twitter
                                            : platform === "github"
                                              ? Github
                                              : Linkedin;
                                    return (
                                        <a
                                            key={platform}
                                            href={href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="ui-link text-sm inline-flex items-center gap-1"
                                        >
                                            <Icon size={14} aria-hidden="true" />
                                            {platform}
                                        </a>
                                    );
                                })}
                            </div>
                        )}
                        {profile.website && socialProfileUrl("website", profile.website) && (
                            <a
                                href={socialProfileUrl("website", profile.website)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ui-link text-sm inline-flex items-center gap-1"
                            >
                                <ExternalLink size={14} aria-hidden="true" /> Website
                            </a>
                        )}
                    </div>
                </div>
            </section>

            <div className="ui-columns">
                <div className="space-y-6 min-w-0">
                    <section className="ui-surface">
                        <h2>Bio</h2>
                        <p className="text-sm leading-relaxed mt-3">
                            {profile.bio || "No bio yet."}
                        </p>
                        {profile.primary_specialization ? (
                            <p className="ui-note mt-4">
                                Specialization: {profile.primary_specialization}
                            </p>
                        ) : null}
                    </section>

                    <section className="ui-stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
                        <Stat
                            label="Followers"
                            value={profile.followers_count || 0}
                            detail="Accounts following this profile"
                        />
                        <Stat
                            label="Following"
                            value={profile.following_count || 0}
                            detail="Accounts this profile follows"
                        />
                        <Stat
                            label="Rating"
                            value={profile.reviews_count > 0 ? profile.avg_rating.toFixed(1) : "—"}
                            detail="Average from completed orders"
                        />
                        <Stat
                            label="Reviews"
                            value={profile.reviews_count || 0}
                            detail="Public reviews"
                        />
                    </section>

                    {badges.length > 0 && (
                        <section className="ui-surface">
                            <h2>Badges</h2>
                            <div className="flex flex-wrap gap-2 mt-3">
                                {badges.map((ub) => (
                                    <span
                                        key={ub.badge_id}
                                        title={ub.badge?.description || ub.badge?.name}
                                        className="ui-tag"
                                    >
                                        {ub.badge?.name || "Badge"}
                                    </span>
                                ))}
                            </div>
                        </section>
                    )}

                    {((profile.skills && profile.skills.length > 0) ||
                        (profile.languages && profile.languages.length > 0)) && (
                        <section className="ui-surface space-y-4">
                            {profile.languages && profile.languages.length > 0 && (
                                <div>
                                    <h2>Languages</h2>
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {profile.languages.map((lang) => (
                                            <span key={lang} className="ui-tag">
                                                {lang}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {profile.skills && profile.skills.length > 0 && (
                                <div>
                                    <h2>Skills</h2>
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {profile.skills.map((skill) => (
                                            <span key={skill} className="ui-tag">
                                                {skill}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </section>
                    )}
                </div>

                <div className="min-w-0 space-y-6">
                    <nav className="ui-tabs" aria-label="Profile activity">
                        <button
                            type="button"
                            onClick={() => setActiveTab("reviews")}
                            className={activeTab === "reviews" ? "active" : ""}
                        >
                            Reviews ({reviews.length})
                        </button>
                        {showListingsTab ? (
                            <button
                                type="button"
                                onClick={() => setActiveTab("listings")}
                                className={activeTab === "listings" ? "active" : ""}
                            >
                                Listings ({listings.length})
                            </button>
                        ) : null}
                    </nav>

                    {activeTab === "reviews" && (
                        <div className="space-y-4">
                            {reviews.length === 0 ? (
                                <EmptyState
                                    title="No reviews yet"
                                    description="Reviews from completed orders will show here."
                                />
                            ) : (
                                reviews.map((review) => (
                                    <article key={review.id} className="ui-surface">
                                        <div className="flex items-start justify-between gap-4 mb-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium">
                                                    @{review.reviewer?.username || "Anonymous"}
                                                </p>
                                                <div className="flex gap-1 mt-1" aria-label={`${review.rating} of 5 stars`}>
                                                    {Array.from({ length: 5 }).map((_, i) => (
                                                        <Star
                                                            key={i}
                                                            size={14}
                                                            className={
                                                                i < review.rating
                                                                    ? "fill-primary text-primary"
                                                                    : "text-muted-foreground"
                                                            }
                                                            aria-hidden="true"
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                            <p className="ui-note shrink-0">
                                                {new Date(review.created_at).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <p className="text-sm leading-relaxed">{review.content}</p>
                                    </article>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === "listings" && (
                        <div className="space-y-3">
                            {listings.length === 0 ? (
                                <EmptyState
                                    title="No listings"
                                    description="This seller has no public listings yet."
                                />
                            ) : (
                                listings.map((listing) => (
                                    <Link
                                        key={listing.id}
                                        href={`/marketplace/${listing.id}`}
                                        className="ui-listing"
                                    >
                                        <div className="min-w-0">
                                            <h2>{listing.title}</h2>
                                            <p className="ui-listing-meta">
                                                {[listing.country, listing.city, listing.status]
                                                    .filter(Boolean)
                                                    .join(" · ")}
                                            </p>
                                        </div>
                                    </Link>
                                ))
                            )}
                            <Link
                                href={`/marketplace?seller_id=${profile.id}`}
                                className="ui-link text-sm"
                            >
                                View all on marketplace
                            </Link>
                        </div>
                    )}
                </div>
            </div>

            <ConfirmDialog
                open={blockOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        setBlockOpen(false);
                        setBlockError("");
                    }
                }}
                title="Block this user"
                description="Block this user? They will be removed from your follows."
                confirmLabel="Block"
                cancelLabel="Cancel"
                destructive
                loading={blockLoading}
                error={blockError || undefined}
                onConfirm={() => void handleBlock()}
            />
        </div>
    );
}
