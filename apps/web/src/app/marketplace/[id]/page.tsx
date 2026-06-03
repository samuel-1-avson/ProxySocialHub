"use client";

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
    getListing,
    createOrder,
    saveListing,
    unsaveListing,
    marketplaceKeys,
    Listing,
} from '@/lib/api/marketplace';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/stores';
import { getErrorMessage } from '@/lib/utils';
import { Loader2, Star, Shield, Signal, Activity, Globe, ShoppingCart, Share2, Heart, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

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
    const [purchasing, setPurchasing] = useState(false);

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                const data = await getListing(id);
                setListing(data.listing);
                setIsSaved(data.is_saved);
            } catch (err: unknown) {
                setError(getErrorMessage(err) || 'Failed to load listing details');
            } finally {
                setLoading(false);
            }
        };

        if (id) fetchDetails();
    }, [id]);

    const handlePurchase = async () => {
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
        setPurchasing(true);
        try {
            // Default to minimum purchase or 1GB for now
            const gbToBuy = listing.min_purchase_gb || 1;
            await createOrder({ listing_id: listing.id, bandwidth_gb: gbToBuy, session_type: 'rotating' });
            void queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
            toast.success('Purchase successful', `${gbToBuy} GB added to your account.`);
            router.push('/dashboard/proxy');
        } catch (err: unknown) {
            toast.error('Purchase failed', getErrorMessage(err) || 'Please try again.');
        } finally {
            setPurchasing(false);
        }
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
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
                <p className="mt-4 font-mono text-sm text-muted-foreground uppercase">Loading Node Details...</p>
            </div>
        );
    }

    if (error || !listing) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
                <div className="p-4 rounded-full bg-destructive/10 border border-destructive/20 mb-4">
                    <Activity className="w-12 h-12 text-destructive" />
                </div>
                <h2 className="text-2xl font-mono font-bold uppercase mb-2">Node Unavailable</h2>
                <p className="font-mono text-muted-foreground mb-6">{error || "This listing could not be found."}</p>
                <Link href="/marketplace" className="btn-retro btn-retro-outline px-6 py-2">
                    RETURN TO MARKET
                </Link>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Nav Back */}
            <Link href="/marketplace" className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase text-muted-foreground hover:text-primary transition-colors">
                <ArrowLeft size={14} /> Back to Market
            </Link>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Col: Main Info */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="card-retro p-8 bg-card relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-50">
                            <Signal size={120} className="text-secondary opacity-10" />
                        </div>

                        <div className="relative z-10">
                            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                                <div>
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="px-2 py-0.5 rounded-sm bg-primary/10 border border-primary/20 text-primary text-[10px] uppercase font-bold tracking-wider">
                                            {listing.proxy_type}
                                        </span>
                                        <div className="flex items-center gap-1 text-xs font-mono font-bold text-yellow-500">
                                            <Star size={12} className="fill-current" />
                                            {listing.seller?.avg_rating?.toFixed(1) || "5.0"}
                                        </div>
                                    </div>
                                    <h1 className="text-3xl md:text-4xl font-bold font-mono uppercase tracking-tight leading-none mb-2">
                                        {listing.title}
                                    </h1>
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
                                    <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Latency</div>
                                    <div className="font-mono font-bold text-lg flex items-center gap-1">
                                        <Signal size={16} className="text-green-500" />
                                        {listing.avg_latency_ms}ms
                                    </div>
                                </div>
                                <div className="p-4 bg-secondary/10 border border-border rounded-sm">
                                    <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1 flex items-center justify-between gap-2">
                                        <span>Uptime</span>
                                        {listing.sla_source === 'gateway' && (
                                            <span className="text-emerald-500 text-[9px]">live</span>
                                        )}
                                    </div>
                                    <div className="font-mono font-bold text-lg flex items-center gap-1">
                                        <Activity size={16} className="text-blue-500" />
                                        {listing.uptime_percent}%
                                    </div>
                                    {listing.sla_source && (
                                        <div className="text-[9px] font-mono text-muted-foreground mt-1 uppercase">
                                            Source: {listing.sla_source}
                                        </div>
                                    )}
                                </div>
                                <div className="p-4 bg-secondary/10 border border-border rounded-sm">
                                    <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Success Rate</div>
                                    <div className="font-mono font-bold text-lg flex items-center gap-1">
                                        <Shield size={16} className="text-purple-500" />
                                        {listing.success_rate}%
                                    </div>
                                </div>
                                <div className="p-4 bg-secondary/10 border border-border rounded-sm">
                                    <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Speed</div>
                                    <div className="font-mono font-bold text-lg">
                                        High
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-bold font-mono uppercase mb-3">Description</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                    {listing.description}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Col: Purchase */}
                <div className="space-y-6">
                    <div className="card-retro p-6 bg-card sticky top-24 border-l-4 border-l-primary">
                        <div className="flex justify-between items-baseline mb-6">
                            <span className="text-sm font-mono uppercase text-muted-foreground">Price</span>
                            <div className="text-right">
                                <span className="text-4xl font-bold font-mono">{listing.price_per_gb} SOL</span>
                                <span className="text-sm text-muted-foreground font-mono">/GB</span>
                            </div>
                        </div>

                        <div className="space-y-4 mb-6">
                            <div className="flex justify-between text-xs font-mono">
                                <span className="text-muted-foreground uppercase">Min Purchase</span>
                                <span className="font-bold">{listing.min_purchase_gb || 1} GB</span>
                            </div>
                            <div className="flex justify-between text-xs font-mono">
                                <span className="text-muted-foreground uppercase">Available</span>
                                <span className="font-bold">{listing.available_bandwidth_gb.toLocaleString()} GB</span>
                            </div>
                            <div className="flex justify-between text-xs font-mono">
                                <span className="text-muted-foreground uppercase">Protocol</span>
                                <span className="font-bold uppercase">{listing.protocol}</span>
                            </div>
                        </div>

                        <button
                            onClick={handlePurchase}
                            disabled={purchasing || !isPurchasable(listing)}
                            className="w-full btn-retro btn-retro-primary py-4 text-sm uppercase tracking-wider flex items-center justify-center gap-2 group mb-4"
                        >
                            {purchasing && <Loader2 className="animate-spin" size={16} />}
                            {!purchasing && <ShoppingCart className="group-hover:translate-x-1 transition-transform" size={18} />}
                            {purchasing ? "Processing..." : isPurchasable(listing) ? "Buy Bandwidth" : `Unavailable: ${formatListingStatus(listing.status)}`}
                        </button>

                        <p className="text-[10px] text-center text-muted-foreground font-mono">
                            Provided by <Link 
                                href={listing.seller?.username ? `/profile/${listing.seller.username}` : '#'} 
                                className="font-bold text-foreground hover:text-primary hover:underline transition-colors"
                            >
                                {listing.seller?.display_name || "Anonymous"}
                            </Link>
                        </p>
                    </div>
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
