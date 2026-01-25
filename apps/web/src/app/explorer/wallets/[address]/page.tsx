'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/Navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { getWalletDetails, getWalletTransactions } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    Wallet,
    ArrowRightLeft,
    ChevronLeft,
    ChevronRight,
    Copy,
    ExternalLink,
    QrCode,
    Layers,
    CheckCircle,
    Clock
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useParams } from 'next/navigation';

export default function WalletInspectorPage() {
    const params = useParams();
    const address = params.address as string;
    const [txPage, setTxPage] = useState(1);

    const { data: wallet, isLoading: loadingWallet, error } = useQuery({
        queryKey: ['wallet', address],
        queryFn: () => getWalletDetails(address),
    });

    const { data: transactions, isLoading: loadingTx } = useQuery({
        queryKey: ['wallet-tx', address, txPage],
        queryFn: () => getWalletTransactions(address, txPage, 10),
        enabled: !!wallet, // Only load tx if wallet exists
    });

    if (error) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-2xl font-bold mb-2">Wallet Not Found</h1>
                    <p className="text-gray-400 mb-4">The address may not be active on this network.</p>
                    <Link href="/explorer" className="text-cyan-400 hover:underline">Return to Explorer</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
            <Navbar />

            <main className="container mx-auto px-4 py-8 mt-16 max-w-6xl">
                <div className="flex flex-col gap-8">

                    <div className="flex items-center gap-2 mb-2">
                        <Link href="/explorer" className="text-gray-400 hover:text-cyan-400 transition-colors flex items-center gap-1">
                            <ChevronLeft className="w-4 h-4" /> Explorer
                        </Link>
                    </div>

                    {/* Wallet Header */}
                    <GlassCard className="p-8 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-32 bg-cyan-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

                        <div className="relative z-10">
                            <div className="flex flex-col md:flex-row justify-between gap-6">
                                <div>
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20">
                                            <Wallet className="w-6 h-6" />
                                        </div>
                                        <h1 className="text-2xl font-bold">Account Overview</h1>
                                    </div>
                                    <div className="flex items-center gap-3 bg-black/40 px-4 py-2 rounded-lg border border-white/5 backdrop-blur-sm">
                                        <span className="font-mono text-gray-300 break-all">{address}</span>
                                        <button
                                            className="text-gray-500 hover:text-white transition-colors"
                                            title="Copy Address"
                                            onClick={() => {
                                                navigator.clipboard.writeText(address);
                                            }}
                                        >
                                            <Copy className="w-4 h-4" />
                                        </button>
                                        <a
                                            href={`https://solscan.io/account/${address}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-gray-500 hover:text-cyan-400 transition-colors"
                                            title="View on Solscan"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </a>
                                    </div>
                                </div>

                                <div className="flex gap-4">
                                    <div className="text-right">
                                        <p className="text-sm text-gray-400 mb-1">Total Balance</p>
                                        {loadingWallet ? (
                                            <div className="h-8 w-32 bg-white/10 rounded animate-pulse ml-auto" />
                                        ) : (
                                            <div className="text-3xl font-bold font-mono text-white">
                                                {wallet?.balance_sol.toLocaleString()} <span className="text-lg text-gray-500">SOL</span>
                                            </div>
                                        )}
                                        <p className="text-xs text-gray-500 mt-1">
                                            ≈ ${(wallet?.balance_sol ? wallet.balance_sol * 145 : 0).toFixed(2)} USD
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Asset Strip */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-white/10">

                                <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                                    <p className="text-xs text-gray-400 mb-1">Platform Credit</p>
                                    <p className="font-mono text-lg">{wallet?.balance_platform.toFixed(2)}</p>
                                </div>
                                <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                                    <p className="text-xs text-gray-400 mb-1">Transactions</p>
                                    <p className="font-mono text-lg">{wallet?.transaction_count.toLocaleString()}</p>
                                </div>
                                <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                                    <p className="text-xs text-gray-400 mb-1">First Seen</p>
                                    <p className="font-mono text-sm text-gray-300">
                                        {wallet?.first_activity ? formatDistanceToNow(new Date(wallet.first_activity), { addSuffix: true }) : '-'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </GlassCard>

                    {/* Transactions List */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <ArrowRightLeft className="w-5 h-5 text-gray-400" /> Transaction History
                        </h2>

                        <GlassCard className="overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-white/10 text-left text-gray-400 text-sm">
                                            <th className="p-4 font-medium">Tx Hash</th>
                                            <th className="p-4 font-medium">Method</th>
                                            <th className="p-4 font-medium">To</th>
                                            <th className="p-4 font-medium text-right">Value</th>
                                            <th className="p-4 font-medium text-right">Age</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {loadingTx ? (
                                            Array.from({ length: 5 }).map((_, i) => (
                                                <tr key={i} className="animate-pulse">
                                                    <td className="p-4"><div className="h-4 bg-white/5 rounded w-32" /></td>
                                                    <td className="p-4"><div className="h-4 bg-white/5 rounded w-16" /></td>
                                                    <td className="p-4"><div className="h-4 bg-white/5 rounded w-32" /></td>
                                                    <td className="p-4"><div className="h-4 bg-white/5 rounded w-20 ml-auto" /></td>
                                                    <td className="p-4"><div className="h-4 bg-white/5 rounded w-16 ml-auto" /></td>
                                                </tr>
                                            ))
                                        ) : transactions?.transactions?.map((tx) => (
                                            <tr key={tx.tx_hash} className="hover:bg-white/5 transition-colors">
                                                <td className="p-4">
                                                    <Link href={`https://solscan.io/tx/${tx.tx_hash}`} className="font-mono text-cyan-400 hover:underline">
                                                        {tx.tx_hash.slice(0, 12)}...
                                                    </Link>
                                                </td>
                                                <td className="p-4">
                                                    <span className="px-2 py-1 rounded text-xs bg-white/5 text-gray-300 border border-white/10 uppercase">
                                                        {tx.tx_type}
                                                    </span>
                                                </td>
                                                <td className="p-4">
                                                    <div className={`flex items-center gap-1 font-mono text-sm ${tx.to_address === address ? 'text-white' : 'text-gray-400'}`}>
                                                        {tx.to_address === address ? (
                                                            <span className="text-green-400 bg-green-400/10 px-1 rounded text-xs">IN</span>
                                                        ) : (
                                                            <span className="text-yellow-400 bg-yellow-400/10 px-1 rounded text-xs">OUT</span>
                                                        )}
                                                        <Link href={`/explorer/wallets/${tx.to_address}`} className="hover:text-white truncate max-w-[150px]">
                                                            {tx.to_address.slice(0, 8)}...
                                                        </Link>
                                                    </div>
                                                </td>
                                                <td className="p-4 text-right">
                                                    <div className="font-mono text-white">{tx.amount.toFixed(4)} {tx.currency}</div>
                                                </td>
                                                <td className="p-4 text-right text-sm text-gray-400">
                                                    {formatDistanceToNow(new Date(tx.timestamp), { addSuffix: true })}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                {transactions?.transactions?.length === 0 && (
                                    <div className="p-12 text-center text-gray-500">No transactions found</div>
                                )}
                            </div>

                            {/* Pagination */}
                            <div className="p-4 border-t border-white/10 flex justify-between items-center">
                                <button
                                    className="p-2 hover:bg-white/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    onClick={() => setTxPage(Math.max(1, txPage - 1))}
                                    disabled={txPage === 1 || loadingTx}
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>
                                <span className="text-sm text-gray-400">Page {txPage}</span>
                                <button
                                    className="p-2 hover:bg-white/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    onClick={() => setTxPage(txPage + 1)}
                                    disabled={transactions && transactions.transactions.length < 10}
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>
                        </GlassCard>
                    </div>

                </div>
            </main>
        </div>
    );
}
