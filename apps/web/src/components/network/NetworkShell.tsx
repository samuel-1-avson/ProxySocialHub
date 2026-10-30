'use client';

import Link from 'next/link';
import { ActivityRail } from '@/components/network/ActivityRail';
import { NetworkMapEmbed } from '@/components/network/NetworkMapEmbed';

interface NetworkShellProps {
    children?: React.ReactNode;
}

/**
 * Unified network home: embedded map preview + activity rail; full commerce on /marketplace/map.
 */
export function NetworkShell({ children }: NetworkShellProps) {
    return (
        <div className="min-h-[calc(100vh-4rem)]" data-testid="network-shell">
            <div className="container mx-auto px-4 py-8">
                <div className="mb-6">
                    <h1 className="text-3xl font-semibold tracking-tight">
                        Proxy <span className="text-primary">network</span>
                    </h1>
                    <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
                        Follow network activity here. The map below shows live listing and node pins; use the
                        marketplace map for filters, Q&A, and wallet checkout.
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-4">
                        <div className="rounded-lg border border-border bg-secondary overflow-hidden min-h-[420px] flex flex-col">
                            <NetworkMapEmbed />
                        </div>
                        <p className="text-center">
                            <Link
                                href="/marketplace/map"
                                className="text-xs font-bold text-primary hover:underline"
                            >
                                Open marketplace map for full discovery →
                            </Link>
                        </p>
                        {children}
                    </div>
                    <aside className="rounded-lg border border-border bg-secondary p-5 h-fit lg:sticky lg:top-24">
                        <ActivityRail />
                    </aside>
                </div>
            </div>
        </div>
    );
}
