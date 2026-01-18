"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getPublicProfile, followUser, unfollowUser, getUserReviews, type User, type Review } from "@/lib/social-api";
import { Star, MapPin, ShieldCheck, UserCheck, MessageCircle, Edit3, Heart, Users, Activity, ExternalLink, Calendar, ChevronRight } from "lucide-react";

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
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                <p className="text-muted-foreground font-medium animate-pulse">Scanning protocol identity...</p>
            </div>
        );
    }

    if (error || !profile) {
        return (
            <div className="container py-20 text-center space-y-6">
                <div className="w-20 h-20 rounded-3xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-500">
                    <Activity size={32} />
                </div>
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-white tracking-tight">Identity Mismatch</h2>
                    <p className="text-muted-foreground max-w-xs mx-auto">{error || "The requested protocol signature could not be verified."}</p>
                </div>
                <Link href="/marketplace" className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-white/[0.05] text-white font-bold hover:bg-white/[0.1] transition-all">
                    Browse Marketplace
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto space-y-10 pb-20 relative">
            {/* Ambient Background Elements */}
            <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none"></div>
            <div className="absolute top-1/2 -right-40 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-[100px] pointer-events-none"></div>

            {/* Profile Header */}
            <div className="relative group">
                <div className="absolute inset-0 bg-primary/5 rounded-[2.5rem] blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                <div className="relative p-10 rounded-[2.5rem] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] border border-[var(--glass-border)] overflow-hidden shadow-[var(--glass-shadow)]">
                    {/* Background Decor */}
                    <div className="absolute -top-24 -right-24 w-80 h-80 bg-primary/10 blur-[100px] rounded-full"></div>
                    <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-blue-500/5 blur-[100px] rounded-full"></div>

                    <div className="relative z-10 flex flex-col lg:flex-row gap-10 items-start">
                        {/* Avatar */}
                        <div className="relative shrink-0 mx-auto lg:mx-0">
                            <div className="absolute inset-0 bg-primary/20 rounded-[3rem] blur-xl animate-pulse"></div>
                            <div className="relative w-40 h-40 rounded-[3rem] bg-black/40 border-2 border-white/10 flex items-center justify-center text-5xl font-black text-white/10 overflow-hidden shadow-2xl group/avatar">
                                {profile.avatar_url ? (
                                    <img src={profile.avatar_url} alt="" className="w-full h-full object-cover group-hover/avatar:scale-110 transition-transform duration-700" />
                                ) : (
                                    <span>{(profile.display_name?.[0] || profile.username?.[0] || "?").toUpperCase()}</span>
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-500"></div>
                            </div>
                            {profile.verified && (
                                <div className="absolute -bottom-2 -right-2 p-3 bg-primary rounded-2xl text-primary-foreground shadow-2xl border-4 border-[#050505] animate-bounce-subtle">
                                    <ShieldCheck size={20} />
                                </div>
                            )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 space-y-6 text-center lg:text-left">
                            <div className="space-y-1">
                                <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-1">
                                    <h1 className="text-5xl font-black text-white tracking-tighter">
                                        {profile.display_name || profile.username || "Anonymous Protocol"}
                                    </h1>
                                    <div className="flex items-center justify-center lg:justify-start gap-2">
                                        {profile.role === "provider" && (
                                            <span className="px-3 py-1 rounded-xl bg-primary/20 text-primary text-[10px] font-black uppercase tracking-[0.2em] border border-primary/20">
                                                Infrastructure Provider
                                            </span>
                                        )}
                                        <span className="px-3 py-1 rounded-xl bg-white/[0.05] text-white/40 text-[10px] font-black uppercase tracking-[0.2em] border border-white/5">
                                            Tier 1
                                        </span>
                                    </div>
                                </div>
                                <p className="text-primary font-bold text-sm tracking-widest uppercase">@{profile.username || profile.id.slice(0, 8)}</p>
                            </div>

                            {profile.bio && (
                                <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed mx-auto lg:mx-0">{profile.bio}</p>
                            )}

                            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-8 pt-4">
                                {profile.location && (
                                    <div className="flex items-center gap-2.5 text-xs font-bold text-white/60">
                                        <div className="p-2 bg-white/[0.05] rounded-xl text-primary">
                                            <MapPin size={16} />
                                        </div>
                                        {profile.location}
                                    </div>
                                )}
                                <div className="flex items-center gap-2.5 text-xs font-bold text-white/60">
                                    <div className="p-2 bg-white/[0.05] rounded-xl text-blue-400">
                                        <Calendar size={16} />
                                    </div>
                                    Joined Oct 2023
                                </div>
                                {profile.avg_rating > 0 && (
                                    <div className="flex items-center gap-2.5 text-xs font-bold text-white/60">
                                        <div className="p-2 bg-white/[0.05] rounded-xl text-yellow-500">
                                            <Star size={16} className="fill-current" />
                                        </div>
                                        {profile.avg_rating.toFixed(1)} / 5.0 Rating
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-3 w-full lg:w-auto shrink-0 pt-6 lg:pt-2">
                            {isOwnProfile ? (
                                <Link
                                    href="/profile/edit"
                                    className="flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-white/[0.05] border border-white/10 text-white font-bold hover:bg-white/[0.1] hover:border-white/20 transition-all shadow-xl active:scale-95 group"
                                >
                                    <Edit3 size={18} className="text-primary group-hover:rotate-12 transition-transform" />
                                    Edit Protocol Profile
                                </Link>
                            ) : (
                                <>
                                    <button
                                        onClick={handleFollow}
                                        disabled={followLoading}
                                        className={`flex items-center justify-center gap-3 px-10 py-4 rounded-2xl font-black transition-all shadow-xl active:scale-95 ${isFollowing
                                            ? "bg-white/[0.05] border border-white/10 text-white hover:bg-white/[0.1]"
                                            : "bg-primary text-primary-foreground shadow-primary/20 hover:shadow-primary/40"
                                            }`}
                                    >
                                        {isFollowing ? <UserCheck size={20} /> : <Users size={20} />}
                                        {followLoading ? "Processing..." : isFollowing ? "Following Signal" : "Establish Link"}
                                    </button>
                                    <Link
                                        href={`/messages?to=${profile.id}`}
                                        className="flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-white/[0.05] border border-white/10 text-white font-bold hover:bg-white/[0.1] transition-all group"
                                    >
                                        <MessageCircle size={20} className="group-hover:scale-110 transition-transform" />
                                        Secure Message
                                    </Link>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Internal Stats Bar */}
                    <div className="relative z-10 grid grid-cols-3 gap-8 mt-12 pt-10 border-t border-white/5">
                        <div className="flex flex-col items-center group/stat">
                            <span className="text-4xl font-black text-white tracking-tighter group-hover:text-primary transition-colors">{profile.followers_count?.toLocaleString() || 0}</span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Pulse Followers</span>
                        </div>
                        <div className="flex flex-col items-center border-x border-white/5 group/stat">
                            <span className="text-4xl font-black text-white tracking-tighter group-hover:text-primary transition-colors">{profile.following_count?.toLocaleString() || 0}</span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Linked Protocols</span>
                        </div>
                        <div className="flex flex-col items-center group/stat">
                            <span className="text-4xl font-black text-white tracking-tighter group-hover:text-primary transition-colors">{profile.reviews_count || 0}</span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Trust Indicators</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Profile Specific Metrics */}
            {profile.total_bandwidth_sold > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        { label: "Infrastructure Contribution", value: `${profile.total_bandwidth_sold.toLocaleString()} GB`, icon: <Activity className="text-primary" /> },
                        { label: "Network Uptime", value: "99.98%", icon: <ShieldCheck className="text-blue-400" /> },
                        { label: "Global Presence", value: "14 Nodes", icon: <MapPin className="text-purple-400" /> },
                    ].map((metric, i) => (
                        <div key={i} className="p-6 rounded-3xl bg-white/[0.02] border border-white/5 flex items-center gap-4 hover:bg-white/[0.04] transition-all">
                            <div className="p-3 bg-white/[0.03] rounded-2xl">{metric.icon}</div>
                            <div>
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-50">{metric.label}</div>
                                <div className="text-xl font-bold text-white tracking-tight">{metric.value}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Content Tabs */}
            <div className="space-y-6">
                <div className="flex p-1.5 bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] border border-[var(--glass-border)] rounded-2xl w-fit mx-auto lg:mx-0 shadow-[var(--glass-shadow)]">
                    {[
                        { id: 'reviews', label: `Trust Ledger (${reviews.length})`, icon: <Heart size={16} /> },
                        ...(profile?.role === 'provider' ? [{ id: 'listings', label: 'Active Deployments', icon: <Activity size={16} /> }] : []),
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex items-center gap-2.5 px-8 py-3 rounded-xl text-sm font-black transition-all duration-500 ${activeTab === tab.id
                                ? "bg-primary text-primary-foreground shadow-xl shadow-primary/20"
                                : "text-muted-foreground hover:text-white hover:bg-white/5"
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content Area */}
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                    {activeTab === "reviews" && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {reviews.length === 0 ? (
                                <div className="col-span-full py-20 text-center bg-white/[0.02] border border-white/5 rounded-[2rem] space-y-4">
                                    <div className="w-16 h-16 rounded-full bg-white/[0.02] flex items-center justify-center mx-auto text-white/10">
                                        <Star size={32} />
                                    </div>
                                    <p className="font-bold text-white/40">No identity proofs recorded yet.</p>
                                </div>
                            ) : (
                                reviews.map((review) => (
                                    <div key={review.id} className="group p-8 rounded-[2rem] bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all hover:-translate-y-1 shadow-2xl">
                                        <div className="flex items-start justify-between mb-6">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-sm font-black text-primary border border-primary/20 shadow-inner">
                                                    {review.reviewer?.display_name?.[0] || review.reviewer?.username?.[0] || "A"}
                                                </div>
                                                <div>
                                                    <span className="font-black text-white group-hover:text-primary transition-colors">
                                                        {review.reviewer?.display_name || review.reviewer?.username || "Anonymous Subnet"}
                                                    </span>
                                                    <div className="flex gap-1 mt-1">
                                                        {Array.from({ length: 5 }).map((_, i) => (
                                                            <Star
                                                                key={i}
                                                                size={12}
                                                                className={`${i < review.rating ? "text-yellow-500 fill-current" : "text-white/10"}`}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest bg-white/[0.05] px-2 py-1 rounded-md">
                                                {new Date(review.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <div className="relative">
                                            <p className="text-muted-foreground leading-relaxed italic relative z-10 px-2 line-clamp-3">"{review.content}"</p>
                                            <div className="absolute -top-4 -left-2 text-primary/10 font-black text-6xl pointer-events-none">"</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === "listings" && (
                        <div className="space-y-6">
                            <Link
                                href={`/marketplace?seller_id=${profile?.id}`}
                                className="group relative block p-1 items-center rounded-[2.5rem] bg-gradient-to-r from-primary/20 to-blue-500/10 hover:from-primary/30 hover:to-blue-500/20 transition-all duration-700 overflow-hidden"
                            >
                                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/40 to-transparent"></div>
                                <div className="relative flex flex-col md:flex-row items-center gap-8 p-10 rounded-[2.4rem] bg-[#050505]/80 backdrop-blur-2xl border border-white/5">
                                    <div className="p-6 rounded-[2rem] bg-primary/10 text-primary group-hover:scale-110 group-hover:rotate-6 transition-all duration-700 shadow-2xl">
                                        <Activity size={48} />
                                    </div>
                                    <div className="flex-1 text-center md:text-left space-y-2">
                                        <h3 className="text-3xl font-black text-white tracking-tighter">View Node Infrastructure</h3>
                                        <p className="text-muted-foreground text-lg max-w-xl">Browse all provisioned bandwidth listings and distributed services currently active on the grid.</p>
                                    </div>
                                    <div className="p-4 rounded-full bg-white/5 text-white/40 group-hover:bg-primary group-hover:text-primary-foreground group-hover:translate-x-2 transition-all duration-500">
                                        <ChevronRight size={32} />
                                    </div>
                                </div>
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
