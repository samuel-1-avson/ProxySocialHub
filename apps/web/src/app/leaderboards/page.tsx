"use client";

import { useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";

// Mock leaderboard data
const mockProviders = [
    { rank: 1, username: "kofi_proxies", display_name: "Kofi Mensah", bandwidth_sold: 5420.5, rating: 4.9, orders: 156, verified: true },
    { rank: 2, username: "accra_net", display_name: "Accra Networks", bandwidth_sold: 4250.2, rating: 4.8, orders: 134, verified: true },
    { rank: 3, username: "tema_proxy", display_name: "Tema Proxies", bandwidth_sold: 3890.0, rating: 4.7, orders: 112, verified: true },
    { rank: 4, username: "kwame_gh", display_name: "Kwame GH", bandwidth_sold: 2560.8, rating: 4.6, orders: 89, verified: false },
    { rank: 5, username: "ghana_connect", display_name: "Ghana Connect", bandwidth_sold: 2100.5, rating: 4.5, orders: 76, verified: true },
    { rank: 6, username: "fast_proxy_gh", display_name: "FastProxy GH", bandwidth_sold: 1890.3, rating: 4.4, orders: 65, verified: false },
    { rank: 7, username: "westside_net", display_name: "WestSide Net", bandwidth_sold: 1650.0, rating: 4.3, orders: 54, verified: true },
    { rank: 8, username: "coastal_ips", display_name: "Coastal IPs", bandwidth_sold: 1420.7, rating: 4.2, orders: 48, verified: false },
];

const mockBuyerLeaderboard = [
    { rank: 1, username: "tech_sam", display_name: "Samuel Tech", total_spent: 1250.5, orders: 45 },
    { rank: 2, username: "data_labs", display_name: "Data Labs Inc", total_spent: 980.2, orders: 38 },
    { rank: 3, username: "scrape_master", display_name: "ScrapeMaster", total_spent: 850.0, orders: 32 },
];

export default function LeaderboardsPage() {
    const [selectedTab, setSelectedTab] = useState<"sellers" | "buyers">("sellers");
    const [sortBy, setSortBy] = useState<"bandwidth" | "rating" | "orders">("bandwidth");

    const sortedProviders = [...mockProviders].sort((a, b) => {
        switch (sortBy) {
            case "rating": return b.rating - a.rating;
            case "orders": return b.orders - a.orders;
            default: return b.bandwidth_sold - a.bandwidth_sold;
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

                {selectedTab === "sellers" && (
                    <>
                        {/* Sort Options */}
                        <div className="flex gap-2 mb-6">
                            <span style={{ color: "var(--muted)" }}>Sort by:</span>
                            {(["bandwidth", "rating", "orders"] as const).map((option) => (
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
                                    {option === "bandwidth" ? "Bandwidth Sold" : option === "rating" ? "Rating" : "Orders"}
                                </button>
                            ))}
                        </div>

                        {/* Top 3 Podium */}
                        <div className="grid grid-cols-3 gap-4 mb-8">
                            {[1, 0, 2].map((podiumIndex) => {
                                const provider = sortedProviders[podiumIndex];
                                if (!provider) return null;
                                const position = podiumIndex === 0 ? 2 : podiumIndex === 1 ? 1 : 3;

                                return (
                                    <Link
                                        key={provider.username}
                                        href={`/profile/${provider.username}`}
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
                                                <span>{provider.display_name.charAt(0)}</span>
                                            </div>
                                            <div className="flex items-center justify-center gap-1 mb-1">
                                                <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                                                    {provider.display_name}
                                                </span>
                                                {provider.verified && (
                                                    <svg className="w-4 h-4" style={{ color: "var(--primary)" }} fill="currentColor" viewBox="0 0 20 20">
                                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                    </svg>
                                                )}
                                            </div>
                                            <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>@{provider.username}</p>
                                            <div className="text-xl font-bold" style={{ color: "var(--primary)" }}>
                                                {provider.bandwidth_sold.toLocaleString()} GB
                                            </div>
                                            <div className="text-sm flex items-center justify-center gap-2 mt-1" style={{ color: "var(--muted)" }}>
                                                <span className="flex items-center gap-1"><Star className="w-3 h-3 text-yellow-500 fill-current" /> {provider.rating}</span>
                                                <span>•</span>
                                                <span>{provider.orders} orders</span>
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
                                    key={provider.username}
                                    href={`/profile/${provider.username}`}
                                    className="flex items-center gap-4 py-4 border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors -mx-6 px-6"
                                    style={{ borderColor: "var(--card-border)" }}
                                >
                                    <div className="w-8 text-center text-lg font-bold" style={{ color: "var(--muted)" }}>
                                        {idx + 4}
                                    </div>
                                    <div className="avatar">
                                        <span>{provider.display_name.charAt(0)}</span>
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-1">
                                            <span className="font-medium" style={{ color: "var(--foreground)" }}>
                                                {provider.display_name}
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
                                            {provider.bandwidth_sold.toLocaleString()} GB
                                        </div>
                                        <div className="text-sm" style={{ color: "var(--muted)" }}>
                                            <span className="flex items-center gap-1"><Star className="w-3 h-3 text-yellow-500 fill-current" /> {provider.rating}</span> • {provider.orders} orders
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </>
                )}

                {selectedTab === "buyers" && (
                    <div className="card">
                        {mockBuyerLeaderboard.map((buyer) => (
                            <Link
                                key={buyer.username}
                                href={`/profile/${buyer.username}`}
                                className="flex items-center gap-4 py-4 border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors -mx-6 px-6"
                                style={{ borderColor: "var(--card-border)" }}
                            >
                                <div
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                                    style={{
                                        background: buyer.rank === 1 ? "#FFD700" : buyer.rank === 2 ? "#C0C0C0" : "#CD7F32",
                                        color: buyer.rank === 1 ? "#1a1a1a" : "white",
                                    }}
                                >
                                    {buyer.rank}
                                </div>
                                <div className="avatar">
                                    <span>{buyer.display_name.charAt(0)}</span>
                                </div>
                                <div className="flex-1">
                                    <span className="font-medium" style={{ color: "var(--foreground)" }}>
                                        {buyer.display_name}
                                    </span>
                                    <p className="text-sm" style={{ color: "var(--muted)" }}>@{buyer.username}</p>
                                </div>
                                <div className="text-right">
                                    <div className="font-bold" style={{ color: "var(--primary)" }}>
                                        ₵{buyer.total_spent.toLocaleString()}
                                    </div>
                                    <div className="text-sm" style={{ color: "var(--muted)" }}>
                                        {buyer.orders} orders
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
