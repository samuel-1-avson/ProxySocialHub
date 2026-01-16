"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getFeed, discoverProviders, getTrendingListings, type FeedEvent, type User, type Listing } from "@/lib/social-api";
import { Navbar } from "@/components/Navbar";

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
            case "new_listing": return "📦";
            case "new_review": return "⭐";
            case "new_sale": return "💰";
            case "new_badge": return "🏆";
            case "new_follower": return "👤";
            default: return "📌";
        }
    };

    return (
        <div className="min-h-screen" style={{ background: "var(--background)" }}>
            <Navbar />

            <main className="container py-8">
                <div className="grid lg:grid-cols-4 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-3">
                        {/* Tabs */}
                        <div className="flex gap-2 mb-6">
                            <button
                                onClick={() => setActiveTab("feed")}
                                className={`btn ${activeTab === "feed" ? "btn-primary" : "btn-secondary"}`}
                            >
                                Feed
                            </button>
                            <button
                                onClick={() => setActiveTab("discover")}
                                className={`btn ${activeTab === "discover" ? "btn-primary" : "btn-secondary"}`}
                            >
                                Discover
                            </button>
                            <button
                                onClick={() => setActiveTab("trending")}
                                className={`btn ${activeTab === "trending" ? "btn-primary" : "btn-secondary"}`}
                            >
                                Trending
                            </button>
                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center py-20">
                                <div className="spinner"></div>
                            </div>
                        ) : (
                            <>
                                {/* Feed Tab */}
                                {activeTab === "feed" && (
                                    <div className="space-y-4">
                                        {!isAuthenticated ? (
                                            <div className="card text-center py-12">
                                                <p className="mb-4" style={{ color: "var(--muted)" }}>
                                                    Log in to see your personalized feed
                                                </p>
                                                <Link href="/login" className="btn btn-primary">
                                                    Log In
                                                </Link>
                                            </div>
                                        ) : events.length === 0 ? (
                                            <div className="card text-center py-12">
                                                <p className="mb-4" style={{ color: "var(--muted)" }}>
                                                    No activity yet. Follow some providers to see their updates!
                                                </p>
                                                <button onClick={() => setActiveTab("discover")} className="btn btn-primary">
                                                    Discover Providers
                                                </button>
                                            </div>
                                        ) : (
                                            events.map((event) => (
                                                <div key={event.id} className="card">
                                                    <div className="flex gap-3">
                                                        <span className="text-2xl">{getEventIcon(event.event_type)}</span>
                                                        <div className="flex-1">
                                                            <p style={{ color: "var(--foreground)" }}>{event.content}</p>
                                                            <span className="text-sm" style={{ color: "var(--muted)" }}>
                                                                {new Date(event.created_at).toLocaleDateString()}
                                                            </span>
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
                                            <div className="col-span-2 card text-center py-12">
                                                <p style={{ color: "var(--muted)" }}>No providers to discover right now.</p>
                                            </div>
                                        ) : (
                                            providers.map((provider) => (
                                                <Link key={provider.id} href={`/profile/${provider.username || provider.id}`} className="card flex items-center gap-4">
                                                    <div className="avatar">
                                                        <span>{provider.display_name?.charAt(0) || "?"}</span>
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-1">
                                                            <span className="font-medium" style={{ color: "var(--foreground)" }}>
                                                                {provider.display_name || provider.username}
                                                            </span>
                                                            {provider.verified && (
                                                                <svg className="w-4 h-4" style={{ color: "var(--primary)" }} fill="currentColor" viewBox="0 0 20 20">
                                                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                                </svg>
                                                            )}
                                                        </div>
                                                        <p className="text-sm" style={{ color: "var(--muted)" }}>
                                                            ★ {provider.avg_rating?.toFixed(1) || "5.0"} • {provider.total_bandwidth_sold?.toLocaleString() || 0} GB sold
                                                        </p>
                                                    </div>
                                                </Link>
                                            ))
                                        )}
                                    </div>
                                )}

                                {/* Trending Tab */}
                                {activeTab === "trending" && (
                                    <div className="grid-listings">
                                        {trending.length === 0 ? (
                                            <div className="col-span-3 card text-center py-12">
                                                <p style={{ color: "var(--muted)" }}>No trending listings right now.</p>
                                            </div>
                                        ) : (
                                            trending.map((listing) => (
                                                <Link key={listing.id} href={`/marketplace/${listing.id}`} className="card">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className="badge">{listing.proxy_type}</span>
                                                        <span className="text-sm" style={{ color: "var(--muted)" }}>
                                                            {listing.orders_count || 0} orders
                                                        </span>
                                                    </div>
                                                    <h3 className="font-semibold mb-2" style={{ color: "var(--foreground)" }}>
                                                        {listing.title}
                                                    </h3>
                                                    <div className="flex justify-between items-center">
                                                        <span className="font-bold" style={{ color: "var(--primary)" }}>
                                                            ₵{listing.price_per_gb}/GB
                                                        </span>
                                                        <span className="text-sm" style={{ color: "var(--muted)" }}>
                                                            {listing.available_bandwidth_gb} GB
                                                        </span>
                                                    </div>
                                                </Link>
                                            ))
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Sidebar */}
                    <div className="lg:col-span-1 space-y-6">
                        {/* Quick Actions */}
                        {isAuthenticated && (
                            <div className="card">
                                <h3 className="font-semibold mb-4" style={{ color: "var(--foreground)" }}>
                                    Quick Actions
                                </h3>
                                <div className="space-y-2">
                                    <Link href="/marketplace" className="btn btn-secondary w-full text-sm">
                                        Browse Marketplace
                                    </Link>
                                    {user?.role === "provider" && (
                                        <Link href="/marketplace/create" className="btn btn-primary w-full text-sm">
                                            Create Listing
                                        </Link>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Trending Preview */}
                        {activeTab !== "trending" && (
                            <div className="card">
                                <h3 className="font-semibold mb-4" style={{ color: "var(--foreground)" }}>
                                    🔥 Trending
                                </h3>
                                <div className="space-y-3">
                                    {trending.slice(0, 3).map((listing) => (
                                        <Link key={listing.id} href={`/marketplace/${listing.id}`} className="block py-2 border-b last:border-b-0" style={{ borderColor: "var(--card-border)" }}>
                                            <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>
                                                {listing.title}
                                            </p>
                                            <p className="text-xs" style={{ color: "var(--muted)" }}>
                                                ₵{listing.price_per_gb}/GB
                                            </p>
                                        </Link>
                                    ))}
                                </div>
                                <button onClick={() => setActiveTab("trending")} className="text-sm mt-3 w-full" style={{ color: "var(--primary)" }}>
                                    View all →
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
