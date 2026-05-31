'use client';

import { Activity } from 'lucide-react';

export type ListingSlaSource = 'gateway' | 'explorer' | 'provider' | 'listing' | string | undefined;

interface Props {
    uptimePercent: number;
    slaSource?: ListingSlaSource;
    compact?: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
    gateway: 'Live SLA',
    explorer: 'Node SLA',
    provider: 'Provider SLA',
    listing: 'Listed SLA',
};

export function ListingSlaBadge({ uptimePercent, slaSource, compact }: Props) {
    const live = slaSource === 'gateway';
    const label = SOURCE_LABEL[slaSource || 'listing'] || 'SLA';
    const uptime = Number(uptimePercent || 0);
    const tone =
        uptime > 98 ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : uptime > 90
            ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
            : 'text-rose-400 border-rose-500/30 bg-rose-500/10';

    if (compact) {
        return (
            <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[7px] font-black uppercase tracking-wider border ${tone}`}
                title={`${uptime.toFixed(1)}% uptime · ${label}`}
            >
                <Activity size={8} />
                {uptime.toFixed(0)}%
                {live && <span className="text-emerald-300">live</span>}
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
            <div className="text-[11px] font-black tabular-nums">{uptime.toFixed(1)}% uptime</div>
        </div>
    );
}
