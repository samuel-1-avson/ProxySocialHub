import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { getListings, type Listing } from "../lib/social-api";
import {
    Star,
    Plus,
    Signal,
    Activity,
    Database,
    Loader2
} from "lucide-react";

export function Marketplace() {
    const { user } = useAuth();
    const [listings, setListings] = useState<Listing[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({
        proxy_type: "",
        sort_by: "newest",
        country: "",
        min_price: "",
        max_price: ""
    });
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    const fetchListings = useCallback(async () => {
        setLoading(true);
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
            console.error(err);
            setListings([]);
        } finally {
            setLoading(false);
        }
    }, [filters, page]);

    useEffect(() => {
        fetchListings();
    }, [fetchListings]);

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-border pb-6">
                <div>
                    <h1 className="text-4xl font-mono font-black uppercase tracking-tight">Node_Market</h1>
                    <p className="text-muted-foreground font-mono text-sm uppercase tracking-widest mt-2">Provision decentralized bandwidth capacity</p>
                </div>

                <div className="flex gap-4 items-center font-mono">
                    {(user as any)?.role === 'provider' && (
                        <Link to="/node/create" className="btn-retro btn-retro-primary px-6 py-3 text-xs flex items-center gap-2">
                            <Plus size={14} /> DEPLOY_NODE
                        </Link>
                    )}

                    <div className="flex gap-4 border-l border-border pl-4">
                        <div className="text-right">
                            <div className="text-2xl font-bold leading-none">{total}</div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">Active_Nodes</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="card-retro p-6 bg-card">
                <div className="flex flex-col md:flex-row gap-6 items-center justify-between">
                    <div className="flex gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
                        {['', 'residential', 'mobile', 'datacenter'].map((type) => (
                            <button
                                key={type}
                                onClick={() => {
                                    setFilters({ ...filters, proxy_type: type });
                                    setPage(1);
                                }}
                                className={`px-4 py-2 text-[10px] font-bold font-mono uppercase transition-all border-2 ${filters.proxy_type === type
                                    ? 'bg-primary text-primary-foreground border-foreground shadow-[2px_2px_0px_var(--foreground)]'
                                    : 'bg-background border-border text-muted-foreground hover:border-foreground'
                                    }`}
                            >
                                {type === '' ? 'ALL_NETWORKS' : type.toUpperCase()}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <span className="text-[10px] font-mono font-bold uppercase text-muted-foreground whitespace-nowrap">Sort_Order:</span>
                        <select
                            className="bg-background border-2 border-border text-xs font-mono font-bold uppercase p-2 outline-none focus:border-primary rounded-sm"
                            value={filters.sort_by}
                            onChange={(e) => {
                                setFilters({ ...filters, sort_by: e.target.value });
                                setPage(1);
                            }}
                        >
                            <option value="newest">NEWEST_FIRST</option>
                            <option value="price_asc">PRICE_ASCENDING</option>
                            <option value="price_desc">PRICE_DESCENDING</option>
                            <option value="popular">HIGHEST_RATING</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Listings Grid */}
            {loading ? (
                <div className="py-20 flex flex-col items-center justify-center space-y-4 font-mono">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-xs font-bold uppercase tracking-widest">Scanning_Frequencies...</p>
                </div>
            ) : listings.length === 0 ? (
                <div className="py-20 text-center border-2 border-dashed border-border rounded-lg bg-secondary/10">
                    <Database size={48} className="mx-auto text-muted-foreground mb-4 opacity-20" />
                    <p className="font-mono text-lg font-bold uppercase">No_Nodes_Acquired</p>
                    <p className="font-mono text-xs text-muted-foreground mt-2 uppercase tracking-widest">Adjust filters or deploy new resources.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20">
                    {listings.map((listing) => (
                        <div key={listing.id} className="card-retro p-0 bg-card overflow-hidden flex flex-col h-full border-2 border-border">
                            {/* Card Header */}
                            <div className="p-5 border-b border-border space-y-4 flex-1">
                                <div className="flex justify-between items-start">
                                    <span className="px-2 py-0.5 bg-secondary border border-border text-[9px] font-mono font-bold uppercase rounded-sm">
                                        {listing.proxy_type}
                                    </span>
                                    <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-yellow-500">
                                        <Star size={10} className="fill-current" />
                                        {listing.seller?.avg_rating?.toFixed(1) || "5.0"}
                                    </div>
                                </div>
                                <h3 className="font-bold font-mono text-sm leading-tight uppercase line-clamp-2 min-h-[2.5rem]">{listing.title}</h3>

                                <div className="flex items-center gap-3 pt-2">
                                    <div className="w-8 h-8 rounded-sm bg-secondary border border-border flex items-center justify-center overflow-hidden grayscale">
                                        {listing.seller?.avatar_url ? (
                                            <img src={listing.seller.avatar_url} className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="font-mono font-black text-xs">{(listing.seller?.username?.[0] || "?").toUpperCase()}</span>
                                        )}
                                    </div>
                                    <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase truncate">OP: {listing.seller?.username || "ANONYMOUS"}</span>
                                </div>
                            </div>

                            {/* Card Stats */}
                            <div className="grid grid-cols-2 border-b border-border bg-secondary/5 font-mono">
                                <div className="p-3 border-r border-border text-center">
                                    <div className="text-[9px] text-muted-foreground uppercase font-black mb-1">Latency</div>
                                    <div className="font-bold text-xs flex items-center justify-center gap-1">
                                        <Signal size={12} className="text-green-500" />
                                        &lt;50ms
                                    </div>
                                </div>
                                <div className="p-3 text-center">
                                    <div className="text-[9px] text-muted-foreground uppercase font-black mb-1">Status</div>
                                    <div className="font-bold text-xs flex items-center justify-center gap-1 text-primary">
                                        <Activity size={12} />
                                        ACTIVE
                                    </div>
                                </div>
                            </div>

                            {/* Card Footer */}
                            <div className="p-5 flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-mono font-black uppercase text-muted-foreground">Standard_Rate</span>
                                    <span className="text-xl font-bold font-mono">₵{listing.price_per_gb}<span className="text-xs text-muted-foreground">/GB</span></span>
                                </div>
                                <button className="btn-retro btn-retro-primary py-2 px-6 text-xs font-bold uppercase tracking-wider">
                                    CONNECT
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
