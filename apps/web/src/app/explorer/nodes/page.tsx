'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/Navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { getNodes } from '@/lib/services/explorer';
import {
    Server,
    MapPin,
    Activity,
    Shield,
    Cloud,
    ChevronLeft,
    ChevronRight,
    Globe
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function NodesPage() {
    const [page, setPage] = useState(1);
    const pageSize = 20;

    const { data, isLoading } = useQuery({
        queryKey: ['nodes', page],
        queryFn: () => getNodes(page, pageSize, true),
        refetchInterval: 30000,
    });

    return (
        <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
            <Navbar />

            <main className="container mx-auto px-4 py-8 mt-16">
                <div className="flex flex-col gap-8">

                    <div className="flex justify-between items-end">
                        <div>
                            <h1 className="text-3xl font-bold flex items-center gap-3">
                                <Server className="text-purple-400" /> Network Nodes
                            </h1>
                            <p className="text-gray-400 mt-2">
                                Active validators and proxy nodes powering the ProxyHub Network
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="text-2xl font-mono font-bold text-cyan-400">
                                {data?.active || '-'}
                            </div>
                            <div className="text-sm text-gray-500">Active Nodes</div>
                        </div>
                    </div>

                    <GlassCard className="overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-white/10 text-left text-gray-400 text-sm">
                                        <th className="p-4 font-medium">Node ID</th>
                                        <th className="p-4 font-medium">Location</th>
                                        <th className="p-4 font-medium">Type</th>
                                        <th className="p-4 font-medium text-center">Uptime</th>
                                        <th className="p-4 font-medium text-right">Bandwidth</th>
                                        <th className="p-4 font-medium text-right">Last Seen</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {isLoading ? (
                                        Array.from({ length: 10 }).map((_, i) => (
                                            <tr key={i} className="animate-pulse">
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-32" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-24" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-20" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-16 mx-auto" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-20 ml-auto" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-24 ml-auto" /></td>
                                            </tr>
                                        ))
                                    ) : data?.nodes?.map((node) => (
                                        <tr key={node.node_id} className="hover:bg-white/5 transition-colors">
                                            <td className="p-4">
                                                <div className="font-mono text-cyan-300 text-sm">
                                                    {node.node_id.slice(0, 12)}...
                                                </div>
                                                {node.name && <div className="text-xs text-gray-500">{node.name}</div>}
                                            </td>
                                            <td className="p-4">
                                                <div className="flex items-center gap-2 text-sm text-gray-300">
                                                    <MapPin className="w-3 h-3 text-gray-500" />
                                                    {node.country}, {node.region}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                {node.is_validator ? (
                                                    <span className="inline-flex items-center gap-1 text-xs text-purple-400 bg-purple-400/10 px-2 py-1 rounded-full">
                                                        <Shield className="w-3 h-3" /> Validator
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs text-blue-400 bg-blue-400/10 px-2 py-1 rounded-full">
                                                        <Cloud className="w-3 h-3" /> Proxy Node
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <div className="w-16 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                                                        <div
                                                            className={`h-full ${node.uptime_percent > 98 ? 'bg-green-500' : 'bg-yellow-500'}`}
                                                            style={{ width: `${node.uptime_percent}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-xs font-mono">{node.uptime_percent}%</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-right">
                                                <div className="font-mono text-white">{node.bandwidth_gb.toFixed(2)} GB</div>
                                                <div className="text-xs text-gray-500">{node.active_sessions} sessions</div>
                                            </td>
                                            <td className="p-4 text-right text-sm text-gray-400">
                                                {formatDistanceToNow(new Date(node.last_heartbeat), { addSuffix: true })}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination (Simplified) */}
                        <div className="p-4 border-t border-white/10 flex justify-between items-center">
                            <button
                                className="p-2 hover:bg-white/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                onClick={() => setPage(Math.max(1, page - 1))}
                                disabled={page === 1 || isLoading}
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <span className="text-sm text-gray-400">Page {page}</span>
                            <button
                                className="p-2 hover:bg-white/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                onClick={() => setPage(page + 1)}
                                disabled={data && page * pageSize >= data.total}
                            >
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                    </GlassCard>

                </div>
            </main>
        </div>
    );
}
