'use client';

/**
 * GlobeMap — Interactive 3D WebGL node globe (Phase 3).
 * Assets are self-hosted under /map-assets/; labels derive from live pin clusters.
 */

import { Loader2, RefreshCw } from 'lucide-react';
import GlobeScene from './globe/GlobeScene';
import { useGlobeAssets } from './globe/useGlobeAssets';
import type { GlobeMapProps, MapStyle } from './globe/types';

export type { MapStyle } from './globe/types';

export default function GlobeMap(props: GlobeMapProps) {
    const mapStyle: MapStyle = props.mapStyle ?? 'satellite';
    const assets = useGlobeAssets(mapStyle);

    if (assets.status === 'loading') {
        return (
            <div
                className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#050508]"
                data-testid="explorer-globe-loading"
            >
                <Loader2 className="animate-spin text-primary" size={28} />
                <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">
                    Loading globe assets…
                </p>
            </div>
        );
    }

    if (assets.status === 'error') {
        return (
            <div
                className="w-full h-full flex flex-col items-center justify-center gap-4 bg-[#050508] px-6 text-center"
                data-testid="explorer-globe-error"
            >
                <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest">
                    Globe assets failed to load
                </p>
                <p className="text-[9px] text-white/40 max-w-sm">{assets.message}</p>
                <button
                    type="button"
                    onClick={assets.retry}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 bg-white/5 text-[9px] font-black uppercase tracking-widest text-white/70 hover:text-white"
                >
                    <RefreshCw size={12} />
                    Retry
                </button>
            </div>
        );
    }

    return <GlobeScene {...props} mapStyle={mapStyle} countries={assets.countries} />;
}
