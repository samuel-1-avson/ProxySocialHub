"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getPublicProfile, followUser, unfollowUser, getUserReviews, type User, type Review } from "@/lib/social-api";
import { Navbar } from "@/components/Navbar";
import { Star } from "lucide-react";

export default function ProfilePage() {
    const params = useParams();
    const { user: currentUser, isAuthenticated } = useAuth();

    const [profile, setProfile] = useState<User | null>(null);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [isFollowing, setIsFollowing] = useState(false);
    const [activeTab, setActiveTab] = useState<"listings" | "reviews">("reviews");
    const [followLoading, setFollowLoading] = useState(false);

    // Determine which user to show
    const username = params?.username as string;
    const isOwnProfile = !username || (currentUser && (username === currentUser.id || username === "me"));

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                // For own profile, use "me" or fetch current user
                const identifier = isOwnProfile ? "me" : username;
                const userData = await getPublicProfile(identifier);
                setProfile(userData);
                setIsFollowing(userData.is_following || false);

                // Fetch reviews
                try {
                    const reviewsData = await getUserReviews(userData.id);
                    setReviews(reviewsData.reviews || []);
                } catch {
                    // Reviews optional
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to load profile");
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [username, isOwnProfile]);

    const handleFollow = async () => {
        if (!profile || !isAuthenticated) return;

        setFollowLoading(true);
        try {
            if (isFollowing) {
                await unfollowUser(profile.id);
                setIsFollowing(false);
                setProfile(p => p ? { ...p, followers_count: p.followers_count - 1 } : null);
            } else {
                await followUser(profile.id);
                setIsFollowing(true);
                setProfile(p => p ? { ...p, followers_count: p.followers_count + 1 } : null);
            }
        } catch {
            // Revert on error
        } finally {
            setFollowLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen" style={{ background: "var(--background)" }}>
                <Navbar />
                <div className="flex items-center justify-center py-20">
                    <div className="spinner"></div>
                </div>
            </div>
        );
    }

    if (error || !profile) {
        return (
            <div className="min-h-screen" style={{ background: "var(--background)" }}>
                <Navbar />
                <div className="container py-20 text-center">
                    <p style={{ color: "var(--error)" }}>{error || "Profile not found"}</p>
                    <Link href="/marketplace" className="btn btn-secondary mt-4">
                        Browse Marketplace
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen" style={{ background: "var(--background)" }}>
            <Navbar />

            {/* Profile Header */}
            <div className="border-b" style={{ borderColor: "var(--card-border)", background: "var(--card)" }}>
                <div className="container py-8">
                    <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
                        {/* Avatar */}
                        <div className="avatar-lg">
                            {profile.avatar_url ? (
                                <>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={profile.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                                </>
                            ) : (
                                <span>{profile.display_name?.charAt(0) || profile.username?.charAt(0) || "?"}</span>
                            )}
                        </div>

                        {/* Info */}
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
                                    {profile.display_name || profile.username || "User"}
                                </h1>
                                {profile.verified && (
                                    <svg className="w-5 h-5" style={{ color: "var(--primary)" }} fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                )}
                                {profile.role === "provider" && (
                                    <span className="badge">Provider</span>
                                )}
                            </div>
                            <p className="mb-2" style={{ color: "var(--muted)" }}>
                                @{profile.username || profile.id.slice(0, 8)}
                            </p>
                            {profile.bio && (
                                <p className="mb-3" style={{ color: "var(--foreground)" }}>{profile.bio}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: "var(--muted)" }}>
                                {profile.location && (
                                    <span className="flex items-center gap-1">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                        </svg>
                                        {profile.location}
                                    </span>
                                )}
                                {profile.avg_rating > 0 && (
                                    <span className="flex items-center gap-1"><Star className="w-3 h-3 text-yellow-500 fill-current" /> {profile.avg_rating.toFixed(1)}</span>
                                )}
                                {profile.total_bandwidth_sold > 0 && (
                                    <span>{profile.total_bandwidth_sold.toLocaleString()} GB sold</span>
                                )}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3">
                            {isOwnProfile ? (
                                <Link href="/profile/edit" className="btn btn-secondary">
                                    Edit Profile
                                </Link>
                            ) : (
                                <>
                                    <button
                                        onClick={handleFollow}
                                        disabled={followLoading}
                                        className={isFollowing ? "btn btn-secondary" : "btn btn-primary"}
                                    >
                                        {followLoading ? "..." : isFollowing ? "Following" : "Follow"}
                                    </button>
                                    <Link href={`/messages?to=${profile.id}`} className="btn btn-secondary">
                                        Message
                                    </Link>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="flex gap-8 mt-6 pt-6 border-t" style={{ borderColor: "var(--card-border)" }}>
                        <div className="text-center">
                            <div className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
                                {profile.followers_count?.toLocaleString() || 0}
                            </div>
                            <div className="text-sm" style={{ color: "var(--muted)" }}>Followers</div>
                        </div>
                        <div className="text-center">
                            <div className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
                                {profile.following_count?.toLocaleString() || 0}
                            </div>
                            <div className="text-sm" style={{ color: "var(--muted)" }}>Following</div>
                        </div>
                        <div className="text-center">
                            <div className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
                                {profile.reviews_count || 0}
                            </div>
                            <div className="text-sm" style={{ color: "var(--muted)" }}>Reviews</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b" style={{ borderColor: "var(--card-border)" }}>
                <div className="container flex">
                    <button
                        onClick={() => setActiveTab("reviews")}
                        className="py-4 px-6 font-medium border-b-2 transition-colors"
                        style={{
                            color: activeTab === "reviews" ? "var(--primary)" : "var(--muted)",
                            borderColor: activeTab === "reviews" ? "var(--primary)" : "transparent",
                        }}
                    >
                        Reviews ({reviews.length})
                    </button>
                    {profile.role === "provider" && (
                        <button
                            onClick={() => setActiveTab("listings")}
                            className="py-4 px-6 font-medium border-b-2 transition-colors"
                            style={{
                                color: activeTab === "listings" ? "var(--primary)" : "var(--muted)",
                                borderColor: activeTab === "listings" ? "var(--primary)" : "transparent",
                            }}
                        >
                            Listings
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <main className="container py-8">
                {activeTab === "reviews" && (
                    <div className="space-y-4 max-w-2xl">
                        {reviews.length === 0 ? (
                            <p className="text-center py-8" style={{ color: "var(--muted)" }}>
                                No reviews yet.
                            </p>
                        ) : (
                            reviews.map((review) => (
                                <div key={review.id} className="card">
                                    <div className="flex items-start justify-between mb-2">
                                        <div>
                                            <span className="font-medium" style={{ color: "var(--foreground)" }}>
                                                {review.reviewer?.display_name || review.reviewer?.username || "Anonymous"}
                                            </span>
                                            <div className="flex ml-2">
                                                {Array.from({ length: 5 }).map((_, i) => (
                                                    <Star
                                                        key={i}
                                                        className={`w-3 h-3 ${i < review.rating ? "text-yellow-500 fill-current" : "text-gray-300"}`}
                                                    />
                                                ))}
                                            </div>
                                            {review.verified_purchase && (
                                                <span className="badge badge-success text-xs ml-2">Verified</span>
                                            )}
                                        </div>
                                        <span className="text-sm" style={{ color: "var(--muted)" }}>
                                            {new Date(review.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                    {review.title && (
                                        <h4 className="font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                            {review.title}
                                        </h4>
                                    )}
                                    <p style={{ color: "var(--muted)" }}>{review.content}</p>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === "listings" && (
                    <div className="text-center py-8">
                        <p style={{ color: "var(--muted)" }}>
                            <Link href={`/marketplace?seller_id=${profile.id}`} className="hover:underline" style={{ color: "var(--primary)" }}>
                                View listings in marketplace →
                            </Link>
                        </p>
                    </div>
                )}
            </main>
        </div>
    );
}
