'use client';

import React, { useState, useEffect } from 'react';
import {
    Star,
    Signal,
    Activity,
    Globe,
    ArrowRight,
    Zap,
    MessageSquare,
    Users,
    Wifi,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Listing } from '@/lib/api/marketplace';
import { CatalogProductBadge } from '@/components/marketplace/CatalogProductBadge';
import {
    displayListingTitle,
    listingShowsCatalogSubtitle,
} from '@/lib/listing-display';
import { ListingSlaBadge } from '@/components/marketplace/ListingSlaBadge';
import { QuickMessageModal } from './QuickMessageModal';
import { FollowProviderButton } from '@/components/social/FollowProviderButton';
import { useAuth } from '@/lib/auth';
import { formatListingPricePerGB } from '@/lib/listing-price';
import { fetchListingSocialContext, type ListingSocialContext } from '@/lib/api/listing-social';
import { LOCATION_SHARED_LATER, isMaskedLocation, visibleCountry } from '@/lib/listing-display';

interface ListingCardEnhancedProps {
    listing: Listing;
    onSelect: (listing: Listing) => void;
}

export function ListingCardEnhanced({ listing, onSelect }: ListingCardEnhancedProps) {
    const { isAuthenticated } = useAuth();
    const [socialContext, setSocialContext] = useState<ListingSocialContext | null>(null);
    const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const isHighQuality = (listing.quality_score || 0) > 90;

    // Fetch social context when component mounts
    useEffect(() => {
        fetchListingSocialContext(listing.id)
            .then(setSocialContext)
            .catch((error) => console.error('Failed to fetch social context:', error));
    }, [listing.id]);

    const provider = socialContext?.provider || listing.seller;
    const providerId = socialContext?.provider?.id || listing.seller_id;
    const isFollowed = socialContext?.is_followed ?? false;
    const activeSessions = socialContext?.active_sessions_count || listing.active_sessions_count || 0;
    const totalSessions = socialContext?.total_sessions_count || listing.orders_count || 0;
    const isOnline = socialContext?.provider?.is_online || listing.seller?.is_online || false;
    const allowMessage = socialContext?.allow_direct_message !== false;

    return (
        <>
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
                        <div className="relative w-12 h-12 rounded-lg bg-secondary border border-border flex items-center justify-center overflow-hidden group-hover:border-primary/40 transition-colors">
                            {provider?.avatar_url ? (
                                <img src={provider.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-xs font-semibold text-primary/40">
                                    {(provider?.display_name?.[0] || provider?.username?.[0] || "?").toUpperCase()}
                                </div>
                            )}
                            {/* Online Indicator */}
                            <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-black ${isOnline ? 'bg-success' : 'bg-secondary-light'}`}>
                                {isOnline && <span className="absolute inset-0 rounded-full bg-success animate-ping opacity-75" />}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold text-foreground text-xs group-hover:text-primary transition-colors">
                                    {displayListingTitle(listing)}
                                </h3>
                                <CatalogProductBadge product={listing.catalog_product} />
                                {listing.is_priority && <span className="text-primary text-xs">★</span>}
                            </div>
                            {listingShowsCatalogSubtitle(listing) && (
                                <p className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                                    {listing.title}
                                </p>
                            )}
                            <div className="flex items-center gap-3 flex-wrap">
                                <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                                    <Star size={10} className="text-warning fill-warning/20" />
                                    {Number(provider?.avg_rating || 5.0).toFixed(1)}
                                    <span className="text-muted-foreground">({provider?.reviews_count || 0})</span>
                                </div>
                                <div className={`px-2 py-0.5 rounded-sm text-xs font-semibold border ${listing.proxy_type === 'residential' ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-secondary border-border text-muted-foreground'
                                    }`}>
                                    {listing.proxy_type}
                                </div>
                                {/* Active Sessions Badge */}
                                {activeSessions > 0 && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-semibold bg-success/10 border border-success/20 text-success">
                                        <Users size={8} />
                                        {listing.max_concurrency
                                            ? `${activeSessions}/${listing.max_concurrency} in use`
                                            : `${activeSessions} in use`}
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
                            <span className={`relative flex h-1.5 w-1.5`}>
                                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isOnline ? 'bg-success' : 'bg-secondary-light'}`} />
                            </span>
                            <span className={`text-xs font-semibold ${isOnline ? 'text-success' : 'text-muted-foreground'}`}>
                                {isOnline ? 'Online' : 'Offline'}
                            </span>
                        </div>
                        <div className="text-xs font-semibold text-muted-foreground">{listing.id?.split('-')[0]}</div>
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
                            <Activity size={10} className="text-primary/40" /> Uptime SLA
                        </div>
                        <div className="text-sm font-semibold text-foreground flex items-baseline gap-1">
                            {Number(listing.uptime_percent || 0).toFixed(1)}<span className="text-xs text-muted-foreground">%</span>
                        </div>
                        <div className="h-1 w-full bg-secondary rounded-full overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, listing.uptime_percent || 0)}%` }}
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
                            {isMaskedLocation(listing.country) ? LOCATION_SHARED_LATER : listing.country || 'Global'}
                        </div>
                        <div className="flex items-center gap-2">
                            <Wifi size={10} className="text-primary/40" />
                            {totalSessions} sessions
                        </div>
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground">
                        {provider?.response_time_min || '~15'}m response
                    </div>
                </div>

                {/* Pricing Hub & Actions */}
                <div className="relative z-10 p-6 flex items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="text-xs font-semibold text-muted-foreground">Settlement Rate</div>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-2xl font-semibold text-foreground tracking-tight">{formatListingPricePerGB(listing.price_per_gb).replace(' / GB', '')}</span>
                            <span className="text-xs font-semibold text-muted-foreground">/ GB</span>
                        </div>
                    </div>

                    <div className="flex gap-2 flex-wrap">
                        {isAuthenticated && providerId && (
                            <FollowProviderButton
                                providerId={providerId}
                                providerName={provider?.display_name || provider?.username}
                                isFollowed={isFollowed}
                                compact
                                onFollowChange={(followed) =>
                                    setSocialContext((c) =>
                                        c ? { ...c, is_followed: followed } : c
                                    )
                                }
                            />
                        )}
                        {/* Message Button */}
                        {allowMessage && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsMessageModalOpen(true);
                                }}
                                className="px-4 py-4 rounded-lg bg-secondary border border-border text-foreground font-semibold text-xs flex items-center justify-center gap-2 transition-all hover:bg-secondary hover:border-border"
                                title="Ask provider about this proxy"
                            >
                                <MessageSquare size={14} />
                                Ask
                            </button>
                        )}

                        {/* Main Action Button */}
                        <button
                            type="button"
                            data-testid="buy-listing-inject"
                            onClick={() => onSelect(listing)}
                            className="flex-1 group/btn relative py-4 px-6 rounded-lg bg-primary text-primary-foreground font-semibold text-xs flex items-center justify-center gap-3 transition-all active:scale-[0.95]"
                        >
                            <div className="absolute inset-0 bg-secondary translate-x-[-200%] group-hover/btn:translate-x-[200%] transition-transform duration-700" />
                            <Zap size={14} className="group-hover/btn:animate-pulse" />
                            Inject
                            <ArrowRight size={12} className="opacity-40 group-hover/btn:opacity-100 group-hover/btn:translate-x-1 transition-all" />
                        </button>
                    </div>
                </div>

                {/* Decorative Protocol Accents */}
                <div className="absolute bottom-2 right-6 flex gap-1 items-end pointer-events-none opacity-20">
                    <div className="w-1 h-3 bg-secondary rounded-full" />
                    <div className="w-1 h-6 bg-primary/40 rounded-full" />
                    <div className="w-1 h-4 bg-secondary rounded-full" />
                </div>
            </motion.div>

            {/* Quick Message Modal */}
            <QuickMessageModal
                isOpen={isMessageModalOpen}
                onClose={() => setIsMessageModalOpen(false)}
                listingId={listing.id}
                listingTitle={displayListingTitle(listing)}
                providerId={provider?.id || listing.seller_id}
                providerName={provider?.display_name || provider?.username || 'Provider'}
                providerAvatar={provider?.avatar_url}
                providerOnline={isOnline}
                pricePerGb={listing.price_per_gb}
                location={visibleCountry(listing.country)}
            />
        </>
    );
}

export default ListingCardEnhanced;
