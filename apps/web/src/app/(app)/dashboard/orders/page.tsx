'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShoppingBag, AlertTriangle, CheckCircle, Clock, ChevronRight, Shield, AlertCircle } from 'lucide-react';
import { getMyOrders, getEscrowStatus, releaseEscrow, createDispute, Order, EscrowTransaction } from '@/lib/api';
import Link from 'next/link';

export default function OrdersPage() {
    const [orders, setOrders] = useState<(Order & { escrow?: EscrowTransaction })[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const ordersData = await getMyOrders();

            // Fetch escrow status for eligible orders in parallel
            const ordersWithEscrow = await Promise.all(
                ordersData.map(async (order) => {
                    // If the order uses escrow (you might check a flag, or just try fetching)
                    // For now, let's try fetching if status is not 'completed' immediately
                    try {
                        const escrow = await getEscrowStatus(order.id);
                        return { ...order, escrow };
                    } catch (e) {
                        return order;
                    }
                })
            );

            setOrders(ordersWithEscrow);
        } catch (error) {
            console.error('Failed to fetch orders:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRelease = async (orderId: string) => {
        if (!confirm('Are you sure you want to release the funds to the seller? This cannot be undone.')) return;

        setActionLoading(orderId);
        try {
            await releaseEscrow(orderId);
            await fetchData();
        } catch (error) {
            console.error('Failed to release escrow:', error);
            alert('Failed to release funds');
        } finally {
            setActionLoading(null);
        }
    };

    const handleDispute = async (orderId: string) => {
        const reason = prompt('Please describe the issue with this order:');
        if (!reason) return;

        setActionLoading(orderId);
        try {
            await createDispute(orderId, 'issue', reason); // Simplified reason type
            await fetchData();
        } catch (error) {
            console.error('Failed to dispute:', error);
            alert('Failed to open dispute');
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8 p-6 max-w-7xl mx-auto">
            <div>
                <h1 className="text-3xl font-bold text-white tracking-tight">My Orders</h1>
                <p className="text-white/60 mt-1">Track your purchases and manage escrow payments.</p>
            </div>

            <div className="space-y-4">
                {orders.length === 0 ? (
                    <div className="text-center py-16 border-2 border-dashed border-white/10 rounded-2xl">
                        <ShoppingBag className="w-12 h-12 text-white/20 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-white/80">No orders yet</h3>
                        <p className="text-white/40 mb-6">Browse the marketplace to find proxies.</p>
                        <Link href="/marketplace" className="px-6 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-medium transition-all">
                            Go to Marketplace
                        </Link>
                    </div>
                ) : (
                    orders.map((order, idx) => (
                        <motion.div
                            key={order.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="group p-6 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition-all"
                        >
                            <div className="flex flex-col md:flex-row justify-between gap-6">

                                {/* Order Details */}
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-mono text-white/40">#{order.id.slice(0, 8)}</span>
                                        <span className="text-xs text-white/40">{new Date(order.created_at).toLocaleDateString()}</span>
                                    </div>
                                    <h3 className="text-lg font-bold text-white mb-1">
                                        {order.listing?.title || 'Proxy Purchase'}
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl font-bold text-primary-400">GHS {order.amount.toFixed(2)}</span>
                                        {/* Status Badge */}
                                        <span className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase ${order.status === 'completed' ? 'bg-green-500/10 text-green-400' :
                                                order.status === 'cancelled' ? 'bg-red-500/10 text-red-400' :
                                                    'bg-blue-500/10 text-blue-400'
                                            }`}>
                                            {order.status}
                                        </span>
                                    </div>
                                </div>

                                {/* Escrow Section */}
                                {order.escrow && (
                                    <div className="flex-1 md:max-w-md bg-black/20 rounded-xl p-4 border border-white/5">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Shield className={`w-4 h-4 ${order.escrow.status === 'held' ? 'text-yellow-400' :
                                                    order.escrow.status === 'released' ? 'text-green-400' : 'text-red-400'
                                                }`} />
                                            <span className="text-sm font-bold text-white/80">Escrow Protection</span>
                                        </div>

                                        {order.escrow.status === 'held' && (
                                            <div className="space-y-3">
                                                <p className="text-xs text-white/60">
                                                    Funds are held safely. Verify the product works before releasing.
                                                    <br />Auto-release in 7 days.
                                                </p>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleRelease(order.id)}
                                                        disabled={!!actionLoading}
                                                        className="flex-1 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2"
                                                    >
                                                        {actionLoading === order.id ? <div className="w-3 h-3 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                                        Release Funds
                                                    </button>
                                                    <button
                                                        onClick={() => handleDispute(order.id)}
                                                        disabled={!!actionLoading}
                                                        className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-bold transition-all"
                                                        title="Report an issue"
                                                    >
                                                        <AlertTriangle className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {order.escrow.status === 'released' && (
                                            <div className="flex items-center gap-2 text-green-400 text-sm">
                                                <CheckCircle className="w-4 h-4" />
                                                Funds released to seller
                                            </div>
                                        )}

                                        {order.escrow.status === 'disputed' && (
                                            <div className="flex items-center gap-2 text-red-400 text-sm font-bold">
                                                <AlertCircle className="w-4 h-4" />
                                                Dispute Open - Support will review
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ))
                )}
            </div>
        </div>
    );
}
