'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { getMyOrders, releaseEscrow, createDispute, Order } from '@/lib/api';
import { CheckCircle, AlertTriangle, ShieldCheck, ArrowRight, Package, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function MyOrdersPage() {
    const { user } = useAuth();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const fetchOrders = useCallback(async () => {
        try {
            const data = await getMyOrders();
            setOrders(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    const handleRelease = async (orderId: string) => {
        if (!confirm("Are you sure you want to release funds to the seller? This cannot be undone.")) return;
        setActionLoading(orderId);
        try {
            await releaseEscrow(orderId);
            // Refresh
            fetchOrders();
        } catch (err) {
            alert("Failed to release funds");
        } finally {
            setActionLoading(null);
        }
    };

    const handleDispute = async (orderId: string) => {
        const reason = prompt("Please enter a reason for the dispute:");
        if (!reason) return;
        const desc = prompt("Please provide additional details:");
        if (!desc) return;

        setActionLoading(orderId);
        try {
            await createDispute(orderId, reason, desc);
            alert("Dispute opened. Support will review shortly.");
            fetchOrders();
        } catch (err) {
            alert("Failed to open dispute");
        } finally {
            setActionLoading(null);
        }
    };

    return (
        <div className="max-w-7xl mx-auto space-y-8 pb-20">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black text-white tracking-tight">My Purchases</h1>
                    <p className="text-muted-foreground mt-2">Manage your orders and escrow transactions.</p>
                </div>
                <Link href="/marketplace" className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-bold border border-white/5 transition-colors">
                    Browse Market
                </Link>
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={32} />
                </div>
            ) : orders.length === 0 ? (
                <div className="text-center py-20 bg-white/2 rounded-3xl border border-white/5">
                    <Package size={48} className="mx-auto text-muted-foreground mb-4 opacity-50" />
                    <p className="text-xl font-bold text-white">No orders yet</p>
                    <Link href="/marketplace" className="inline-block mt-4 text-purple-400 hover:text-purple-300 font-bold hover:underline">
                        Start Shopping
                    </Link>
                </div>
            ) : (
                <div className="grid gap-4">
                    {orders.map((order) => {
                        return (
                            <div key={order.id} className="p-6 rounded-2xl bg-[#0a0a0a] border border-white/5 hover:border-white/10 transition-colors flex flex-col md:flex-row gap-6 items-center">

                                {/* Icon */}
                                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                                    <Package size={20} className="text-white/60" />
                                </div>

                                {/* Info */}
                                <div className="flex-1 space-y-1 text-center md:text-left">
                                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                        Order #{order.id.slice(0, 8)} • {new Date(order.created_at).toLocaleDateString()}
                                    </div>
                                    <div className="font-bold text-white text-lg">
                                        {order.listing?.title || 'Unknown Listing'}
                                    </div>
                                    <div className="text-sm text-yellow-500 font-mono">
                                        {order.amount ? `₵${order.amount.toFixed(2)}` : 'Amount Pending'}
                                    </div>
                                </div>

                                {/* Status Badge */}
                                <div>
                                    {order.status === 'completed' && (
                                        <div className="px-3 py-1 rounded-full bg-green-500/10 text-green-500 text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                            <CheckCircle size={12} /> Completed
                                        </div>
                                    )}
                                    {order.status === 'active' && (
                                        <div className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                            <ShieldCheck size={12} /> Funds Escrowed
                                        </div>
                                    )}
                                    {order.status === 'disputed' && (
                                        <div className="px-3 py-1 rounded-full bg-red-500/10 text-red-400 text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                            <AlertTriangle size={12} /> Disputed
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2">
                                    {order.status === 'active' && (
                                        <>
                                            <button
                                                onClick={() => handleRelease(order.id)}
                                                disabled={!!actionLoading}
                                                className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-bold uppercase tracking-tight transition-colors disabled:opacity-50"
                                            >
                                                {actionLoading === order.id ? <Loader2 size={14} className="animate-spin" /> : 'Release Funds'}
                                            </button>
                                            <button
                                                onClick={() => handleDispute(order.id)}
                                                disabled={!!actionLoading}
                                                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-red-400 text-xs font-bold uppercase tracking-tight transition-colors border border-white/5"
                                            >
                                                Dispute
                                            </button>
                                        </>
                                    )}
                                    <Link href={`/marketplace/${order.listing?.title ? 'details' : ''}`} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white transition-colors">
                                        <ArrowRight size={16} />
                                    </Link>
                                </div>

                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
