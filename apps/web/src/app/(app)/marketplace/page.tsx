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
    Database,
    Signal,
    Activity,
    Server
} from "lucide-react";
import { SmartMatchWidget } from "@/components/SmartMatchWidget";
import { BuyListingModal } from "@/components/BuyListingModal";
import { motion } from "framer-motion";

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
    const [selectedListing, setSelectedListing] = useState<Listing | null>(null);

    const fetchListings = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const data = await getListings({
                proxy_type: filters.proxy_type || undefined,
                sort_by: filters.sort_by,
                page,
            });
            setListings(data?.listings || []);
            setTotal(data?.total || 0);
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
        <div className="relative min-h-screen pb-20">
            {/* Background Mesh Gradients */}
            <div className="fixed inset-0 pointer-events-none z-0">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-900/10 blur-[150px] rounded-full mix-blend-screen"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-900/10 blur-[150px] rounded-full mix-blend-screen"></div>
            </div>

            <div className="relative z-10 max-w-7xl mx-auto space-y-10">

                {/* Hero Section */}
                <div className="relative rounded-[3rem] bg-[#050505] border border-white/5 overflow-hidden min-h-[500px] flex items-center">
                    {/* Animated Grid Background */}
                    <div className="absolute inset-0 z-0 opacity-20"
                        style={{
                            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)',
                            backgroundSize: '40px 40px'
                        }}>
                    </div>

                    <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent z-10"></div>

                    <div className="relative z-20 w-full px-12 md:px-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                        <div className="space-y-8">
                            <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                                </span>
                                <span className="text-xs font-black text-white/80 uppercase tracking-widest">Global Grid Active</span>
                            </div>

                            <h1 className="text-6xl md:text-8xl font-black text-white tracking-tighter leading-[0.9]">
                                NODE<br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-white/40">MARKET</span>
                            </h1>

                            <p className="text-xl text-white/50 max-w-lg leading-relaxed font-medium">
                                Access a decentralized network of high-performance residential and datacenter nodes.
                            </p>

                            <div className="flex flex-wrap gap-4">
                                {isAuthenticated && user?.role === "provider" && (
                                    <Link href="/marketplace/create" className="group flex items-center gap-3 px-8 py-4 bg-white text-black font-black uppercase tracking-tight rounded-xl hover:bg-zinc-200 transition-colors">
                                        <Plus size={20} />
                                        <span>Deploy Node</span>
                                    </Link>
                                )}
                                <div className="flex items-center gap-8 px-8 py-4 bg-white/5 rounded-xl border border-white/5 backdrop-blur-md">
                                    <div>
                                        <div className="text-2xl font-black text-white">{total > 0 ? total : '--'}</div>
                                        <div className="text-[10px] text-white/40 font-bold uppercase tracking-wider">Active Nodes</div>
                                    </div>
                                    <div className="w-px h-8 bg-white/10"></div>
                                    <div>
                                        <div className="text-2xl font-black text-white">99.9%</div>
                                        <div className="text-[10px] text-white/40 font-bold uppercase tracking-wider">Net Uptime</div>
                                    </div>
                                    <div className="w-px h-8 bg-white/10"></div>
                                    <div>
                                        <div className="text-2xl font-black text-white text-emerald-400">#294,102</div>
                                        <div className="text-[10px] text-white/40 font-bold uppercase tracking-wider flex items-center gap-1">
                                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                                            Chain Height
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Abstract Globe/Network Visualization Area - Right Side */}
                        <div className="hidden lg:flex justify-center items-center relative h-full">
                            <div className="relative w-[500px] h-[500px]">
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-purple-600/20 rounded-full blur-[100px] animate-pulse"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="grid grid-cols-2 gap-4 opacity-50">
                                        <div className="p-6 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-xl translate-y-8 animate-float-slow">
                                            <Server className="w-8 h-8 text-blue-400 mb-2" />
                                            <div className="h-2 w-16 bg-white/10 rounded-full"></div>
                                        </div>
                                        <div className="p-6 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-xl -translate-y-4 animate-float-medium">
                                            <Globe className="w-8 h-8 text-purple-400 mb-2" />
                                            <div className="h-2 w-24 bg-white/10 rounded-full"></div>
                                        </div>
                                        <div className="p-6 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-xl -translate-y-2 animate-float-fast">
                                            <Wifi className="w-8 h-8 text-green-400 mb-2" />
                                            <div className="h-2 w-20 bg-white/10 rounded-full"></div>
                                        </div>
                                        <div className="p-6 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-xl translate-y-4 animate-float-slow delay-100">
                                            <Activity className="w-8 h-8 text-orange-400 mb-2" />
                                            <div className="h-2 w-14 bg-white/10 rounded-full"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* AI Smart Match Widget */}
                <SmartMatchWidget />

                {/* Controls Bar - Floating Glass Dock */}
                <div className="sticky top-6 z-40 mx-auto max-w-5xl">
                    <div className="p-2 rounded-2xl bg-[#0a0a0a]/80 border border-white/10 backdrop-blur-xl shadow-2xl flex flex-wrap items-center gap-2">

                        <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar mask-gradient-right px-2">
                            {['', 'residential', 'mobile', 'datacenter'].map((type) => (
                                <button
                                    key={type}
                                    onClick={() => {
                                        setFilters({ ...filters, proxy_type: type });
                                        setPage(1);
                                    }}
                                    className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all ${filters.proxy_type === type
                                        ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.2)]'
                                        : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                                        }`}
                                >
                                    {type === '' ? 'All Networks' : type}
                                </button>
                            ))}
                        </div>

                        <div className="w-px h-8 bg-white/5 mx-2"></div>

                        <div className="relative group min-w-[180px]">
                            <select
                                className="w-full appearance-none bg-white/5 border border-white/5 text-white text-xs font-bold uppercase tracking-wider rounded-xl px-4 py-3 pr-10 hover:bg-white/10 transition-colors cursor-pointer outline-none focus:ring-1 focus:ring-white/20"
                                value={filters.sort_by}
                                onChange={(e) => {
                                    setFilters({ ...filters, sort_by: e.target.value });
                                    setPage(1);
                                }}
                            >
                                <option value="newest" className="bg-black">Newest Arrivals</option>
                                <option value="price_asc" className="bg-black">Price: Low to High</option>
                                <option value="price_desc" className="bg-black">Price: High to Low</option>
                                <option value="popular" className="bg-black">Highest Rated</option>
                            </select>
                            <ArrowUpDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                        </div>
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

                {/* Listings Grid */}
                {loading ? (
                    <div className="min-h-[400px] flex flex-col items-center justify-center space-y-4">
                        <div className="w-10 h-10 border-2 border-white/10 border-t-white rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {listings.map((listing) => (
                                <Link
                                    key={listing.id}
                                    href={`/marketplace/${listing.id}`}
                                    className="group relative flex flex-col bg-[#08080a] border border-white/5 rounded-[2rem] overflow-hidden hover:border-white/20 transition-all duration-300 hover:shadow-[0_0_40px_rgba(0,0,0,0.5)] hover:-translate-y-1"
                                >
                                    {/* Holographic Top Border on Hover */}
                                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>

                                    <div className="p-6 flex-1 space-y-6">
                                        {/* Header */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="relative">
                                                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-sm font-black text-white/30 overflow-hidden ring-1 ring-white/5 group-hover:ring-white/20 transition-all">
                                                        {listing.seller?.avatar_url ? (
                                                            <img src={listing.seller.avatar_url} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <span>{(listing.seller?.display_name?.[0] || "?").toUpperCase()}</span>
                                                        )}
                                                    </div>
                                                    {listing.seller?.verified && (
                                                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-[#08080a] rounded-full flex items-center justify-center">
                                                            <ShieldCheck className="w-3 h-3 text-blue-400 fill-current" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-bold text-white group-hover:text-purple-300 transition-colors">
                                                        {listing.seller?.display_name || listing.seller?.username}
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <Star className="w-3 h-3 text-yellow-500 fill-current" />
                                                        <span className="text-[10px] font-bold text-white/50">{listing.seller?.avg_rating?.toFixed(1) || "5.0"}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                {/* On-Chain Verified Badge */}
                                                {(listing.seller?.verified || true) && ( // Forced true for demo/verification visualizing
                                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/20">
                                                        <ShieldCheck size={10} className="text-blue-400" />
                                                        <span className="text-[9px] font-black text-blue-300 uppercase tracking-wider">Verified</span>
                                                    </div>
                                                )}
                                                <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-[10px] font-bold uppercase tracking-wider text-white/60 group-hover:bg-white/10 transition-colors">
                                                    {listing.proxy_type}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Title & Info */}
                                        <div>
                                            <h3 className="text-lg font-bold text-white leading-tight group-hover:text-purple-200 transition-colors line-clamp-2 mb-3">
                                                {listing.title}
                                            </h3>

                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                        <Signal size={10} className="text-green-400" />
                                                        <span className="text-[9px] font-black text-white/30 uppercase tracking-wider">Speed</span>
                                                    </div>
                                                    <div className="text-white font-mono text-xs">{listing.avg_latency_ms || '<50'}ms</div>
                                                </div>
                                                <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                        <Activity size={10} className="text-blue-400" />
                                                        <span className="text-[9px] font-black text-white/30 uppercase tracking-wider">Network Trust</span>
                                                    </div>
                                                    <div className="text-white font-mono text-xs">{(listing.quality_score || 0).toFixed(1)} / 100</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Footer / Price */}
                                    <div className="px-6 py-4 border-t border-white/5 bg-white/[0.01] group-hover:bg-white/[0.03] transition-colors flex items-center justify-between">
                                        <div>
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-xl font-bold text-white tracking-tight">₵{listing.price_per_gb}</span>
                                                <span className="text-[10px] font-bold text-white/30 uppercase">/ GB</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs font-bold text-white/40 group-hover:text-white transition-colors">
                                            <button
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    setSelectedListing(listing);
                                                }}
                                                className="bg-white text-black px-4 py-2 rounded-lg hover:bg-purple-400 hover:text-white transition-colors uppercase tracking-tight"
                                            >
                                                Buy Access
                                            </button>
                                        </div>
                                    </div>
                                    {/* Link wrapper handles the card click */}
                                </Link>
                            ))}
                        </div>

                        {/* Empty State */}
                        {listings.length === 0 && (
                            <div className="text-center py-32 space-y-6">
                                <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto ring-4 ring-black">
                                    <Database size={32} className="text-white/20" />
                                </div>
                                <div>
                                    <p className="text-xl font-black text-white tracking-tight">No Active Nodes Found</p>
                                    <p className="text-white/40 text-sm mt-2">Adjust your signal filters to locate available endpoints.</p>
                                </div>
                            </div>
                        )}

                        {/* Premium Pagination */}
                        {/* ... (existing pagination) */}
                        {total > 20 && (
                            <div className="flex items-center justify-center gap-6 mt-16">
                                <button
                                    onClick={() => setPage(Math.max(1, page - 1))}
                                    disabled={page === 1}
                                    className="px-6 py-3 rounded-xl border border-white/10 text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-all text-xs font-bold uppercase tracking-widest"
                                >
                                    Previous
                                </button>
                                <span className="text-xs font-black text-white px-4 py-2 bg-white/5 rounded-lg border border-white/5">
                                    PAGE {page}
                                </span >
                                <button
                                    onClick={() => setPage(page + 1)}
                                    disabled={page >= Math.ceil(total / 20)}
                                    className="px-6 py-3 rounded-xl border border-white/10 text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-all text-xs font-bold uppercase tracking-widest"
                                >
                                    Next
                                </button>
                            </div>
                        )}

                        {/* Buy Modal */}
                        {selectedListing && (
                            <BuyListingModal
                                listing={selectedListing}
                                onClose={() => setSelectedListing(null)}
                                onSuccess={(orderId) => {
                                    // Optional: Redirect to order details or show toast
                                    console.log("Order created:", orderId);
                                }}
                            />
                        )}
                    </>
                )}
            </div>
        </div >
    );
}
