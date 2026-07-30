'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { motion } from 'framer-motion';
import {
    Server, Plus, Trash2, RefreshCw, Wifi, WifiOff, Clock,
    BarChart3, MapPin, Loader2, AlertCircle, CheckCircle2, Copy, Download
} from 'lucide-react';
import { ProviderNodeConnectPanel } from '@/components/provider/ProviderNodeConnectPanel';
import {
    getMyNodes, deleteNode, sendNodeHeartbeat,
    type NodeRegistration,
} from '@/lib/api/provider';
import Link from 'next/link';

export default function NodesPage() {
    const qc = useQueryClient();
    const [pinging, setPinging] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const [connectNodeId, setConnectNodeId] = useState<string | null>(null);

    const { data, isLoading, error } = useQuery({
        queryKey: ['my-nodes'],
        queryFn: getMyNodes,
        refetchInterval: 30_000,
    });

    const deleteMutation = useMutation({
        mutationFn: deleteNode,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['my-nodes'] }),
    });

    const nodes = data?.nodes ?? [];
    const online = nodes.filter((n) => n.status === 'online').length;
    const offline = nodes.filter((n) => n.status === 'offline').length;
    const pending = nodes.filter((n) => n.status === 'pending').length;

    async function pingNode(nodeId: string) {
        setPinging(nodeId);
        try {
            await sendNodeHeartbeat(nodeId);
            qc.invalidateQueries({ queryKey: ['my-nodes'] });
        } finally {
            setPinging(null);
        }
    }

    function copyId(id: string) {
        navigator.clipboard.writeText(id);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <Server size={14} />
                    Provider Infrastructure
                </div>
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">My Nodes</h1>
                    <Link
                        href="/dashboard/provider/setup"
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold uppercase tracking-wider hover:bg-primary/90 transition-colors"
                    >
                        <Plus size={14} />
                        Add Node
                    </Link>
                </div>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    MANAGE YOUR BANDWIDTH SHARING INFRASTRUCTURE.
                </p>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4">
                <GlassCard className="p-4" hoverEffect={false}>
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                            <Wifi size={16} className="text-emerald-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-black font-mono text-emerald-400">{online}</p>
                            <p className="text-[10px] font-mono uppercase text-muted-foreground">Online</p>
                        </div>
                    </div>
                </GlassCard>
                <GlassCard className="p-4" hoverEffect={false}>
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
                            <WifiOff size={16} className="text-red-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-black font-mono text-red-400">{offline}</p>
                            <p className="text-[10px] font-mono uppercase text-muted-foreground">Offline</p>
                        </div>
                    </div>
                </GlassCard>
                <GlassCard className="p-4" hoverEffect={false}>
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                            <Clock size={16} className="text-amber-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-black font-mono text-amber-400">{pending}</p>
                            <p className="text-[10px] font-mono uppercase text-muted-foreground">Pending</p>
                        </div>
                    </div>
                </GlassCard>
            </div>

            {/* Node list */}
            {isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="animate-spin text-primary w-8 h-8" />
                </div>
            ) : error ? (
                <GlassCard hoverEffect={false}>
                    <div className="text-center py-8">
                        <AlertCircle className="mx-auto w-12 h-12 text-red-400 mb-3 opacity-60" />
                        <p className="font-mono text-sm text-muted-foreground">Failed to load nodes.</p>
                    </div>
                </GlassCard>
            ) : nodes.length === 0 ? (
                <GlassCard hoverEffect={false}>
                    <div className="text-center py-12">
                        <Server className="mx-auto w-14 h-14 text-muted-foreground/20 mb-4" />
                        <p className="font-mono text-sm font-bold mb-2">No nodes registered</p>
                        <p className="font-mono text-xs text-muted-foreground mb-6">
                            Run the setup wizard or install the CLI to register your first node.
                        </p>
                        <div className="flex gap-3 justify-center">
                            <Link
                                href="/dashboard/provider/setup"
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold uppercase"
                            >
                                Setup Wizard
                            </Link>
                            <Link
                                href="/dashboard/provider/cli"
                                className="px-4 py-2 bg-white/10 rounded-xl font-mono text-xs font-bold uppercase"
                            >
                                Get CLI
                            </Link>
                        </div>
                    </div>
                </GlassCard>
            ) : (
                <div className="space-y-3">
                    {nodes.map((node, i) => (
                        <NodeCard
                            key={node.id}
                            node={node}
                            index={i}
                            pinging={pinging === node.id}
                            copied={copied === node.id}
                            connectOpen={connectNodeId === node.id}
                            onPing={() => pingNode(node.id)}
                            onCopy={() => copyId(node.id)}
                            onConnect={() =>
                                setConnectNodeId((id) => (id === node.id ? null : node.id))
                            }
                            onDelete={() => {
                                if (confirm(`Delete node "${node.name}"?`)) {
                                    deleteMutation.mutate(node.id);
                                }
                            }}
                            deleting={deleteMutation.isPending && deleteMutation.variables === node.id}
                        />
                    ))}
                </div>
            )}

            {/* Footer hint */}
            {nodes.length > 0 && (
                <p className="text-center text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">
                    Nodes refresh every 30s · Browser ping is not a real tunnel — use Connect + CLI start
                </p>
            )}
        </div>
    );
}

