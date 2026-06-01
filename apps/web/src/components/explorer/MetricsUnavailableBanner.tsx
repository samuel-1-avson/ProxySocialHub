'use client';

import { BarChart2 } from 'lucide-react';

const DEFAULT_MESSAGE =
    'Time-series metrics are still aggregating. Charts use live snapshot totals until hourly rollups exist.';

type MetricsUnavailableBannerProps = {
    message?: string;
    compact?: boolean;
};

export function MetricsUnavailableBanner({ message, compact }: MetricsUnavailableBannerProps) {
    return (
        <div
            className={`flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-400 ${
                compact ? 'px-4 py-2.5 text-[9px]' : 'px-5 py-3 text-[10px]'
            } font-black uppercase tracking-widest`}
        >
            <BarChart2 size={compact ? 14 : 16} className="shrink-0 mt-0.5 text-amber-500" />
            <span className="leading-relaxed normal-case tracking-normal text-amber-200/90">
                {message || DEFAULT_MESSAGE}
            </span>
        </div>
    );
}
