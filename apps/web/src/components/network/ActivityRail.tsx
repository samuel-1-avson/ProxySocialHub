'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Package, Vote } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getFeed } from '@/lib/services/feed';
import { getProposals } from '@/lib/services/governance';

// Recent-updates rail (F09). This is not a live stream: it polls on an
// interval and says so through its freshness line. Signed-out, source
// failure, stale-after-failed-refresh and genuine inactivity are distinct
// states — a failure is never rendered as "nothing happened".

const REFRESH_MS = 60_000;

function formatTime(value: Date | string | number): string {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ActivityRail() {
    const { user, isAuthenticated, isLoading: authLoading } = useAuth();

    const feedQuery = useQuery({
        queryKey: ["network-rail", "feed", user?.id ?? "anon"],
        queryFn: () => getFeed(1),
        enabled: !authLoading && isAuthenticated,
        refetchInterval: REFRESH_MS,
        retry: false,
    });
    const govQuery = useQuery({
        queryKey: ["network-rail", "proposals"],
        queryFn: () => getProposals('active'),
        refetchInterval: REFRESH_MS,
        retry: false,
    });

    const feedEvents = (feedQuery.data?.events ?? []).slice(0, 6);
    const proposals = (govQuery.data ?? []).slice(0, 4);
    const feedFailed = feedQuery.isError;
    const feedStale = Boolean(feedQuery.error) && !feedQuery.isError && feedEvents.length > 0;

    if (authLoading || govQuery.isPending || (isAuthenticated && feedQuery.isPending)) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-primary" size={20} />
            </div>
        );
    }

    return (
        <div className="space-y-6" data-testid="network-activity-rail">
            <section>
                <h3 className="text-xs font-semibold text-muted-foreground mb-1">
                    Recent updates
                </h3>
                {isAuthenticated && feedQuery.dataUpdatedAt > 0 && (
                    <p className="text-[11px] text-muted-foreground mb-3">
                        Updated {formatTime(feedQuery.dataUpdatedAt)} · refreshes every minute
                    </p>
                )}
                {!isAuthenticated ? (
                    <p className="text-xs text-muted-foreground">
                        Sign in to see activity from people you follow.{' '}
                        <Link href="/login?next=/network" className="font-bold text-primary hover:underline">
                            Sign in
                        </Link>
                    </p>
                ) : feedFailed && feedEvents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        Recent updates could not be loaded.{' '}
                        <button type="button" className="font-bold text-primary hover:underline" onClick={() => void feedQuery.refetch()}>
                            Try again
                        </button>
                    </p>
                ) : (
                    <>
                        {(feedStale || (feedFailed && feedEvents.length > 0)) && (
                            <p className="text-[11px] text-muted-foreground mb-2">
                                Refresh failed — showing the last successful update.
                            </p>
                        )}
                        <ul className="space-y-2">
                            {feedEvents.length === 0 ? (
                                <li className="text-xs text-muted-foreground">No recent activity yet.</li>
                            ) : (
                                feedEvents.map((event) => (
                                    <li key={event.id} className="flex gap-2 text-xs">
                                        <Package size={14} className="text-primary shrink-0 mt-0.5" />
                                        <span className="line-clamp-2">{event.content || event.event_type}</span>
                                        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                                            {formatTime(event.created_at)}
                                        </span>
                                    </li>
                                ))
                            )}
                        </ul>
                    </>
                )}
            </section>

            <section>
                <h3 className="text-xs font-semibold text-muted-foreground mb-3">
                    Governance
                </h3>
                {govQuery.isError && proposals.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        Proposals could not be loaded.{' '}
                        <button type="button" className="font-bold text-primary hover:underline" onClick={() => void govQuery.refetch()}>
                            Try again
                        </button>
                    </p>
                ) : (
                    <ul className="space-y-2">
                        {proposals.length === 0 ? (
                            <li className="text-xs text-muted-foreground">No active proposals.</li>
                        ) : (
                            proposals.map((proposal) => (
                                <li key={proposal.id}>
                                    <Link
                                        href={`/governance/${proposal.id}`}
                                        className="flex gap-2 text-xs hover:text-primary transition-colors"
                                    >
                                        <Vote size={14} className="shrink-0 mt-0.5" />
                                        <span className="line-clamp-2 font-medium">{proposal.title}</span>
                                    </Link>
                                </li>
                            ))
                        )}
                    </ul>
                )}
                <Link
                    href="/governance"
                    className="inline-block mt-3 text-xs font-bold text-primary hover:underline"
                >
                    All proposals →
                </Link>
            </section>
        </div>
    );
}
