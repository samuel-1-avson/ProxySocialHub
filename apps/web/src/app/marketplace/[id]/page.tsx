"use client";

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
    getListing,
    saveListing,
    unsaveListing,
    marketplaceKeys,
    Listing,
} from '@/lib/api/marketplace';
import { BuyListingModal } from '@/components/BuyListingModal';
import { ListingSocialPanel } from '@/components/marketplace/ListingSocialPanel';
import { ListingQASection } from '@/components/marketplace/ListingQASection';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/stores';
import { getErrorMessage } from '@/lib/utils';
import { Loader2, Star, Shield, Signal, Activity, Globe, ShoppingCart, Share2, Heart, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { trackListingViewOnce } from '@/lib/analytics/marketplace-funnel';
import { CatalogProductBadge } from '@/components/marketplace/CatalogProductBadge';
import {
    displayListingTitle,
    listingShowsCatalogSubtitle,
} from '@/lib/listing-display';
import { listingProtocolLabel } from '@/lib/listing-protocols';

function isPurchasable(listing: Listing) {
    return listing.status === 'active' && listing.available_bandwidth_gb > 0;
}

function formatListingStatus(status: string) {
    return status.replace(/_/g, ' ');
}

function ListingDetailContent() {
    const params = useParams();
    const router = useRouter();
    const { user } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const id = params.id as string;

    const [listing, setListing] = useState<Listing | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [isSaved, setIsSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [buyOpen, setBuyOpen] = useState(false);

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                const data = await getListing(id);
                setListing(data.listing);
                setIsSaved(data.is_saved);
                trackListingViewOnce(data.listing.id, 'detail', Boolean(user));
            } catch (err: unknown) {
                setError(getErrorMessage(err) || 'Failed to load listing details');
            } finally {
                setLoading(false);
            }
        };

        if (id) fetchDetails();
    }, [id, user]);

    const handleBuyClick = () => {
        if (!listing) return;
        if (!user) {
            toast.warning('Sign in required', 'Please sign in before buying marketplace bandwidth.');
            router.push(`/login?redirect=/marketplace/${listing.id}`);
            return;
        }
        if (!isPurchasable(listing)) {
            toast.warning('Listing unavailable', `This listing is currently ${formatListingStatus(listing.status)}.`);
            return;
        }
        setBuyOpen(true);
    };

    const handleToggleSave = async () => {
        if (!listing || saving) return;
        if (!user) {
            toast.warning('Sign in required', 'Please sign in before saving marketplace listings.');
            router.push(`/login?redirect=/marketplace/${listing.id}`);
            return;
        }
        if (!isSaved && listing.status !== 'active') {
            toast.warning('Listing unavailable', `Only active listings can be saved. Current status: ${formatListingStatus(listing.status)}.`);
            return;
        }

        setSaving(true);
        try {
            if (isSaved) {
                await unsaveListing(listing.id);
                setIsSaved(false);
                setListing(current => current ? { ...current, saves_count: Math.max((current.saves_count || 0) - 1, 0) } : current);
                toast.success('Listing removed', 'This listing was removed from your saved list.');
            } else {
                await saveListing(listing.id);
                setIsSaved(true);
                setListing(current => current ? { ...current, saves_count: (current.saves_count || 0) + 1 } : current);
                toast.success('Listing saved', 'This listing was added to your saved list.');
            }
            void queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
        } catch (err: unknown) {
            toast.error('Save failed', getErrorMessage(err) || 'Please try again.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="ui-loading" role="status"><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Loading this listing…</div>;
    }

    if (error || !listing) {
        return (
            <div className="ui-error" role="alert">
                <h2>Listing unavailable</h2>
                <p>{error || "This listing could not be found."}</p>
                <Link className="ui-button secondary" href="/marketplace">Back to marketplace</Link>
            </div>
        );
    }

    const metricsMeasured = listing.sla_source === 'gateway' || listing.sla_source === 'explorer' || listing.sla_source === 'provider';

    return (
        <div className="space-y-6">
            {buyOpen && (
                <BuyListingModal
                    listing={listing}
                    surface="detail"
                    onClose={() => setBuyOpen(false)}
                    onSuccess={() => {
                        void queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
                    }}
                />
            )}

            <Link href="/marketplace" className="ui-link">
                <ArrowLeft size={14} aria-hidden="true" /> Back to marketplace
            </Link>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <div className="ui-surface">
                        <div className="absolute top-0 right-0 p-4 opacity-50">
                            <Signal size={120} className="text-secondary opacity-10" />
                        </div>

                        <div className="relative z-10">
                            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                                <div>
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="ui-status neutral">
                                            {listing.proxy_type}
                                        </span>
                                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                            <Star size={12} aria-hidden="true" />
                                            {typeof listing.seller?.avg_rating === "number" ? listing.seller.avg_rating.toFixed(1) : "Rating not reported"}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 mb-2">
                                        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                                            {displayListingTitle(listing)}
                                        </h1>
                                        <CatalogProductBadge product={listing.catalog_product} className="self-end mb-1" />
                                    </div>
                                    {listingShowsCatalogSubtitle(listing) && (
                                        <p className="text-xs font-mono text-muted-foreground mb-2">
                                            Listing: {listing.title}
                                        </p>
                                    )}
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
                                        <span>Node ID: {listing.id.slice(0, 8)}</span>
                                        <span>•</span>
                                        <span className="flex items-center gap-1">
                                            <Globe size={12} /> {listing.seller?.location || "Global"}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleToggleSave}
                                        disabled={saving || (!isSaved && listing.status !== 'active')}
                                        aria-label={isSaved ? 'Remove from saved' : 'Save listing'}
                                        aria-pressed={isSaved}
                                        className={`btn-retro p-3 disabled:opacity-50 disabled:cursor-not-allowed ${isSaved ? 'bg-primary/20 text-primary border-primary' : 'bg-background border-border hover:border-primary'}`}
                                    >
                                        {saving ? <Loader2 size={20} className="animate-spin" /> : <Heart size={20} className={isSaved ? 'fill-current' : ''} />}
                                    </button>
                                    <button
                                        aria-label="Share listing"
                                        className="btn-retro p-3 bg-background border-border hover:border-primary"
                                    >
                                        <Share2 size={20} />
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                                <div className="p-4 bg-secondary/10 border border-border rounded-sm">
                                    <div className="ui-stat-label">Latency</div>
                                    <div className="font-mono font-bold text-lg flex items-center gap-1">
                                        <Signal size={16} className="text-success" />
                                        {metricsMeasured ? `${listing.avg_latency_ms}ms` : 'Unmeasured'}
                                    </div>
                                </div>
                                <div className="p-4 bg-secondary/10 border border-border rounded-sm">
                                    <div className="ui-stat-label flex items-center justify-between gap-2">
                                        <span>Uptime</span>
                                        {listing.sla_source === 'gateway' && (
                                            <span className="ui-note">live</span>
                                        )}
                                    </div>
                                    <div className="font-mono font-bold text-lg flex items-center gap-1">
                                        <Activity size={16} className="text-info" />
                                        {metricsMeasured ? `${listing.uptime_percent}%` : 'Unmeasured'}
                                    </div>
                                    {listing.sla_source && (
                                        <div className="ui-note">
                                            Source: {listing.sla_source}
                                        </div>
                                    )}
                                </div>
                                <div className="p-4 bg-secondary/10 border border-border rounded-sm">
                                    <div className="ui-stat-label">Success rate</div>
                                    <div className="font-mono font-bold text-lg flex items-center gap-1">
                                        <Shield size={16} className="text-primary" />
                                        {metricsMeasured ? `${listing.success_rate}%` : 'Unmeasured'}
                                    </div>
                                </div>
                                <div className="p-4 bg-secondary/10 border border-border rounded-sm">
                                    <div className="ui-stat-label">In use</div>
                                    <div className="font-mono font-bold text-lg">
                                        {listing.active_sessions_count || 0}
                                        {listing.max_concurrency ? `/${listing.max_concurrency}` : ''}
                                    </div>
                                    <div className="ui-note">Other buyers can still connect.</div>
                                </div>
                            </div>

                            <div>
                                <h2>Description</h2>
                                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                    {listing.description}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="ui-surface">
                        <div className="flex justify-between items-baseline mb-6">
                            <span className="ui-stat-label">Price</span>
                            <div className="text-right">
                                <span className="text-4xl font-bold font-mono">{Number(listing.price_per_gb || 0).toFixed(4)}</span>
                                <span className="text-sm text-muted-foreground font-mono"> USD/GB</span>
                            </div>
                        </div>

                        <div className="space-y-4 mb-6">
                            <div className="flex justify-between text-xs font-mono">
                                <span className="text-muted-foreground">Min Purchase</span>
                                <span className="font-bold">{listing.min_purchase_gb || 1} GB</span>
                            </div>
                            <div className="flex justify-between text-xs font-mono">
                                <span className="text-muted-foreground">Available</span>
                                <span className="font-bold">{listing.available_bandwidth_gb.toLocaleString()} GB</span>
                            </div>
                            <div className="flex justify-between text-xs font-mono">
                                <span className="text-muted-foreground">Buyers connected</span>
                                <span className="font-bold">
                                    {listing.active_sessions_count || 0}
                                    {listing.max_concurrency ? ` / ${listing.max_concurrency}` : ''}
                                </span>
                            </div>
                            <div className="flex justify-between text-xs font-mono">
                                <span className="text-muted-foreground">Protocol</span>
                                <span className="font-bold">{listingProtocolLabel(listing.protocol)}</span>
                            </div>
                        </div>

                        <button
                            onClick={handleBuyClick}
                            disabled={!isPurchasable(listing)}
                            className="ui-button block"
                        >
                            <ShoppingCart className="group-hover:translate-x-1 transition-transform" size={18} />
                            {isPurchasable(listing) ? "Buy Bandwidth" : `Unavailable: ${formatListingStatus(listing.status)}`}
                        </button>

                        <p className="ui-note">
                            Provided by <Link 
                                href={listing.seller?.username ? `/profile/${listing.seller.username}` : '#'} 
                                className="font-bold text-foreground hover:text-primary hover:underline transition-colors"
                            >
                                {listing.seller?.display_name || "Anonymous"}
                            </Link>
                        </p>
                    </div>

                    <ListingSocialPanel
                        listingId={listing.id}
                        listingTitle={displayListingTitle(listing)}
                        pricePerGb={listing.price_per_gb}
                        location={listing.seller?.location}
                    />

                    <ListingQASection listingId={listing.id} />
                </div>
            </div>
        </div>
    );
}

export default function ListingDetailPage() {
    return (
        <div className="container mx-auto px-4 py-8">
            <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div>}>
                <ListingDetailContent />
            </Suspense>
        </div>
    );
}
