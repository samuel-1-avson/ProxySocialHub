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
import { ListingSlaBadge } from '@/components/marketplace/ListingSlaBadge';

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
                    <div className="w-12 h-12 rounded-2xl bg-black/40 border border-white/5 flex items-center justify-center relative group-hover:border-primary/40 transition-colors overflow-hidden">
                        {listing.seller?.avatar_url ? (
                            <img src={listing.seller.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <div className="text-[10px] font-black text-primary/40">{(listing.seller?.display_name?.[0] || "?").toUpperCase()}</div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-primary/40 scale-x-0 group-hover:scale-x-100 transition-transform" />
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <h3 className="font-black text-white text-[11px] uppercase tracking-wider group-hover:text-primary transition-colors">{listing.title}</h3>
                            {listing.is_priority && <Target size={10} className="text-primary animate-pulse" />}
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1 text-[9px] font-black text-white/20 uppercase tracking-widest">
                                <Star size={10} className="text-yellow-500 fill-yellow-500/20" />
                                {Number(listing.seller?.avg_rating || 5.0).toFixed(1)}
                            </div>
                            <div className={`px-2 py-0.5 rounded-sm text-[8px] font-black uppercase tracking-widest border ${listing.proxy_type === 'residential' ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-white/5 border-white/10 text-white/40'
                                }`}>
                                {listing.proxy_type}
                            </div>
                            <ListingSlaBadge
                                uptimePercent={listing.uptime_percent}
                                slaSource={listing.sla_source}
                                compact
                            />
                        </div>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-1.5 px-3 py-1.5 rounded-xl bg-black/20 border border-white/5 backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                        </span>
                        <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Active</span>
                    </div>
                    <div className="text-[8px] font-black text-white/10 tracking-[0.2em]">{listing.id.split('-')[0]}</div>
                </div>

                {/* Tier Badge */}
                <div className={`absolute top-24 right-6 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] shadow-xl border backdrop-blur-md z-20 ${
                    (listing.current_tier === 'Gold' || (!listing.current_tier && (listing.quality_score || 0) >= 90)) ? 'bg-amber-500/20 text-amber-500 border-amber-500/30 shadow-amber-500/10' :
                    (listing.current_tier === 'Silver' || (!listing.current_tier && (listing.quality_score || 0) >= 70)) ? 'bg-slate-300/20 text-slate-300 border-slate-300/30' :
                    'bg-orange-700/20 text-orange-400 border-orange-700/30'
                }`}>
                    <div className="flex items-center gap-1.5">
                        <Hexagon size={10} className="fill-current/20" />
                        {listing.current_tier || ((listing.quality_score || 0) >= 90 ? 'Gold' : (listing.quality_score || 0) >= 70 ? 'Silver' : 'Bronze')}
                    </div>
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
                        <Activity size={10} className="text-primary/40" /> Capacity
                    </div>
                    <div className="text-sm font-black text-white flex items-baseline gap-1">
                        {Number(listing.quality_score || 95).toFixed(0)}<span className="text-[10px] text-white/20">%</span>
                    </div>
                    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${listing.quality_score || 95}%` }}
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
                        <ShieldCheck size={10} className="text-primary/40" />
                        ZK-MultiSig
                    </div>
                </div>
                <div className="p-1 px-2 rounded-lg bg-black/40 border border-white/5 group-hover:border-primary/20 transition-colors">
                    <Cpu size={12} className="text-white/10" />
                </div>
            </div>

            {/* Pricing Hub & Action */}
            <div className="relative z-10 p-6 flex items-center justify-between gap-6">
                <div className="space-y-1">
                    <div className="text-[8px] font-black text-white/20 uppercase tracking-[0.4em]">Settlement Rate</div>
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-black text-white tracking-tighter">₵{Number(listing.price_per_gb || 0).toFixed(2)}</span>
                        <span className="text-[10px] font-black text-white/20 uppercase">/ Gb</span>
                    </div>
                </div>

                <button
                    onClick={() => onSelect(listing)}
                    className="flex-1 group/btn relative py-4 rounded-2xl bg-primary text-primary-foreground font-black text-[10px] uppercase tracking-[0.4em] flex items-center justify-center gap-3 transition-all hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] active:scale-[0.95]"
                >
                    <div className="absolute inset-0 bg-white/10 translate-x-[-200%] group-hover/btn:translate-x-[200%] transition-transform duration-700" />
                    <Zap size={14} className="group-hover/btn:animate-pulse" />
                    Inject
                    <ArrowRight size={12} className="opacity-40 group-hover/btn:opacity-100 group-hover/btn:translate-x-1 transition-all" />
                </button>
            </div>

            {/* Decorative Protocol Accents */}
            <div className="absolute bottom-2 right-6 flex gap-1 items-end pointer-events-none opacity-20">
                <div className="w-1 h-3 bg-white/10 rounded-full" />
                <div className="w-1 h-6 bg-primary/40 rounded-full" />
                <div className="w-1 h-4 bg-white/10 rounded-full" />
            </div>
        </motion.div>
    );
}
