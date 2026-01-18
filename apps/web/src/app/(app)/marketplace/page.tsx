"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getListings, type Listing } from "@/lib/social-api";
import {
    Star,
    Filter,
    ArrowUpDown,
    Plus,
    Globe,
    Zap,
    ShieldCheck,
    Search,
    ChevronRight,
    ArrowRight,
    LayoutGrid,
    Wifi,
    Cpu,
    Database
} from "lucide-react";
import { SmartMatchWidget } from "@/components/SmartMatchWidget";

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
            setListings([]);
        } finally {
            setLoading(false);
        }
    }, [filters, page]);

    useEffect(() => {
        fetchListings();
    }, [fetchListings]);

    return (
        <div className="max-w-7xl mx-auto space-y-10 pb-20">
            {/* Page Header */}
            <div className="relative p-10 md:p-16 rounded-[2.5rem] bg-[#0c0c14] border border-white/5 overflow-hidden">
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/10 blur-[150px] rounded-full translate-x-1/3 -translate-y-1/3 opacity-60"></div>

                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div className="space-y-6">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse box-shadow-green-glow"></div>
                            <span className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em]">Live Network Grid</span>
                        </div>
                        <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter leading-[0.9]">
                            Node<br />Marketplace
                        </h1>
                        <p className="text-white/60 max-w-lg text-lg leading-relaxed font-medium">
                            Access a decentralized network of high-performance residential and datacenter nodes.
                        </p>
                    </div>

                    {isAuthenticated && user?.role === "provider" && (
                        <Link href="/marketplace/create" className="group flex items-center gap-3 px-8 py-5 bg-white text-black font-black uppercase tracking-tight rounded-2xl hover:bg-zinc-200 transition-colors">
                            <Plus size={20} />
                            <span>List New Node</span>
                        </Link>
                    )}
                </div>
            </div>

            {/* AI Smart Match Widget */}
            <SmartMatchWidget />

            {/* Navigation & Controls Bar */}
            <div className="sticky top-4 z-40 flex flex-wrap items-center gap-4 p-2 bg-[#0a0a0a]/90 border border-white/10 rounded-2xl backdrop-blur-xl shadow-2xl">
                <div className="flex items-center gap-2 flex-1 min-w-[300px] pl-2">
                    <div className="flex items-center gap-3 px-4 py-3 bg-white/[0.03] rounded-xl border border-white/[0.05] text-white/70 hover:bg-white/[0.06] transition-all flex-1">
                        <Filter size={16} className="text-white/40" />
                        <select
                            className="bg-transparent border-none outline-none text-xs font-bold uppercase tracking-wider text-white focus:ring-0 flex-1 cursor-pointer [&>option]:bg-black"
                            value={filters.proxy_type}
                            onChange={(e) => {
                                setFilters({ ...filters, proxy_type: e.target.value });
                                setPage(1);
                            }}
                        >
                            <option value="">All Types</option>
                            <option value="residential">Residential</option>
                            <option value="mobile">Mobile 4G/5G</option>
                            <option value="datacenter">Datacenter</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-3 px-4 py-3 bg-white/[0.03] rounded-xl border border-white/[0.05] text-white/70 hover:bg-white/[0.06] transition-all flex-1">
                        <ArrowUpDown size={16} className="text-white/40" />
                        <select
                            className="bg-transparent border-none outline-none text-xs font-bold uppercase tracking-wider text-white focus:ring-0 flex-1 cursor-pointer [&>option]:bg-black"
                            value={filters.sort_by}
                            onChange={(e) => {
                                setFilters({ ...filters, sort_by: e.target.value });
                                setPage(1);
                            }}
                        >
                            <option value="newest">Newest First</option>
                            <option value="price_asc">Price: Low to High</option>
                            <option value="price_desc">Price: High to Low</option>
                            <option value="popular">Most Popular</option>
                        </select>
                    </div>
                </div>

                <div className="flex items-center gap-4 px-6 border-l border-white/5 h-10">
                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                        {total} Available
                    </span>
                </div>
            </div>

            {/* Error State */}
            {
                error && (
                    <div className="p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-between">
                        <p className="text-sm font-bold uppercase tracking-widest">{error}</p>
                        <button onClick={fetchListings} className="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 transition-all text-xs font-black uppercase tracking-widest">Retry Sync</button>
                    </div>
                )
            }

            {/* Loading State */}
            {
                loading ? (
                    <div className="min-h-[400px] flex flex-col items-center justify-center space-y-4">
                        <div className="w-10 h-10 border-2 border-white/10 border-t-white rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <>
                        {/* Listings Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {listings.map((listing) => (
                                <Link
                                    key={listing.id}
                                    href={`/marketplace/${listing.id}`}
                                    className="group relative flex flex-col p-6 rounded-[2rem] bg-[#0f0f16] border border-white/5 hover:border-white/10 hover:bg-[#14141c] transition-all duration-300"
                                >

                                    {/* Header: Provider & Rating */}
                                    <div className="flex items-center justify-between mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-sm font-black text-white/30 overflow-hidden">
                                                {listing.seller?.avatar_url ? (
                                                    <img src={listing.seller.avatar_url} className="w-full h-full object-cover" />
                                                ) : (
                                                    <span>{(listing.seller?.display_name?.[0] || "?").toUpperCase()}</span>
                                                )}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-bold text-white group-hover:text-white transition-colors">
                                                        {listing.seller?.display_name || listing.seller?.username}
                                                    </span>
                                                    {listing.seller?.verified && (
                                                        <ShieldCheck className="w-3 h-3 text-blue-400" />
                                                    )}
                                                </div>
                                                <p className="text-[10px] font-medium text-white/30 uppercase tracking-wider">Provider</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                                            <Star className="w-3 h-3 fill-current" />
                                            <span className="text-[10px] font-bold">
                                                {listing.seller?.avg_rating?.toFixed(1) || "5.0"}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 space-y-4">
                                        <h3 className="text-xl font-bold text-white leading-tight group-hover:text-purple-300 transition-colors">
                                            {listing.title}
                                        </h3>

                                        <div className="flex flex-wrap gap-2">
                                            <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-white/5 text-white/60 border border-white/5">
                                                {listing.proxy_type}
                                            </span>
                                            <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-white/5 text-white/60 border border-white/5">
                                                {listing.protocol}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 pt-2">
                                            <div className="p-3 rounded-xl bg-black/20 border border-white/5">
                                                <p className="text-[9px] text-white/30 uppercase font-black tracking-wider mb-1">Bandwidth</p>
                                                <p className="text-xs font-bold text-white">{listing.available_bandwidth_gb} GB</p>
                                            </div>
                                            <div className="p-3 rounded-xl bg-black/20 border border-white/5">
                                                <p className="text-[9px] text-white/30 uppercase font-black tracking-wider mb-1">Reliability</p>
                                                <p className="text-xs font-bold text-green-400">{listing.uptime_percent || 99.9}%</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Footer */}
                                    <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
                                        <div>
                                            <span className="block text-2xl font-bold text-white tracking-tight">
                                                ₵{listing.price_per_gb}
                                            </span>
                                            <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Per GB</span>
                                        </div>
                                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 group-hover:bg-white group-hover:text-black transition-all">
                                            <ArrowRight size={14} />
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>

                        {/* Empty State */}
                        {listings.length === 0 && (
                            <div className="text-center py-32 space-y-8">
                                <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-white/10">
                                    <Database size={48} />
                                </div>
                                <div className="space-y-2">
                                    <p className="text-2xl font-black text-white tracking-tighter">No Active Nodes Found</p>
                                    <p className="text-muted-foreground uppercase tracking-[0.2em] text-[10px] font-bold">Try adjusting your protocol filters</p>
                                </div>
                                {isAuthenticated && user?.role === "provider" && (
                                    <Link href="/marketplace/create" className="inline-flex px-10 py-4 bg-primary text-black font-black uppercase tracking-widest text-xs rounded-2xl hover:scale-105 transition-all">
                                        Be The First Provider
                                    </Link>
                                )}
                            </div>
                        )}

                        {/* Premium Pagination */}
                        {total > 20 && (
                            <div className="flex items-center justify-center gap-6 mt-16 pb-10">
                                <button
                                    onClick={() => setPage(Math.max(1, page - 1))}
                                    disabled={page === 1}
                                    className="group flex items-center gap-3 px-6 py-3 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-[10px] hover:bg-white/10 disabled:opacity-20 disabled:pointer-events-none transition-all"
                                >
                                    <ChevronRight size={16} className="rotate-180" />
                                    Previous Sector
                                </button>

                                <div className="flex items-center gap-3">
                                    <div className="px-4 py-2 rounded-xl bg-primary text-black text-xs font-black">
                                        {page}
                                    </div>
                                    <span className="text-white/20 font-black">/</span>
                                    <div className="px-4 py-2 rounded-xl bg-white/5 text-white/50 text-xs font-black">
                                        {Math.ceil(total / 20)}
                                    </div>
                                </div>

                                <button
                                    onClick={() => setPage(page + 1)}
                                    disabled={page >= Math.ceil(total / 20)}
                                    className="group flex items-center gap-3 px-6 py-3 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-[10px] hover:bg-white/10 disabled:opacity-20 disabled:pointer-events-none transition-all"
                                >
                                    Next Sector
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        )}
                    </>
                )
            }
        </div >
    );
}
