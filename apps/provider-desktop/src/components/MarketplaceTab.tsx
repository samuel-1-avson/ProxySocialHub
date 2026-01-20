import { useEffect, useState } from 'react';
import { marketplace, Listing } from '../lib/api';
import { ShoppingCart, Star, RotateCw, Wifi, Shield, Zap } from "lucide-react";

export function MarketplaceTab() {
    const [listings, setListings] = useState<Listing[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [page, setPage] = useState(1);
    const [filters, setFilters] = useState({
        proxy_type: "",
        sort_by: "newest"
    });

    useEffect(() => {
        loadListings();
    }, [page, filters]);

    const loadListings = async () => {
        try {
            setLoading(true);
            const data = await marketplace.getListings({
                proxy_type: filters.proxy_type,
                sort_by: filters.sort_by,
                page
            });
            setListings(data.listings || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleRefresh = () => {
        setRefreshing(true);
        loadListings();
    };

    const handleBuy = async (id: string, price: number) => {
        if (confirm(`Start IaaS Session?\n\nRate: ₵${price} per GB\nBilling: Pay-as-you-go (deducted from wallet)`)) {
            try {
                await marketplace.buy(id, 1); // API ignores amount 1 now
                alert("Session Started! Access credentials sent.");
            } catch (err) {
                alert("Connection failed. Please check wallet balance.");
            }
        }
    };

    const ListingCardSkeleton = () => (
        <div className="bg-white/50 dark:bg-gray-800/50 rounded-xl p-5 border border-gray-100 dark:border-gray-800 animate-pulse h-[200px]">
            <div className="flex justify-between mb-4">
                <div className="w-16 h-5 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="w-10 h-5 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
            <div className="h-6 w-3/4 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
            <div className="h-4 w-1/2 bg-gray-200 dark:bg-gray-700 rounded mb-6" />
            <div className="flex justify-between mt-auto pt-4 border-t border-gray-100 dark:border-gray-700">
                <div className="w-20 h-8 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="w-24 h-8 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
        </div>
    );

    return (
        <div className="p-8 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex justify-between items-end mb-8">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3 text-gray-900 dark:text-white">
                        <div className="p-2 bg-primary/10 rounded-lg">
                            <ShoppingCart className="w-6 h-6 text-primary" />
                        </div>
                        Node Marketplace
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 mt-2 font-medium">
                        Verified residential bandwidth & AI compute nodes.
                    </p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing || loading}
                    className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                    title="Refresh Listings"
                >
                    <RotateCw className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} />
                </button>
            </div>

            {/* Controls */}
            <div className="glass-panel p-1 rounded-xl mb-8 flex gap-2 w-fit backdrop-blur-md bg-white/60 dark:bg-gray-900/60 border border-gray-200/50 dark:border-gray-700/50">
                <select
                    className="bg-transparent px-4 py-2 text-sm font-medium focus:outline-none cursor-pointer text-gray-700 dark:text-gray-200"
                    value={filters.proxy_type}
                    onChange={e => setFilters({ ...filters, proxy_type: e.target.value })}
                >
                    <option value="">All Networks</option>
                    <option value="residential">Residential ISP</option>
                    <option value="mobile">Mobile 4G/5G</option>
                    <option value="datacenter">Datacenter</option>
                </select>
                <div className="w-px bg-gray-200 dark:bg-gray-700 my-2"></div>
                <select
                    className="bg-transparent px-4 py-2 text-sm font-medium focus:outline-none cursor-pointer text-gray-700 dark:text-gray-200"
                    value={filters.sort_by}
                    onChange={e => setFilters({ ...filters, sort_by: e.target.value })}
                >
                    <option value="newest">Newest Arrivals</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="popular">Most Popular</option>
                </select>
            </div>

            {/* Grid */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3, 4, 5, 6].map(i => <ListingCardSkeleton key={i} />)}
                </div>
            ) : listings.length === 0 ? (
                <div className="text-center py-20 bg-gray-50/50 dark:bg-gray-800/20 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                    <Wifi className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 font-medium">No active nodes found matching filters.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {listings.map(item => (
                        <div
                            key={item.id}
                            className="group relative bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-800 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <span className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full border ${item.proxy_type === 'residential'
                                    ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800/30'
                                    : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800/30'
                                    }`}>
                                    {item.proxy_type}
                                </span>
                                <div className="flex items-center gap-1 text-sm font-medium text-amber-500">
                                    <Star className="w-3.5 h-3.5 fill-current" />
                                    <span>{item.seller.avg_rating?.toFixed(1) || "5.0"}</span>
                                </div>
                            </div>

                            <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-1.5 leading-tight group-hover:text-primary transition-colors">
                                {item.title}
                            </h3>

                            <div className="flex items-center gap-2 mb-6">
                                <p className="text-xs font-mono text-gray-500 dark:text-gray-400">@{item.seller.username}</p>
                                {item.seller.is_verified_agent && (
                                    <div className="flex items-center gap-1 pl-2 border-l border-gray-200 dark:border-gray-700" title="Verified AI Agent">
                                        <Shield className="w-3 h-3 text-blue-500" />
                                        <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                                            Verified
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-6 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                <div className="flex flex-col">
                                    <span className="text-[10px] uppercase text-gray-400 font-bold mb-1">Uptime</span>
                                    <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                                        <Zap className="w-3.5 h-3.5 text-green-500" />
                                        {item.uptime_percent || 99.9}%
                                    </div>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[10px] uppercase text-gray-400 font-bold mb-1">Latency</span>
                                    <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                                        <Wifi className="w-3.5 h-3.5 text-blue-500" />
                                        {item.avg_latency_ms || 45}ms
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-between items-center pt-2">
                                <div className="flex flex-col">
                                    <span className="text-2xl font-bold font-mono tracking-tighter text-gray-900 dark:text-white">
                                        ₵{item.price_per_gb.toFixed(2)}
                                    </span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">per GB</span>
                                </div>
                                <button
                                    onClick={() => handleBuy(item.id, item.price_per_gb)}
                                    className="bg-black dark:bg-white text-white dark:text-black px-5 py-2.5 rounded-lg hover:opacity-90 text-sm font-bold transition-all shadow-lg hover:shadow-xl active:scale-95"
                                >
                                    Connect
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
