"use client";

import { useState, useEffect, useRef } from "react";
import { getFeed, subscribeToFeed, type FeedEvent } from "@/lib/services/feed";
import { Activity, Shield, Users, Server, DollarSign, Vote, AlertTriangle, Radio } from "lucide-react";
import Link from "next/link";

export function NetworkFeed() {
    const [events, setEvents] = useState<FeedEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Initial load
        getFeed()
            .then(data => setEvents(data.events))
            .catch(err => console.error(err))
            .finally(() => setLoading(false));

        // Subscribe to real-time updates
        const unsubscribe = subscribeToFeed((newEvent) => {
            setEvents(prev => [newEvent, ...prev].slice(0, 50)); // Keep last 50
        });

        return () => unsubscribe();
    }, []);

    const getIcon = (type: string) => {
        switch (type) {
            case 'new_node': return <Server size={14} className="text-secondary-foreground" />;
            case 'whale_alert': return <AlertTriangle size={14} className="text-yellow-500" />;
            case 'governance_proposal': return <Vote size={14} className="text-primary" />;
            case 'node_purchase': return <DollarSign size={14} className="text-green-500" />;
            case 'review': return <Users size={14} className="text-blue-500" />;
            default: return <Activity size={14} className="text-muted-foreground" />;
        }
    };

    const formatTime = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    return (
        <div className="card-retro p-0 bg-card h-[400px] flex flex-col overflow-hidden border-primary/20 shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)]">
            <div className="p-4 border-b border-border bg-secondary/10 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Radio className="text-destructive animate-pulse" size={16} />
                    <h3 className="font-bold font-mono uppercase text-sm tracking-wider">Network Protocol Feed</h3>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    Live Signal
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-0 scrollbar-hide relative" ref={scrollRef}>
                {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <div className="divide-y divide-border/50">
                        {!Array.isArray(events) || events.length === 0 ? (
                            <div className="p-8 text-center text-xs font-mono text-muted-foreground">
                                No network activity detected.
                            </div>
                        ) : (
                            (events || []).map((event) => (
                                <div key={event.id} className="p-3 hover:bg-secondary/5 transition-colors flex gap-3 group animate-in slide-in-from-left duration-300">
                                    <div className="mt-1 min-w-[24px] h-6 flex items-center justify-center rounded-sm bg-secondary/30 border border-border/50 font-mono text-xs">
                                        {getIcon(event.event_type)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center mb-0.5">
                                            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest opacity-70">
                                                {event.event_type.replace('_', ' ')}
                                            </span>
                                            <span className="text-[10px] font-mono text-muted-foreground">
                                                {formatTime(event.created_at)}
                                            </span>
                                        </div>
                                        <p className="text-xs font-mono leading-relaxed truncate group-hover:whitespace-normal group-hover:overflow-visible group-hover:bg-card group-hover:z-10 group-hover:relative">
                                            {event.content}
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            <div className="p-2 border-t border-border bg-secondary/5 text-center">
                <Link href="/feed" className="text-[10px] font-mono uppercase text-primary hover:underline">
                    View Full History
                </Link>
            </div>
        </div>
    );
}
