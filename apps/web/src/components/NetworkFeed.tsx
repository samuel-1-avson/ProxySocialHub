"use client";

import { useState, useEffect, useRef } from "react";
import { getFeed, subscribeToFeed, type FeedEvent } from "@/lib/services/feed";
import { isAuthenticated } from "@/lib/auth";
import { Activity, Shield, Users, Server, DollarSign, Vote, AlertTriangle, Radio, Wifi, Hexagon, ChevronRight, Zap, ArrowRight } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ROUTES } from "@/lib/navigation/routes";

export function NetworkFeed() {
    const [events, setEvents] = useState<FeedEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Skip if not authenticated
        if (!isAuthenticated()) {
            setLoading(false);
            return;
        }

        // Initial load
        getFeed()
            .then(data => setEvents(data.events))
            .catch(err => {
                // Silently ignore auth errors
                if (err instanceof Error && err.message !== 'Not authenticated') {
                    console.error(err);
                }
            })
            .finally(() => setLoading(false));

        // Subscribe to real-time updates
        const unsubscribe = subscribeToFeed((newEvent) => {
            setEvents(prev => [newEvent, ...prev].slice(0, 50)); // Keep last 50
        });

        return () => unsubscribe();
    }, []);

    const getIcon = (type: string) => {
        switch (type) {
            case 'new_node': return <Server size={14} className="text-primary" />;
            case 'whale_alert': return <AlertTriangle size={14} className="text-amber-500" />;
            case 'governance_proposal': return <Vote size={14} className="text-blue-500" />;
            case 'node_purchase': return <Zap size={14} className="text-emerald-500" />;
            case 'review': return <Users size={14} className="text-primary/60" />;
            default: return <Activity size={14} className="text-primary" />;
        }
    };

    const formatTime = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    return (
        <div className="glass-card !p-0 h-[450px] flex flex-col overflow-hidden border-white/5 bg-black/40 backdrop-blur-3xl rounded-[2rem] shadow-2xl group">
            <div className="p-6 border-b border-white/5 bg-white/2 flex justify-between items-center relative z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
                        <Wifi className="text-primary animate-pulse" size={16} />
                    </div>
                    <div className="space-y-0.5">
                        <h3 className="font-black font-mono uppercase text-[10px] tracking-[0.3em]">Protocol Stream</h3>
                        <div className="text-[8px] font-mono text-muted-foreground/40 uppercase tracking-widest flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                            Live Telemetry
                        </div>
                    </div>
                </div>
                <div className="p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer">
                    <Activity size={14} className="text-muted-foreground/30" />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 scrollbar-hide relative space-y-3" ref={scrollRef}>
                {loading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                            className="w-8 h-8 border-t-2 border-primary rounded-full"
                        />
                        <p className="font-mono text-[8px] uppercase tracking-[0.4em] text-muted-foreground/30">Syncing Grid</p>
                    </div>
                ) : (
                    <AnimatePresence initial={false}>
                        {!Array.isArray(events) || events.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="py-20 text-center space-y-4 opacity-20"
                            >
                                <Hexagon size={32} className="mx-auto animate-spin-slow" />
                                <p className="text-[9px] font-black font-mono uppercase tracking-[0.4em]">Establishing Uplink...</p>
                            </motion.div>
                        ) : (
                            (events || []).map((event, idx) => (
                                <motion.div
                                    key={event.id}
                                    initial={{ opacity: 0, x: -10, scale: 0.98 }}
                                    animate={{ opacity: 1, x: 0, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    layout
                                    className="p-4 rounded-2xl bg-white/2 border border-white/5 hover:border-primary/20 hover:bg-white/5 transition-all flex gap-4 group/item relative overflow-hidden"
                                >
                                    <div className="mt-0.5 shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-black/40 border border-white/5 group-hover/item:border-primary/20 transition-colors">
                                        {getIcon(event.event_type)}
                                    </div>
                                    <div className="flex-1 min-w-0 space-y-1.5">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[8px] font-black font-mono text-primary/60 uppercase tracking-[0.3em]">
                                                {event.event_type.replace('_', ' ')}
                                            </span>
                                            <span className="text-[9px] font-mono text-muted-foreground/20 tabular-nums font-black">
                                                {formatTime(event.created_at)}
                                            </span>
                                        </div>
                                        <p className="text-[10px] font-black font-mono leading-relaxed truncate group-hover/item:whitespace-normal transition-all duration-500 opacity-80 text-foreground/70">
                                            {event.content}
                                        </p>
                                    </div>
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                        <ChevronRight size={14} className="text-primary/30" />
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>
                )}
            </div>

            <div className="p-4 border-t border-white/5 bg-white/2 backdrop-blur-3xl">
                <Link href={ROUTES.communityFeed} className="flex items-center justify-center gap-3 w-full py-3 rounded-xl bg-white/5 hover:bg-primary/10 border border-white/5 hover:border-primary/30 transition-all group/btn">
                    <span className="text-[9px] font-black font-mono uppercase text-muted-foreground group-hover/btn:text-primary transition-colors tracking-[0.3em]">Protocol Archive</span>
                    <ArrowRight size={12} className="text-muted-foreground/20 group-hover/btn:text-primary group-hover/btn:translate-x-1 transition-all" />
                </Link>
            </div>
        </div>
    );
}
