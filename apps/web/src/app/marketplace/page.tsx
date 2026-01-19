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
    Search,
    Wifi,
    Signal,
    Activity,
    Server,
    Database,
    Loader2,
    ShoppingCart
} from "lucide-react";
import { SmartMatchWidget } from "@/components/SmartMatchWidget";
import { BuyListingModal } from "@/components/BuyListingModal";

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
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-1">Node Market</h1>
                    <p className="text-muted-foreground font-mono text-xs">ACQUIRE DECENTRALIZED BANDWIDTH RESOURCES.</p>
                </div>

                <div className="flex gap-4">
                    <div className="text-right">
                        <div className="text-2xl font-bold font-mono leading-none">{total}</div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Nodes</div>
                    </div>
                    <div className="w-px h-8 bg-border"></div>
                    <div className="text-right">
                        <div className="text-2xl font-bold font-mono leading-none text-green-500">99.9%</div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Uptime</div>
                    </div>
                </div>
            </div>

            {/* Smart Match */}
            <div className="card-retro p-6 bg-card border-l-4 border-l-primary">
                <h2 className="text-sm font-bold font-mono uppercase mb-4 flex items-center gap-2">
                    <Activity size={16} className="text-primary" />
                    Smart Match Protocol
                </h2>
                <SmartMatchWidget />
            </div>

            {/* Filters Bar */}
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between p-4 bg-secondary/10 border border-border rounded-sm">
                <div className="flex gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
                    {['', 'residential', 'mobile', 'datacenter'].map((type) => (
                        <button
                            key={type}
                            onClick={() => {
                                setFilters({ ...filters, proxy_type: type });
                                setPage(1);
                            }}
                            className={`px-3 py-1.5 rounded-sm text-[10px] font-bold font-mono uppercase transition-all border ${filters.proxy_type === type
                                    ? 'bg-primary text-primary-foreground border-foreground shadow-[2px_2px_0px_var(--foreground)]'
                                    : 'bg-background border-border text-muted-foreground hover:border-foreground'
                                }`}
                        >
                            {type === '' ? 'All Networks' : type}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                    <span className="text-[10px] font-mono font-bold uppercase text-muted-foreground whitespace-nowrap">Sort By:</span>
                    <select
                        className="bg-background border border-border text-xs font-mono font-bold uppercase rounded-sm px-2 py-1.5 outline-none focus:border-primary"
                        value={filters.sort_by}
                        onChange={(e) => {
                            setFilters({ ...filters, sort_by: e.target.value });
                            setPage(1);
                        }}
                    >
                        <option value="newest">Newest</option>
                        <option value="price_asc">Price: Low to High</option>
                        <option value="price_desc">Price: High to Low</option>
                        <option value="popular">Rating</option>
                    </select>
                </div>
            </div>

            {/* Error State */}
            {error && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono font-bold uppercase flex justify-between items-center">
                    <span>Error: {error}</span>
                    <button onClick={fetchListings} className="underline hover:no-underline">RETRY</button>
                </div>
            )}

            {/* Listings Grid */}
            {loading ? (
                <div className="py-20 flex flex-col items-center justify-center space-y-4">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest">Scanning Network...</p>
                </div>
            ) : listings.length === 0 ? (
                <div className="py-20 text-center border-2 border-dashed border-border rounded-sm">
                    <Database size={32} className="mx-auto text-muted-foreground mb-4 opacity-50" />
                    <p className="font-mono text-lg font-bold uppercase">No Nodes Found</p>
                    <p className="font-mono text-xs text-muted-foreground mt-2">ADJUST FILTERS OR DEPLOY A NEW NODE.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {listings.map((listing) => (
                        <div key={listing.id} className="card-retro p-0 bg-card group hover:-translate-y-1 transition-transform duration-300">
                            {/* Card Header */}
                            <div className="p-5 border-b border-border flex justify-between items-start">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-sm bg-secondary border border-border flex items-center justify-center overflow-hidden">
                                        {listing.seller?.avatar_url ? (
                                            <img src={listing.seller.avatar_url} className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="font-mono font-bold text-sm">{(listing.seller?.display_name?.[0] || "?").toUpperCase()}</span>
                                        )}
                                    </div>
                                    <div>
                                        <h3 className="font-bold font-mono text-sm leading-tight line-clamp-1">{listing.title}</h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-muted-foreground">
                                                <Star size={10} className="text-yellow-500 fill-current" />
                                                {listing.seller?.avg_rating?.toFixed(1) || "5.0"}
                                            </div>
                                            <span className="text-[10px] font-mono text-muted-foreground">|</span>
                                            <div className="text-[10px] font-mono font-bold uppercase text-primary">
                                                {listing.proxy_type}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Card Stats */}
                            <div className="grid grid-cols-2 divide-x divide-border border-b border-border bg-secondary/5">
                                <div className="p-3 text-center">
                                    <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Speed</div>
                                    <div className="font-mono font-bold text-xs flex items-center justify-center gap-1">
                                        <Signal size={12} className="text-green-500" />
                                        {listing.avg_latency_ms || '<50'}ms
                                    </div>
                                </div>
                                <div className="p-3 text-center">
                                    <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Score</div>
                                    <div className="font-mono font-bold text-xs flex items-center justify-center gap-1">
                                        <Activity size={12} className="text-blue-500" />
                                        {(listing.quality_score || 0).toFixed(0)}/100
                                    </div>
                                </div>
                            </div>

                            {/* Card Footer */}
                            <div className="p-5 flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-mono uppercase text-muted-foreground">Rate</span>
                                    <span className="text-lg font-bold font-mono">₵{listing.price_per_gb}<span className="text-xs text-muted-foreground">/GB</span></span>
                                </div>
                                <button
                                    onClick={() => setSelectedListing(listing)}
                                    className="btn-retro btn-retro-primary py-2 px-4 text-xs flex items-center gap-2"
                                >
                                    <ShoppingCart size={14} />
                                    BUY
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Pagination */}
            {total > 20 && (
                <div className="flex justify-center gap-4 pt-8">
                    <button
                        onClick={() => setPage(Math.max(1, page - 1))}
                        disabled={page === 1}
                        className="btn-retro btn-retro-outline py-2 px-4 text-xs disabled:opacity-50"
                    >
                        PREV
                    </button>
                    <span className="h-full flex items-center font-mono font-bold text-sm">
                        PAGE {page}
                    </span>
                    <button
                        onClick={() => setPage(page + 1)}
                        disabled={page >= Math.ceil(total / 20)}
                        className="btn-retro btn-retro-outline py-2 px-4 text-xs disabled:opacity-50"
                    >
                        NEXT
                    </button>
                </div>
            )}

            {/* Buy Modal */}
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
