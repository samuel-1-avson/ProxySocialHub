"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getFeed, discoverProviders, getTrendingListings, type FeedEvent, type User, type Listing } from "@/lib/social-api";
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
    Activity
} from "lucide-react";

export default function FeedPage() {
    const { isAuthenticated, user } = useAuth();
    const [activeTab, setActiveTab] = useState<"feed" | "discover" | "trending">("feed");
    const [loading, setLoading] = useState(true);
    const [events, setEvents] = useState<FeedEvent[]>([]);
    const [providers, setProviders] = useState<User[]>([]);
    const [trending, setTrending] = useState<Listing[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                if (activeTab === "feed" && isAuthenticated) {
                    const data = await getFeed();
                    setEvents(data.events || []);
                } else if (activeTab === "discover") {
                    const data = await discoverProviders();
                    setProviders(data.providers || []);
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
            case "new_listing": return <Package className="text-blue-500" size={18} />;
            case "new_review": return <Star className="text-yellow-500 fill-yellow-500" size={18} />;
            case "new_sale": return <Coins className="text-green-500" size={18} />;
            case "new_badge": return <Award className="text-orange-500" size={18} />;
            case "new_follower": return <Heart className="text-red-500" size={18} />;
            default: return <Activity className="text-muted-foreground" size={18} />;
        }
    };

    return (
        <div className="max-w-7xl mx-auto space-y-8 pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-1">Network Activity</h1>
                    <p className="text-muted-foreground font-mono text-xs">MONITOR LIVE PROTOCOL EVENTS AND SIGNALS.</p>
                </div>
            </div>

            <div className="grid lg:grid-cols-12 gap-8">
                {/* Main Content */}
                <div className="lg:col-span-8 space-y-6">
                    {/* Tabs */}
                    <div className="flex gap-2 pb-2 overflow-x-auto">
                        {[
                            { id: 'feed', label: 'Pulse', icon: Rss },
                            { id: 'discover', label: 'Discover', icon: Compass },
                            { id: 'trending', label: 'Trending', icon: TrendingUp },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold font-mono uppercase border transition-all ${activeTab === tab.id
                                        ? "bg-primary text-primary-foreground border-foreground shadow-[2px_2px_0px_var(--foreground)]"
                                        : "bg-background border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                                    }`}
                            >
                                <tab.icon size={14} />
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {loading ? (
                        <div className="py-20 flex flex-col items-center justify-center space-y-4">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                            <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest">Synchronizing Data...</p>
                        </div>
                    ) : (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            {/* Feed Tab */}
                            {activeTab === "feed" && (
                                <div className="space-y-4">
                                    {!isAuthenticated ? (
                                        <div className="card-retro p-8 bg-card text-center space-y-4">
                                            <ShieldCheck size={32} className="mx-auto text-muted-foreground" />
                                            <div>
                                                <h3 className="font-bold font-mono uppercase">Authentication Required</h3>
                                                <p className="text-xs font-mono text-muted-foreground">PLEASE LOGIN TO VIEW PERSONALIZED FEED.</p>
                                            </div>
                                            <Link href="/login" className="btn-retro btn-retro-primary inline-flex">
                                                LOG IN
                                            </Link>
                                        </div>
                                    ) : events.length === 0 ? (
                                        <div className="card-retro p-8 bg-card text-center space-y-4">
                                            <Rss size={32} className="mx-auto text-muted-foreground opacity-50" />
                                            <div>
                                                <h3 className="font-bold font-mono uppercase">Quiet Network</h3>
                                                <p className="text-xs font-mono text-muted-foreground">NO RECENT ACTIVITY DETECTED.</p>
                                            </div>
                                            <button onClick={() => setActiveTab("discover")} className="btn-retro btn-retro-outline inline-flex">
                                                EXPLORE NODES
                                            </button>
                                        </div>
                                    ) : (
                                        events.map((event) => (
                                            <div key={event.id} className="card-retro p-4 bg-card flex gap-4 items-start">
                                                <div className="w-10 h-10 shrink-0 rounded-sm bg-secondary border border-border flex items-center justify-center">
                                                    {getEventIcon(event.event_type)}
                                                </div>
                                                <div className="flex-1 space-y-1">
                                                    <p className="text-sm font-mono leading-tight">{event.content}</p>
                                                    <div className="flex items-center gap-2 text-[10px] font-bold font-mono text-muted-foreground uppercase">
                                                        <Clock size={10} />
                                                        {new Date(event.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                                                        <span className="text-primary/50">|</span>
                                                        <span>{event.event_type.replace('_', ' ')}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Discover Tab */}
                            {activeTab === "discover" && (
                                <div className="grid md:grid-cols-2 gap-4">
                                    {providers.length === 0 ? (
                                        <div className="col-span-full py-12 text-center text-muted-foreground font-mono text-xs">
                                            NO PROVIDERS FOUND.
                                        </div>
                                    ) : (
                                        providers.map((provider) => (
                                            <Link key={provider.id} href={`/profile/${provider.username || provider.id}`} className="card-retro p-4 bg-card hover:border-primary transition-colors flex items-center gap-4 group">
                                                <div className="w-12 h-12 shrink-0 rounded-sm bg-secondary border border-border flex items-center justify-center overflow-hidden">
                                                    {provider.avatar_url ? (
                                                        <img src={provider.avatar_url} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <span className="font-mono font-bold text-sm">{(provider.display_name || provider.username || "?").charAt(0).toUpperCase()}</span>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold font-mono text-sm truncate">{provider.display_name || provider.username}</span>
                                                        {provider.verified && <ShieldCheck size={12} className="text-primary" />}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <div className="flex items-center gap-0.5 text-[10px] font-mono font-bold text-yellow-500">
                                                            <Star size={10} className="fill-current" />
                                                            {provider.avg_rating?.toFixed(1) || "5.0"}
                                                        </div>
                                                        <span className="text-[10px] font-mono text-muted-foreground uppercase">{provider.total_bandwidth_sold?.toLocaleString() || 0} GB SOLD</span>
                                                    </div>
                                                </div>
                                                <ArrowRight size={16} className="text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                                            </Link>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Trending Tab */}
                            {activeTab === "trending" && (
                                <div className="grid md:grid-cols-2 gap-4">
                                    {trending.length === 0 ? (
                                        <div className="col-span-full py-12 text-center text-muted-foreground font-mono text-xs">
                                            CALCULATING TRAFFIC...
                                        </div>
                                    ) : (
                                        trending.map((listing) => (
                                            <Link key={listing.id} href={`/marketplace/${listing.id}`} className="card-retro p-4 bg-card hover:border-primary transition-colors flex flex-col group h-full">
                                                <div className="flex justify-between items-start mb-2">
                                                    <span className="px-2 py-0.5 rounded-sm bg-secondary border border-border text-[10px] font-mono font-bold uppercase">
                                                        {listing.proxy_type}
                                                    </span>
                                                    <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground font-bold">
                                                        <Zap size={10} className="text-yellow-500" />
                                                        {listing.orders_count || 0}
                                                    </div>
                                                </div>
                                                <h3 className="font-bold font-mono text-sm mb-auto line-clamp-2">{listing.title}</h3>
                                                <div className="flex justify-between items-end mt-4 pt-4 border-t border-border border-dashed">
                                                    <div className="text-lg font-bold font-mono">₵{listing.price_per_gb}</div>
                                                    <div className="text-[10px] font-mono text-muted-foreground text-right">
                                                        <div className="font-bold text-foreground">{listing.available_bandwidth_gb} GB</div>
                                                        AVAILABLE
                                                    </div>
                                                </div>
                                            </Link>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Sidebar Widgets */}
                <div className="lg:col-span-4 space-y-6">
                    {isAuthenticated && (
                        <div className="card-retro p-6 bg-card space-y-6">
                            <h3 className="font-bold font-mono uppercase text-xs border-b border-border pb-2 flex justify-between">
                                <span>Command Center</span>
                                <Activity size={12} className="text-primary" />
                            </h3>
                            <div className="space-y-4">
                                <Link href="/marketplace" className="btn-retro btn-retro-outline w-full justify-between group">
                                    <span className="flex items-center gap-2"><Compass size={14} /> Browse Market</span>
                                    <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                                </Link>
                                {user?.role === "provider" && (
                                    <Link href="/marketplace/create" className="btn-retro btn-retro-primary w-full justify-between group">
                                        <span className="flex items-center gap-2"><Plus size={14} /> Deploy Node</span>
                                        <Zap size={14} className="group-hover:scale-110 transition-transform" />
                                    </Link>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="card-retro p-6 bg-card">
                        <div className="flex justify-between items-center border-b border-border pb-2 mb-4">
                            <h3 className="font-bold font-mono uppercase text-xs">High Traffic Stream</h3>
                            <button onClick={() => setActiveTab("trending")} className="text-[10px] font-mono font-bold text-primary hover:underline">SYNC &rarr;</button>
                        </div>
                        <div className="space-y-3">
                            {trending.slice(0, 3).map((listing, i) => (
                                <Link key={listing.id} href={`/marketplace/${listing.id}`} className="block p-3 border border-border rounded-sm hover:bg-secondary/20 transition-colors group">
                                    <div className="flex gap-3">
                                        <div className="font-mono font-bold text-lg text-muted-foreground/30">0{i + 1}</div>
                                        <div className="min-w-0">
                                            <div className="font-mono font-bold text-xs truncate group-hover:text-primary transition-colors">{listing.title}</div>
                                            <div className="font-mono text-[10px] text-muted-foreground">₵{listing.price_per_gb}/GB</div>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
