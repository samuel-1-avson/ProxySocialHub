import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { getFeed, discoverProviders, getTrendingListings, type FeedEvent, type User, type Listing } from "../lib/social-api";
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
    Loader2,
    Activity
} from "lucide-react";

export function Feed() {
    const { isAuthenticated } = useAuth();
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
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-4xl font-mono font-black uppercase tracking-tight">Network_Pulse</h1>
                <p className="text-muted-foreground font-mono text-sm uppercase tracking-widest mt-2">Live signals from the decentralized web</p>
            </div>

            <div className="grid lg:grid-cols-12 gap-8">
                {/* Main Content */}
                <div className="lg:col-span-8 space-y-6">
                    {/* Tabs */}
                    <div className="flex gap-2 pb-2 overflow-x-auto">
                        {[
                            { id: 'feed', label: 'Feeds', icon: Rss },
                            { id: 'discover', label: 'Discover', icon: Compass },
                            { id: 'trending', label: 'Trending', icon: TrendingUp },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`flex items-center gap-2 px-4 py-2 text-xs font-bold font-mono uppercase border-2 transition-all ${activeTab === tab.id
                                    ? "bg-primary text-primary-foreground border-foreground shadow-[3px_3px_0px_var(--foreground)]"
                                    : "bg-background border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                                    }`}
                            >
                                <tab.icon size={14} />
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {loading ? (
                        <div className="py-20 flex flex-col items-center justify-center space-y-4 font-mono">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                            <p className="text-xs font-bold uppercase tracking-widest">Initialising_Stream...</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Feed Tab */}
                            {activeTab === "feed" && (
                                <div className="space-y-4">
                                    {events.length === 0 ? (
                                        <div className="card-retro p-12 bg-card text-center space-y-4 border-dashed border-2">
                                            <Rss size={32} className="mx-auto text-muted-foreground opacity-50" />
                                            <div>
                                                <h3 className="font-bold font-mono uppercase">Quiet_Sector</h3>
                                                <p className="text-xs font-mono text-muted-foreground">NO LIVE SIGNALS DETECTED IN THIS FREQUENCY.</p>
                                            </div>
                                        </div>
                                    ) : (
                                        events.map((event) => (
                                            <div key={event.id} className="card-retro p-4 bg-card flex gap-4 items-start border-l-4 border-l-primary/50">
                                                <div className="w-10 h-10 shrink-0 rounded-sm bg-secondary border border-border flex items-center justify-center">
                                                    {getEventIcon(event.event_type)}
                                                </div>
                                                <div className="flex-1 space-y-1">
                                                    <p className="text-sm font-mono leading-tight">{event.content}</p>
                                                    <div className="flex items-center gap-2 text-[10px] font-bold font-mono text-muted-foreground uppercase">
                                                        <Clock size={10} />
                                                        {new Date(event.created_at).toLocaleDateString()}
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
                                        <div className="col-span-full py-12 text-center text-muted-foreground font-mono text-xs border-dashed border-2 rounded-lg uppercase">
                                            Zero_Nodes_Located.
                                        </div>
                                    ) : (
                                        providers.map((provider) => (
                                            <div key={provider.id} className="card-retro p-4 bg-card hover:border-primary transition-colors flex items-center gap-4 group cursor-pointer">
                                                <div className="w-12 h-12 shrink-0 rounded-sm bg-secondary border border-border flex items-center justify-center overflow-hidden">
                                                    {provider.avatar_url ? (
                                                        <img src={provider.avatar_url} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <span className="font-mono font-bold text-sm">{(provider.display_name || provider.username || "?").charAt(0).toUpperCase()}</span>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold font-mono text-sm truncate uppercase">{provider.display_name || provider.username}</span>
                                                        {provider.verified && <ShieldCheck size={12} className="text-primary" />}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <div className="flex items-center gap-0.5 text-[10px] font-mono font-bold text-yellow-500">
                                                            <Star size={10} className="fill-current" />
                                                            {provider.avg_rating?.toFixed(1) || "5.0"}
                                                        </div>
                                                        <span className="text-[10px] font-mono text-muted-foreground uppercase">{provider.total_bandwidth_sold?.toLocaleString() || 0} GB_SOLD</span>
                                                    </div>
                                                </div>
                                                <ArrowRight size={16} className="text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Trending Tab */}
                            {activeTab === "trending" && (
                                <div className="grid md:grid-cols-2 gap-4">
                                    {trending.length === 0 ? (
                                        <div className="col-span-full py-12 text-center text-muted-foreground font-mono text-xs border-dashed border-2 rounded-lg uppercase">
                                            Calculating_Traffic_Demand...
                                        </div>
                                    ) : (
                                        trending.map((listing) => (
                                            <div key={listing.id} className="card-retro p-4 bg-card hover:border-primary transition-colors flex flex-col group h-full cursor-pointer">
                                                <div className="flex justify-between items-start mb-2">
                                                    <span className="px-2 py-0.5 rounded-sm bg-secondary border border-border text-[10px] font-mono font-bold uppercase">
                                                        {listing.proxy_type}
                                                    </span>
                                                    <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground font-bold">
                                                        <Zap size={10} className="text-yellow-500" />
                                                        {listing.orders_count || 0}
                                                    </div>
                                                </div>
                                                <h3 className="font-bold font-mono text-sm mb-auto line-clamp-2 uppercase mt-1">{listing.title}</h3>
                                                <div className="flex justify-between items-end mt-4 pt-4 border-t border-border border-dashed font-mono">
                                                    <div className="text-lg font-bold">₵{listing.price_per_gb}</div>
                                                    <div className="text-[10px] text-muted-foreground text-right uppercase">
                                                        <div className="font-bold text-foreground">{listing.available_bandwidth_gb} GB</div>
                                                        CAPACITY
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Right Sidebar Widgets */}
                <div className="lg:col-span-4 space-y-6">
                    <div className="card-retro p-6 bg-card space-y-6 border-t-4 border-t-primary">
                        <h3 className="font-black font-mono uppercase text-xs border-b-2 border-border pb-2 flex justify-between">
                            <span>Command_Center</span>
                            <Activity size={12} className="text-primary" />
                        </h3>
                        <div className="space-y-3">
                            <Link to="/marketplace" className="btn-retro btn-retro-outline w-full justify-between items-center px-4 py-3 group">
                                <span className="flex items-center gap-2"><Compass size={14} /> BROWSE_NODES</span>
                                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <Link to="/node" className="btn-retro btn-retro-primary w-full justify-between items-center px-4 py-3 group">
                                <span className="flex items-center gap-2"><Zap size={14} /> DEPLOY_RESOURCES</span>
                            </Link>
                        </div>
                    </div>

                    <div className="card-retro p-6 bg-secondary/20">
                        <div className="flex justify-between items-center border-b border-border pb-2 mb-4">
                            <h3 className="font-bold font-mono uppercase text-[10px] tracking-widest text-muted-foreground">TOP_PERFORMERS</h3>
                            <button onClick={() => setActiveTab("trending")} className="text-[10px] font-mono font-bold text-primary hover:underline uppercase">Sync &rarr;</button>
                        </div>
                        <div className="space-y-3">
                            {trending.slice(0, 3).map((listing, i) => (
                                <div key={listing.id} className="block p-3 border border-border bg-card rounded-sm hover:border-primary transition-colors group cursor-pointer">
                                    <div className="flex gap-3">
                                        <div className="font-mono font-bold text-lg text-muted-foreground/30">0{i + 1}</div>
                                        <div className="min-w-0">
                                            <div className="font-mono font-bold text-[10px] uppercase truncate group-hover:text-primary transition-colors">{listing.title}</div>
                                            <div className="font-mono text-[10px] text-muted-foreground font-bold">₵{listing.price_per_gb}/GB</div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {trending.length === 0 && <p className="text-[10px] font-mono text-center text-muted-foreground py-4 uppercase">Waiting_for_Signal...</p>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
