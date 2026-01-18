"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Star, TrendingUp } from "lucide-react";
import { discoverProviders, User } from "@/lib/social-api";

export default function LeaderboardsPage() {
    const [selectedTab, setSelectedTab] = useState<"sellers" | "buyers">("sellers");
    const [sortBy, setSortBy] = useState<"bandwidth" | "rating" | "orders">("bandwidth");
    const [providers, setProviders] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchProviders() {
            setLoading(true);
            try {
                const data = await discoverProviders();
                setProviders(data.providers || []);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        fetchProviders();
    }, []);

    const sortedProviders = [...providers].sort((a, b) => {
        switch (sortBy) {
            case "rating": return b.avg_rating - a.avg_rating;
            // case "orders": return b.orders_count - a.orders_count; // orders_count not in User type yet, falling back to bandwidth for now or if we add it
            default: return b.total_bandwidth_sold - a.total_bandwidth_sold;
        }
    });

    return (
        <div className="min-h-screen" style={{ background: "var(--background)" }}>
            {/* Header */}
            <nav className="border-b" style={{ borderColor: "var(--card-border)" }}>
                <div className="container flex items-center justify-between py-4">
                    <Link href="/" className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--primary)" }}>
                            <span className="text-white font-bold text-sm">PS</span>
                        </div>
                        <span className="text-lg font-semibold hidden sm:inline" style={{ color: "var(--foreground)" }}>
                            ProxySocialHub
                        </span>
                    </Link>

                    <div className="flex items-center gap-6">
                        <Link href="/feed" className="btn btn-ghost">Feed</Link>
                        <Link href="/marketplace" className="btn btn-ghost">Marketplace</Link>
                        <Link href="/leaderboards" className="btn btn-ghost font-semibold" style={{ color: "var(--primary)" }}>Leaderboards</Link>
                    </div>
                </div>
            </nav>

            <main className="container py-8">
                <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--foreground)" }}>
                    Leaderboards
                </h1>
                <p className="mb-8" style={{ color: "var(--muted)" }}>
                    Top performers on ProxySocialHub
                </p>

                {/* Tabs */}
                <div className="flex gap-4 mb-6">
                    <button
                        onClick={() => setSelectedTab("sellers")}
                        className={`btn ${selectedTab === "sellers" ? "btn-primary" : "btn-secondary"}`}
                    >
                        Top Sellers
                    </button>
                    <button
                        onClick={() => setSelectedTab("buyers")}
                        className={`btn ${selectedTab === "buyers" ? "btn-primary" : "btn-secondary"}`}
                    >
                        Top Buyers
                    </button>
                </div>

                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="spinner"></div>
                    </div>
                ) : selectedTab === "sellers" ? (
                    <>
                        {/* Sort Options */}
                        <div className="flex gap-2 mb-6">
                            <span style={{ color: "var(--muted)" }}>Sort by:</span>
                            {(["bandwidth", "rating"] as const).map((option) => (
                                <button
                                    key={option}
                                    onClick={() => setSortBy(option)}
                                    className="text-sm px-3 py-1 rounded-full transition-colors"
                                    style={{
                                        background: sortBy === option ? "var(--primary)" : "transparent",
                                        color: sortBy === option ? "white" : "var(--muted)",
                                        border: sortBy === option ? "none" : "1px solid var(--card-border)",
                                    }}
                                >
                                    {option === "bandwidth" ? "Bandwidth Sold" : "Rating"}
                                </button>
                            ))}
                        </div>

                        {sortedProviders.length === 0 ? (
                            <div className="card text-center py-12">
                                <p style={{ color: "var(--muted)" }}>No providers found yet.</p>
                            </div>
                        ) : (
                            <>
                                {/* Top 3 Podium */}
                                <div className="grid grid-cols-3 gap-4 mb-8">
                                    {[1, 0, 2].map((podiumIndex) => {
                                        const provider = sortedProviders[podiumIndex];
                                        if (!provider) return null;
                                        const position = podiumIndex === 0 ? 2 : podiumIndex === 1 ? 1 : 3;

                                        return (
                                            <Link
                                                key={provider.id}
                                                href={`/profile/${provider.username || provider.id}`}
                                                className="card text-center relative"
                                                style={{
                                                    transform: position === 1 ? "scale(1.05)" : "none",
                                                    borderColor: position === 1 ? "var(--primary)" : "var(--card-border)",
                                                }}
                                            >
                                                {/* Medal */}
                                                <div
                                                    className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                                                    style={{
                                                        background: position === 1 ? "#FFD700" : position === 2 ? "#C0C0C0" : "#CD7F32",
                                                        color: position === 1 ? "#1a1a1a" : "white",
                                                    }}
                                                >
                                                    {position}
                                                </div>

                                                <div className="pt-4">
                                                    <div className="avatar-lg mx-auto mb-3">
                                                        <span>{provider.display_name?.charAt(0) || provider.username?.charAt(0) || "?"}</span>
                                                    </div>
                                                    <div className="flex items-center justify-center gap-1 mb-1">
                                                        <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                                                            {provider.display_name || provider.username}
                                                        </span>
                                                        {provider.verified && (
                                                            <svg className="w-4 h-4" style={{ color: "var(--primary)" }} fill="currentColor" viewBox="0 0 20 20">
                                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                            </svg>
                                                        )}
                                                    </div>
                                                    <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>@{provider.username}</p>
                                                    <div className="text-xl font-bold" style={{ color: "var(--primary)" }}>
                                                        {provider.total_bandwidth_sold?.toLocaleString() || 0} GB
                                                    </div>
                                                    <div className="text-sm flex items-center justify-center gap-2 mt-1" style={{ color: "var(--muted)" }}>
                                                        <span className="flex items-center gap-1"><Star className="w-3 h-3 text-yellow-500 fill-current" /> {provider.avg_rating?.toFixed(1) || "New"}</span>
                                                    </div>
                                                </div>
                                            </Link>
                                        );
                                    })}
                                </div>

                                {/* Rest of leaderboard */}
                                <div className="card">
                                    {sortedProviders.slice(3).map((provider, idx) => (
                                        <Link
                                            key={provider.id}
                                            href={`/profile/${provider.username || provider.id}`}
                                            className="flex items-center gap-4 py-4 border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors -mx-6 px-6"
                                            style={{ borderColor: "var(--card-border)" }}
                                        >
                                            <div className="w-8 text-center text-lg font-bold" style={{ color: "var(--muted)" }}>
                                                {idx + 4}
                                            </div>
                                            <div className="avatar">
                                                <span>{provider.display_name?.charAt(0) || provider.username?.charAt(0) || "?"}</span>
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
                                                <span className="text-sm" style={{ color: "var(--muted)" }}>@{provider.username}</span>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-bold" style={{ color: "var(--primary)" }}>
                                                    {provider.total_bandwidth_sold?.toLocaleString() || 0} GB
                                                </div>
                                                <div className="text-sm" style={{ color: "var(--muted)" }}>
                                                    <span className="flex items-center gap-1"><Star className="w-3 h-3 text-yellow-500 fill-current" /> {provider.avg_rating?.toFixed(1) || "New"}</span>
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    <div className="card text-center py-20">
                        <TrendingUp className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <h3 className="text-lg font-bold mb-2">Buyer Leaderboards Coming Soon</h3>
                        <p style={{ color: "var(--muted)" }}>
                            We are tracking top buyers and will display them here shortly.
                        </p>
                    </div>
                )}
            </main>
        </div>
    );
}
