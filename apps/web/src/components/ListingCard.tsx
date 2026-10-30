'use client';

import React from 'react';
import {
    Star,
    Wifi,
    Signal,
    Activity,
    Globe,
    Shield,
    Server,
    ArrowRight,
    ChevronUp,
    TrendingDown,
    Zap,
    Hexagon,
    Target,
    ShieldCheck,
    Cpu,
    Command
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Listing } from '@/lib/api/marketplace';
import { CatalogProductBadge } from '@/components/marketplace/CatalogProductBadge';
import { ListingSlaBadge } from '@/components/marketplace/ListingSlaBadge';
import { formatListingPricePerGB } from '@/lib/listing-price';
import { displayListingTitle } from '@/lib/listing-display';

interface ListingCardProps {
    listing: Listing;
    onSelect: (listing: Listing) => void;
}

export function ListingCard({ listing, onSelect }: ListingCardProps) {
    const isHighQuality = (listing.quality_score || 0) > 90;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4, scale: 1.01 }}
            className={`group relative overflow-hidden rounded-lg border transition-all duration-500 ${isHighQuality
                    ? 'bg-primary/[0.03] border-primary/30 '
                    : 'bg-secondary border-border hover:border-border'
                }`}
        >
            {/* Background Texture */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none z-0"
                style={{ backgroundImage: 'linear-gradient(90deg, white 1px, transparent 0), linear-gradient(0deg, white 1px, transparent 0)', backgroundSize: '20px 20px' }} />

            {/* Tactical Header */}
            <div className="relative z-10 p-6 pb-4 flex justify-between items-start gap-4">
                <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-lg bg-secondary border border-border flex items-center justify-center relative group-hover:border-primary/40 transition-colors overflow-hidden">
                        {listing.seller?.avatar_url ? (
                            <img src={listing.seller.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <div className="text-xs font-semibold text-primary/40">{(listing.seller?.display_name?.[0] || "?").toUpperCase()}</div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-primary/40 scale-x-0 group-hover:scale-x-100 transition-transform" />
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-foreground text-xs group-hover:text-primary transition-colors">
                                {displayListingTitle(listing)}
                            </h3>
                            <CatalogProductBadge product={listing.catalog_product} />
                            {listing.is_priority && <Target size={10} className="text-primary animate-pulse" />}
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                                <Star size={10} className="text-warning fill-warning/20" />
                                {Number(listing.seller?.avg_rating || 5.0).toFixed(1)}
                            </div>
                            <div className={`px-2 py-0.5 rounded-sm text-xs font-semibold border ${listing.proxy_type === 'residential' ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-secondary border-border text-muted-foreground'
                                }`}>
                                {listing.proxy_type}
                            </div>
                            {(listing.active_sessions_count || 0) > 0 && (
                                <div className="px-2 py-0.5 rounded-sm text-xs font-semibold bg-success/10 border border-success/20 text-success">
                                    {listing.max_concurrency
                                        ? `${listing.active_sessions_count}/${listing.max_concurrency} in use`
                                        : `${listing.active_sessions_count} in use`}
                                </div>
                            )}
                            <ListingSlaBadge
                                uptimePercent={listing.uptime_percent}
                                slaSource={listing.sla_source}
                                listingOfferVerified={listing.listing_offer_verified}
                                listingOfferSigner={listing.listing_offer_signer}
                                listingOfferError={listing.listing_offer_verification_error}
                                compact
                            />
                        </div>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-border">
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success"></span>
                        </span>
                        <span className="text-xs font-semibold text-success">Active</span>
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground">{listing.id.split('-')[0]}</div>
                </div>

                {/* Tier Badge */}
                <div className={`absolute top-24 right-6 px-3 py-1 rounded-full text-xs font-semibold shadow-sm border z-20 ${
                    (listing.current_tier === 'Gold' || (!listing.current_tier && (listing.quality_score || 0) >= 90)) ? 'bg-warning/20 text-warning border-warning/30 ' :
                    (listing.current_tier === 'Silver' || (!listing.current_tier && (listing.quality_score || 0) >= 70)) ? 'bg-muted/20 text-muted-foreground border-border' :
                    'bg-warning/20 text-warning border-warning/30'
                }`}>
                    <div className="flex items-center gap-1.5">
                        <Hexagon size={10} className="fill-current/20" />
                        {listing.current_tier || ((listing.quality_score || 0) >= 90 ? 'Gold' : (listing.quality_score || 0) >= 70 ? 'Silver' : 'Bronze')}
                    </div>
                </div>
            </div>

            {/* Technical Detail Grid */}
            <div className="relative z-10 px-6 py-4 grid grid-cols-2 gap-4 border-t border-b border-border bg-secondary">
                <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                        <Signal size={10} className="text-primary/40" /> Latency
                    </div>
                    <div className="text-sm font-semibold text-foreground flex items-baseline gap-1">
                        {listing.avg_latency_ms || '40'}<span className="text-xs text-muted-foreground">ms</span>
                    </div>
                    <div className="h-1 w-full bg-secondary rounded-full overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, 100 - (listing.avg_latency_ms || 40) / 2)}%` }}
                            className="h-full bg-primary/40"
                        />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                        <Activity size={10} className="text-primary/40" /> Capacity
                    </div>
                    <div className="text-sm font-semibold text-foreground flex items-baseline gap-1">
                        {Number(listing.quality_score || 95).toFixed(0)}<span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <div className="h-1 w-full bg-secondary rounded-full overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${listing.quality_score || 95}%` }}
                            className="h-full bg-primary/40"
                        />
                    </div>
                </div>
            </div>

            {/* Protocol Meta Strip */}
            <div className="relative z-10 px-6 py-3 flex items-center justify-between bg-secondary border-b border-border">
                <div className="flex items-center gap-5 text-xs font-semibold text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <Globe size={10} className="text-primary/40" />
                        {listing.country || 'Global'}
                    </div>
                    <div className="flex items-center gap-2">
                        <ShieldCheck size={10} className="text-primary/40" />
                        Multi-Sig
                    </div>
                </div>
                <div className="p-1 px-2 rounded-lg bg-secondary border border-border group-hover:border-primary/20 transition-colors">
                    <Cpu size={12} className="text-muted-foreground" />
                </div>
            </div>

            {/* Pricing Hub & Action */}
            <div className="relative z-10 p-6 flex items-center justify-between gap-6">
                <div className="space-y-1">
                    <div className="text-xs font-semibold text-muted-foreground">Settlement Rate</div>
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-semibold text-foreground tracking-tight">{formatListingPricePerGB(listing.price_per_gb).replace(' / GB', '')}</span>
                        <span className="text-xs font-semibold text-muted-foreground">/ GB</span>
                    </div>
                </div>

                <button
                    onClick={() => onSelect(listing)}
                    className="flex-1 group/btn relative py-4 rounded-lg bg-primary text-primary-foreground font-semibold text-xs flex items-center justify-center gap-3 transition-all active:scale-[0.95]"
                >
                    <div className="absolute inset-0 bg-secondary translate-x-[-200%] group-hover/btn:translate-x-[200%] transition-transform duration-700" />
                    <Zap size={14} className="group-hover/btn:animate-pulse" />
                    Inject
                    <ArrowRight size={12} className="opacity-40 group-hover/btn:opacity-100 group-hover/btn:translate-x-1 transition-all" />
                </button>
            </div>

            {/* Decorative Protocol Accents */}
            <div className="absolute bottom-2 right-6 flex gap-1 items-end pointer-events-none opacity-20">
                <div className="w-1 h-3 bg-secondary rounded-full" />
                <div className="w-1 h-6 bg-primary/40 rounded-full" />
                <div className="w-1 h-4 bg-secondary rounded-full" />
            </div>
        </motion.div>
    );
}
