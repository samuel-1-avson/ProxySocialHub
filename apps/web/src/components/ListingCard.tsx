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
    ArrowRight
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Listing } from '@/lib/api/marketplace';

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
            whileHover={{ y: -4 }}
            className={`group relative overflow-hidden rounded-2xl border transition-all duration-300 ${isHighQuality
                ? 'bg-gradient-to-br from-emerald-500/10 to-blue-500/5 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.1)]'
                : 'bg-black/40 backdrop-blur-md border-white/5 hover:border-white/20'
                }`}
        >
            {/* Header / Identity */}
            <div className="p-5 border-b border-white/5 flex justify-between items-start">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
                        {listing.seller?.avatar_url ? (
                            <img src={listing.seller.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <span className="font-mono font-black text-sm text-white/40">{(listing.seller?.display_name?.[0] || "?").toUpperCase()}</span>
                        )}
                    </div>
                    <div>
                        <h3 className="font-black text-white text-sm leading-tight line-clamp-1 uppercase tracking-tight">{listing.title}</h3>
                        <div className="flex items-center gap-2 mt-1">
                            <div className="flex items-center gap-1 text-[10px] font-black text-yellow-500">
                                <Star size={10} className="fill-current" />
                                {listing.seller?.avg_rating?.toFixed(1) || "5.0"}
                            </div>
                            <span className="text-white/20 text-[10px]">•</span>
                            <div className="text-[10px] font-black uppercase text-emerald-400 font-mono tracking-wider">
                                {listing.proxy_type}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Live Pulse Indicator */}
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                    <span className="text-[8px] font-black text-emerald-400 uppercase tracking-tighter">Live</span>
                </div>
            </div>

            {/* Performance Grid */}
            <div className="grid grid-cols-2 divide-x divide-white/5 border-b border-white/5 bg-white/[0.02]">
                <div className="p-4 space-y-1">
                    <div className="flex items-center gap-1.5 text-[9px] font-bold text-white/30 uppercase tracking-widest">
                        <Signal size={10} /> Latency
                    </div>
                    <div className="font-mono font-black text-xs text-white flex items-baseline gap-0.5">
                        {listing.avg_latency_ms || '<50'}<span className="text-[10px] text-white/40">ms</span>
                    </div>
                </div>
                <div className="p-4 space-y-1">
                    <div className="flex items-center gap-1.5 text-[9px] font-bold text-white/30 uppercase tracking-widest">
                        <Activity size={10} /> Node Score
                    </div>
                    <div className="font-mono font-black text-xs text-white">
                        {(listing.quality_score || 0).toFixed(0)}<span className="text-[10px] text-white/40">/100</span>
                    </div>
                </div>
            </div>

            {/* Technical Detail Strip */}
            <div className="px-5 py-3 flex items-center justify-between text-[10px] font-bold text-white/40 border-b border-white/5">
                <div className="flex items-center gap-1.5">
                    <Globe size={12} className="text-blue-400/60" />
                    {listing.country || 'Global Network'}
                </div>
                <div className="flex items-center gap-1.5">
                    <Shield size={12} className="text-purple-400/60" />
                    {listing.isp || 'Verified Provider'}
                </div>
            </div>

            {/* Pricing & CTA */}
            <div className="p-5 flex items-center justify-between">
                <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30 mb-0.5">Rate Control</div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-lg font-black text-white">₵{listing.price_per_gb}</span>
                        <span className="text-[10px] font-bold text-white/40 uppercase">/ GB</span>
                    </div>
                </div>
                <button
                    onClick={() => onSelect(listing)}
                    className="group/btn relative px-5 py-2.5 rounded-xl bg-white text-black font-black text-[10px] uppercase tracking-widest flex items-center gap-2 overflow-hidden transition-all hover:scale-105 active:scale-95"
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent translate-x-[-200%] group-hover/btn:translate-x-[200%] transition-transform duration-700"></div>
                    <Wifi size={14} className="group-hover/btn:animate-pulse" />
                    Link Node
                    <ArrowRight size={12} className="opacity-0 -translate-x-2 group-hover/btn:opacity-100 group-hover/btn:translate-x-0 transition-all" />
                </button>
            </div>

            {/* Background HUD effect */}
            <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
                <Server size={64} className="rotate-12" />
            </div>
        </motion.div>
    );
}
