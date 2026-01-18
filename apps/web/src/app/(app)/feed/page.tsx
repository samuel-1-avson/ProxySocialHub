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
    User as UserIcon,
    Pin,
    TrendingUp,
    Compass,
    Search,
    Rss,
    ShieldCheck,
    Zap,
    ArrowRight,
    Clock,
    Heart,
    Plus
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
            case "new_listing": return <Package className="text-blue-400" size={18} />;
            case "new_review": return <Star className="text-yellow-400 fill-yellow-400" size={18} />;
            case "new_sale": return <Coins className="text-green-400" size={18} />;
            case "new_badge": return <Award className="text-orange-400" size={18} />;
            case "new_follower": return <Heart className="text-pink-400" size={18} />;
            default: return <Pin className="text-muted-foreground" size={18} />;
        }
    };

    return (
        <div className="max-w-7xl mx-auto space-y-10 pb-20">
            {/* Page Header */}
            <div className="relative p-10 rounded-[2.5rem] bg-white/[0.03] border border-white/5 overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2"></div>
                <div className="relative z-10">
                    <h1 className="text-4xl font-black text-white tracking-tighter">Activity Feed</h1>
                    <p className="text-muted-foreground text-sm mt-1">Stay updated with the latest protocol deployments and provider activities.</p>
                </div>
            </div>

            <div className="grid lg:grid-cols-12 gap-10">
                {/* Main Content */}
                <div className="lg:col-span-8 space-y-8">
                    {/* Integrated Tabs */}
                    <div className="flex p-1.5 bg-white/[0.03] rounded-2xl border border-white/5 w-fit backdrop-blur-3xl">
                        {[
                            { id: 'feed', label: 'Network Pulse', icon: <Rss size={16} /> },
                            { id: 'discover', label: 'Discover Nodes', icon: <Compass size={16} /> },
                            { id: 'trending', label: 'High Traffic', icon: <TrendingUp size={16} /> },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`flex items-center gap-2.5 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 ${activeTab === tab.id
                                    ? "bg-primary text-black shadow-[0_10px_20px_rgba(var(--primary-rgb),0.2)]"
                                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                                    }`}
                            >
                                {tab.icon}
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {loading ? (
                        <div className="min-h-[400px] flex flex-col items-center justify-center space-y-4">
                            <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                            <p className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Synchronizing Data...</p>
                        </div>
                    ) : (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {/* Feed Tab */}
                            {activeTab === "feed" && (
                                <div className="space-y-4">
                                    {!isAuthenticated ? (
                                        <div className="p-12 text-center rounded-3xl bg-white/[0.03] border border-white/5 space-y-6">
                                            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-white/20">
                                                <ShieldCheck size={32} />
                                            </div>
                                            <div>
                                                <p className="text-white font-black uppercase tracking-tighter">Authorization Required</p>
                                                <p className="text-muted-foreground text-sm">Please identify yourself to access the personalized pulse feed.</p>
                                            </div>
                                            <Link href="/login" className="inline-flex px-8 py-3 bg-primary text-black font-black uppercase tracking-widest text-xs rounded-xl hover:scale-105 transition-all">
                                                Log In
                                            </Link>
                                        </div>
                                    ) : events.length === 0 ? (
                                        <div className="p-20 text-center rounded-3xl bg-white/[0.03] border border-white/5 space-y-6">
                                            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-white/20">
                                                <Rss size={32} />
                                            </div>
                                            <div>
                                                <p className="text-white font-black uppercase tracking-tighter">Quiet Network</p>
                                                <p className="text-muted-foreground text-sm">Follow some high-performance providers to inject activity into your feed.</p>
                                            </div>
                                            <button onClick={() => setActiveTab("discover")} className="inline-flex px-8 py-3 bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-xs rounded-xl hover:bg-white/10 transition-all">
                                                Explore Network
                                            </button>
                                        </div>
                                    ) : (
                                        events.map((event) => (
                                            <div key={event.id} className="group p-6 rounded-3xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-all hover:bg-white/[0.05]">
                                                <div className="flex gap-5">
                                                    <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-white/5 border border-white/10 shrink-0">
                                                        {getEventIcon(event.event_type)}
                                                    </div>
                                                    <div className="flex-1 space-y-2">
                                                        <p className="text-sm font-medium text-white/90 leading-relaxed">{event.content}</p>
                                                        <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.1em] text-muted-foreground">
                                                            <div className="flex items-center gap-1">
                                                                <Clock size={10} />
                                                                {new Date(event.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                                                            </div>
                                                            <div className="w-1 h-1 rounded-full bg-white/10"></div>
                                                            <span className="text-primary/50">{event.event_type.replace('_', ' ')}</span>
                                                        </div>
                                                    </div>
                                                    <ArrowRight size={16} className="text-white/10 group-hover:text-primary transition-colors mt-1" />
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Discover Tab */}
                            {activeTab === "discover" && (
                                <div className="grid md:grid-cols-2 gap-6">
                                    {providers.length === 0 ? (
                                        <div className="col-span-2 p-20 text-center rounded-3xl bg-white/[0.03] border border-white/5">
                                            <p className="text-muted-foreground text-sm uppercase font-black tracking-widest">Scanning network for new providers...</p>
                                        </div>
                                    ) : (
                                        providers.map((provider) => (
                                            <Link key={provider.id} href={`/profile/${provider.username || provider.id}`} className="group p-6 rounded-3xl bg-white/[0.03] border border-white/5 hover:border-primary/30 transition-all flex items-center gap-5 hover:bg-primary/5">
                                                <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-xl font-black text-white/30 group-hover:text-primary/50 transition-colors overflow-hidden">
                                                    {provider.avatar_url ? (
                                                        <img src={provider.avatar_url} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <span>{provider.display_name?.charAt(0) || "?"}</span>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-sm font-black text-white truncate">{provider.display_name || provider.username}</span>
                                                        {provider.verified && <ShieldCheck className="w-3.5 h-3.5 text-primary" />}
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500 text-[10px] font-black">
                                                            <Star size={10} fill="currentColor" />
                                                            {provider.avg_rating?.toFixed(1) || "5.0"}
                                                        </div>
                                                        <span className="text-[10px] font-black text-muted-foreground uppercase opacity-50">{provider.total_bandwidth_sold?.toLocaleString() || 0} GB SOLD</span>
                                                    </div>
                                                </div>
                                                <ArrowRight size={16} className="text-white/10 group-hover:text-primary transition-all group-hover:translate-x-1" />
                                            </Link>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Trending Tab */}
                            {activeTab === "trending" && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {trending.length === 0 ? (
                                        <div className="col-span-2 p-20 text-center rounded-3xl bg-white/[0.03] border border-white/5">
                                            <p className="text-muted-foreground text-sm uppercase font-black tracking-widest">Calculating high-traffic nodes...</p>
                                        </div>
                                    ) : (
                                        trending.map((listing) => (
                                            <Link key={listing.id} href={`/marketplace/${listing.id}`} className="group p-6 rounded-3xl bg-white/[0.03] border border-white/5 hover:border-blue-500/30 transition-all flex flex-col hover:bg-blue-500/5">
                                                <div className="flex items-center justify-between mb-4">
                                                    <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
                                                        {listing.proxy_type}
                                                    </span>
                                                    <div className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground opacity-50 uppercase tracking-widest">
                                                        <Zap size={10} className="text-blue-500" />
                                                        {listing.orders_count || 0} orders
                                                    </div>
                                                </div>
                                                <h3 className="text-lg font-black text-white mb-4 group-hover:text-blue-400 transition-colors line-clamp-1">{listing.title}</h3>
                                                <div className="mt-auto flex justify-between items-end border-t border-white/5 pt-4">
                                                    <div>
                                                        <div className="text-2xl font-black text-white tracking-tighter">₵{listing.price_per_gb}</div>
                                                        <div className="text-[10px] font-bold text-muted-foreground uppercase opacity-50">per GB protocol</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-sm font-bold text-white/80">{listing.available_bandwidth_gb} GB</div>
                                                        <div className="text-[10px] font-bold text-muted-foreground uppercase opacity-50">available</div>
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

                {/* Contextual Sidebar */}
                <div className="lg:col-span-4 space-y-10">
                    {isAuthenticated && (
                        <div className="p-8 rounded-[2rem] bg-white/[0.03] border border-white/5 space-y-8 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-[50px] rounded-full translate-x-1/2 -translate-y-1/2"></div>
                            <div className="relative z-10 flex items-center justify-between">
                                <h3 className="font-black text-white uppercase tracking-widest text-xs">Command Center</h3>
                                <TrendingUp size={16} className="text-primary" />
                            </div>
                            <div className="grid gap-3 relative z-10">
                                <Link href="/marketplace" className="group flex items-center justify-between p-5 rounded-2xl bg-white/[0.05] border border-white/5 hover:border-white/20 transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className="p-2 rounded-lg bg-white/5 text-muted-foreground group-hover:text-white transition-colors">
                                            <Search size={18} />
                                        </div>
                                        <span className="text-sm font-bold text-white/70 group-hover:text-white transition-colors">Search Marketplace</span>
                                    </div>
                                    <ArrowRight size={16} className="text-white/10 group-hover:text-primary transition-all group-hover:translate-x-1" />
                                </Link>
                                {user?.role === "provider" && (
                                    <Link href="/marketplace/create" className="group flex items-center justify-between p-5 rounded-2xl bg-primary/10 border border-primary/10 hover:border-primary/40 transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className="p-2 rounded-lg bg-primary/20 text-primary">
                                                <Plus size={18} />
                                            </div>
                                            <span className="text-sm font-bold text-primary">Deploy New Node</span>
                                        </div>
                                        <Zap size={16} className="text-primary animate-pulse" />
                                    </Link>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Trending Preview */}
                    <div className="space-y-6">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="font-black text-white/50 uppercase tracking-[0.2em] text-[10px]">High Traffic Stream</h3>
                            <button onClick={() => setActiveTab("trending")} className="text-[10px] font-black text-primary hover:underline uppercase tracking-widest">Sync Port →</button>
                        </div>
                        <div className="space-y-4">
                            {trending.slice(0, 4).map((listing, i) => (
                                <Link key={listing.id} href={`/marketplace/${listing.id}`} className="group relative block p-5 rounded-[1.5rem] bg-white/[0.03] border border-white/5 hover:border-white/10 transition-all overflow-hidden">
                                    <div className="absolute top-0 right-0 p-6 transform translate-x-4 -translate-y-4 text-white/[0.02] font-black text-4xl group-hover:scale-110 transition-transform">0{i + 1}</div>
                                    <div className="flex gap-5 relative z-10">
                                        <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-xl shrink-0 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                            <Zap size={22} fill={i === 0 ? "currentColor" : "none"} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-white truncate group-hover:text-primary transition-colors">
                                                {listing.title}
                                            </p>
                                            <div className="flex items-center gap-2 mt-2">
                                                <span className="text-sm font-black text-white italic">₵{listing.price_per_gb}</span>
                                                <span className="text-[10px] font-black text-muted-foreground uppercase opacity-30">/ GB</span>
                                            </div>
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
