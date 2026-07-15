'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, MessageSquare, Star, Users, Wifi } from 'lucide-react';
import {
    fetchListingSocialContext,
    type ListingSocialContext,
} from '@/lib/api/listing-social';
import { QuickMessageModal } from '@/components/QuickMessageModal';
import { FollowFeedHint, FollowProviderButton } from '@/components/social/FollowProviderButton';
import { useAuth } from '@/lib/auth';

interface ListingSocialPanelProps {
    listingId: string;
    listingTitle: string;
    pricePerGb?: number;
    location?: string;
    compact?: boolean;
    className?: string;
}

export function ListingSocialPanel({
    listingId,
    listingTitle,
    pricePerGb,
    location,
    compact = false,
    className = '',
}: ListingSocialPanelProps) {
    const { user, isAuthenticated } = useAuth();
    const [context, setContext] = useState<ListingSocialContext | null>(null);
    const [loading, setLoading] = useState(true);
    const [messageOpen, setMessageOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchListingSocialContext(listingId)
            .then((data) => {
                if (!cancelled) setContext(data);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [listingId]);

    if (loading) {
        return (
            <div
                className={`flex items-center gap-2 text-[10px] font-mono uppercase text-muted-foreground/40 ${className}`}
            >
                <Loader2 size={14} className="animate-spin" />
                Loading provider context…
            </div>
        );
    }

    if (!context?.provider) {
        return null;
    }

    const provider = context.provider;
    const profileHref = provider.username
        ? `/profile/${provider.username}`
        : `/profile/${provider.id}`;

    return (
        <>
            <div
                className={`rounded-xl border border-white/10 bg-white/[0.02] ${compact ? 'p-4 space-y-3' : 'p-5 space-y-4'} ${className}`}
            >
                <div className="flex items-start gap-3">
                    <div className="relative w-10 h-10 rounded-xl bg-black/40 border border-white/10 overflow-hidden shrink-0">
                        {provider.avatar_url ? (
                            <img
                                src={provider.avatar_url}
                                alt=""
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] font-black text-primary/50">
                                {(provider.display_name || provider.username || '?')[0]?.toUpperCase()}
                            </div>
                        )}
                        <span
                            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-black ${
                                provider.is_online ? 'bg-emerald-500' : 'bg-white/30'
                            }`}
                        />
                    </div>
                    <div className="min-w-0 flex-1">
                        <Link
                            href={profileHref}
                            className="text-xs font-black uppercase tracking-wide text-foreground hover:text-primary truncate block"
                        >
                            {provider.display_name || provider.username || 'Provider'}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[9px] font-mono uppercase text-muted-foreground/50">
                            <span className="inline-flex items-center gap-1 text-amber-500">
                                <Star size={10} className="fill-current" />
                                {provider.avg_rating?.toFixed(1) || '—'}
                            </span>
                            <span>{provider.reviews_count} reviews</span>
                            {!compact && (
                                <span>~{provider.response_time_min}m reply</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3 text-[9px] font-mono uppercase text-muted-foreground/50">
                    <span className="inline-flex items-center gap-1">
                        <Users size={10} />
                        {context.active_sessions_count} active / {context.total_sessions_count} total
                    </span>
                    {provider.is_online && (
                        <span className="inline-flex items-center gap-1 text-emerald-500">
                            <Wifi size={10} />
                            Online
                        </span>
                    )}
                </div>

                <div className={`flex gap-2 ${compact ? 'flex-col' : 'flex-wrap'}`}>
                    {context.allow_direct_message && (
                        <button
                            type="button"
                            onClick={() => setMessageOpen(true)}
                            className="flex-1 min-w-[120px] inline-flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border border-primary/30 bg-primary/10 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/20 transition-colors"
                        >
                            <MessageSquare size={14} />
                            Message provider
                        </button>
                    )}
                    {isAuthenticated && user?.id !== provider.id && (
                        <FollowProviderButton
                            providerId={provider.id}
                            providerName={provider.display_name || provider.username}
                            isFollowed={context.is_followed}
                            compact={compact}
                            onFollowChange={(followed) =>
                                setContext((c) => (c ? { ...c, is_followed: followed } : c))
                            }
                        />
                    )}
                </div>

                {!compact && isAuthenticated && user?.id !== provider.id && (
                    <FollowFeedHint />
                )}

                {context.has_existing_session && context.existing_session_id && (
                    <p className="text-[9px] font-mono text-emerald-500/80 uppercase tracking-wider">
                        You have an active session on this listing.
                    </p>
                )}
            </div>

            <QuickMessageModal
                isOpen={messageOpen}
                onClose={() => setMessageOpen(false)}
                listingId={listingId}
                listingTitle={listingTitle}
                providerId={provider.id}
                providerName={provider.display_name || provider.username}
                providerAvatar={provider.avatar_url}
                providerOnline={provider.is_online}
                pricePerGb={pricePerGb}
                location={location}
            />
        </>
    );
}
