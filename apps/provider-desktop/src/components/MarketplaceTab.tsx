import { useEffect, useState } from 'react';
import { marketplace, Listing } from '../lib/api'; // Ensure Listing is exported from api.ts
import { ShoppingCart, Star, Loader } from "lucide-react";

export function MarketplaceTab() {
    const [listings, setListings] = useState<Listing[]>([]);
    const [loading, setLoading] = useState(true);
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
        }
    };

    const handleBuy = async (id: string, price: number) => {
        if (confirm(`Buy 1 GB for GHS ${price}?`)) {
            try {
                await marketplace.buy(id, 1);
                alert("Purchase successful! Proxy credentials sent to email.");
            } catch (err) {
                alert("Purchase failed. Check balance.");
            }
        }
    };

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <ShoppingCart className="w-6 h-6" /> Marketplace
                    </h2>
                    <p className="text-gray-500 text-sm">Buy residential bandwidth from verified providers.</p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex gap-4 mb-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm">
                <select
                    className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                    value={filters.proxy_type}
                    onChange={e => setFilters({ ...filters, proxy_type: e.target.value })}
                >
                    <option value="">All Types</option>
                    <option value="residential">Residential</option>
                    <option value="mobile">Mobile</option>
                    <option value="datacenter">Datacenter</option>
                </select>
                <select
                    className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                    value={filters.sort_by}
                    onChange={e => setFilters({ ...filters, sort_by: e.target.value })}
                >
                    <option value="newest">Newest</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="popular">Popular</option>
                </select>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader className="w-8 h-8 animate-spin text-gray-400" />
                </div>
            ) : listings.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg dashed-border">
                    <p>No listings found.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {listings.map(item => (
                        <div key={item.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow p-5 border dark:border-gray-700">
                            <div className="flex justify-between mb-3">
                                <span className={`text-xs px-2 py-1 rounded badge-muted uppercase font-bold`}>
                                    {item.proxy_type}
                                </span>
                                <div className="flex items-center gap-1 text-sm text-yellow-500">
                                    <Star className="w-4 h-4 fill-current" />
                                    <span>{item.seller.avg_rating || "5.0"}</span>
                                </div>
                            </div>

                            <h3 className="font-bold text-lg mb-1">{item.title}</h3>
                            <div className="flex items-center gap-2 mb-4">
                                <p className="text-sm text-gray-500">by @{item.seller.username}</p>
                                {item.seller.is_verified_agent && (
                                    <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800" title="Cryptographically Verified Agent">
                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                                        Verified Agent
                                    </span>
                                )}
                            </div>

                            <div className="flex justify-between items-center mb-4 text-sm text-gray-500">
                                <span>{item.uptime_percent}% Uptime</span>
                                <span>{item.avg_latency_ms}ms</span>
                            </div>

                            <div className="flex justify-between items-center pt-4 border-t dark:border-gray-700">
                                <div>
                                    <span className="text-xl font-bold text-green-600">₵{item.price_per_gb}</span>
                                    <span className="text-xs text-gray-500">/GB</span>
                                </div>
                                <button
                                    onClick={() => handleBuy(item.id, item.price_per_gb)}
                                    className="bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 text-sm font-medium"
                                >
                                    Buy Now
                                </button>
                            </div>
                        </div>
                    ))}

                    {/* Pagination */}
                    <div className="flex justify-center gap-2 mt-6">
                        <button
                            disabled={page === 1}
                            onClick={() => setPage(page - 1)}
                            className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded disabled:opacity-50"
                        >Prev</button>
                        <span className="self-center">Page {page}</span>
                        <button
                            onClick={() => setPage(page + 1)}
                            className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded hover:bg-gray-300"
                        >Next</button>
                    </div>
                </div>
            )}
        </div>
    );
}
