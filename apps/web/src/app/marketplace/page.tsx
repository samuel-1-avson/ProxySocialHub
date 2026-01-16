"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getListings, type Listing } from "@/lib/social-api";
import { Navbar } from "@/components/Navbar";

export default function MarketplacePage() {
    const { isAuthenticated, user } = useAuth();
    const [listings, setListings] = useState<Listing[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [filters, setFilters] = useState({
        proxy_type: "",
        sort_by: "newest",
    });
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    const fetchListings = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const data = await getListings({
                proxy_type: filters.proxy_type || undefined,
                sort_by: filters.sort_by,
                page,
            });
            setListings(data.listings || []);
            setTotal(data.total || 0);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load listings");
            // Fallback to empty for demo
            setListings([]);
        } finally {
            setLoading(false);
        }
    }, [filters, page]);

    useEffect(() => {
        fetchListings();
    }, [fetchListings]);

    return (
        <div className="min-h-screen" style={{ background: "var(--background)" }}>
            <Navbar />

            <main className="container py-8">
                {/* Page Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
                            Marketplace
                        </h1>
                        <p style={{ color: "var(--muted)" }}>
                            Browse verified proxy listings from Ghana providers
                        </p>
                    </div>

                    {isAuthenticated && user?.role === "provider" && (
                        <Link href="/marketplace/create" className="btn btn-primary">
                            + Create Listing
                        </Link>
                    )}
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-4 mb-8 p-4 rounded-lg" style={{ background: "var(--card)" }}>
                    <select
                        className="input"
                        style={{ width: "auto" }}
                        value={filters.proxy_type}
                        onChange={(e) => {
                            setFilters({ ...filters, proxy_type: e.target.value });
                            setPage(1);
                        }}
                    >
                        <option value="">All Types</option>
                        <option value="residential">Residential</option>
                        <option value="mobile">Mobile</option>
                        <option value="datacenter">Datacenter</option>
                    </select>

                    <select
                        className="input"
                        style={{ width: "auto" }}
                        value={filters.sort_by}
                        onChange={(e) => {
                            setFilters({ ...filters, sort_by: e.target.value });
                            setPage(1);
                        }}
                    >
                        <option value="newest">Newest</option>
                        <option value="price_asc">Price: Low to High</option>
                        <option value="price_desc">Price: High to Low</option>
                        <option value="popular">Most Popular</option>
                    </select>

                    <div className="flex-1" />

                    <span className="text-sm self-center" style={{ color: "var(--muted)" }}>
                        {total} listings found
                    </span>
                </div>

                {/* Error State */}
                {error && (
                    <div className="mb-6 p-4 rounded-lg" style={{ background: "rgba(239, 68, 68, 0.1)", color: "var(--error)" }}>
                        {error}
                        <button onClick={fetchListings} className="ml-2 underline">Retry</button>
                    </div>
                )}

                {/* Loading State */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="spinner"></div>
                    </div>
                ) : (
                    <>
                        {/* Listings Grid */}
                        <div className="grid-listings">
                            {listings.map((listing) => (
                                <Link
                                    key={listing.id}
                                    href={`/marketplace/${listing.id}`}
                                    className="card fade-in"
                                >
                                    {/* Seller Info */}
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="avatar">
                                            <span>
                                                {listing.seller?.display_name?.charAt(0) || listing.seller?.username?.charAt(0) || "?"}
                                            </span>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-1" style={{ color: "var(--foreground)" }}>
                                                <span className="font-medium">
                                                    @{listing.seller?.username || "unknown"}
                                                </span>
                                                {listing.seller?.verified && (
                                                    <svg className="w-4 h-4" style={{ color: "var(--primary)" }} fill="currentColor" viewBox="0 0 20 20">
                                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                    </svg>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 text-sm">
                                                <span className="stars">★</span>
                                                <span style={{ color: "var(--muted)" }}>
                                                    {listing.seller?.avg_rating?.toFixed(1) || "5.0"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Listing Details */}
                                    <h3 className="font-semibold mb-2" style={{ color: "var(--foreground)" }}>
                                        {listing.title}
                                    </h3>

                                    <div className="flex flex-wrap gap-2 mb-4">
                                        <span className="badge badge-muted">{listing.proxy_type}</span>
                                        <span className="badge badge-muted">{listing.protocol}</span>
                                        {listing.avg_latency_ms && (
                                            <span className="badge badge-muted">{listing.avg_latency_ms}ms</span>
                                        )}
                                    </div>

                                    {/* Stats */}
                                    <div className="flex justify-between text-sm mb-4" style={{ color: "var(--muted)" }}>
                                        <span>Available: {listing.available_bandwidth_gb} GB</span>
                                        <span>{listing.uptime_percent || 99}% uptime</span>
                                    </div>

                                    {/* Price */}
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-xl font-bold" style={{ color: "var(--primary)" }}>
                                                ₵{listing.price_per_gb}
                                            </span>
                                            <span className="text-sm ml-1" style={{ color: "var(--muted)" }}>
                                                /GB
                                            </span>
                                        </div>
                                        <span className="text-sm" style={{ color: "var(--muted)" }}>
                                            {listing.orders_count || 0} sold
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </div>

                        {/* Empty State */}
                        {!loading && listings.length === 0 && (
                            <div className="text-center py-20">
                                <p style={{ color: "var(--muted)" }}>No listings found</p>
                                {isAuthenticated && user?.role === "provider" && (
                                    <Link href="/marketplace/create" className="btn btn-primary mt-4">
                                        Create First Listing
                                    </Link>
                                )}
                            </div>
                        )}

                        {/* Pagination */}
                        {total > 20 && (
                            <div className="flex justify-center gap-2 mt-8">
                                <button
                                    onClick={() => setPage(Math.max(1, page - 1))}
                                    disabled={page === 1}
                                    className="btn btn-secondary"
                                >
                                    Previous
                                </button>
                                <span className="px-4 py-2" style={{ color: "var(--muted)" }}>
                                    Page {page} of {Math.ceil(total / 20)}
                                </span>
                                <button
                                    onClick={() => setPage(page + 1)}
                                    disabled={page >= Math.ceil(total / 20)}
                                    className="btn btn-secondary"
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
