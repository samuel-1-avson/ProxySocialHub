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
    Cpu,
    Target,
    Hexagon,
    ChevronRight,
    TrendingUp,
    ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SmartMatchWidget } from "@/components/SmartMatchWidget";
import { BuyListingModal } from "@/components/BuyListingModal";
import { ListingCard } from "@/components/ListingCard";
import { GlassCard } from "@/components/ui/glass-card";

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

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="min-h-screen bg-[#09090b] text-foreground p-8 md:p-12 space-y-12 font-mono selection:bg-primary/30"
        >
            {/* V3 Alpha-Terminal Header */}
            <motion.header variants={itemVariants} className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-8 border-b border-white/5 pb-12">
                <div className="space-y-4">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-3xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_30px_rgba(16,185,129,0.1)] group relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <Cpu size={32} className="text-primary relative z-10" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 text-primary text-[10px] font-black uppercase tracking-[0.4em] mb-1">
                                <Hexagon size={12} className="animate-spin-slow" /> Protocol Acquisition
                            </div>
                            <h1 className="text-5xl font-black uppercase tracking-tighter leading-none bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">Node Market</h1>
                            <p className="text-muted-foreground/40 font-mono text-[10px] mt-2 flex items-center gap-3 uppercase tracking-tighter">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                Global Liquidity Pool V3.1 // Sector Active
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-8 glass-card !p-6 border border-white/5 bg-white/2 backdrop-blur-3xl !rounded-3xl shadow-2xl">
                    <div className="text-center px-6 border-r border-white/5">
                        <div className="text-3xl font-black tracking-tighter">{total}</div>
                        <div className="text-[9px] text-muted-foreground/40 uppercase tracking-[0.2em] font-black">Active Grid</div>
                    </div>
                    <div className="text-center px-6 border-r border-white/5 text-emerald-500">
                        <div className="text-3xl font-black tracking-tighter">99.9%</div>
                        <div className="text-[9px] text-muted-foreground/40 uppercase tracking-[0.2em] font-black">Uptime index</div>
                    </div>
                    {user?.role === 'provider' && (
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Link href="/marketplace/create" className="px-8 py-4 rounded-2xl bg-primary text-primary-foreground font-black text-xs uppercase tracking-widest flex items-center gap-3 shadow-xl hover:shadow-primary/20 transition-all">
                                <Plus size={18} /> Sell Nodes
                            </Link>
                        </motion.div>
                    )}
                </div>
            </motion.header>

            {/* Smart Match - Elevated UI */}
            <motion.section variants={itemVariants} className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-emerald-500/20 rounded-[2.5rem] blur-2xl opacity-20 group-hover:opacity-40 transition duration-1000"></div>
                <div className="relative">
                    <SmartMatchWidget />
                </div>
            </motion.section>

            {/* Marketplace Grid Controls */}
            <motion.div variants={itemVariants} className="sticky top-6 z-40 flex flex-col lg:flex-row gap-6 items-center justify-between p-6 glass-card border border-white/10 !bg-black/60 backdrop-blur-3xl !rounded-3xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)]">
                <div className="flex gap-3 overflow-x-auto w-full lg:w-auto pb-2 lg:pb-0 px-2">
                    {['', 'residential', 'mobile', 'datacenter'].map((type) => (
                        <button
                            key={type}
                            onClick={() => {
                                setFilters({ ...filters, proxy_type: type });
                                setPage(1);
                            }}
                            className={`px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border whitespace-nowrap ${filters.proxy_type === type
                                ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                                : 'bg-white/5 border-white/5 text-muted-foreground/40 hover:text-foreground hover:border-white/20'
                                }`}
                        >
                            {type === '' ? 'Global Pool' : type}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-4 w-full lg:w-auto border-t lg:border-t-0 lg:border-l border-white/5 pt-4 lg:pt-0 lg:pl-6">
                    <button
                        onClick={() => {
                            setFilters({ proxy_type: "", sort_by: "newest", country: "", min_price: "", max_price: "" });
                            setPage(1);
                        }}
                        className="p-3 rounded-2xl bg-white/5 border border-white/10 text-muted-foreground/40 hover:text-primary hover:border-primary/50 transition-all"
                    >
                        <Filter size={18} />
                    </button>
                    <div className="relative flex-1 lg:flex-none">
                        <select
                            className="w-full lg:w-[200px] bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest rounded-2xl px-5 py-3 outline-none focus:border-primary/50 text-foreground/80 appearance-none cursor-pointer"
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
                        <ChevronRight size={14} className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 text-muted-foreground/30 pointer-events-none" />
                    </div>
                </div>
            </motion.div>

            {/* Error Interface */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="p-6 glass-card border border-rose-500/20 bg-rose-500/5 text-rose-500 text-[10px] font-black uppercase tracking-[0.2em] flex justify-between items-center rounded-3xl"
                    >
                        <div className="flex items-center gap-4">
                            <Zap size={16} className="animate-pulse" />
                            SIGNAL INTERRUPTION: {error}
                        </div>
                        <button onClick={fetchListings} className="px-4 py-2 bg-rose-500/10 rounded-xl hover:bg-rose-500/20 transition-all">RESCAN GRID</button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Listings Grid */}
            <AnimatePresence mode="wait">
                {loading ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="py-60 flex flex-col items-center justify-center space-y-8"
                    >
                        <div className="relative">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                className="w-24 h-24 border-t-2 border-r-2 border-primary rounded-full"
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Loader2 className="w-8 h-8 animate-spin text-primary opacity-50" />
                            </div>
                        </div>
                        <p className="font-mono text-[11px] text-muted-foreground/30 uppercase tracking-[0.5em] animate-pulse">Scanning Grid Segments...</p>
                    </motion.div>
                ) : listings.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="py-40 text-center border-2 border-dashed border-white/5 rounded-[3rem] bg-white/[0.01]"
                    >
                        <Database size={64} className="mx-auto text-white/5 mb-8" />
                        <p className="font-black text-2xl uppercase tracking-tighter opacity-80">Zero Nodes Detected</p>
                        <p className="font-mono text-[10px] text-muted-foreground/30 mt-4 uppercase tracking-[0.3em] max-w-sm mx-auto">
                            The requested sector is currently dark. Adjust filters or wait for mesh synchronization.
                        </p>
                    </motion.div>
                ) : (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10"
                    >
                        {listings.map((listing) => (
                            <ListingCard
                                key={listing.id}
                                listing={listing}
                                onSelect={setSelectedListing}
                            />
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Deep Pagination */}
            {total > 20 && (
                <motion.footer variants={itemVariants} className="flex justify-center gap-8 pt-20">
                    <motion.button
                        whileHover={{ scale: 1.1, x: -5 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setPage(Math.max(1, page - 1))}
                        disabled={page === 1}
                        className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 disabled:opacity-10 hover:bg-white/10 transition-all font-black"
                    >
                        <div className="rotate-180"><ChevronRight size={24} /></div>
                    </motion.button>
                    <div className="h-14 px-10 rounded-2xl bg-white/5 border border-white/5 flex items-center font-mono font-black text-xs uppercase tracking-[0.4em] text-muted-foreground/40 shadow-xl">
                        Sector <span className="text-primary ml-4 mr-1 text-lg">{page}</span> / {Math.ceil(total / 20)}
                    </div>
                    <motion.button
                        whileHover={{ scale: 1.1, x: 5 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setPage(page + 1)}
                        disabled={page >= Math.ceil(total / 20)}
                        className="w-14 h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center font-black disabled:opacity-20 shadow-xl shadow-primary/20"
                    >
                        <ChevronRight size={24} />
                    </motion.button>
                </motion.footer>
            )}

            {/* Acquisition Protocol Modal */}
            <AnimatePresence>
                {selectedListing && (
                    <BuyListingModal
                        listing={selectedListing}
                        onClose={() => setSelectedListing(null)}
                        onSuccess={(orderId) => {
                            console.log("Order created:", orderId);
                        }}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}
