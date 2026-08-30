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
        ? 'text-white/40 border-white/10 bg-white/5'
        : uptime > 98 ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : uptime > 90
            ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
            : 'text-rose-400 border-rose-500/30 bg-rose-500/10';
    const proofTitle = listingOfferVerified
        ? `Provider-signed offer${listingOfferSigner ? ` · ${listingOfferSigner}` : ''}`
        : listingOfferError && listingOfferError !== 'unsigned'
            ? `Listing proof issue: ${listingOfferError}`
            : 'Listing offer is not provider-signed yet';

    if (compact) {
        return (
            <span className="inline-flex items-center gap-1">
                <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[7px] font-black uppercase tracking-wider border ${tone}`}
                    title={measured ? `${uptime.toFixed(1)}% uptime · ${label}` : 'No live SLA telemetry'}
                >
                    <Activity size={8} />
                    {measured ? `${uptime.toFixed(0)}%` : '—'}
                    {live && <span className="text-emerald-300">live</span>}
                </span>
                <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[7px] font-black uppercase tracking-wider border ${
                        listingOfferVerified
                            ? 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10'
                            : 'text-white/40 border-white/10 bg-white/5'
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
            <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest">
                <Activity size={9} />
                {label}
                {live && <span className="text-emerald-300 animate-pulse">●</span>}
            </div>
            <div className="text-[11px] font-black tabular-nums">{measured ? `${uptime.toFixed(1)}% uptime` : 'No telemetry'}</div>
            <div
                className={`inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest ${
                    listingOfferVerified ? 'text-cyan-300' : 'text-white/40'
                }`}
                title={proofTitle}
            >
                {listingOfferVerified ? <ShieldCheck size={9} /> : <ShieldAlert size={9} />}
                {listingOfferVerified ? 'Provider signed' : 'Unsigned offer'}
            </div>
        </div>
    );
}
