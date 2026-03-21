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
    ShieldCheck,
    Globe,
    Layers,
    Server,
    Radar
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
            className="space-y-16 pb-32 font-mono selection:bg-primary/30"
        >
            {/* Tactical Protocol Header */}
            <motion.header variants={itemVariants} className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-12 border-b border-white/5 pb-16">
                <div className="space-y-6">
                    <div className="flex items-center gap-5">
                        <div className="w-20 h-20 rounded-[2rem] bg-gradient-to-br from-primary/20 to-emerald-500/5 flex items-center justify-center border border-primary/20 shadow-2xl group relative overflow-hidden">
                            <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <Radar size={40} className="text-primary group-hover:scale-110 transition-transform duration-500" />
                        </div>
                        <div className="space-y-1">
                            <div className="flex items-center gap-3 text-primary text-[10px] font-black uppercase tracking-[0.5em] mb-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                Protocol Registry // Sector Active
                            </div>
                            <h1 className="text-6xl font-black uppercase tracking-tighter leading-none bg-clip-text text-transparent bg-gradient-to-r from-primary via-emerald-400 to-white">Node Market</h1>
                            <p className="text-muted-foreground/30 font-black text-[10px] uppercase tracking-widest flex items-center gap-3">
                                Total Grid Capacity: <span className="text-foreground/60">{total.toLocaleString()} Units</span>
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-10">
                    <div className="flex items-center gap-10 p-6 px-10 glass-card border-white/5 bg-white/[0.02] rounded-[2.5rem] shadow-2xl backdrop-blur-3xl">
                        <div className="space-y-1">
                            <div className="text-[10px] text-muted-foreground/40 uppercase tracking-[0.3em] font-black">Global Liquidity</div>
                            <div className="text-3xl font-black tracking-tighter text-white">99.9<span className="text-sm opacity-20 ml-1">%</span></div>
                        </div>
                        <div className="w-px h-10 bg-white/5" />
                        <div className="space-y-1">
                            <div className="text-[10px] text-muted-foreground/40 uppercase tracking-[0.3em] font-black">Registry State</div>
                            <div className="text-[11px] font-black uppercase text-emerald-500 flex items-center gap-2">
                                <Activity size={12} className="animate-pulse" /> Normalized
                            </div>
                        </div>
                    </div>

                    {user?.role === 'provider' && (
                        <Link href="/marketplace/create" className="group relative px-10 py-5 rounded-[1.8rem] bg-primary text-primary-foreground font-black text-xs uppercase tracking-[0.3em] flex items-center gap-3 shadow-2xl shadow-primary/20 hover:shadow-primary/40 transition-all active:scale-[0.98]">
                            <Plus size={20} className="group-hover:rotate-90 transition-transform duration-300" />
                            Submit Sequence
                        </Link>
                    )}
                </div>
            </motion.header>

            {/* Neural Context Hub */}
            <motion.section variants={itemVariants}>
                <div className="relative group">
                    <div className="absolute -inset-4 bg-primary/5 blur-[100px] opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
                    <SmartMatchWidget />
                </div>
            </motion.section>

            {/* Grid Control Interface */}
            <div className="space-y-10">
                <motion.div variants={itemVariants} className="flex flex-col lg:flex-row gap-6 items-center justify-between p-2 glass-card border border-white/10 !bg-white/[0.01] backdrop-blur-3xl rounded-[2.5rem] shadow-2xl">
                    <div className="flex flex-wrap gap-2 p-1.5 flex-1">
                        {[
                            { id: '', label: 'Global Grid', icon: Globe },
                            { id: 'residential', label: 'Residential', icon: Server },
                            { id: 'mobile', label: 'Mobile Mesh', icon: Zap },
                            { id: 'datacenter', label: 'Vault Data', icon: Layers }
                        ].map((type) => (
                            <button
                                key={type.id}
                                onClick={() => {
                                    setFilters({ ...filters, proxy_type: type.id });
                                    setPage(1);
                                }}
                                className={`px-8 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all gap-3 flex items-center whitespace-nowrap ${filters.proxy_type === type.id
                                    ? 'bg-primary text-primary-foreground shadow-xl shadow-primary/20'
                                    : 'text-muted-foreground/40 hover:text-foreground hover:bg-white/5'
                                    }`}
                            >
                                <type.icon size={14} className={filters.proxy_type === type.id ? 'opacity-100' : 'opacity-20'} />
                                {type.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-4 p-2 pl-6 border-l border-white/5">
                        <button
                            onClick={() => {
                                setFilters({ proxy_type: "", sort_by: "newest", country: "", min_price: "", max_price: "" });
                                setPage(1);
                            }}
                            className="p-4 rounded-2xl bg-white/5 border border-white/5 text-muted-foreground/30 hover:text-primary hover:border-primary/40 transition-all"
                            title="Reset Parameters"
                        >
                            <Filter size={18} />
                        </button>
                        <div className="relative">
                            <select
                                className="bg-black/40 border border-white/5 text-[10px] font-black uppercase tracking-widest rounded-2xl px-8 py-4 outline-none focus:border-primary/40 text-foreground/60 appearance-none cursor-pointer min-w-[240px] transition-all"
                                value={filters.sort_by}
                                onChange={(e) => {
                                    setFilters({ ...filters, sort_by: e.target.value });
                                    setPage(1);
                                }}
                            >
                                <option value="newest">LATEST_SYNC_SIGNALS</option>
                                <option value="price_asc">RATE_INT_ASCENDING</option>
                                <option value="price_desc">RATE_INT_DESCENDING</option>
                                <option value="popular">TRUST_CRED_RATING</option>
                            </select>
                            <ChevronRight size={14} className="absolute right-5 top-1/2 -translate-y-1/2 rotate-90 text-white/10 pointer-events-none" />
                        </div>
                    </div>
                </motion.div>

                {/* Grid Visualizer */}
                <div className="min-h-[600px] relative">
                    <AnimatePresence mode="wait">
                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                className="mb-10 p-6 glass-card border-rose-500/20 bg-rose-500/5 text-rose-500 text-[10px] font-black uppercase tracking-[0.3em] flex justify-between items-center rounded-3xl"
                            >
                                <div className="flex items-center gap-4">
                                    <Zap size={16} className="animate-pulse" />
                                    SIGNAL INTERRUPTION: {error}
                                </div>
                                <button onClick={fetchListings} className="px-6 py-2 bg-rose-500/10 rounded-xl hover:bg-rose-500/20 transition-all border border-rose-500/20">RESCAN_SECTOR</button>
                            </motion.div>
                        )}

                        {loading ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="py-40 flex flex-col items-center justify-center space-y-10"
                            >
                                <div className="relative w-32 h-32">
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                        className="absolute inset-0 border-b-2 border-primary rounded-full"
                                    />
                                    <motion.div
                                        animate={{ rotate: -360 }}
                                        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                                        className="absolute inset-4 border-t-2 border-primary/20 rounded-full"
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <Loader2 className="animate-spin text-primary/40" size={32} />
                                    </div>
                                </div>
                                <p className="text-[10px] font-black text-muted-foreground/20 uppercase tracking-[0.8em] animate-pulse">Syncing Grid Segments...</p>
                            </motion.div>
                        ) : listings.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="py-60 text-center border border-dashed border-white/5 rounded-[4rem] bg-white/[0.01]"
                            >
                                <Database size={80} className="mx-auto text-white/5 mb-10" />
                                <h3 className="font-black text-3xl uppercase tracking-tighter opacity-80">Grid Sector Dark</h3>
                                <p className="font-black text-[10px] text-muted-foreground/30 mt-6 uppercase tracking-[0.4em] max-w-sm mx-auto leading-relaxed">
                                    No node signatures detected in the current filter spectrum. Reset parameters or wait for mesh sync.
                                </p>
                            </motion.div>
                        ) : (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8"
                            >
                                {listings.map((listing) => (
                                    <ListingCardEnhanced
                                        key={listing.id}
                                        listing={listing}
                                        onSelect={setSelectedListing}
                                    />
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Tactical Pagination */}
                {total > 20 && (
                    <motion.footer variants={itemVariants} className="flex justify-center items-center gap-10 pt-32">
                        <button
                            onClick={() => setPage(Math.max(1, page - 1))}
                            disabled={page === 1}
                            className="w-16 h-16 rounded-[1.8rem] bg-white/[0.02] border border-white/5 flex items-center justify-center text-white hover:border-primary/40 transition-all disabled:opacity-10 group"
                        >
                            <ChevronRight size={24} className="rotate-180 group-hover:-translate-x-1 transition-transform" />
                        </button>

                        <div className="flex flex-col items-center gap-2">
                            <div className="text-[10px] font-black text-white/20 uppercase tracking-[0.5em]">Sector Access</div>
                            <div className="text-2xl font-black text-white px-10 py-3 rounded-2xl bg-white/5 border border-white/5">
                                {page} <span className="opacity-10 mx-3">/</span> {Math.ceil(total / 20)}
                            </div>
                        </div>

                        <button
                            onClick={() => setPage(page + 1)}
                            disabled={page >= Math.ceil(total / 20)}
                            className="w-16 h-16 rounded-[1.8rem] bg-primary/20 border border-primary/30 text-primary flex items-center justify-center font-black disabled:opacity-5 group shadow-2xl shadow-primary/10"
                        >
                            <ChevronRight size={24} className="group-hover:translate-x-1 transition-transform" />
                        </button>
                    </motion.footer>
                )}
            </div>

            {/* Acquisition Protocol Overlay */}
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