function NodeCard({
    node, index, pinging, copied, connectOpen, onPing, onCopy, onConnect, onDelete, deleting,
}: {
    node: NodeRegistration;
    index: number;
    pinging: boolean;
    copied: boolean;
    connectOpen: boolean;
    onPing: () => void;
    onCopy: () => void;
    onConnect: () => void;
    onDelete: () => void;
    deleting: boolean;
}) {
    const online = node.status === 'online';
    const pending = node.status === 'pending';
    const needsConnect = pending || !online;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.3 }}
            className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors"
        >
            {needsConnect && (
                <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 flex flex-wrap items-center gap-2 justify-between">
                    <p className="text-[10px] font-mono text-amber-200/90">
                        Needs CLI tunnel. Download config, then start — do not register again.
                    </p>
                    <div className="flex gap-2">
                        <button type="button" onClick={onConnect} className="px-2 py-1 rounded-lg bg-primary/15 text-primary text-[9px] font-bold uppercase">
                            Connect
                        </button>
                        <Link href="/dashboard/provider/cli" className="px-2 py-1 rounded-lg bg-white/10 text-[9px] font-bold uppercase text-muted-foreground">CLI</Link>
                        <Link href="/dashboard/provider/health" className="px-2 py-1 rounded-lg bg-white/10 text-[9px] font-bold uppercase text-muted-foreground">Diagnostics</Link>
                        <Link href="/dashboard/provider/earnings" className="px-2 py-1 rounded-lg bg-white/10 text-[9px] font-bold uppercase text-muted-foreground">Income</Link>
                    </div>
                </div>
            )}
            <div className="flex items-start justify-between gap-4">
                {/* Left: status + name */}
                <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                        online
                            ? 'bg-emerald-500/10 border-emerald-500/20'
                            : pending
                            ? 'bg-amber-500/10 border-amber-500/20'
                            : 'bg-red-500/10 border-red-500/20'
                    }`}>
                        <Server size={16} className={
                            online ? 'text-emerald-400' : pending ? 'text-amber-400' : 'text-red-400'
                        } />
                    </div>
                    <div className="min-w-0">
                        <p className="font-bold font-mono text-sm truncate">{node.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[9px] font-mono uppercase font-black px-2 py-0.5 rounded-full ${
                                online
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : pending
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : 'bg-red-500/20 text-red-400'
                            }`}>
                                {node.status}
                            </span>
                            <span
                                className={`text-[9px] font-mono uppercase font-black px-2 py-0.5 rounded-full ${
                                    node.latest_heartbeat_verified
                                        ? 'bg-emerald-500/15 text-emerald-400'
                                        : node.latest_heartbeat_verification_error
                                        ? 'bg-red-500/15 text-red-400'
                                        : 'bg-blue-500/15 text-blue-300'
                                }`}
                                title={
                                    node.latest_heartbeat_verified
                                        ? `Heartbeat proof verified${node.latest_heartbeat_signer ? ` by ${node.latest_heartbeat_signer}` : ''}`
                                        : node.latest_heartbeat_verification_error || 'Heartbeat proof not configured yet'
                                }
                            >
                                {node.latest_heartbeat_verified
                                    ? 'proof ok'
                                    : node.latest_heartbeat_verification_error
                                    ? 'proof error'
                                    : 'unsigned'}
                            </span>
                            {node.country && (
                                <span className="text-[9px] font-mono text-muted-foreground flex items-center gap-1">
                                    <MapPin size={8} />
                                    {node.city ? `${node.city}, ` : ''}{node.country}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right: metrics */}
                <div className="hidden md:flex items-center gap-6 text-xs font-mono text-muted-foreground">
                    <div className="text-center">
                        <p className="text-white font-bold">{node.uptime_percent?.toFixed(1) ?? '—'}%</p>
                        <p className="text-[9px] uppercase tracking-wider">Uptime</p>
                    </div>
                    <div className="text-center">
                        <p className="text-white font-bold">{node.quality_score?.toFixed(0) ?? '—'}</p>
                        <p className="text-[9px] uppercase tracking-wider">Score</p>
                    </div>
                    <div className="text-center">
                        <p className="text-white font-bold">{node.active_connections ?? 0}</p>
                        <p className="text-[9px] uppercase tracking-wider">Conns</p>
                    </div>
                    {node.latency_ms != null && (
                        <div className="text-center">
                            <p className="text-white font-bold">{node.latency_ms}ms</p>
                            <p className="text-[9px] uppercase tracking-wider">Latency</p>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={onConnect}
                        title="Download connection config"
                        className={`p-2 rounded-lg transition-colors ${
                            connectOpen
                                ? 'bg-primary/20 text-primary'
                                : 'hover:bg-white/10 text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <Download size={14} />
                    </button>
                    <button
                        onClick={onCopy}
                        title="Copy node ID"
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
                    >
                        {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    </button>
                    <button
                        onClick={onPing}
                        disabled={pinging}
                        title="Browser ping (not a real tunnel)"
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                        {pinging ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    </button>
                    <button
                        onClick={onDelete}
                        disabled={deleting}
                        title="Delete node"
                        className="p-2 rounded-lg hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-400 disabled:opacity-50"
                    >
                        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                </div>
            </div>

            {/* Node ID */}
            <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2">
                <BarChart3 size={10} className="text-muted-foreground/40" />
                <p className="text-[9px] font-mono text-muted-foreground/40 truncate">ID: {node.id}</p>
                {node.ip_address && (
                    <p className="text-[9px] font-mono text-muted-foreground/40 ml-auto">
                        {node.ip_address}
                    </p>
                )}
            </div>

            {(connectOpen || needsConnect) && (
                <div className="mt-3">
                    <ProviderNodeConnectPanel nodeId={node.id} nodeName={node.name} compact />
                </div>
            )}
        </motion.div>
    );
}
