"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useRole } from "@/hooks/useRole";
import { getFeed, discoverProviders, getTrendingListings, type FeedEvent, type User, type Listing } from "@/lib/social-api";
import { FollowProviderButton } from "@/components/social/FollowProviderButton";
import { PeopleYouMayKnow } from "@/components/PeopleYouMayKnow";
import {
    Package,
    Star,
    Coins,
    Award,
    TrendingUp,
    Compass,
    Rss,
    ShieldCheck,
    Zap,
    ArrowRight,
    Clock,
    Heart,
    Plus,
    Loader2,
    Activity,
    Hexagon,
    ChevronRight,
    Terminal,
    Search,
    Shield,
    Flame,
    Lock
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";

export default function FeedPage() {
    const { isAuthenticated } = useAuth();
    const { isProvider } = useRole();
    const [activeTab, setActiveTab] = useState<"feed" | "discover" | "trending">("feed");
    const [loading, setLoading] = useState(true);
    const [events, setEvents] = useState<FeedEvent[]>([]);
    const [providers, setProviders] = useState<User[]>([]);
    const [trending, setTrending] = useState<Listing[]>([]);

    const refreshDiscover = async () => {
        const data = await discoverProviders();
        setProviders(data.providers || []);
    };

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                if (activeTab === "feed" && isAuthenticated) {
                    const data = await getFeed();
                    setEvents(data.events || []);
                } else if (activeTab === "discover") {
                    await refreshDiscover();
                } else if (activeTab === "trending") {
                    const data = await getTrendingListings();
                    setTrending(data.listings || []);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [activeTab, isAuthenticated]);

    const getEventIcon = (type: string) => {
        switch (type) {
            case "new_listing": return <Package className="text-primary" size={18} />;
            case "new_review": return <Star className="text-warning fill-warning/20" size={18} />;
            case "new_sale": return <Coins className="text-success" size={18} />;
            case "badge_earned":
            case "new_badge": return <Award className="text-info" size={18} />;
            case "milestone": return <TrendingUp className="text-primary" size={18} />;
            case "new_thread": return <Terminal className="text-info" size={18} />;
            case "node_online": return <Zap className="text-warning" size={18} />;
            case "new_follower": return <Heart className="text-destructive" size={18} />;
            default: return <Activity className="text-primary" size={18} />;
        }
    };

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    const feedEventHref = (event: FeedEvent): string | null => {
        if (!event.target_id) return null;
        switch (event.event_type) {
            case "new_listing":
            case "listing_inquiry":
                return `/marketplace/${event.target_id}`;
            case "new_thread":
                return `/community/forum/thread/${event.target_id}`;
            case "new_sale":
                return event.target_type === "listing" ? `/marketplace/${event.target_id}` : null;
            default:
                return null;
        }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="max-w-7xl mx-auto space-y-12 pb-20 font-mono"
        >
            {/* V3 Terminal Header */}
            <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-end gap-8 border-b border-border pb-10">
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-primary text-xs font-semibold">
                        <Hexagon size={12} className="animate-spin-slow" /> Network Activity Sequence
                    </div>
                    <div>
                        <h1 className="text-5xl font-semibold tracking-tight leading-none">Activity Pulse</h1>
                        <p className="text-muted-foreground font-mono text-xs mt-3 flex items-center gap-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
                            Monitor live protocol events and discovery signals.
                        </p>
                    </div>
                </div>
            </motion.div>

            <div className="grid lg:grid-cols-12 gap-10">
                {/* Main Content Stream */}
                <div className="lg:col-span-8 space-y-8">
                    {/* Mode Selector */}
                    <motion.div variants={itemVariants} className="flex gap-3 p-1.5 bg-muted border border-border rounded-lg w-fit">
                        {[
                            { id: 'feed', label: 'Pulse', icon: Rss },
                            { id: 'discover', label: 'Discover', icon: Compass },
                            { id: 'trending', label: 'Trending', icon: TrendingUp },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`flex items-center gap-3 px-6 py-2.5 rounded-lg text-xs font-semibold transition-all ${activeTab === tab.id
                                    ? "bg-primary text-primary-foreground shadow-sm "
                                    : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
                                    }`}
                            >
                                <tab.icon size={14} />
                                {tab.label}
                            </button>
                        ))}
                    </motion.div>

                    <AnimatePresence mode="wait">
                        {loading ? (
                            <motion.div
                                key="loader"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="py-40 flex flex-col items-center justify-center space-y-6"
                            >
                                <div className="relative">
                                    <div className="w-16 h-16 border-t-2 border-primary rounded-full animate-spin"></div>
                                    <div className="absolute inset-0 flex items-center justify-center text-primary/30">
                                        <Loader2 size={24} className="animate-pulse" />
                                    </div>
                                </div>
                                <p className="font-mono text-xs text-muted-foreground">Synchronizing Stream...</p>
                            </motion.div>
                        ) : (
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                className="space-y-4"
                            >
                                {/* Pulse Tab */}
                                {activeTab === "feed" && (
                                    <div className="space-y-4 relative">
                                        {!isAuthenticated ? (
                                            <GlassCard className="!p-16 text-center space-y-8 border-dashed border-border">
                                                <div className="w-20 h-20 rounded-full bg-muted border border-border flex items-center justify-center mx-auto">
                                                    <Lock size={32} className="text-muted-foreground" />
                                                </div>
                                                <div className="space-y-3">
                                                    <h3 className="text-xl font-semibold tracking-tight">Authorization Required</h3>
                                                    <p className="text-xs font-mono text-muted-foreground leading-relaxed max-w-xs mx-auto">
                                                        The activity pipeline requires a linear session identity. Initialize protocol to proceed.
                                                    </p>
                                                </div>
                                                <Link href="/login" className="px-10 py-4 bg-primary text-primary-foreground rounded-lg font-semibold text-xs hover:shadow-sm transition-all inline-block">
                                                    Initialize session
                                                </Link>
                                            </GlassCard>
                                        ) : events.length === 0 ? (
                                            <GlassCard className="!p-16 text-center space-y-6 border-dashed border-border">
                                                <Rss size={48} className="mx-auto text-muted-foreground" />
                                                <div className="space-y-2">
                                                    <h3 className="text-lg font-semibold tracking-tight">Your feed is quiet</h3>
                                                    <p className="text-xs font-mono text-muted-foreground leading-relaxed max-w-sm mx-auto">
                                                        Follow providers from the marketplace or Discover tab to see new listings, sales, and milestones here.
                                                    </p>
                                                </div>
                                                <button onClick={() => setActiveTab("discover")} className="px-6 py-3 glass-card border-border hover:border-primary/50 text-xs font-semibold transition-all rounded-lg">
                                                    Discover providers
                                                </button>
                                            </GlassCard>
                                        ) : (
                                            events.map((event, idx) => {
                                                const href = feedEventHref(event);
                                                const card = (
                                                    <GlassCard className="!p-6 group relative overflow-hidden active:scale-[0.99] transition-transform">
                                                        <div className="absolute left-0 top-0 w-1 h-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                                        <div className="flex gap-6 items-start">
                                                            <div className="w-12 h-12 shrink-0 rounded-lg bg-muted border border-border flex items-center justify-center group-hover:scale-110 transition-transform">
                                                                {getEventIcon(event.event_type)}
                                                            </div>
                                                            <div className="flex-1 space-y-2">
                                                                <p className="text-sm font-semibold tracking-tight leading-relaxed text-foreground">{event.content}</p>
                                                                <div className="flex items-center gap-4 text-xs font-semibold text-muted-foreground">
                                                                    <div className="flex items-center gap-2"><Clock size={12} /> {new Date(event.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                                                                    <span className="text-border">•</span>
                                                                    <div className="flex items-center gap-2 text-primary/80">{event.event_type.replace(/_/g, ' ')}</div>
                                                                </div>
                                                            </div>
                                                            {href && (
                                                                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <ChevronRight size={18} className="text-primary/40" />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </GlassCard>
                                                );
                                                return (
                                                    <motion.div
                                                        key={event.id}
                                                        initial={{ opacity: 0, x: -10 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        transition={{ delay: idx * 0.05 }}
                                                    >
                                                        {href ? (
                                                            <Link href={href} className="block">
                                                                {card}
                                                            </Link>
                                                        ) : (
                                                            card
                                                        )}
                                                    </motion.div>
                                                );
                                            })
                                        )}
                                    </div>
                                )}

                                {/* Discover Tab */}
                                {activeTab === "discover" && (
                                    <div className="grid md:grid-cols-2 gap-6">
                                        {providers.length === 0 ? (
                                            <div className="col-span-full py-20 text-center text-muted-foreground font-semibold text-xs">
                                                No signals detected in this cluster.
                                            </div>
                                        ) : (
                                            providers.map((provider) => (
                                                <GlassCard
                                                    key={provider.id}
                                                    className="!p-6 hover:border-primary/40 transition-all flex items-center gap-6 relative overflow-hidden"
                                                >
                                                    <Link
                                                        href={`/profile/${provider.username || provider.id}`}
                                                        className="flex items-center gap-6 flex-1 min-w-0 group"
                                                    >
                                                        <div className="w-16 h-16 shrink-0 rounded-lg bg-muted border border-border flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform shadow-sm">
                                                            {provider.avatar_url ? (
                                                                <img src={provider.avatar_url} alt="" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <span className="font-semibold text-xl text-primary/40">
                                                                    {(provider.display_name || provider.username || "?").charAt(0).toUpperCase()}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0 space-y-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-semibold text-base tracking-tight truncate group-hover:text-primary transition-colors">
                                                                    {provider.display_name || provider.username}
                                                                </span>
                                                                {provider.verified && <ShieldCheck size={14} className="text-primary" />}
                                                            </div>
                                                            <div className="flex items-center gap-4 flex-wrap">
                                                                <div className="flex items-center gap-1 text-xs font-semibold text-warning bg-warning/10 px-2 py-0.5 rounded-lg border border-warning/20">
                                                                    <Star size={10} className="fill-current" />
                                                                    {provider.avg_rating?.toFixed(1) || "5.0"}
                                                                </div>
                                                                <span className="text-xs font-semibold text-muted-foreground">
                                                                    {provider.total_bandwidth_sold?.toLocaleString() || 0} GB dispatched
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </Link>
                                                    <div className="flex flex-col items-end gap-2 shrink-0">
                                                        <FollowProviderButton
                                                            providerId={provider.id}
                                                            providerName={provider.display_name || provider.username}
                                                            compact
                                                            onFollowChange={() => refreshDiscover()}
                                                        />
                                                        <Link
                                                            href={`/profile/${provider.username || provider.id}`}
                                                            className="p-2 text-muted-foreground hover:text-primary transition-colors"
                                                            aria-label="View profile"
                                                        >
                                                            <ArrowRight size={16} />
                                                        </Link>
                                                    </div>
                                                </GlassCard>
                                            ))
                                        )}
                                    </div>
                                )}

                                {/* Trending Tab */}
                                {activeTab === "trending" && (
                                    <div className="grid md:grid-cols-2 gap-6">
                                        {trending.length === 0 ? (
                                            <div className="col-span-full py-20 text-center text-muted-foreground font-semibold text-xs">
                                                Calculating high-traffic signals...
                                            </div>
                                        ) : (
                                            trending.map((listing) => (
                                                <Link key={listing.id} href={`/marketplace/${listing.id}`} className="group">
                                                    <GlassCard className="!p-8 flex flex-col h-full hover:border-primary/40 transition-all active:scale-95 group">
                                                        <div className="flex justify-between items-start mb-6">
                                                            <span className="px-4 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs font-semibold text-primary">
                                                                {listing.proxy_type}
                                                            </span>
                                                            <div className="flex items-center gap-2 text-xs font-semibold text-warning">
                                                                <Flame size={14} className="animate-pulse" />
                                                                {listing.orders_count || 0} PEAKS
                                                            </div>
                                                        </div>
                                                        <h3 className="font-semibold text-lg tracking-tight mb-8 leading-tight group-hover:text-primary transition-colors">{listing.title}</h3>
                                                        <div className="mt-auto pt-6 border-t border-border border-dashed flex justify-between items-end">
                                                            <div className="space-y-1">
                                                                <div className="text-xs text-muted-foreground font-semibold">Rate</div>
                                                                <div className="text-2xl font-semibold tracking-tight">${Number(listing.price_per_gb || 0).toFixed(4)}<span className="text-xs text-muted-foreground">/GB</span></div>
                                                            </div>
                                                            <div className="text-right space-y-1">
                                                                <div className="text-xs font-semibold text-primary">{listing.available_bandwidth_gb} GB</div>
                                                                <div className="text-xs font-semibold text-muted-foreground">AVAILABILITY</div>
                                                            </div>
                                                        </div>
                                                    </GlassCard>
                                                </Link>
                                            ))
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Sidebar - Telemetry Widgets */}
                <div className="lg:col-span-4 space-y-8">
                    {isAuthenticated && <PeopleYouMayKnow limit={5} showViewAll />}
                    {isAuthenticated && (
                        <motion.div variants={itemVariants}>
                            <GlassCard className="!p-8 bg-muted border border-border relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 transition-transform">
                                    <Terminal size={120} className="text-primary" />
                                </div>
                                <h3 className="font-semibold text-xs mb-8 flex justify-between items-center text-muted-foreground border-b border-border pb-4 relative z-10">
                                    Operator Console
                                    <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span> Pulse</div>
                                </h3>
                                <div className="space-y-4 relative z-10">
                                    <Link href="/marketplace" className="group flex items-center justify-between p-4 glass-card border-border hover:border-primary/50 rounded-lg transition-all active:scale-95">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-card flex items-center justify-center text-muted-foreground group-hover:text-primary transition-colors"><Compass size={20} /></div>
                                            <span className="text-xs font-semibold">Acquire Resources</span>
                                        </div>
                                        <ArrowRight size={16} className="text-primary/30 group-hover:translate-x-1 transition-transform" />
                                    </Link>
                                    {isProvider && (
                                        <Link href="/marketplace/create" className="group flex items-center justify-between p-4 glass-card border-success/20 bg-success/5 hover:border-success/50 rounded-lg transition-all active:scale-95">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center text-success"><Plus size={20} /></div>
                                                <span className="text-xs font-semibold text-success">Create listing</span>
                                            </div>
                                            <Zap size={16} className="text-success animate-pulse" />
                                        </Link>
                                    )}
                                </div>
                            </GlassCard>
                        </motion.div>
                    )}

                    <motion.div variants={itemVariants}>
                        <GlassCard className="!p-8 relative overflow-hidden group">
                            <div className="absolute -bottom-10 -right-10 p-6 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity">
                                <Activity size={180} className="text-primary" />
                            </div>
                            <div className="flex justify-between items-center border-b border-border pb-4 mb-8">
                                <h3 className="font-semibold text-xs text-muted-foreground">High Traffic NodeStream</h3>
                                <div className="px-3 py-1 bg-primary/10 rounded-lg text-primary text-xs font-semibold">LIVE</div>
                            </div>
                            <div className="space-y-4">
                                {trending.slice(0, 3).map((listing, i) => (
                                    <Link key={listing.id} href={`/marketplace/${listing.id}`} className="block group/item">
                                        <div className="p-5 glass-card border-border hover:border-primary/30 rounded-lg transition-all active:scale-[0.98]">
                                            <div className="flex gap-5">
                                                <div className="font-semibold text-2xl text-muted-foreground opacity-30 group-hover/item:opacity-100 group-hover/item:text-primary transition-colors">0{i + 1}</div>
                                                <div className="min-w-0 space-y-1">
                                                    <div className="font-semibold text-xs tracking-tight truncate group-hover/item:text-primary transition-colors">{listing.title}</div>
                                                    <div className="flex justify-between items-center">
                                                        <div className="font-semibold text-xs text-muted-foreground">${Number(listing.price_per_gb || 0).toFixed(4)} / GB</div>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-1 h-3 bg-success/50 rounded-full"></div>
                                                            <div className="w-1 h-2 bg-success/30 rounded-full"></div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                            <button onClick={() => setActiveTab("trending")} className="w-full mt-8 py-4 glass-card border-border hover:border-primary/50 text-xs font-semibold transition-all text-muted-foreground group-hover:text-primary">
                                ALL CHANNELS &rarr;
                            </button>
                        </GlassCard>
                    </motion.div>
                </div>
            </div>
        </motion.div>
    );
}
