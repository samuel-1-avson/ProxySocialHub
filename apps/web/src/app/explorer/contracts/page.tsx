'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/Navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { API_BASE_URL } from '@/lib/services/client'; // Use base URL directly for simple fetch
import Link from 'next/link';
import {
    FileCode,
    CheckCircle,
    XCircle,
    Search,
    ChevronLeft,
    ChevronRight,
    Code2,
    ShieldCheck
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// Direct fetch for this simple page
async function getContracts(page = 1) {
    const res = await fetch(`${API_BASE_URL}/v1/explorer/contracts?page=${page}&page_size=20`);
    if (!res.ok) throw new Error('Failed to fetch contracts');
    return res.json();
}

export default function ContractsPage() {
    const [page, setPage] = useState(1);
    const pageSize = 20;

    const { data, isLoading } = useQuery({
        queryKey: ['contracts', page],
        queryFn: () => getContracts(page),
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
                                <FileCode className="text-pink-400" /> Smart Contracts
                            </h1>
                            <p className="text-gray-400 mt-2">
                                Verified programs running on the ProxyHub Network
                            </p>
                        </div>

                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search by address or name..."
                                className="bg-white/5 border border-white/10 rounded-full py-2 px-10 text-sm focus:outline-none focus:border-pink-500/50 w-64"
                            />
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
                        </div>
                    </div>

                    <GlassCard className="overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-white/10 text-left text-gray-400 text-sm">
                                        <th className="p-4 font-medium">Contract Name</th>
                                        <th className="p-4 font-medium">Address</th>
                                        <th className="p-4 font-medium">Type</th>
                                        <th className="p-4 font-medium text-center">Verified</th>
                                        <th className="p-4 font-medium text-right">Calls</th>
                                        <th className="p-4 font-medium text-right">Deployed</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {isLoading ? (
                                        Array.from({ length: 5 }).map((_, i) => (
                                            <tr key={i} className="animate-pulse">
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-32" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-48" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-24" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-16 mx-auto" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-16 ml-auto" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-24 ml-auto" /></td>
                                            </tr>
                                        ))
                                    ) : data?.contracts?.map((contract: any) => (
                                        <tr key={contract.address} className="hover:bg-white/5 transition-colors">
                                            <td className="p-4">
                                                <div className="font-medium text-white flex items-center gap-2">
                                                    <Code2 className="w-4 h-4 text-pink-400" />
                                                    {contract.name}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <Link href={`/explorer/contracts/${contract.address}`} className="font-mono text-cyan-400 hover:underline text-sm">
                                                    {contract.address.slice(0, 16)}...
                                                </Link>
                                            </td>
                                            <td className="p-4">
                                                <span className="px-2 py-1 rounded text-xs bg-white/5 text-gray-300 border border-white/10 uppercase">
                                                    {contract.contract_type}
                                                </span>
                                            </td>
                                            <td className="p-4 text-center">
                                                {contract.is_verified ? (
                                                    <div className="flex items-center justify-center gap-1 text-green-400 text-xs">
                                                        <ShieldCheck className="w-4 h-4" /> Verified
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center justify-center gap-1 text-gray-500 text-xs">
                                                        <XCircle className="w-4 h-4" /> Unverified
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4 text-right">
                                                <span className="font-mono">{contract.total_calls.toLocaleString()}</span>
                                            </td>
                                            <td className="p-4 text-right text-sm text-gray-400">
                                                {formatDistanceToNow(new Date(contract.deployed_at), { addSuffix: true })}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {data?.contracts?.length === 0 && (
                                <div className="p-12 text-center text-gray-500">No contracts found</div>
                            )}
                        </div>

                        {/* Pagination */}
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
