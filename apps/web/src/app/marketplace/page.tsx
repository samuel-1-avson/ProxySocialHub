"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getListings, type Listing } from "@/lib/api/marketplace";
import {
    Activity,
    Database,
    Loader2,
    Plus,
    Filter,
    Zap,
    Cpu
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SmartMatchWidget } from "@/components/SmartMatchWidget";
import { BuyListingModal } from "@/components/BuyListingModal";
import { ListingCard } from "@/components/ListingCard";

export default function MarketplacePage() {
    const { user } = useAuth();
    const [listings, setListings] = useState<Listing[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [filters, setFilters] = useState({
        proxy_type: "",
        sort_by: "newest",
        country: "",
        min_price: "",
        max_price: ""
    });
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [selectedListing, setSelectedListing] = useState<Listing | null>(null);

    const fetchListings = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const params: any = {
                sort_by: filters.sort_by,
                page,
            };
            if (filters.proxy_type) params.proxy_type = filters.proxy_type;
            if (filters.country) params.country = filters.country;
            if (filters.min_price) params.min_price = filters.min_price;
            if (filters.max_price) params.max_price = filters.max_price;

            const data = await getListings(params);
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
        <div className="min-h-screen bg-[#0A0A0B] text-white p-4 md:p-8 space-y-10">
            {/* V3 Industrial Header */}
            <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-white/5 pb-10">
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-blue-600 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                            <Cpu size={24} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-4xl font-black uppercase tracking-tighter leading-none">Node Market</h1>
                            <p className="text-white/40 font-mono text-[10px] mt-1 flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                                PROTOCOL ACQUISITION ENGINE V3.1
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-6 bg-white/[0.03] border border-white/5 rounded-2xl p-4 backdrop-blur-xl">
                    <div className="text-center px-4 border-r border-white/5 font-mono">
                        <div className="text-2xl font-black">{total}</div>
                        <div className="text-[8px] text-white/30 uppercase tracking-[0.2em] font-bold">Active Nodes</div>
                    </div>
                    <div className="text-center px-4 border-r border-white/5 font-mono text-emerald-400">
                        <div className="text-2xl font-black">99.9%</div>
                        <div className="text-[8px] text-white/30 uppercase tracking-[0.2em] font-bold">Health</div>
                    </div>
                    {user?.role === 'provider' && (
                        <Link href="/marketplace/create" className="group relative px-6 py-3 rounded-xl bg-white text-black font-black text-xs uppercase tracking-widest flex items-center gap-2 transition-all hover:scale-105">
                            <Plus size={16} /> SELL NODES
                        </Link>
                    )}
                </div>
            </header>

            {/* Smart Match - Prominent Placement */}
            <section className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/20 to-blue-500/20 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
                <div className="relative">
                    <SmartMatchWidget />
                </div>
            </section>

            {/* Marketplace Grid Controls */}
            <div className="sticky top-4 z-40 flex flex-col md:flex-row gap-4 items-center justify-between p-4 bg-[#141415]/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl">
                <div className="flex gap-2 overflow-x-auto w-full md:w-auto">
                    {['', 'residential', 'mobile', 'datacenter'].map((type) => (
                        <button
                            key={type}
                            onClick={() => {
                                setFilters({ ...filters, proxy_type: type });
                                setPage(1);
                            }}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${filters.proxy_type === type
                                ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.2)]'
                                : 'bg-white/5 border-white/10 text-white/40 hover:text-white hover:border-white/20'
                                }`}
                        >
                            {type === '' ? 'Global Pool' : type}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-4 w-full md:w-auto">
                    <button
                        onClick={() => {
                            setFilters({ proxy_type: "", sort_by: "newest", country: "", min_price: "", max_price: "" });
                            setPage(1);
                        }}
                        className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white transition-colors"
                    >
                        <Filter size={18} />
                    </button>
                    <select
                        className="bg-white/5 border border-white/10 text-xs font-black uppercase tracking-widest rounded-xl px-4 py-2 outline-none focus:border-white/40 text-white/80"
                        value={filters.sort_by}
                        onChange={(e) => {
                            setFilters({ ...filters, sort_by: e.target.value });
                            setPage(1);
                        }}
                    >
                        <option value="newest">Latest Signals</option>
                        <option value="price_asc">Rate: Ascending</option>
                        <option value="price_desc">Rate: Descending</option>
                        <option value="popular">Trust Rating</option>
                    </select>
                </div>
            </div>

            {/* Error Interface */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="p-5 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-[10px] font-black uppercase tracking-[0.2em] flex justify-between items-center"
                    >
                        <div className="flex items-center gap-3">
                            <Zap size={14} />
                            SIGNAL INTERRUPTION: {error}
                        </div>
                        <button onClick={fetchListings} className="underline hover:text-white">REINITIALIZE SCAN</button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Listings Interface */}
            {loading ? (
                <div className="py-40 flex flex-col items-center justify-center space-y-6">
                    <div className="relative">
                        <div className="w-16 h-16 border-b-2 border-emerald-500 rounded-full animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="w-6 h-6 animate-pulse text-emerald-500" />
                        </div>
                    </div>
                    <p className="font-mono text-[10px] text-white/30 uppercase tracking-[0.4em]">Optimizing Discovery Mesh...</p>
                </div>
            ) : listings.length === 0 ? (
                <div className="py-40 text-center border-2 border-dashed border-white/5 rounded-3xl bg-white/[0.01]">
                    <Database size={48} className="mx-auto text-white/10 mb-6" />
                    <p className="font-black text-xl uppercase tracking-tighter">Zero Nodes Detected</p>
                    <p className="font-mono text-[10px] text-white/30 mt-3 uppercase tracking-widest">ADJUST FILTERS OR WAIT FOR NETWORK REPLICATION.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {listings.map((listing) => (
                        <ListingCard
                            key={listing.id}
                            listing={listing}
                            onSelect={setSelectedListing}
                        />
                    ))}
                </div>
            )}

            {/* Deep Pagination */}
            {total > 20 && (
                <footer className="flex justify-center gap-6 pt-12">
                    <button
                        onClick={() => setPage(Math.max(1, page - 1))}
                        disabled={page === 1}
                        className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 disabled:opacity-20 hover:bg-white/10 transition-all font-black"
                    >
                        -
                    </button>
                    <div className="h-12 px-6 rounded-xl bg-white/[0.03] border border-white/5 flex items-center font-mono font-black text-xs uppercase tracking-widest text-white/40">
                        Sector <span className="text-white ml-2">{page}</span>
                    </div>
                    <button
                        onClick={() => setPage(page + 1)}
                        disabled={page >= Math.ceil(total / 20)}
                        className="w-12 h-12 rounded-xl bg-white text-black flex items-center justify-center font-black disabled:opacity-20 hover:scale-105 transition-all"
                    >
                        +
                    </button>
                </footer>
            )}

            {/* Acquisition Protocol Modal */}
            {selectedListing && (
                <BuyListingModal
                    listing={selectedListing}
                    onClose={() => setSelectedListing(null)}
                    onSuccess={(orderId) => {
                        console.log("Order created:", orderId);
                    }}
                />
            )}
        </div>
    );
}
