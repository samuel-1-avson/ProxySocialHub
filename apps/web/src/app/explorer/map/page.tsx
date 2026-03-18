'use client';

/**
 * Node Map Page — Proxy Explorer
 *
 * Data flow:
 *  1. GET /v1/explorer/nodes/geo  → lightweight geo array → 3D globe
 *  2. WS  /v1/explorer/ws        → node_update events   → merge into local node map
 *  3. Globe rotate / zoom        → Three.js handles rendering
 *  4. Heatmap toggle             → hex-bin session density layer
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { getNodeGeo, type NodeGeoPoint } from '@/lib/services/explorer';
import { useExplorerWS } from '@/lib/hooks/useExplorerWS';
import type { MapNodeUpdate } from './LeafletMap';
import type { MapStyle } from './GlobeMap';
import {
    ArrowLeft, Globe, MapPin, Server, Shield,
    Radio, Activity, RefreshCw, Layers, Zap, Satellite, Mountain, Map,
} from 'lucide-react';
import { motion } from 'framer-motion';

const GlobeMap = dynamic(() => import('./GlobeMap'), {
    ssr: false,
    loading: () => (
        <div className="w-full h-full flex items-center justify-center bg-[#050508]">
            <div className="text-[10px] font-black text-white/20 uppercase tracking-widest animate-pulse">
                Initialising 3D globe…
            </div>
        </div>
    ),
});

// ─── Fallback coordinates (used only when backend lat/lon = 0) ────────────────
// These place nodes at country / region centres. Real coordinates come from
// the GeoIP backfill worker once it has resolved an IP.

const COUNTRY_COORDS: Record<string, [number, number]> = {
    'US': [38, -97], 'United States': [38, -97], 'USA': [38, -97],
    'CA': [56, -106], 'Canada': [56, -106],
    'MX': [23, -102], 'Mexico': [23, -102],
    'GB': [52, -1], 'United Kingdom': [52, -1], 'UK': [52, -1],
    'DE': [51, 10], 'Germany': [51, 10],
    'FR': [46, 2], 'France': [46, 2],
    'NL': [52, 5], 'Netherlands': [52, 5],
    'SE': [60, 15], 'Sweden': [60, 15],
    'NO': [64, 15], 'Norway': [64, 15],
    'FI': [64, 26], 'Finland': [64, 26],
    'CH': [47, 8], 'Switzerland': [47, 8],
    'PL': [52, 20], 'Poland': [52, 20],
    'UA': [49, 32], 'Ukraine': [49, 32],
    'TR': [39, 35], 'Turkey': [39, 35],
    'ES': [40, -4], 'Spain': [40, -4],
    'IT': [42, 12], 'Italy': [42, 12],
    'PT': [39, -8], 'Portugal': [39, -8],
    'RO': [45, 25], 'Romania': [45, 25],
    'CZ': [50, 15], 'Czech Republic': [50, 15],
    'AT': [47, 14], 'Austria': [47, 14],
    'BE': [51, 4], 'Belgium': [51, 4],
    'GR': [39, 22], 'Greece': [39, 22],
    'DK': [56, 10], 'Denmark': [56, 10],
    'IE': [53, -8], 'Ireland': [53, -8],
    'HU': [47, 20], 'Hungary': [47, 20],
    'RU': [60, 90], 'Russia': [60, 90],
    'JP': [35, 135], 'Japan': [35, 135],
    'SG': [1, 104], 'Singapore': [1, 104],
    'HK': [22, 114], 'Hong Kong': [22, 114],
    'KR': [37, 127], 'South Korea': [37, 127],
    'IN': [20, 77], 'India': [20, 77],
    'CN': [35, 103], 'China': [35, 103],
    'AU': [-25, 133], 'Australia': [-25, 133],
    'NZ': [-40.9, 174.9], 'New Zealand': [-40.9, 174.9],
    'BR': [-10, -55], 'Brazil': [-10, -55],
    'AR': [-34, -64], 'Argentina': [-34, -64],
    'ZA': [-29, 25], 'South Africa': [-29, 25],
    'NG': [9, 8], 'Nigeria': [9, 8],
    'AE': [24, 54], 'UAE': [24, 54],
    'IL': [31, 35], 'Israel': [31, 35],
    'ID': [-5, 120], 'Indonesia': [-5, 120],
    'TH': [13, 101], 'Thailand': [13, 101],
    'VN': [14, 108], 'Vietnam': [14, 108],
    'MY': [3, 109], 'Malaysia': [3, 109],
    'PH': [13, 122], 'Philippines': [13, 122],
};

const REGION_COORDS: Record<string, [number, number]> = {
    'us-east': [39, -77], 'us-west': [37, -122], 'eu-west': [51, 0],
    'eu-central': [50, 10], 'ap-southeast': [1, 104], 'ap-northeast': [35, 135],
    'sa-east': [-23, -46], 'af-south': [-29, 25], 'me-south': [24, 54],
    'north-america': [45, -100], 'europe': [50, 10], 'asia': [25, 90],
    'oceania': [-25, 133], 'south-america': [-15, -60], 'africa': [5, 20],
};

function resolveCoords(n: NodeGeoPoint): NodeGeoPoint {
    if (Math.abs(n.lat) > 0.01 || Math.abs(n.lon) > 0.01) return n;
    if (n.country) {
        const c = COUNTRY_COORDS[n.country];
        if (c) return { ...n, lat: c[0], lon: c[1] };
    }
    if (n.region) {
        const lc = n.region.toLowerCase();
        for (const [k, v] of Object.entries(REGION_COORDS)) {
            if (lc.includes(k) || k.includes(lc)) return { ...n, lat: v[0], lon: v[1] };
        }
    }
    return n; // no coords — still included, supercluster will filter lat/lon ~0
}

// ─── Animations ───────────────────────────────────────────────────────────────

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NodeMapPage() {
    const [mounted, setMounted] = useState(false);
    const [selectedNode, setSelectedNode] = useState<NodeGeoPoint | null>(null);
    const [showValidatorsOnly, setShowValidatorsOnly] = useState(false);
    const [showActiveOnly, setShowActiveOnly] = useState(false);
    const [selectedRegion, setSelectedRegion] = useState<string>('all');
    const [showHeatmap, setShowHeatmap] = useState(false);
    const [mapStyle, setMapStyle] = useState<MapStyle>('minimal');
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [wsConnected, setWsConnected] = useState(false);

    // Accumulate WS node_update events; flushed to LeafletMap as a batch
    const pendingUpdatesRef = useRef<MapNodeUpdate[]>([]);
    const [liveUpdates, setLiveUpdates] = useState<MapNodeUpdate[]>([]);

    useEffect(() => { setMounted(true); }, []);

    // ── Fetch lightweight geo data ──
    const { data: geoData, isLoading, error, refetch } = useQuery({
        queryKey: ['nodes-geo', showActiveOnly, showValidatorsOnly],
        queryFn: () => getNodeGeo(showActiveOnly, showValidatorsOnly),
        refetchInterval: 60_000,   // background refresh every 60s
        staleTime: 15_000,
        retry: 3,
    });

    useEffect(() => {
        if (geoData && !isLoading) setLastUpdated(new Date());
    }, [geoData, isLoading]);

    // ── WebSocket — subscribe only to node updates ──
    useExplorerWS({
        enabled: mounted,
        topics: ['nodes'],
        onNodeUpdate: useCallback((data: any) => {
            const upd: MapNodeUpdate = {
                node_id: data.node_id,
                is_active: data.is_active,
                uptime_percent: data.uptime_percent,
                active_sessions: data.active_sessions,
                lat: data.lat,
                lon: data.lon,
            };
            pendingUpdatesRef.current.push(upd);
            // Batch-flush to avoid re-render per event
            setLiveUpdates(prev => [...prev.slice(-200), upd]);
        }, []),
        onInitial: useCallback(() => {
            setWsConnected(true);
        }, []),
    });

    // ── Resolve coords + apply filters ──
    const nodes = useMemo(() => {
        let list = (geoData?.nodes ?? []).map(resolveCoords);
        if (selectedRegion !== 'all') {
            list = list.filter(n =>
                n.region === selectedRegion || n.country === selectedRegion
            );
        }
        return list;
    }, [geoData?.nodes, selectedRegion]);

    const totalActive = nodes.filter(n => n.is_active).length;
    const totalValidator = nodes.filter(n => n.is_validator).length;
    const mappedCount = nodes.filter(n => Math.abs(n.lat) > 0.01 || Math.abs(n.lon) > 0.01).length;
    const unmapped = nodes.length - mappedCount;

    // ── Auto-zoom bounds when a region is selected ──
    const focusBounds = useMemo((): [[number, number], [number, number]] | null => {
        if (selectedRegion === 'all') return null;
        const inBounds = nodes.filter(n => Math.abs(n.lat) > 0.01 || Math.abs(n.lon) > 0.01);
        if (inBounds.length === 0) return null;
        const lats = inBounds.map(n => n.lat);
        const lons = inBounds.map(n => n.lon);
        return [
            [Math.min(...lats) - 3, Math.min(...lons) - 3],
            [Math.max(...lats) + 3, Math.max(...lons) + 3],
        ];
    }, [nodes, selectedRegion]);

    // ── Region breakdown ──
    const regionBreakdown = useMemo(() => {
        const acc: Record<string, number> = {};
        for (const n of geoData?.nodes ?? []) {
            const k = n.region || n.country || 'Unknown';
            acc[k] = (acc[k] || 0) + 1;
        }
        return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 12);
    }, [geoData?.nodes]);

    const handleSelectNode = useCallback((node: NodeGeoPoint) => setSelectedNode(node), []);

    return (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-8 font-mono">

            {/* ── Header ── */}
            <motion.header variants={item} className="flex flex-col gap-6 border-b border-white/5 pb-8">
                <Link href="/explorer" className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary transition-colors uppercase tracking-[0.3em] w-fit">
                    <ArrowLeft size={14} /> Back to Grid
                </Link>
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
                    <div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // 3D Globe</div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-4">
                            <Globe className="text-primary" size={32} /> Node Globe
                        </h1>
                        <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mt-2">
                            Live global relay node distribution · WebGL 3D globe
                        </p>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        {[
                            { label: 'Total', value: nodes.length, color: 'text-white' },
                            { label: 'Active', value: totalActive, color: 'text-emerald-400' },
                            { label: 'Validators', value: totalValidator, color: 'text-purple-400' },
                            { label: 'Plotted', value: mappedCount, color: 'text-primary' },
                        ].map(s => (
                            <GlassCard key={s.label} className="!p-4 border-white/5 bg-white/[0.01] rounded-2xl text-center min-w-[72px]">
                                <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
                                <div className="text-[8px] font-black text-white/30 uppercase tracking-widest mt-0.5">{s.label}</div>
                            </GlassCard>
                        ))}
                    </div>
                </div>

                {/* Status bar */}
                <div className="flex items-center gap-4 text-[9px] font-bold uppercase tracking-wider flex-wrap">
                    <div className={`flex items-center gap-2 ${error ? 'text-rose-400' : isLoading ? 'text-amber-400' : 'text-emerald-400'}`}>
                        <div className={`w-2 h-2 rounded-full ${error ? 'bg-rose-500 animate-pulse' : isLoading ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                        {error ? 'Disconnected' : isLoading ? 'Syncing…' : 'Live'}
                    </div>
                    <div className={`flex items-center gap-2 ${wsConnected ? 'text-blue-400' : 'text-white/20'}`}>
                        <Zap size={9} /> {wsConnected ? 'WS Connected' : 'WS Connecting…'}
                    </div>
                    {lastUpdated && <span className="text-white/20">Updated {lastUpdated.toLocaleTimeString()}</span>}
                    <button onClick={() => refetch()} className="flex items-center gap-1.5 text-white/20 hover:text-primary transition-colors">
                        <RefreshCw size={10} /> Refresh
                    </button>
                </div>
            </motion.header>

            {/* ── Map + Sidebar ── */}
            <motion.div variants={item} className="grid grid-cols-1 xl:grid-cols-4 gap-6">

                {/* Map */}
                <div className="xl:col-span-3">
                    <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] overflow-hidden !p-0">
                        {/* Toolbar */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-3 border-b border-white/5 gap-3 flex-wrap">
                            <div className="flex items-center gap-3">
                                <Radio size={13} className={`text-primary ${isLoading ? 'animate-pulse' : ''}`} />
                                <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">
                                    {isLoading
                                        ? 'Fetching nodes…'
                                        : error
                                            ? 'Load failed'
                                            : `${mappedCount} of ${nodes.length} nodes plotted`}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    value={selectedRegion}
                                    onChange={e => setSelectedRegion(e.target.value)}
                                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[9px] font-bold text-white/70 uppercase tracking-wider focus:outline-none focus:border-primary/50"
                                >
                                    <option value="all">All Regions</option>
                                    {regionBreakdown.map(([r]) => <option key={r} value={r}>{r}</option>)}
                                </select>
                                <button
                                    onClick={() => setShowValidatorsOnly(v => !v)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-bold uppercase tracking-wider transition-all ${showValidatorsOnly ? 'bg-purple-500/20 border-purple-500/50 text-purple-400' : 'bg-white/5 border-white/10 text-white/50 hover:text-white/70'}`}
                                >
                                    <Shield size={9} /> Validators
                                </button>
                                <button
                                    onClick={() => setShowActiveOnly(v => !v)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-bold uppercase tracking-wider transition-all ${showActiveOnly ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-white/5 border-white/10 text-white/50 hover:text-white/70'}`}
                                >
                                    <Activity size={9} /> Active Only
                                </button>
                            </div>
                            {/* Legend */}
                            <div className="flex items-center gap-3">
                                {[
                                    { color: 'bg-emerald-500', label: 'Active' },
                                    { color: 'bg-purple-500', label: 'Validator' },
                                    { color: 'bg-rose-500', label: 'Offline' },
                                ].map(l => (
                                    <div key={l.label} className="flex items-center gap-1.5">
                                        <div className={`w-2 h-2 rounded-full ${l.color}`} />
                                        <span className="text-[8px] font-black text-white/30 uppercase hidden sm:block">{l.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Globe canvas */}
                        <div style={{ height: '680px' }} className="relative bg-[#050508]">
                            {mounted && (
                                <GlobeMap
                                    nodes={nodes}
                                    onSelectNode={handleSelectNode}
                                    selectedNodeId={selectedNode?.node_id}
                                    showHeatmap={showHeatmap}
                                    mapStyle={mapStyle}
                                    focusBounds={focusBounds}
                                    liveUpdates={liveUpdates}
                                />
                            )}

                            {/* Error overlay */}
                            {error && (
                                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 px-5 py-3 bg-[#0a0a15]/90 border border-rose-500/40 rounded-2xl backdrop-blur-sm shadow-xl">
                                    <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse flex-shrink-0" />
                                    <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest whitespace-nowrap">API Unavailable</span>
                                    <button onClick={() => refetch()} className="ml-2 px-2 py-1 bg-rose-500/15 border border-rose-500/30 rounded-lg text-[8px] font-black text-rose-400 uppercase tracking-wider hover:bg-rose-500/25 transition-all">
                                        Retry
                                    </button>
                                </div>
                            )}

                            {/* Empty state */}
                            {!isLoading && !error && nodes.length === 0 && (
                                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2 px-6 py-4 bg-[#0a0a15]/90 border border-white/10 rounded-2xl backdrop-blur-sm text-center max-w-xs">
                                    <Globe size={20} className="text-white/20" />
                                    <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">
                                        {selectedRegion !== 'all' || showValidatorsOnly || showActiveOnly
                                            ? 'No nodes match filters'
                                            : 'No nodes registered yet'}
                                    </p>
                                    {(selectedRegion !== 'all' || showValidatorsOnly || showActiveOnly) && (
                                        <button
                                            onClick={() => { setSelectedRegion('all'); setShowValidatorsOnly(false); setShowActiveOnly(false); }}
                                            className="px-3 py-1 bg-primary/10 border border-primary/20 rounded-lg text-[8px] font-black text-primary uppercase tracking-widest hover:bg-primary/20 transition-all">
                                            Clear Filters
                                        </button>
                                    )}
                                </div>
                            )}

                            {isLoading && (
                                <div className="absolute top-4 right-4 z-[1000] flex items-center gap-2 px-3 py-2 bg-[#0a0a15]/80 border border-white/10 rounded-xl backdrop-blur-sm">
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                    <span className="text-[8px] font-black text-white/40 uppercase tracking-widest">Syncing…</span>
                                </div>
                            )}
                        </div>
                    </GlassCard>
                </div>

                {/* Sidebar */}
                <div className="xl:col-span-1 space-y-4">
                    {/* Selected node card */}
                    {selectedNode ? (
                        <GlassCard className="border-primary/20 bg-primary/[0.02] rounded-[2rem] !p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black text-primary uppercase tracking-widest">Selected Node</span>
                                <button onClick={() => setSelectedNode(null)} className="text-white/20 hover:text-white text-xs">✕</button>
                            </div>
                            <div className="space-y-1.5">
                                {[
                                    { label: 'Node ID', value: `${selectedNode.node_id.slice(0, 14)}…`, mono: true },
                                    { label: 'Status', value: selectedNode.is_active ? '● Active' : '○ Offline', color: selectedNode.is_active ? 'text-emerald-400' : 'text-rose-400' },
                                    { label: 'Type', value: selectedNode.is_validator ? '⬡ Validator' : '◎ Proxy', color: selectedNode.is_validator ? 'text-purple-400' : 'text-blue-400' },
                                    { label: 'Country', value: selectedNode.country || '—' },
                                    { label: 'Region', value: selectedNode.region || '—' },
                                    { label: 'City', value: selectedNode.city || '—' },
                                    { label: 'ISP', value: selectedNode.isp || '—' },
                                    { label: 'Uptime', value: `${(selectedNode.uptime_percent || 0).toFixed(2)}%` },
                                    { label: 'Sessions', value: String(selectedNode.active_sessions || 0) },
                                    {
                                        label: 'Coords',
                                        value: (Math.abs(selectedNode.lat) > 0.01)
                                            ? `${selectedNode.lat.toFixed(3)}, ${selectedNode.lon.toFixed(3)}`
                                            : 'Estimated',
                                    },
                                ].map(f => (
                                    <div key={f.label} className="flex justify-between items-center py-1 border-b border-white/[0.04]">
                                        <span className="text-[8px] font-black text-white/30 uppercase tracking-wider">{f.label}</span>
                                        <span className={`text-[9px] font-black truncate max-w-[120px] ${(f as any).color || ((f as any).mono ? 'text-primary font-mono' : 'text-white')}`}>
                                            {f.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <Link href={`/explorer/nodes/${selectedNode.node_id}`}
                                className="block w-full text-center py-2 rounded-xl bg-primary/10 border border-primary/20 text-primary text-[9px] font-black uppercase tracking-widest hover:bg-primary/20 transition-all">
                                Full Details →
                            </Link>
                        </GlassCard>
                    ) : (
                        <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] !p-6 text-center">
                            <MapPin size={32} className="mx-auto text-white/10 mb-3" />
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-widest leading-relaxed">
                                Click any node marker to inspect it
                            </p>
                        </GlassCard>
                    )}

                    {/* Map controls */}
                    <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] !p-5 space-y-4">
                        <div className="text-[9px] font-black text-white/40 uppercase tracking-widest flex items-center gap-2">
                            <Layers size={10} /> Globe Controls
                        </div>

                        {/* Map style switcher */}
                        <div>
                            <p className="text-[8px] font-black text-white/25 uppercase tracking-widest mb-2">Map Style</p>
                            <div className="grid grid-cols-3 gap-1.5">
                                {([
                                    { id: 'satellite', label: 'Satellite', icon: <Satellite size={9} /> },
                                    { id: 'terrain',   label: 'Terrain',   icon: <Mountain size={9} /> },
                                    { id: 'minimal',   label: 'Minimal',   icon: <Map size={9} /> },
                                ] as { id: MapStyle; label: string; icon: React.ReactNode }[]).map(s => (
                                    <button
                                        key={s.id}
                                        onClick={() => setMapStyle(s.id)}
                                        className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl border text-[8px] font-bold uppercase tracking-wider transition-all ${
                                            mapStyle === s.id
                                                ? 'bg-primary/20 border-primary/50 text-primary'
                                                : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
                                        }`}
                                    >
                                        {s.icon}
                                        <span>{s.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Hex-bin heatmap toggle */}
                        <button
                            onClick={() => setShowHeatmap(h => !h)}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-[9px] font-bold uppercase tracking-wider transition-all ${showHeatmap ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' : 'bg-white/5 border-white/10 text-white/50 hover:text-white/70'}`}
                        >
                            <span>Session Hex Density</span>
                            <div className={`w-8 h-4 rounded-full transition-all relative ${showHeatmap ? 'bg-indigo-500' : 'bg-white/20'}`}>
                                <div className={`absolute top-0 w-4 h-4 rounded-full bg-white transition-transform ${showHeatmap ? 'translate-x-4' : 'translate-x-0'}`} />
                            </div>
                        </button>
                        {/* Legend */}
                        <div className="space-y-2">
                            {[
                                { color: 'bg-emerald-500', label: 'Active Proxy', desc: 'Online, serving traffic' },
                                { color: 'bg-purple-500', label: 'Validator', desc: 'High-stake validator node' },
                                { color: 'bg-rose-500', label: 'Offline', desc: 'No recent heartbeat' },
                                { color: 'bg-amber-400', label: 'Selected', desc: 'Pulsing ring animation' },
                                { color: 'bg-indigo-500', label: 'Hex Density', desc: 'Session weight columns' },
                            ].map(i => (
                                <div key={i.label} className="flex items-start gap-2">
                                    <div className={`w-2.5 h-2.5 rounded-full ${i.color} mt-0.5 flex-shrink-0`} />
                                    <div>
                                        <span className="text-[8px] font-black text-white/60 uppercase">{i.label}</span>
                                        <p className="text-[7px] text-white/25">{i.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </GlassCard>

                    {/* Region breakdown */}
                    <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] !p-5">
                        <div className="text-[9px] font-black text-white/40 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <Globe size={10} /> Region Distribution
                        </div>
                        {regionBreakdown.length === 0 ? (
                            <p className="text-[8px] font-black text-white/20 uppercase tracking-widest text-center py-4">No nodes yet</p>
                        ) : (
                            <div className="space-y-1.5 max-h-52 overflow-y-auto">
                                {regionBreakdown.map(([region, count]) => {
                                    const total = geoData?.nodes?.length ?? 1;
                                    return (
                                        <div key={region}
                                            className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-1 py-1 rounded transition-colors"
                                            onClick={() => setSelectedRegion(selectedRegion === region ? 'all' : region)}>
                                            <div className="flex-1 bg-white/[0.03] rounded-full h-1.5 overflow-hidden">
                                                <div className={`h-full rounded-full transition-all ${selectedRegion === region ? 'bg-amber-400' : 'bg-primary'}`}
                                                    style={{ width: `${(count / total) * 100}%` }} />
                                            </div>
                                            <span className={`text-[8px] font-black uppercase w-20 text-right truncate ${selectedRegion === region ? 'text-amber-400' : 'text-white/40'}`}>{region}</span>
                                            <span className="text-[8px] font-black text-white w-4 text-right">{count}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {selectedRegion !== 'all' && (
                            <button onClick={() => setSelectedRegion('all')}
                                className="mt-3 w-full text-center text-[8px] font-bold text-primary hover:text-primary/80 uppercase tracking-wider transition-colors">
                                Clear Filter ✕
                            </button>
                        )}
                    </GlassCard>

                    {unmapped > 0 && (
                        <div className="text-[8px] font-black text-amber-400/60 uppercase tracking-widest text-center px-3 py-2.5 bg-amber-500/5 rounded-xl border border-amber-500/10 leading-relaxed">
                            ⚠ {unmapped} node{unmapped > 1 ? 's' : ''} missing GPS
                            <p className="text-[7px] text-white/20 normal-case mt-0.5 font-normal">GeoIP backfill will resolve these automatically</p>
                        </div>
                    )}
                </div>
            </motion.div>

            {/* ── Node table ── */}
            <motion.section variants={item}>
                <h2 className="text-sm font-black uppercase tracking-tighter text-white flex items-center gap-2 mb-4">
                    <Server size={14} className="text-primary" /> Located Nodes
                    {mappedCount > 0 && <span className="text-[9px] font-bold text-white/30 ml-1">({mappedCount} with coordinates)</span>}
                </h2>
                <GlassCard className="overflow-hidden border-white/5 bg-white/[0.01] rounded-[2rem]">
                    {nodes.length === 0 ? (
                        <div className="py-16 text-center">
                            <Server size={40} className="text-white/5 mx-auto mb-4" />
                            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">No nodes registered</p>
                            <p className="text-[8px] text-white/10 max-w-xs mx-auto">
                                Nodes appear here once providers join the network with location data.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-white/5 text-white/40 text-[9px] uppercase tracking-[0.2em] font-black">
                                        <th className="px-5 py-3">Node</th>
                                        <th className="px-5 py-3">Type</th>
                                        <th className="px-5 py-3">Location</th>
                                        <th className="px-5 py-3">ISP</th>
                                        <th className="px-5 py-3 text-right">Uptime</th>
                                        <th className="px-5 py-3 text-right">Sessions</th>
                                        <th className="px-5 py-3 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.04]">
                                    {nodes.slice(0, 100).map((n) => (
                                        <tr key={n.node_id}
                                            onClick={() => setSelectedNode(n)}
                                            className={`hover:bg-white/[0.03] transition-colors cursor-pointer ${selectedNode?.node_id === n.node_id ? 'bg-primary/5' : ''}`}>
                                            <td className="px-5 py-2.5">
                                                <Link href={`/explorer/nodes/${n.node_id}`}
                                                    className="font-mono text-primary hover:text-primary/80 text-[10px] font-bold"
                                                    onClick={e => e.stopPropagation()}>
                                                    {n.node_id.slice(0, 14)}…
                                                </Link>
                                            </td>
                                            <td className="px-5 py-2.5">
                                                <span className={`text-[8px] font-black px-2 py-0.5 rounded-md uppercase ${n.is_validator ? 'text-purple-400 bg-purple-400/10' : 'text-blue-400 bg-blue-400/10'}`}>
                                                    {n.is_validator ? 'Validator' : 'Proxy'}
                                                </span>
                                            </td>
                                            <td className="px-5 py-2.5">
                                                <div className="flex items-center gap-1.5">
                                                    <MapPin size={8} className="text-white/20 flex-shrink-0" />
                                                    <span className="text-[9px] text-white/60">
                                                        {[n.city, n.country || n.region].filter(Boolean).join(', ') || '—'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-5 py-2.5">
                                                <span className="text-[9px] text-white/40">{n.isp || '—'}</span>
                                            </td>
                                            <td className="px-5 py-2.5 text-right font-mono text-[10px] font-black text-white">
                                                {(n.uptime_percent || 0).toFixed(1)}%
                                            </td>
                                            <td className="px-5 py-2.5 text-right font-mono text-[10px] font-black text-white">
                                                {n.active_sessions}
                                            </td>
                                            <td className="px-5 py-2.5 text-center">
                                                <span className={`inline-block w-2 h-2 rounded-full ${n.is_active ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </GlassCard>
            </motion.section>
        </motion.div>
    );
}
