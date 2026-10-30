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
            className={`flex items-start gap-3 rounded-lg border border-warning/20 bg-warning/10 text-warning ${
                compact ? 'px-4 py-2.5 text-xs' : 'px-5 py-3 text-xs'
            } font-semibold  `}
        >
            <BarChart2 size={compact ? 14 : 16} className="shrink-0 mt-0.5 text-warning" />
            <span className="leading-relaxed normal-case tracking-normal text-warning/90">
                {message || DEFAULT_MESSAGE}
            </span>
        </div>
    );
}
