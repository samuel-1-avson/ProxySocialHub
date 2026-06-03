"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getProfile, followUser, unfollowUser, blockUser, getUserReviews, type UserPublicProfile, type Review } from "@/lib/services/profile";

import {
    Star,
    MapPin,
    ShieldCheck,
    UserCheck,
    MessageCircle,
    Edit3,
    Heart,
    Users,
    Activity,
    ExternalLink,
    Calendar,
    ChevronRight,
    ArrowRight,
    Loader2,
    Twitter,
    Github,
    Linkedin,
    MoreVertical,
    Ban,
    Briefcase,
    Hexagon,
    Target,
    Fingerprint,
    Cpu,
    Globe,
    Shield,
    Terminal,
    Zap,
    History,
    Key
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";

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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [isFollowing, setIsFollowing] = useState(false);
    const [activeTab, setActiveTab] = useState<"listings" | "reviews">("reviews");
    const [followLoading, setFollowLoading] = useState(false);
    const [showMenu, setShowMenu] = useState(false);

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
                    // Reviews optional
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
        if (!confirm("Confirm target isolation? This entity will be purged from your network segment.")) return;
        try {
            await blockUser(profile.id);
            router.push('/');
        } catch (err) {
            alert("Protocol deviation detected. Purge failed.");
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-60 gap-8">
                <div className="relative">
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        className="w-20 h-20 border-t-2 border-primary rounded-full"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Fingerprint className="text-primary/40" size={32} />
                    </div>
                </div>
                <p className="font-black text-[10px] uppercase tracking-[0.6em] text-muted-foreground animate-pulse">Scanning Neural ID...</p>
            </div>
        );
    }

    if (error || !profile) {
        return (
            <div className="max-w-xl mx-auto py-40 text-center space-y-10">
                <div className="w-24 h-24 rounded-[2rem] bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto text-rose-500 shadow-2xl">
                    <Zap size={40} className="animate-pulse" />
                </div>
                <div className="space-y-4">
                    <h2 className="text-4xl font-black uppercase tracking-tighter text-white">Grid Signal Lost</h2>
                    <p className="text-[11px] font-black uppercase text-muted-foreground/40 tracking-widest leading-relaxed">
                        {error || "The requested protocol signature could not be verified in the current mesh sector."}
                    </p>
                </div>
                <Link href="/marketplace" className="inline-flex items-center gap-4 px-10 py-5 bg-white text-black font-black text-[11px] uppercase tracking-widest rounded-2xl hover:bg-white/90 transition-all active:scale-95 shadow-2xl">
                    <ArrowRight size={20} /> Browse Sectors
                </Link>
            </div>
        );
    }

    const containerVariants = {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { staggerChildren: 0.1 } }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="max-w-6xl mx-auto space-y-12 pb-40 font-mono"
        >
            {/* Immersive Tactical Header */}
            <motion.div variants={itemVariants} className="group relative">
                <div className="absolute -inset-4 bg-primary/5 blur-[100px] opacity-20 pointer-events-none" />
                <GlassCard className="!p-0 border-white/5 bg-white/[0.02] overflow-hidden rounded-[3rem] shadow-2xl relative">
                    {/* Cover Area with Mesh Grid and Geo Pulse */}
                    <div className="h-64 bg-black/40 relative overflow-hidden">
                        {/* Dynamic SVG Mesh Grid */}
                        <svg className="absolute inset-0 w-full h-full opacity-[0.15]" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                                <pattern id="meshGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
                                </pattern>
                                <radialGradient id="meshGlow" cx="50%" cy="50%" r="50%">
                                    <stop offset="0%" stopColor="rgba(16,185,129,0.2)" />
                                    <stop offset="100%" stopColor="transparent" />
                                </radialGradient>
                            </defs>
                            <rect width="100%" height="100%" fill="url(#meshGrid)" />
                            <motion.circle
                                cx="20%" cy="30%" r="150" fill="url(#meshGlow)"
                                animate={{ opacity: [0.1, 0.3, 0.1], scale: [1, 1.2, 1] }}
                                transition={{ duration: 8, repeat: Infinity }}
                            />
                        </svg>
                        
                        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black via-black/60 to-transparent" />

                        {/* Top Protocol Status - Tactically Enhanced */}
                        <div className="absolute top-10 inset-x-12 flex justify-between items-start pointer-events-none">
                            <div className="space-y-2">
                                <div className="text-[9px] font-black uppercase tracking-[0.4em] text-white/30">Network Origin</div>
                                <div className="space-y-1">
                                    <div className="text-[11px] font-bold tracking-widest text-emerald-400 flex items-center gap-2">
                                        <MapPin size={12} /> {profile.location || 'Global Mesh Node'}
                                    </div>
                                    <div className="text-[9px] font-black tracking-[0.2em] text-white/40 uppercase flex items-center gap-2">
                                        <Globe size={10} className="opacity-50" /> {profile.isp || 'Peer-to-Peer Relay'}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right space-y-2">
                                <div className="text-[9px] font-black uppercase tracking-[0.4em] text-white/30">Protocol Authority</div>
                                <div className="space-y-1">
                                    <div className="text-[11px] font-bold tracking-widest text-emerald-400 flex items-center gap-2 justify-end">
                                        {profile.trust_tier || 'Alpha Sector'} <ShieldCheck size={12} />
                                    </div>
                                    <div className="text-[9px] font-black tracking-[0.2em] text-white/40 uppercase">
                                        Registry Status: <span className="text-emerald-500/60">Verified</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="px-12 pb-12 relative flex flex-col md:flex-row gap-12 items-end -mt-16">
                        {/* Avatar HUD */}
                        <div className="relative group/avatar">
                            <motion.div 
                                animate={{ opacity: [0.1, 0.3, 0.1], scale: [0.95, 1.05, 0.95] }}
                                transition={{ duration: 4, repeat: Infinity }}
                                className="absolute -inset-4 bg-emerald-500/20 rounded-[3rem] blur-2xl" 
                            />
                            <div className="w-48 h-48 rounded-[2.5rem] bg-black border-[6px] border-white/5 p-1.5 relative z-10 shadow-2xl overflow-hidden shadow-black/80 transition-transform duration-500 group-hover/avatar:scale-105">
                                {profile.avatar_url ? (
                                    <img src={profile.avatar_url} alt="" className="w-full h-full object-cover rounded-[2rem]" />
                                ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-white/10 to-white/5 rounded-[2rem] flex items-center justify-center text-6xl font-black text-white italic tracking-tighter shadow-inner">
                                        {(profile.display_name?.[0] || profile.username?.[0] || "?").toUpperCase()}
                                    </div>
                                )}
                                {/* Status Indicator */}
                                <div className="absolute bottom-6 right-6 w-7 h-7 rounded-xl bg-emerald-500 border-4 border-black shadow-[0_0_20px_rgba(16,185,129,0.8)] flex items-center justify-center">
                                    <Activity size={12} className="text-black" />
                                </div>
                            </div>
                        </div>

                        {/* Identity & Social Hub */}
                        <div className="flex-1 space-y-6 pb-2">
                            <div className="space-y-4">
                                <div className="flex items-center gap-6">
                                    <h1 className="text-6xl font-black uppercase tracking-tighter text-white drop-shadow-2xl">
                                        {profile.display_name || profile.username}
                                    </h1>
                                    {profile.verified && (
                                        <motion.div 
                                            animate={{ boxShadow: ["0 0 10px rgba(16,185,129,0)", "0 0 25px rgba(16,185,129,0.4)", "0 0 10px rgba(16,185,129,0)"] }}
                                            transition={{ duration: 3, repeat: Infinity }}
                                            className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400"
                                        >
                                            <ShieldCheck size={24} />
                                        </motion.div>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-6">
                                    <div className="text-sm font-black text-emerald-400 tracking-[0.2em] uppercase bg-emerald-500/5 px-4 py-1.5 rounded-full border border-emerald-500/10">
                                        @{profile.username}
                                    </div>
                                    <div className="h-5 w-px bg-white/10" />
                                    {profile.professional_title && (
                                        <div className="flex items-center gap-2 text-[11px] font-black text-white/80 uppercase tracking-widest">
                                            <Briefcase size={12} className="text-purple-400" /> {profile.professional_title}
                                            {profile.experience_years > 0 && (
                                                <span className="text-white/30 lowercase ml-1">({profile.experience_years}y exp)</span>
                                            )}
                                        </div>
                                    )}
                                    <div className="h-5 w-px bg-white/10 invisible md:visible" />
                                    <div className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] flex items-center gap-2">
                                        <History size={14} /> Node Synced {new Date(profile.created_at).toLocaleDateString([], { month: 'short', year: 'numeric' })}
                                    </div>
                                </div>
                            </div>

                            {/* Social Links Cockpit */}
                            {profile.social_links && (
                                <div className="flex items-center gap-3">
                                    {Object.entries(profile.social_links).map(([platform, handle]) => {
                                        if (!handle) return null;
                                        const Icon = platform === 'twitter' ? Twitter : platform === 'github' ? Github : Linkedin;
                                        return (
                                            <motion.a
                                                key={platform}
                                                whileHover={{ y: -2, scale: 1.1 }}
                                                href={platform === 'linkedin' ? handle : `https://${platform}.com/${handle}`}
                                                target="_blank"
                                                className="p-3 rounded-xl bg-white/[0.03] border border-white/5 text-white/40 hover:text-primary hover:border-primary/20 transition-all shadow-xl"
                                            >
                                                <Icon size={16} />
                                            </motion.a>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Actions Control Unit */}
                        <div className="flex gap-4 pb-4">
                            {isOwnProfile ? (
                                <Link
                                    href="/dashboard/settings/identity"
                                    className="px-10 py-5 rounded-2xl bg-white text-black font-black text-[11px] uppercase tracking-widest flex items-center gap-3 shadow-2xl hover:scale-105 transition-all active:scale-95"
                                >
                                    <Edit3 size={18} /> Edit Local Buffer
                                </Link>
                            ) : (
                                <div className="flex gap-4 items-center">
                                    <button
                                        onClick={handleFollow}
                                        className={`px-10 py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest flex items-center gap-3 transition-all active:scale-95 shadow-2xl ${isFollowing
                                                ? 'bg-white/5 border border-white/10 text-white/40 hover:bg-white/10'
                                                : 'bg-primary text-primary-foreground hover:shadow-primary/30'
                                            }`}
                                    >
                                        {isFollowing ? <UserCheck size={18} /> : <Users size={18} />}
                                        {isFollowing ? 'Purge Sync' : 'Initialize Sync'}
                                    </button>
                                    <Link
                                        href={`/messages?to=${profile.id}`}
                                        className="p-5 rounded-2xl bg-white/[0.03] border border-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-all shadow-xl"
                                    >
                                        <MessageCircle size={20} />
                                    </Link>
                                    <button
                                        onClick={handleBlock}
                                        className="p-5 rounded-2xl bg-white/[0.03] border border-white/5 text-rose-500/40 hover:text-rose-500 hover:bg-rose-500/10 transition-all shadow-xl"
                                    >
                                        <Ban size={20} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </GlassCard>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                {/* Left Unit: Bio & Stats HUD */}
                <div className="lg:col-span-4 space-y-12">
                    <motion.div variants={itemVariants} className="space-y-6">
                        <div className="flex items-center gap-3 px-6">
                            <div className="h-px bg-white/5 flex-1" />
                            <div className="text-[9px] font-black uppercase text-white/20 tracking-[0.4em]">Neural Summary</div>
                            <div className="h-px bg-white/5 flex-1" />
                        </div>
                        <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] relative group p-8">
                            <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.1] transition-opacity duration-700">
                                <Terminal size={80} />
                            </div>
                            <div className="space-y-6 relative z-10">
                                <p className="text-sm font-black text-white/80 leading-relaxed italic">
                                    "{profile.bio || "No neural description recorded in current protocol sector."}"
                                </p>
                                {profile.primary_specialization && (
                                    <div className="pt-6 border-t border-white/5 flex items-center gap-4">
                                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                                            <Fingerprint size={14} />
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-[8px] font-black uppercase tracking-[0.2em] text-white/20">Specialization</div>
                                            <div className="text-[11px] font-black uppercase tracking-widest text-white/60">{profile.primary_specialization}</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </GlassCard>
                    </motion.div>

                    {/* Stats Matrix */}
                    <motion.div variants={itemVariants} className="grid grid-cols-2 gap-6">
                        {[
                            { label: 'Network Reach', value: profile.followers_count || 0, icon: Users, color: 'text-primary' },
                            { label: 'Relay Nodes', value: profile.following_count || 0, icon: Hexagon, color: 'text-white/40' },
                            { label: 'Protocol Rating', value: profile.avg_rating > 0 ? profile.avg_rating.toFixed(1) : '5.0', icon: Star, color: 'text-yellow-500' },
                            { label: 'Consensus Proof', value: profile.reviews_count || 0, icon: ShieldCheck, color: 'text-emerald-500' }
                        ].map((stat, i) => (
                            <GlassCard key={i} className="!p-6 border-white/5 bg-white/[0.01] rounded-[2rem] hover:scale-105 transition-transform">
                                <stat.icon className={`${stat.color} mb-3`} size={18} />
                                <div className="text-2xl font-black text-white tracking-tighter">{stat.value}</div>
                                <div className="text-[8px] font-black uppercase text-white/20 tracking-widest mt-1">{stat.label}</div>
                            </GlassCard>
                        ))}
                    </motion.div>

                    {/* Capability Map */}
                    {((profile.skills && profile.skills.length > 0) || (profile.languages && profile.languages.length > 0)) && (
                        <motion.div variants={itemVariants} className="space-y-8">
                            <div className="flex items-center gap-3 px-6">
                                <div className="text-[9px] font-black uppercase text-white/20 tracking-[0.4em]">Capacity Matrix</div>
                                <div className="h-px bg-white/5 flex-1" />
                            </div>
                            
                            {profile.languages && profile.languages.length > 0 && (
                                <div className="space-y-4">
                                    <div className="text-[8px] font-black uppercase tracking-widest text-emerald-500/40 px-6">Protocol Languages</div>
                                    <div className="flex flex-wrap gap-2 px-1">
                                        {profile.languages.map(lang => (
                                            <span key={lang} className="px-4 py-2 rounded-xl bg-white/[0.03] border border-white/5 text-[9px] font-black uppercase tracking-widest text-white/40">
                                                {lang}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {profile.skills && profile.skills.length > 0 && (
                                <div className="space-y-4">
                                    <div className="text-[8px] font-black uppercase tracking-widest text-purple-500/40 px-6">Specialized Modules</div>
                                    <div className="flex flex-wrap gap-2 px-1">
                                        {profile.skills.map(skill => (
                                            <span key={skill} className="px-5 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-[9px] font-black uppercase tracking-widest text-emerald-400/60 hover:text-emerald-400 hover:border-emerald-500/40 transition-all cursor-default">
                                                {skill}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}
                </div>

                {/* Right Unit: Activity & Trust Ledger */}
                <div className="lg:col-span-8 space-y-12">
                    <motion.div variants={itemVariants} className="flex gap-8 border-b border-white/5">
                        {[
                            { id: 'reviews', label: 'Trust Ledger', count: reviews.length, icon: Heart },
                            ...(profile?.role === 'provider' ? [{ id: 'listings', label: 'Active Grid', count: 'GRID', icon: Activity }] : []),
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`relative flex items-center gap-3 px-8 py-5 text-[10px] font-black uppercase tracking-[0.3em] transition-all ${activeTab === tab.id ? "text-primary" : "text-white/20 hover:text-white/40"
                                    }`}
                            >
                                <tab.icon size={14} />
                                {tab.label}
                                <span className={`ml-2 px-2 py-0.5 rounded-md text-[8px] border font-black ${activeTab === tab.id ? "bg-primary/20 border-primary/20" : "bg-white/5 border-white/5"
                                    }`}>
                                    {tab.count}
                                </span>
                                {activeTab === tab.id && (
                                    <motion.div layoutId="profile-tab" className="absolute bottom-0 inset-x-0 h-1 bg-primary rounded-full shadow-[0_0_20px_rgba(16,185,129,0.5)]" />
                                )}
                            </button>
                        ))}
                    </motion.div>

                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                        {activeTab === "reviews" && (
                            <div className="space-y-6">
                                {reviews.length === 0 ? (
                                    <div className="py-40 text-center border-2 border-dashed border-white/5 rounded-[3rem] bg-white/[0.01]">
                                        <div className="relative w-20 h-20 mx-auto mb-8">
                                            <div className="absolute inset-0 rounded-full border border-white/5 animate-ping opacity-20" />
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <Star size={32} className="text-white/5" />
                                            </div>
                                        </div>
                                        <h4 className="text-xl font-black uppercase tracking-tighter opacity-40">Zero Consensus Proofs</h4>
                                        <p className="text-[10px] font-black text-white/10 uppercase tracking-[0.4em] mt-4">No decentralized identity logs recorded.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        {reviews.map((review) => (
                                            <GlassCard key={review.id} className="group !p-8 border-white/5 bg-white/[0.02] rounded-[2.5rem] hover:bg-white/[0.04] transition-all">
                                                <div className="flex items-start justify-between gap-6 mb-8">
                                                    <div className="flex items-center gap-5">
                                                        <div className="w-12 h-12 rounded-2xl bg-black border border-white/5 flex items-center justify-center text-xs font-black text-primary overflow-hidden">
                                                            {review.reviewer?.avatar_url ? (
                                                                <img src={review.reviewer.avatar_url} alt="" className="w-full h-full object-cover opacity-50" />
                                                            ) : (
                                                                (review.reviewer?.username?.[0] || "A").toUpperCase()
                                                            )}
                                                        </div>
                                                        <div className="space-y-1">
                                                            <div className="text-[11px] font-black text-white uppercase tracking-wider">
                                                                @{review.reviewer?.username || "Anonymous"}
                                                            </div>
                                                            <div className="flex gap-1">
                                                                {Array.from({ length: 5 }).map((_, i) => (
                                                                    <Star key={i} size={10} className={i < review.rating ? "fill-primary text-primary" : "text-white/10"} />
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-[9px] font-black text-white/10 uppercase tracking-widest">{new Date(review.created_at).toLocaleDateString()}</div>
                                                        <div className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mt-1 flex items-center gap-1 justify-end">
                                                            <Shield size={8} /> ZK_PROOF_SYNC
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="relative pl-6">
                                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/20 rounded-full" />
                                                    <p className="text-sm font-black text-white/60 leading-relaxed italic">
                                                        "{review.content}"
                                                    </p>
                                                </div>
                                            </GlassCard>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === "listings" && (
                            <Link href={`/marketplace?seller_id=${profile?.id}`} className="group block">
                                <GlassCard className="!p-12 border-white/5 bg-white/[0.02] rounded-[3rem] items-center justify-between flex group-hover:bg-primary/[0.03] group-hover:border-primary/20 transition-all">
                                    <div className="flex items-center gap-10">
                                        <div className="w-24 h-24 rounded-[2.5rem] bg-black/40 border border-white/5 flex items-center justify-center text-primary relative overflow-hidden group-hover:border-primary/30 transition-colors">
                                            <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            <Cpu size={40} className="relative z-10 group-hover:scale-110 transition-transform duration-500" />
                                        </div>
                                        <div className="space-y-2">
                                            <h3 className="text-3xl font-black uppercase tracking-tighter text-white">Active Grid Assets</h3>
                                            <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.4em] flex items-center gap-3">
                                                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> Synchronize Current Load Factors
                                            </p>
                                        </div>
                                    </div>
                                    <div className="w-20 h-20 rounded-[2.5rem] bg-white/[0.02] border border-white/5 flex items-center justify-center text-white/20 group-hover:text-primary group-hover:border-primary/20 transition-all">
                                        <ArrowRight size={32} className="group-hover:translate-x-2 transition-transform" />
                                    </div>
                                </GlassCard>
                            </Link>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
