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
                <Loader2 className="w-12 h-12 animate-spin text-purple-500" />
                <p className="mt-4 font-sans text-sm text-muted-foreground uppercase tracking-widest font-bold">Retrieving Profile...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                <h2 className="text-xl font-bold mb-2">Error</h2>
                <p className="text-muted-foreground mb-6">{error}</p>
                <Link href="/marketplace" className="px-6 py-2 bg-purple-600 rounded-lg font-bold">
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
    // Public profile does not yet expose measured uptime — show unavailable, not a fake %.
    const avgUptime = "—";
    const reputationScore = Math.round(profile.avg_rating * 20) || 0; // Convert 0-5 to 0-100
    const providerSince = profile.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : "Joined recently";
    const location = profile.location || "Global";

    return (
        <div className="container mx-auto px-4 py-12 max-w-6xl">
            {/* Header / Nav */}
            <Link href="/marketplace" className="inline-flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground hover:text-purple-400 transition-colors mb-8">
                <ArrowLeft size={14} /> Back to Marketplace
            </Link>

            {/* Profile Overview Card */}
            <div className="glass-card p-8 mb-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/4" />
                
                <div className="relative z-10 flex flex-col md:flex-row gap-8 items-start">
                    <div className="w-24 h-24 rounded-3xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-500 shadow-[0_0_30px_rgba(168,85,247,0.15)]">
                        {profile.avatar_url ? (
                            <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full rounded-3xl object-cover" />
                        ) : (
                            <Server size={48} strokeWidth={1.5} />
                        )}
                    </div>
                    
                    <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                            <h1 className="text-3xl font-black font-sans tracking-tight">{profile.display_name || `Provider ${id.slice(0, 8)}`}</h1>
                            {profile.verified && (
                                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-black uppercase border border-emerald-500/20">
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
                            <ProfileStat label="Reputation" value={`${reputationScore}/100`} sub="Node Trust Score" color="purple" />
                            <ProfileStat label="Total Shared" value={totalBandwidth} sub="Lifetime Traffic" color="blue" />
                            <ProfileStat label="Avg. Uptime" value={avgUptime} sub={avgUptime === "—" ? "Unavailable" : "Last 30 Days"} color="emerald" />
                            <ProfileStat label="SLA Tier" value={profile.trust_tier || "Standard"} sub="Guaranteed Quality" color="amber" />
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
                        <button
                            type="button"
                            className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(147,51,234,0.3)]"
                        >
                            Contact Provider
                        </button>
                    </div>
                </div>
            </div>

            {/* Active Infrastructure */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Network size={20} className="text-purple-500" />
                        Infrastructure Fleet
                    </h2>
                    <span className="text-sm font-medium text-muted-foreground">{listings.length} Listings Online</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {listings.map((listing) => (
                        <NodeMiniCard key={listing.id} listing={listing} />
                    ))}
                    {listings.length === 0 && (
                        <div className="col-span-full py-20 text-center glass-card border-dashed">
                            <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground/30 mb-4" />
                            <h3 className="text-lg font-bold mb-1">No Public Nodes</h3>
                            <p className="text-sm text-muted-foreground">This provider is currently running private infrastructure.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function ProfileStat({ label, value, sub, color }: { label: string, value: string, sub: string, color: string }) {
    const colors: any = {
        purple: "text-purple-400 bg-purple-500/10 border-purple-500/20",
        blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
        emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
        amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    };

    return (
        <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col">
            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">{label}</span>
            <span className="text-xl font-black font-sans mb-0.5">{value}</span>
            <span className="text-[10px] font-medium text-muted-foreground/60">{sub}</span>
        </div>
    );
}

function NodeMiniCard({ listing }: { listing: Listing }) {
    return (
        <motion.div 
            whileHover={{ y: -4 }}
            className="glass-card p-6 flex flex-col h-full group transition-all hover:bg-white/5"
        >
            <div className="flex justify-between items-start mb-4">
                <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 group-hover:bg-purple-500/20 transition-colors">
                    <Zap size={20} />
                </div>
                <StatusBadge status={listing.status === 'active' ? 'online' : 'offline'} label={listing.status === 'active' ? 'Online' : 'Offline'} pulse={listing.status === 'active'} />
            </div>

            <h3 className="font-bold text-lg mb-1">{listing.title || "Edge Node"}</h3>
            <p className="text-xs text-muted-foreground mb-4 font-mono truncate">{listing.node_id || listing.id}</p>

            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="space-y-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Quality</span>
                    <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${listing.quality_score || 95}%` }} />
                        </div>
                        <span className="text-xs font-bold">{(listing.quality_score || 95).toFixed(0)}</span>
                    </div>
                </div>
                <div className="space-y-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Latency</span>
                    <div className="text-xs font-bold flex items-center gap-1">
                        <Activity size={12} className="text-blue-400" />
                        {listing.avg_latency_ms || 45}ms
                    </div>
                </div>
            </div>

            <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
                <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Rate</span>
                    <span className="text-sm font-black text-emerald-400">${(listing.price_per_gb || 0.05).toFixed(4)}<span className="text-[10px] text-muted-foreground">/GB</span></span>
                </div>
                <Link href={`/marketplace/${listing.id}`} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground">
                    <ExternalLink size={16} />
                </Link>
            </div>
        </motion.div>
    );
}
