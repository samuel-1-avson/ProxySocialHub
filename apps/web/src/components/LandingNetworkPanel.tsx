'use client';

/**
 * Guest-safe network status for the landing page.
 * Uses public marketplace map counts — never invents SLA/price metrics.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe, MapPin, Radio, Server } from 'lucide-react';
import { getMarketplaceMapPoints } from '@/lib/api/marketplace';
import { explorerHref } from "@/lib/navigation/workspace";
import { ROUTES } from '@/lib/navigation/routes';

type NetworkSnapshot = {
    nodeCount: number;
    listingCount: number;
    loading: boolean;
    error: boolean;
};

export function LandingNetworkPanel() {
    const [snap, setSnap] = useState<NetworkSnapshot>({
        nodeCount: 0,
        listingCount: 0,
        loading: true,
        error: false,
    });

    useEffect(() => {
        let cancelled = false;
        getMarketplaceMapPoints({ include_nodes: true, purchasable_only: true, active_nodes_only: true })
            .then((data) => {
                if (cancelled) return;
                setSnap({
                    nodeCount: data.node_count ?? 0,
                    listingCount: data.listing_count ?? 0,
                    loading: false,
                    error: false,
                });
            })
            .catch(() => {
                if (cancelled) return;
                setSnap((s) => ({ ...s, loading: false, error: true }));
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const forming = !snap.loading && !snap.error && snap.nodeCount === 0;

    return (
        <div className="w-full max-w-5xl mx-auto border border-border bg-card overflow-hidden rounded-lg">
            <div className="grid md:grid-cols-2 min-h-[280px]">
                {/* Product visual — self-hosted earth texture (no auth, no fake pins) */}
                <Link
                    href={explorerHref("/nodes?view=map")}
                    className="relative group min-h-[220px] md:min-h-full block overflow-hidden border-b md:border-b-0 md:border-r border-border"
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/map-assets/earth-night.jpg"
                        alt="ProxyHubb global infrastructure map preview"
                        className="absolute inset-0 w-full h-full object-cover scale-110 group-hover:scale-100 transition-transform duration-700"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.55)_100%)]" />
                    <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-black font-mono uppercase tracking-[0.35em] text-primary mb-1">
                                Infrastructure map
                            </p>
                            <p className="text-sm font-mono font-bold text-foreground">
                                Explore the live network map
                            </p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-black font-mono uppercase tracking-widest text-foreground/80 group-hover:text-primary transition-colors">
                            <MapPin size={12} /> Open map
                        </span>
                    </div>
                </Link>

                {/* Honest live counts */}
                <div className="p-6 sm:p-8 flex flex-col justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <Radio size={14} className={snap.loading ? 'text-amber-400 animate-pulse' : 'text-emerald-500'} />
                            <span className="text-[10px] font-black font-mono uppercase tracking-[0.3em] text-muted-foreground">
                                {snap.loading ? 'Syncing network…' : snap.error ? 'Network status unavailable' : 'Live network'}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="border border-border rounded-sm p-4 bg-background/60">
                                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                    <Server size={12} />
                                    <span className="text-[9px] font-mono font-bold uppercase tracking-widest">Providers</span>
                                </div>
                                <p className="text-3xl font-mono font-bold tabular-nums">
                                    {snap.loading ? '—' : snap.nodeCount}
                                </p>
                            </div>
                            <div className="border border-border rounded-sm p-4 bg-background/60">
                                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                    <Globe size={12} />
                                    <span className="text-[9px] font-mono font-bold uppercase tracking-widest">Listings</span>
                                </div>
                                <p className="text-3xl font-mono font-bold tabular-nums">
                                    {snap.loading ? '—' : snap.listingCount}
                                </p>
                            </div>
                        </div>
                    </div>

                    {forming ? (
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                The network is forming — no provider nodes are online yet. Be among the first to register and appear on the map.
                            </p>
                            <Link
                                href={`${ROUTES.register}?role=provider`}
                                className="btn-retro btn-retro-primary inline-flex items-center justify-center px-4 py-2.5 text-xs w-full sm:w-auto"
                            >
                                Become a provider
                            </Link>
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-3">
                            <Link
                                href={ROUTES.marketplace}
                                className="btn-retro btn-retro-outline inline-flex items-center justify-center px-4 py-2.5 text-xs"
                            >
                                Browse marketplace
                            </Link>
                            <Link
                                href={explorerHref("/nodes?view=map")}
                                className="btn-retro btn-retro-primary inline-flex items-center justify-center px-4 py-2.5 text-xs"
                            >
                                View map
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
