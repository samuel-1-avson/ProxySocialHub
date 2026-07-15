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
import { fetchListingSocialContext, type ListingSocialContext } from '@/lib/api/listing-social';

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
    const activeSessions = socialContext?.active_sessions_count || 0;
    const totalSessions = socialContext?.total_sessions_count || listing.orders_count || 0;
    const isOnline = socialContext?.provider?.is_online || false;
    const allowMessage = socialContext?.allow_direct_message !== false;

    return (
        <>
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -4, scale: 1.01 }}
                className={`group relative overflow-hidden rounded-[2rem] border transition-all duration-500 ${isHighQuality
                        ? 'bg-primary/[0.03] border-primary/30 shadow-[0_0_40px_rgba(16,185,129,0.1)]'
                        : 'bg-white/[0.02] border-white/5 hover:border-white/20'
                    }`}
            >
                {/* Background Texture */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none z-0"
                    style={{ backgroundImage: 'linear-gradient(90deg, white 1px, transparent 0), linear-gradient(0deg, white 1px, transparent 0)', backgroundSize: '20px 20px' }} />

                {/* Tactical Header */}
                <div className="relative z-10 p-6 pb-4 flex justify-between items-start gap-4">
                    <div className="flex gap-4">
                        <div className="relative w-12 h-12 rounded-2xl bg-black/40 border border-white/5 flex items-center justify-center overflow-hidden group-hover:border-primary/40 transition-colors">
                            {provider?.avatar_url ? (
                                <img src={provider.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-[10px] font-black text-primary/40">
                                    {(provider?.display_name?.[0] || provider?.username?.[0] || "?").toUpperCase()}
                                </div>
                            )}
                            {/* Online Indicator */}
                            <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-black ${isOnline ? 'bg-emerald-500' : 'bg-white/30'}`}>
                                {isOnline && <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-black text-white text-[11px] uppercase tracking-wider group-hover:text-primary transition-colors">
                                    {displayListingTitle(listing)}
                                </h3>
                                <CatalogProductBadge product={listing.catalog_product} />
                                {listing.is_priority && <span className="text-primary text-xs">★</span>}
                            </div>
                            {listingShowsCatalogSubtitle(listing) && (
                                <p className="text-[9px] text-white/30 font-mono truncate max-w-[200px]">
                                    {listing.title}
                                </p>
                            )}
                            <div className="flex items-center gap-3 flex-wrap">
                                <div className="flex items-center gap-1 text-[9px] font-black text-white/20 uppercase tracking-widest">
                                    <Star size={10} className="text-yellow-500 fill-yellow-500/20" />
                                    {Number(provider?.avg_rating || 5.0).toFixed(1)}
                                    <span className="text-white/10">({provider?.reviews_count || 0})</span>
                                </div>
                                <div className={`px-2 py-0.5 rounded-sm text-[8px] font-black uppercase tracking-widest border ${listing.proxy_type === 'residential' ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-white/5 border-white/10 text-white/40'
                                    }`}>
                                    {listing.proxy_type}
                                </div>
                                {/* Active Sessions Badge */}
                                {activeSessions > 0 && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-sm text-[8px] font-black uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                                        <Users size={8} />
                                        {activeSessions} active
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

                    <div className="flex flex-col items-end gap-1.5 px-3 py-1.5 rounded-xl bg-black/20 border border-white/5 backdrop-blur-md">
                        <div className="flex items-center gap-2">
                            <span className={`relative flex h-1.5 w-1.5`}>
                                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isOnline ? 'bg-emerald-500' : 'bg-white/30'}`} />
                            </span>
                            <span className={`text-[9px] font-black uppercase tracking-widest ${isOnline ? 'text-emerald-500' : 'text-white/30'}`}>
                                {isOnline ? 'Online' : 'Offline'}
                            </span>
                        </div>
                        <div className="text-[8px] font-black text-white/10 tracking-[0.2em]">{listing.id?.split('-')[0]}</div>
                    </div>
                </div>

                {/* Technical Detail Grid */}
                <div className="relative z-10 px-6 py-4 grid grid-cols-2 gap-4 border-t border-b border-white/5 bg-white/[0.01]">
                    <div className="space-y-1.5">
                        <div className="text-[8px] font-black text-white/10 uppercase tracking-[0.3em] flex items-center gap-2">
                            <Signal size={10} className="text-primary/40" /> Latency
                        </div>
                        <div className="text-sm font-black text-white flex items-baseline gap-1">
                            {listing.avg_latency_ms || '40'}<span className="text-[10px] text-white/20">ms</span>
                        </div>
                        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, 100 - (listing.avg_latency_ms || 40) / 2)}%` }}
                                className="h-full bg-primary/40"
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <div className="text-[8px] font-black text-white/10 uppercase tracking-[0.3em] flex items-center gap-2">
                            <Activity size={10} className="text-primary/40" /> Uptime SLA
                        </div>
                        <div className="text-sm font-black text-white flex items-baseline gap-1">
                            {Number(listing.uptime_percent || 0).toFixed(1)}<span className="text-[10px] text-white/20">%</span>
                        </div>
                        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, listing.uptime_percent || 0)}%` }}
                                className="h-full bg-primary/40"
                            />
                        </div>
                    </div>
                </div>

                {/* Protocol Meta Strip */}
                <div className="relative z-10 px-6 py-3 flex items-center justify-between bg-white/[0.02] border-b border-white/5">
                    <div className="flex items-center gap-5 text-[9px] font-black uppercase tracking-widest text-white/30">
                        <div className="flex items-center gap-2">
                            <Globe size={10} className="text-primary/40" />
                            {listing.country || 'Global'}
                        </div>
                        <div className="flex items-center gap-2">
                            <Wifi size={10} className="text-primary/40" />
                            {totalSessions} sessions
                        </div>
                    </div>
                    <div className="text-[9px] font-black text-white/20">
                        {provider?.response_time_min || '~15'}m response
                    </div>
                </div>

                {/* Pricing Hub & Actions */}
                <div className="relative z-10 p-6 flex items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="text-[8px] font-black text-white/20 uppercase tracking-[0.4em]">Settlement Rate</div>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-2xl font-black text-white tracking-tighter">{Number(listing.price_per_gb || 0).toFixed(6)} SOL</span>
                            <span className="text-[10px] font-black text-white/20 uppercase">/ GB</span>
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
                                className="px-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-white/70 font-black text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all hover:bg-white/10 hover:border-white/20"
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
                            className="flex-1 group/btn relative py-4 px-6 rounded-2xl bg-primary text-primary-foreground font-black text-[10px] uppercase tracking-[0.4em] flex items-center justify-center gap-3 transition-all hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] active:scale-[0.95]"
                        >
                            <div className="absolute inset-0 bg-white/10 translate-x-[-200%] group-hover/btn:translate-x-[200%] transition-transform duration-700" />
                            <Zap size={14} className="group-hover/btn:animate-pulse" />
                            Inject
                            <ArrowRight size={12} className="opacity-40 group-hover/btn:opacity-100 group-hover/btn:translate-x-1 transition-all" />
                        </button>
                    </div>
                </div>

                {/* Decorative Protocol Accents */}
                <div className="absolute bottom-2 right-6 flex gap-1 items-end pointer-events-none opacity-20">
                    <div className="w-1 h-3 bg-white/10 rounded-full" />
                    <div className="w-1 h-6 bg-primary/40 rounded-full" />
                    <div className="w-1 h-4 bg-white/10 rounded-full" />
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
                location={listing.country}
            />
        </>
    );
}

export default ListingCardEnhanced;
