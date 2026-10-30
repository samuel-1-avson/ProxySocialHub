"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
    Server, Activity, Globe, Star, 
    ArrowLeft, ExternalLink, Calendar, MapPin, 
    CheckCircle2, AlertCircle, Zap, Network
} from 'lucide-react';
import Link from 'next/link';
import { getListings, type Listing } from '@/lib/api/marketplace';
import { getPublicProfile, type UserPublicProfile } from '@/lib/api/profile';
import { fetchListingSocialContext } from '@/lib/api/listing-social';
import { FollowFeedHint, FollowProviderButton } from '@/components/social/FollowProviderButton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Loader2 } from 'lucide-react';

export default function ProviderProfilePage() {
    const params = useParams();
    const id = params.id as string;
    const [profile, setProfile] = useState<UserPublicProfile | null>(null);
    const [listings, setListings] = useState<Listing[]>([]);
    const [providerFollowed, setProviderFollowed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const fetchProviderData = async () => {
            try {
                const [profileData, listingsData] = await Promise.all([
                    getPublicProfile(id),
                    getListings({ seller_id: id })
                ]);
                setProfile(profileData);
                const sellerListings = listingsData.listings || [];
                setListings(sellerListings);
                if (sellerListings[0]?.id) {
                    const social = await fetchListingSocialContext(sellerListings[0].id);
                    setProviderFollowed(Boolean(social?.is_followed));
                } else {
                    setProviderFollowed(false);
                }
            } catch (err) {
                console.error("Profile load error:", err);
                setError("Failed to load provider profile.");
            } finally {
                setLoading(false);
            }
        };

        if (id) fetchProviderData();
    }, [id]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
                <p className="mt-4 font-sans text-sm text-muted-foreground font-bold">Retrieving Profile...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <AlertCircle className="w-12 h-12 text-destructive mb-4" />
                <h2 className="text-xl font-bold mb-2">Error</h2>
                <p className="text-muted-foreground mb-6">{error}</p>
                <Link href="/marketplace" className="px-6 py-2 bg-primary rounded-lg font-bold">
                    Back to Marketplace
                </Link>
            </div>
        );
    }

    if (!profile) return null;

    // Use actual data from the profile
    const totalBandwidth = profile.total_bandwidth_sold > 0
        ? `${(profile.total_bandwidth_sold / 1024).toFixed(1)} TB`
        : "0 GB";
    const reportedRating = Number.isFinite(profile.avg_rating) ? profile.avg_rating.toFixed(1) : "Not reported";
    const providerSince = profile.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : "Join date not reported";
    const location = profile.location || "Location not reported";

    return (
        <div className="container mx-auto px-4 py-12 max-w-6xl">
            {/* Header / Nav */}
            <Link href="/marketplace" className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-primary transition-colors mb-8">
                <ArrowLeft size={14} /> Back to Marketplace
            </Link>

            {/* Profile Overview Card */}
            <div className="ui-surface">
                <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/4" />
                
                <div className="relative z-10 flex flex-col md:flex-row gap-8 items-start">
                    <div className="w-24 h-24 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                        {profile.avatar_url ? (
                            <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full rounded-lg object-cover" />
                        ) : (
                            <Server size={48} strokeWidth={1.5} />
                        )}
                    </div>
                    
                    <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                            <h1 className="text-3xl font-semibold tracking-tight">{profile.display_name || `Provider ${id.slice(0, 8)}`}</h1>
                            {profile.verified && (
                                <div className="ui-status good">
                                    <CheckCircle2 size={10} /> Verified
                                </div>
                            )}
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground font-medium mb-6">
                            <span className="flex items-center gap-1.5"><MapPin size={14} /> {location}</span>
                            <span className="flex items-center gap-1.5"><Calendar size={14} /> Joined {providerSince}</span>
                            <span className="flex items-center gap-1.5"><Activity size={14} /> {listings.length} Active Listings</span>
                        </div>

                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <ProfileStat label="Reported rating" value={reportedRating} detail="Average from reported reviews" />
                            <ProfileStat label="Bandwidth sold" value={totalBandwidth} detail="Reported lifetime traffic" />
                            <ProfileStat label="Uptime" value="Not reported" detail="This profile does not include a measured uptime" />
                            <ProfileStat label="Trust tier" value={profile.trust_tier || "Not reported"} detail="Reported account tier" />
                        </div>
                    </div>

                    <div className="w-full md:w-auto flex flex-col gap-3">
                        <FollowProviderButton
                            providerId={profile.id}
                            providerName={profile.display_name || profile.username}
                            isFollowed={providerFollowed}
                            onFollowChange={setProviderFollowed}
                            className="w-full justify-center"
                        />
                        <FollowFeedHint />
                        <p className="ui-note">A direct message destination is not configured on this profile.</p>
                    </div>
                </div>
            </div>

            {/* Active Infrastructure */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Network size={20} className="text-primary" />
                        Infrastructure Fleet
                    </h2>
                    <span className="text-sm font-medium text-muted-foreground">{listings.length} Listings Online</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {listings.map((listing) => (
                        <NodeMiniCard key={listing.id} listing={listing} />
                    ))}
                    {listings.length === 0 && (
                        <div className="ui-empty">
                            <h3>No public listings</h3>
                            <p>This profile did not return any public listings.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function ProfileStat({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <div>
            <div className="ui-stat-label">{label}</div>
            <div className="ui-stat-value">{value}</div>
            <div className="ui-stat-detail">{detail}</div>
        </div>
    );
}

function NodeMiniCard({ listing }: { listing: Listing }) {
    return (
        <motion.div 
            whileHover={{ y: -4 }}
            className="ui-surface flex flex-col h-full"
        >
            <div className="flex justify-between items-start mb-4">
                <div className="p-2.5 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                    <Zap size={20} />
                </div>
                <StatusBadge status={listing.status === 'active' ? 'online' : 'offline'} label={listing.status === 'active' ? 'Online' : 'Offline'} pulse={listing.status === 'active'} />
            </div>

            <h3 className="font-bold text-lg mb-1">{listing.title || "Edge Node"}</h3>
            <p className="text-xs text-muted-foreground mb-4 font-mono truncate">{listing.node_id || listing.id}</p>

            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="space-y-1">
                    <span className="ui-stat-label">Quality</span>
                    <div className="flex items-center gap-1.5">
                        <span className="text-sm">{listing.quality_score != null ? listing.quality_score.toFixed(0) : "Not reported"}</span>
                    </div>
                </div>
                <div className="space-y-1">
                    <span className="ui-stat-label">Latency</span>
                    <div className="text-xs font-bold flex items-center gap-1">
                        <Activity size={12} className="text-blue-400" />
                        {listing.avg_latency_ms != null && listing.avg_latency_ms > 0 ? `${listing.avg_latency_ms} ms` : "Not reported"}
                    </div>
                </div>
            </div>

            <div className="mt-auto pt-4 border-t border-border flex items-center justify-between">
                <div className="flex flex-col">
                    <span className="ui-stat-label">Rate</span>
                    <span className="text-sm">{listing.price_per_gb != null ? `$${listing.price_per_gb.toFixed(4)}/GB` : "Not reported"}</span>
                </div>
                <Link href={`/marketplace/${listing.id}`} className="p-2 rounded-lg bg-secondary hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                    <ExternalLink size={16} />
                </Link>
            </div>
        </motion.div>
    );
}
