'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { getFeed, FeedEvent } from '@/lib/api';
import { Activity, User, Tag, Award, Zap, LayoutList, Calendar } from 'lucide-react';

export default function FeedPage() {
    const { isAuthenticated } = useAuth();
    const [events, setEvents] = useState<FeedEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isAuthenticated) {
            loadFeed();
        }
    }, [isAuthenticated]);

    const loadFeed = async () => {
        try {
            const data = await getFeed();
            setEvents(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'new_listing': return <Tag size={16} />;
            case 'badge_earned': return <Award size={16} />;
            case 'milestone': return <Zap size={16} />;
            case 'new_follower': return <User size={16} />;
            default: return <Activity size={16} />;
        }
    };

    if (loading) return <div className="p-8 text-center font-mono">LOADING FEED STREAM...</div>;

    return (
        <div className="max-w-2xl mx-auto space-y-6 pb-20 animate-in fade-in duration-500">
            <div className="flex items-center justify-between border-b border-border pb-4">
                <h1 className="text-2xl font-bold font-mono uppercase flex items-center gap-2">
                    <Activity size={24} className="text-primary" />
                    Network Activity
                </h1>
                <div className="text-xs font-mono text-muted-foreground">
                    GLOBAL STREAM
                </div>
            </div>

            <div className="space-y-4">
                {events.length > 0 ? events.map(event => (
                    <div key={event.id} className="card-retro bg-card p-4 flex gap-4 hover:border-primary transition-colors">
                        <div className="mt-1">
                            <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center text-primary">
                                {getIcon(event.event_type)}
                            </div>
                        </div>
                        <div className="flex-1 space-y-1">
                            <div className="flex justify-between items-start">
                                <span className="text-sm font-bold font-mono">
                                    {event.actor?.display_name || event.actor?.username || 'Unknown User'}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                                    <Calendar size={10} />
                                    {new Date(event.created_at).toLocaleDateString()}
                                </span>
                            </div>
                            <p className="text-sm text-muted-foreground">{event.content}</p>

                            {/* Metadata visualization if needed */}
                            {event.metadata && Object.keys(event.metadata).length > 0 && (
                                <div className="mt-2 p-2 bg-secondary/30 rounded-sm text-xs font-mono text-muted-foreground overflow-hidden">
                                    <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
                                </div>
                            )}
                        </div>
                    </div>
                )) : (
                    <div className="text-center py-12 border-2 border-dashed border-border rounded-sm">
                        <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                        <h3 className="text-lg font-bold font-mono uppercase text-foreground mb-2">No Activity Detected</h3>
                        <p className="text-xs font-mono text-muted-foreground">
                            THE NETWORK IS SILENT. BE THE FIRST TO GENERATE SIGNALS.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
