"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getProfile, followUser, unfollowUser, blockUser, getUserReviews, type UserPublicProfile, type Review } from "@/lib/services/profile";

import { Star, MapPin, ShieldCheck, UserCheck, MessageCircle, Edit3, Heart, Users, Activity, ExternalLink, Calendar, ChevronRight, ArrowRight, Loader2, Twitter, Github, Linkedin, MoreVertical, Ban, Briefcase } from "lucide-react";

interface ProfileViewProps {
    username?: string;
}

export function ProfileView({ username: propUsername }: ProfileViewProps) {
    const params = useParams();
    const router = useRouter(); // For redirect after block
    const { user: currentUser, isAuthenticated } = useAuth();

    const targetUsername = propUsername ?? (params?.username as string) ?? "me";

    const [profile, setProfile] = useState<UserPublicProfile | null>(null);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [isFollowing, setIsFollowing] = useState(false);
    const [activeTab, setActiveTab] = useState<"listings" | "reviews">("reviews");
    const [followLoading, setFollowLoading] = useState(false);
    const [showMenu, setShowMenu] = useState(false);

    const isOwnProfile =
        targetUsername === "me" ||
        (currentUser && (targetUsername === currentUser.id || targetUsername === currentUser.user_metadata?.username));

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            setError("");
            try {
                const identifier = isOwnProfile ? "me" : targetUsername;

                // Retrieve Profile
                // Note: getProfile is imported from 'lib/services/profile'
                const userData = await getProfile(identifier);
                setProfile(userData);
                setIsFollowing(userData.is_following || false);

                // Fetch reviews
                try {
                    const reviewsData = await getUserReviews(userData.id);
                    setReviews(reviewsData.reviews || []);
                } catch {
                    // Reviews optional or failed
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
            // Revert
        } finally {
            setFollowLoading(false);
        }
    };

    const handleBlock = async () => {
        if (!profile || !isAuthenticated) return;
        if (!confirm("Are you sure you want to block this user? You will no longer see their content.")) return;

        try {
            await blockUser(profile.id);
            // Redirect to home or show blocked state
            router.push('/');
        } catch (err) {
            console.error("Failed to block", err);
            alert("Failed to block user");
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Scanning protocol identity...</p>
            </div>
        );
    }

    if (error || !profile) {
        return (
            <div className="container py-20 text-center space-y-6">
                <div className="w-20 h-20 rounded-sm bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto text-destructive">
                    <Activity size={32} />
                </div>
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold font-mono uppercase tracking-tight">Identity Mismatch</h2>
                    <p className="font-mono text-xs text-muted-foreground max-w-xs mx-auto">{error || "The requested protocol signature could not be verified."}</p>
                </div>
                <Link href="/marketplace" className="btn-retro btn-retro-outline inline-flex items-center gap-2">
                    Browse Marketplace
                </Link>
            </div>
        );
    }

    // Checking for business verification (simulated by checking business_name presence for now)
    const isBusiness = !!profile.business_name;

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Header Card */}
            <div className="card-retro p-0 bg-card overflow-hidden">
                <div className="h-32 bg-secondary/30 border-b border-border relative">
                    <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#444_1px,transparent_1px)] [background-size:16px_16px]"></div>
                </div>
                <div className="p-8 relative">
                    <div className="absolute -top-16 left-8">
                        <div className="w-32 h-32 rounded-sm bg-background border-2 border-foreground p-1 shadow-[4px_4px_0px_var(--foreground)]">
                            {profile.avatar_url ? (
                                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-secondary flex items-center justify-center text-4xl font-mono font-bold">
                                    {(profile.display_name?.[0] || profile.username?.[0] || "?").toUpperCase()}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="ml-40 flex flex-col md:flex-row justify-between items-start gap-4 min-h-[60px]">
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-3xl font-bold font-mono uppercase leading-none">
                                    {profile.display_name || profile.username || "Anonymous Protocol"}
                                </h1>
                                {isBusiness && (
                                    <div className="ml-2 px-2 py-0.5 bg-primary/20 border border-primary text-primary text-[10px] font-bold font-mono uppercase flex items-center gap-1 rounded-full">
                                        <Briefcase size={10} />
                                        Verified Business
                                    </div>
                                )}
                            </div>
                            <p className="text-lg font-mono text-muted-foreground mt-1">@{profile.username}</p>

                            {/* Social Links */}
                            {profile.social_links && (
                                <div className="flex items-center gap-3 mt-3">
                                    {profile.social_links.twitter && (
                                        <a href={`https://twitter.com/${profile.social_links.twitter}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                                            <Twitter size={16} />
                                        </a>
                                    )}
                                    {profile.social_links.github && (
                                        <a href={`https://github.com/${profile.social_links.github}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                                            <Github size={16} />
                                        </a>
                                    )}
                                    {profile.social_links.linkedin && (
                                        <a href={profile.social_links.linkedin} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                                            <Linkedin size={16} />
                                        </a>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3">
                            {isOwnProfile ? (
                                <Link
                                    href="/settings"
                                    className="btn-retro btn-retro-outline py-2 px-4 text-xs bg-background"
                                >
                                    <Edit3 size={14} className="mr-2" />
                                    EDIT PROFILE
                                </Link>
                            ) : (
                                <>
                                    <button
                                        onClick={handleFollow}
                                        disabled={followLoading}
                                        className={`btn-retro py-2 px-4 text-xs flex items-center gap-2 ${isFollowing ? "btn-retro-outline bg-background" : "btn-retro-primary"
                                            }`}
                                    >
                                        {isFollowing ? <UserCheck size={14} /> : <Users size={14} />}
                                        {followLoading ? "PROCESSING..." : isFollowing ? "FOLLOWING" : "CONNECT"}
                                    </button>
                                    <Link
                                        href={`/messages?to=${profile.id}`}
                                        className="btn-retro btn-retro-outline py-2 px-4 text-xs bg-background"
                                    >
                                        <MessageCircle size={14} className="mr-2" />
                                        MESSAGE
                                    </Link>

                                    {/* More Menu */}
                                    <div className="relative">
                                        <button
                                            onClick={() => setShowMenu(!showMenu)}
                                            className="btn-retro btn-retro-outline py-2 px-2 h-full bg-background"
                                        >
                                            <MoreVertical size={14} />
                                        </button>
                                        {showMenu && (
                                            <div className="absolute right-0 top-full mt-2 w-40 bg-card border border-border bg-popover text-popover-foreground shadow-md z-50 rounded-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                                <button
                                                    onClick={handleBlock}
                                                    className="w-full text-left px-4 py-2 text-xs font-mono uppercase hover:bg-destructive/10 hover:text-destructive flex items-center gap-2"
                                                >
                                                    <Ban size={12} />
                                                    Block User
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="mt-8 space-y-6">
                        {profile.bio && (
                            <p className="font-mono text-sm max-w-3xl leading-relaxed border-l-2 border-primary pl-4">
                                {profile.bio}
                            </p>
                        )}

                        {/* Capability Chips */}
                        {profile.skills && profile.skills.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {profile.skills.map((skill: string) => (
                                    <span key={skill} className="bg-secondary/50 text-secondary-foreground border border-border px-2 py-1 rounded-sm text-[10px] font-mono uppercase tracking-wide">
                                        {skill}
                                    </span>
                                ))}
                            </div>
                        )}

                        <div className="flex flex-wrap gap-6 text-xs font-mono font-bold text-muted-foreground uppercase">
                            {profile.location && (
                                <div className="flex items-center gap-2">
                                    <MapPin size={14} className="text-primary" />
                                    {profile.location}
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <Calendar size={14} className="text-primary" />
                                Joined {profile.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Oct 2023'}
                            </div>
                            {profile.avg_rating > 0 && (
                                <div className="flex items-center gap-2">
                                    <Star size={14} className="text-primary fill-current" />
                                    {profile.avg_rating.toFixed(1)} / 5.0 Rating
                                </div>
                            )}
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-3 gap-4 border-t border-border pt-6 max-w-lg">
                            <div>
                                <div className="text-2xl font-bold font-mono">{profile.followers_count?.toLocaleString() || 0}</div>
                                <div className="text-[10px] uppercase text-muted-foreground font-mono">Followers</div>
                            </div>
                            <div>
                                <div className="text-2xl font-bold font-mono">{profile.following_count?.toLocaleString() || 0}</div>
                                <div className="text-[10px] uppercase text-muted-foreground font-mono">Following</div>
                            </div>
                            <div>
                                <div className="text-2xl font-bold font-mono">{profile.reviews_count || 0}</div>
                                <div className="text-[10px] uppercase text-muted-foreground font-mono">Reviews</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Tabs */}
            <div className="space-y-6">
                <div className="flex gap-4 border-b border-border">
                    {[
                        { id: 'reviews', label: `Trust Ledger (${reviews.length})`, icon: Heart },
                        ...(profile?.role === 'provider' ? [{ id: 'listings', label: 'Active Nodes', icon: Activity }] : []),
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex items-center gap-2 px-6 py-3 text-xs font-bold font-mono uppercase border-b-2 transition-all ${activeTab === tab.id
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            <tab.icon size={14} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content Area */}
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {activeTab === "reviews" && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {reviews.length === 0 ? (
                                <div className="col-span-full py-12 text-center border-2 border-dashed border-border rounded-sm">
                                    <Star size={24} className="mx-auto text-muted-foreground opacity-50 mb-2" />
                                    <p className="font-mono text-xs text-muted-foreground uppercase">No identity proofs recorded.</p>
                                </div>
                            ) : (
                                reviews.map((review) => (
                                    <div key={review.id} className="card-retro p-6 bg-card">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-sm bg-secondary border border-border flex items-center justify-center text-xs font-bold font-mono">
                                                    {review.reviewer?.display_name?.[0] || review.reviewer?.username?.[0] || "A"}
                                                </div>
                                                <div>
                                                    <div className="font-bold font-mono text-sm">
                                                        {review.reviewer?.display_name || review.reviewer?.username || "Anonymous"}
                                                    </div>
                                                    <div className="flex gap-0.5 text-primary">
                                                        {Array.from({ length: 5 }).map((_, i) => (
                                                            <Star
                                                                key={i}
                                                                size={10}
                                                                className={i < review.rating ? "fill-current" : "text-muted-foreground opacity-30"}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase">
                                                {new Date(review.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <p className="font-mono text-xs text-muted-foreground italic border-l-2 border-border pl-3">"{review.content}"</p>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === "listings" && (
                        <div className="space-y-4">
                            <Link
                                href={`/marketplace?seller_id=${profile?.id}`}
                                className="card-retro p-8 bg-card flex items-center justify-between group hover:border-primary transition-colors"
                            >
                                <div className="flex items-center gap-6">
                                    <div className="p-4 bg-primary/10 rounded-sm border border-primary/20 text-primary">
                                        <Activity size={32} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold font-mono uppercase">Node Infrastructure</h3>
                                        <p className="text-xs font-mono text-muted-foreground">VIEW ALL ACTIVE BANDWIDTH LISTINGS</p>
                                    </div>
                                </div>
                                <ArrowRight size={24} className="text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
