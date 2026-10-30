'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Package, Vote } from 'lucide-react';
import { getFeed } from '@/lib/services/feed';
import { getProposals } from '@/lib/services/governance';

export function ActivityRail() {
    const [loading, setLoading] = useState(true);
    const [feedEvents, setFeedEvents] = useState<{ id: string; type: string; title: string }[]>([]);
    const [proposals, setProposals] = useState<{ id: string; title: string; status: string }[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [feedRes, proposalRes] = await Promise.all([
                    getFeed(1).catch(() => ({ events: [] })),
                    getProposals('active').catch(() => []),
                ]);
                if (cancelled) return;
                setFeedEvents(
                    (feedRes.events ?? []).slice(0, 6).map((e) => ({
                        id: e.id,
                        type: e.event_type,
                        title: e.content || e.event_type,
                    })),
                );
                setProposals(
                    (proposalRes ?? []).slice(0, 4).map((p) => ({
                        id: p.id,
                        title: p.title,
                        status: p.status,
                    })),
                );
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-primary" size={20} />
            </div>
        );
    }

    return (
        <div className="space-y-6" data-testid="network-activity-rail">
            <section>
                <h3 className="text-xs font-semibold text-muted-foreground mb-3">
                    Live feed
                </h3>
                <ul className="space-y-2">
                    {feedEvents.length === 0 ? (
                        <li className="text-xs text-muted-foreground">No recent activity.</li>
                    ) : (
                        feedEvents.map((e) => (
                            <li key={e.id} className="flex gap-2 text-xs">
                                <Package size={14} className="text-primary shrink-0 mt-0.5" />
                                <span className="line-clamp-2">{e.title}</span>
                            </li>
                        ))
                    )}
                </ul>
                <Link
                    href="/community/feed"
                    className="inline-block mt-3 text-xs font-bold text-primary hover:underline"
                >
                    Full feed →
                </Link>
            </section>

            <section>
                <h3 className="text-xs font-semibold text-muted-foreground mb-3">
                    Governance
                </h3>
                <ul className="space-y-2">
                    {proposals.length === 0 ? (
                        <li className="text-xs text-muted-foreground">No active proposals.</li>
                    ) : (
                        proposals.map((p) => (
                            <li key={p.id}>
                                <Link
                                    href={`/governance/${p.id}`}
                                    className="flex gap-2 text-xs hover:text-primary transition-colors"
                                >
                                    <Vote size={14} className="shrink-0 mt-0.5" />
                                    <span className="line-clamp-2 font-medium">{p.title}</span>
                                </Link>
                            </li>
                        ))
                    )}
                </ul>
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
