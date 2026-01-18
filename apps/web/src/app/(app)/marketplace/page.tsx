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
            <div className="relative p-12 rounded-[3rem] bg-white/[0.03] border border-white/5 overflow-hidden">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/10 blur-[120px] rounded-full translate-x-1/2 -translate-y-1/2"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-primary/5 blur-[80px] rounded-full -translate-x-1/4 translate-y-1/4"></div>

                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 w-fit">
                            <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Global Network Access</span>
                        </div>
                        <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter">
                            Node Marketplace
                        </h1>
                        <p className="text-muted-foreground max-w-lg text-lg leading-relaxed">
                            Discover high-performance protocol nodes across Ghana. Filter by type, speed, and reliability.
                        </p>
                    </div>

                    {isAuthenticated && user?.role === "provider" && (
                        <Link href="/marketplace/create" className="group flex items-center gap-3 px-8 py-5 bg-primary text-black font-black uppercase tracking-tight rounded-2xl shadow-[0_20px_40px_-10px_rgba(var(--primary-rgb),0.3)] hover:scale-105 active:scale-95 transition-all">
                            <Plus size={20} />
                            <span>List Protocol Port</span>
                        </Link>
                    )}
                </div>
            </div>

            {/* Navigation & Controls Bar */}
            <div className="sticky top-4 z-40 flex flex-wrap items-center gap-6 p-6 bg-[#0a0a0a]/80 border border-white/10 rounded-[2rem] backdrop-blur-xl shadow-2xl">
                <div className="flex items-center gap-4 flex-1 min-w-[300px]">
                    <div className="flex items-center gap-3 px-5 py-3 bg-white/5 rounded-2xl border border-white/10 text-white/70 group focus-within:border-primary/50 transition-all flex-1">
                        <Filter size={18} className="text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <select
                            className="bg-transparent border-none outline-none text-sm font-black uppercase tracking-widest focus:ring-0 flex-1 cursor-pointer"
                            value={filters.proxy_type}
                            onChange={(e) => {
                                setFilters({ ...filters, proxy_type: e.target.value });
                                setPage(1);
                            }}
                        >
                            <option value="">All Architectures</option>
                            <option value="residential">Residential Nodes</option>
                            <option value="mobile">Mobile Protocol</option>
                            <option value="datacenter">Datacenter Backbone</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-3 px-5 py-3 bg-white/5 rounded-2xl border border-white/10 text-white/70 group focus-within:border-primary/50 transition-all flex-1">
                        <ArrowUpDown size={18} className="text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <select
                            className="bg-transparent border-none outline-none text-sm font-black uppercase tracking-widest focus:ring-0 flex-1 cursor-pointer"
                            value={filters.sort_by}
                            onChange={(e) => {
                                setFilters({ ...filters, sort_by: e.target.value });
                                setPage(1);
                            }}
                        >
                            <option value="newest">Latest Entry</option>
                            <option value="price_asc">Lowest Latency Cost</option>
                            <option value="price_desc">Premium Tunnels</option>
                            <option value="popular">High Traffic</option>
                        </select>
                    </div>
                </div>

                <div className="flex items-center gap-3 pl-6 border-l border-white/10">
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] font-black text-primary italic uppercase tracking-widest leading-none">
                            {total} ACTIVE PORTS
                        </span>
                        <span className="text-[9px] font-bold text-muted-foreground uppercase opacity-40">Network Synchronized</span>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse ring-4 ring-green-500/20"></div>
                </div>
            </div>

            {/* Error State */}
            {error && (
                <div className="p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-between">
                    <p className="text-sm font-bold uppercase tracking-widest">{error}</p>
                    <button onClick={fetchListings} className="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 transition-all text-xs font-black uppercase tracking-widest">Retry Sync</button>
                </div>
            )}

            {/* Loading State */}
            {loading ? (
                <div className="min-h-[400px] flex flex-col items-center justify-center space-y-4">
                    <div className="w-12 h-12 border-4 border-primary/10 border-t-primary rounded-full animate-spin"></div>
                    <p className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground animate-pulse">Scanning Grid...</p>
                </div>
            ) : (
                <>
                    {/* Listings Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {listings.map((listing) => (
                            <Link
                                key={listing.id}
                                href={`/marketplace/${listing.id}`}
                                className="group relative flex flex-col p-8 rounded-[2.5rem] bg-white/[0.03] border border-white/5 hover:border-primary/40 hover:bg-white/[0.05] transition-all duration-700 overflow-hidden"
                            >
                                {/* Background Decor */}
                                <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 blur-[80px] translate-x-12 -translate-y-12 group-hover:scale-150 transition-transform duration-700"></div>

                                {/* Header: Provider & Rating */}
                                <div className="flex items-center justify-between mb-8 relative z-10">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-lg font-black text-white/20 overflow-hidden group-hover:border-primary/30 transition-all">
                                            {listing.seller?.avatar_url ? (
                                                <img src={listing.seller.avatar_url} className="w-full h-full object-cover" />
                                            ) : (
                                                <span>{(listing.seller?.display_name?.[0] || "?").toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div className="space-y-0.5">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-black text-white truncate group-hover:text-primary transition-colors">
                                                    {listing.seller?.display_name || listing.seller?.username}
                                                </span>
                                                {listing.seller?.verified && (
                                                    <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                                                )}
                                            </div>
                                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-50">Verified Provider</p>
                                        </div>
                                    </div>
                                    <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 flex items-center gap-2 group-hover:bg-primary/10 group-hover:border-primary/20 transition-all">
                                        <Star className="w-3.5 h-3.5 text-yellow-500 fill-current" />
                                        <span className="text-xs font-black text-white/80">
                                            {listing.seller?.avg_rating?.toFixed(1) || "5.0"}
                                        </span>
                                    </div>
                                </div>

                                {/* Content: Title & Types */}
                                <div className="relative z-10 flex-1 space-y-6">
                                    <h3 className="text-2xl font-black text-white leading-tight group-hover:translate-x-1 transition-transform duration-500">
                                        {listing.title}
                                    </h3>

                                    <div className="flex flex-wrap gap-2">
                                        <span className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-xl bg-primary/10 text-primary border border-primary/20">
                                            <Wifi size={12} />
                                            {listing.proxy_type}
                                        </span>
                                        <span className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-xl bg-white/5 text-muted-foreground border border-white/10 group-hover:border-white/20">
                                            <Cpu size={12} />
                                            {listing.protocol}
                                        </span>
                                    </div>

                                    {/* Connectivity Stats Grid */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-1 group-hover:bg-white/[0.04] transition-all">
                                            <p className="text-[9px] text-muted-foreground uppercase font-black tracking-[0.1em] opacity-40">Availability</p>
                                            <p className="text-sm font-black text-white/90 italic">{listing.available_bandwidth_gb} GB</p>
                                        </div>
                                        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-1 group-hover:bg-white/[0.04] transition-all">
                                            <p className="text-[9px] text-muted-foreground uppercase font-black tracking-[0.1em] opacity-40">Uptime Score</p>
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                                                <p className="text-sm font-black text-white/90 italic">{listing.uptime_percent || 99.9}%</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer: Economics */}
                                <div className="mt-8 pt-8 border-t border-white/5 flex items-center justify-between relative z-10">
                                    <div className="space-y-1">
                                        <div className="flex items-baseline gap-1.5">
                                            <span className="text-3xl font-black text-white tracking-tighter group-hover:text-primary transition-colors">
                                                ₵{listing.price_per_gb}
                                            </span>
                                            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest opacity-40">/ GB</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className="px-3 py-1.5 rounded-xl bg-primary text-black text-[10px] font-black uppercase tracking-widest shadow-[0_10px_20px_rgba(var(--primary-rgb),0.2)]">
                                            {listing.orders_count || 0} DEPLOYED
                                        </span>
                                    </div>
                                </div>

                                {/* Hover Interaction Layer */}
                                <div className="absolute bottom-6 right-6 translate-y-20 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-700 delay-100">
                                    <div className="w-12 h-12 rounded-2xl bg-primary text-black flex items-center justify-center shadow-2xl">
                                        <ArrowRight size={24} />
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
            )}
        </div>
    );
}
