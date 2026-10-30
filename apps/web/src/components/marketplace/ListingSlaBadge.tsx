'use client';

import { Activity, ShieldAlert, ShieldCheck } from 'lucide-react';

export type ListingSlaSource = 'gateway' | 'explorer' | 'provider' | 'listing' | string | undefined;

interface Props {
    uptimePercent: number;
    slaSource?: ListingSlaSource;
    listingOfferVerified?: boolean;
    listingOfferSigner?: string;
    listingOfferError?: string;
    compact?: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
    gateway: 'Live SLA',
    explorer: 'Node SLA',
    provider: 'Provider SLA',
    listing: 'Unmeasured',
};

function slaIsMeasured(slaSource?: ListingSlaSource) {
    return slaSource === 'gateway' || slaSource === 'explorer' || slaSource === 'provider';
}

export function ListingSlaBadge({
    uptimePercent,
    slaSource,
    listingOfferVerified,
    listingOfferSigner,
    listingOfferError,
    compact,
}: Props) {
    const live = slaSource === 'gateway';
    const measured = slaIsMeasured(slaSource);
    const label = SOURCE_LABEL[slaSource || 'listing'] || 'Unmeasured';
    const uptime = Number(uptimePercent || 0);
    const tone = !measured
        ? 'text-muted-foreground border-border bg-secondary'
        : uptime > 98 ? 'text-success border-success/30 bg-success/10' : uptime > 90
            ? 'text-warning border-warning/30 bg-warning/10'
            : 'text-destructive border-destructive/30 bg-destructive/10';
    const proofTitle = listingOfferVerified
        ? `Provider-signed offer${listingOfferSigner ? ` · ${listingOfferSigner}` : ''}`
        : listingOfferError && listingOfferError !== 'unsigned'
            ? `Listing proof issue: ${listingOfferError}`
            : 'Listing offer is not provider-signed yet';

    if (compact) {
        return (
            <span className="inline-flex items-center gap-1">
                <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[7px] font-semibold border ${tone}`}
                    title={measured ? `${uptime.toFixed(1)}% uptime · ${label}` : 'No live SLA telemetry'}
                >
                    <Activity size={8} />
                    {measured ? `${uptime.toFixed(0)}%` : 'Not measured'}
                    {live && <span className="text-success">live</span>}
                </span>
                <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[7px] font-semibold border ${
                        listingOfferVerified
                            ? 'text-info border-info/30 bg-info/10'
                            : 'text-muted-foreground border-border bg-secondary'
                    }`}
                    title={proofTitle}
                >
                    {listingOfferVerified ? <ShieldCheck size={8} /> : <ShieldAlert size={8} />}
                    {listingOfferVerified ? 'signed' : 'unsigned'}
                </span>
            </span>
        );
    }

    return (
        <div className={`inline-flex flex-col gap-0.5 px-2 py-1 rounded-lg border ${tone}`}>
            <div className="flex items-center gap-1 text-xs font-semibold">
                <Activity size={9} />
                {label}
                {live && <span className="text-success animate-pulse">●</span>}
            </div>
            <div className="text-xs font-semibold tabular-nums">{measured ? `${uptime.toFixed(1)}% uptime` : 'No telemetry'}</div>
            <div
                className={`inline-flex items-center gap-1 text-xs font-semibold ${
                    listingOfferVerified ? 'text-info' : 'text-muted-foreground'
                }`}
                title={proofTitle}
            >
                {listingOfferVerified ? <ShieldCheck size={9} /> : <ShieldAlert size={9} />}
                {listingOfferVerified ? 'Provider signed' : 'Unsigned offer'}
            </div>
        </div>
    );
}
