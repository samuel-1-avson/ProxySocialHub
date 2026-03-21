"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Users,
    Wifi,
    DollarSign,
    Clock,
    MessageSquare,
    Gift,
    ChevronRight,
    Loader2,
    User,
    TrendingUp,
    Award,
    Search,
} from "lucide-react";
import {
    getProviderRelationships,
    getProviderRelationshipStats,
    sendRefillOffer,
    relationshipKeys,
    getRelationshipTier,
    getTierColor,
    getTierLabel,
    formatRelationshipDuration,
    type ProviderBuyerRelationship,
} from "@/lib/api/relationships";
import { useNotificationStore } from "@/stores";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ProviderRelationshipsPage() {
    const { addNotification } = useNotificationStore();
    const queryClient = useQueryClient();
    const [selectedBuyer, setSelectedBuyer] = useState<ProviderBuyerRelationship | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [offerModalOpen, setOfferModalOpen] = useState(false);

    const { data: relationships = [], isLoading: relationshipsLoading } = useQuery({
        queryKey: relationshipKeys.provider.lists(),
        queryFn: getProviderRelationships,
    });

    const { data: stats, isLoading: statsLoading } = useQuery({
        queryKey: relationshipKeys.provider.stats(),
        queryFn: getProviderRelationshipStats,
    });

    const offerMutation = useMutation({
        mutationFn: ({ buyerId, offer }: { buyerId: string; offer: any }) =>
            sendRefillOffer(buyerId, offer),
        onSuccess: () => {
            addNotification({
                type: "success",
                title: "Offer Sent",
                message: "Refill offer sent successfully",
            });
            setOfferModalOpen(false);
            setSelectedBuyer(null);
        },
        onError: (error: Error) => {
            addNotification({
                type: "error",
                title: "Failed to send offer",
                message: error.message,
            });
        },
    });

    const filteredRelationships = relationships.filter(
        (r) =>
            r.buyer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            r.buyer_email?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const loading = relationshipsLoading || statsLoading;

    return (
        <div className="space-y-8 pb-20">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
            >
                <div>
                    <h1 className="text-3xl font-black font-mono uppercase tracking-tighter mb-1">
                        Customer Relationships
                    </h1>
                    <p className="text-muted-foreground font-mono text-xs">
                        Manage your ongoing buyer connections and send refill offers
                    </p>
                </div>
            </motion.div>

            {/* Stats Cards */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="grid grid-cols-1 md:grid-cols-4 gap-4"
            >
                {[
                    {
                        label: "Total Customers",
                        value: stats?.total_relationships || 0,
                        icon: Users,
                        color: "text-blue-500",
                        bg: "bg-blue-500/10",
                    },
                    {
                        label: "Total Bandwidth Sold",
                        value: `${(stats?.total_bandwidth_sold_gb || 0).toFixed(1)} GB`,
                        icon: Wifi,
                        color: "text-emerald-500",
                        bg: "bg-emerald-500/10",
                    },
                    {
                        label: "Total Revenue",
                        value: `$${(stats?.total_revenue || 0).toFixed(2)}`,
                        icon: DollarSign,
                        color: "text-amber-500",
                        bg: "bg-amber-500/10",
                    },
                    {
                        label: "Avg Sessions/Buyer",
                        value: (stats?.avg_sessions_per_buyer || 0).toFixed(1),
                        icon: TrendingUp,
                        color: "text-violet-500",
                        bg: "bg-violet-500/10",
                    },
                ].map((stat, i) => (
                    <div key={i} className="glass-card p-4">
                        <div className={`p-2 rounded-lg ${stat.bg} ${stat.color} w-fit mb-3`}>
                            <stat.icon size={18} />
                        </div>
                        <div className="text-2xl font-black font-mono">{stat.value}</div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                            {stat.label}
                        </div>
                    </div>
                ))}
            </motion.div>

            {/* Search */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="relative"
            >
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                <Input
                    placeholder="Search customers by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-12 bg-white/5 border-white/10"
                />
            </motion.div>

            {/* Relationships List */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="space-y-4"
            >
                {loading ? (
                    <div className="flex justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                ) : filteredRelationships.length === 0 ? (
                    <div className="text-center py-20 glass-card">
                        <User className="w-16 h-16 mx-auto text-muted-foreground/20 mb-4" />
                        <h3 className="font-bold text-lg mb-2">No Relationships Yet</h3>
                        <p className="text-muted-foreground text-sm">
                            {searchQuery
                                ? "No customers match your search"
                                : "Complete sessions with buyers to build relationships"}
                        </p>
                    </div>
                ) : (
                    filteredRelationships.map((relationship) => {
                        const tier = getRelationshipTier(
                            relationship.total_spent,
                            relationship.session_count
                        );
                        return (
                            <motion.div
                                key={relationship.buyer_id}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                whileHover={{ scale: 1.01 }}
                                className="glass-card p-6 flex flex-col md:flex-row items-start md:items-center gap-6 group"
                            >
                                {/* Avatar */}
                                <div className="relative">
                                    <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center overflow-hidden">
                                        {relationship.buyer_avatar ? (
                                            <img
                                                src={relationship.buyer_avatar}
                                                alt={relationship.buyer_name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <User className="w-6 h-6 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div
                                        className={`absolute -bottom-1 -right-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${getTierColor(
                                            tier
                                        )} bg-black/50 border-current`}
                                    >
                                        {getTierLabel(tier)}
                                    </div>
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-lg truncate">{relationship.buyer_name}</h3>
                                    <p className="text-sm text-muted-foreground">{relationship.buyer_email}</p>
                                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                            <Clock size={12} />
                                            {formatRelationshipDuration(relationship.first_session_at)}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Wifi size={12} />
                                            {(relationship.total_bandwidth_gb || 0).toFixed(1)} GB
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Award size={12} />
                                            {relationship.session_count || 0} sessions
                                        </span>
                                    </div>
                                </div>

                                {/* Stats */}
                                <div className="text-right">
                                    <div className="text-2xl font-black text-emerald-500">
                                        ${(relationship.total_spent || 0).toFixed(2)}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                                        Total Spent
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2"
                                        onClick={() => {
                                            setSelectedBuyer(relationship);
                                            setOfferModalOpen(true);
                                        }}
                                    >
                                        <Gift size={14} />
                                        Offer
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <ChevronRight size={18} />
                                    </Button>
                                </div>
                            </motion.div>
                        );
                    })
                )}
            </motion.div>

            {/* Offer Modal */}
            {offerModalOpen && selectedBuyer && (
                <OfferModal
                    buyer={selectedBuyer}
                    onClose={() => {
                        setOfferModalOpen(false);
                        setSelectedBuyer(null);
                    }}
                    onSubmit={(offer) =>
                        offerMutation.mutate({ buyerId: selectedBuyer.buyer_id, offer })
                    }
                    isSubmitting={offerMutation.isPending}
                />
            )}
        </div>
    );
}

// Offer Modal Component
interface OfferModalProps {
    buyer: ProviderBuyerRelationship;
    onClose: () => void;
    onSubmit: (offer: { discount_percent: number; bonus_gb: number; message: string }) => void;
    isSubmitting: boolean;
}

function OfferModal({ buyer, onClose, onSubmit, isSubmitting }: OfferModalProps) {
    const [discountPercent, setDiscountPercent] = useState(10);
    const [bonusGb, setBonusGb] = useState(5);
    const [message, setMessage] = useState(
        `Hey ${buyer.buyer_name}! Thanks for being a loyal customer. Here's a special offer just for you.`
    );

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-black/95 border border-white/10 rounded-2xl max-w-md w-full p-6"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="text-xl font-bold mb-4">Send Refill Offer</h2>
                <p className="text-sm text-muted-foreground mb-6">
                    To: <span className="text-white font-medium">{buyer.buyer_name}</span>
                </p>

                <div className="space-y-4">
                    <div>
                        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                            Discount: {discountPercent}%
                        </label>
                        <input
                            type="range"
                            min="5"
                            max="50"
                            value={discountPercent}
                            onChange={(e) => setDiscountPercent(Number(e.target.value))}
                            className="w-full"
                        />
                    </div>

                    <div>
                        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                            Bonus Bandwidth: {bonusGb} GB
                        </label>
                        <input
                            type="range"
                            min="1"
                            max="50"
                            value={bonusGb}
                            onChange={(e) => setBonusGb(Number(e.target.value))}
                            className="w-full"
                        />
                    </div>

                    <div>
                        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                            Personal Message
                        </label>
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm min-h-[100px]"
                            placeholder="Add a personal message..."
                        />
                    </div>

                    <div className="flex gap-3 pt-4">
                        <Button variant="outline" className="flex-1" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            className="flex-1 bg-emerald-500 text-black hover:bg-emerald-400"
                            onClick={() => onSubmit({ discount_percent: discountPercent, bonus_gb: bonusGb, message })}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <>
                                    <Gift className="w-4 h-4 mr-2" />
                                    Send Offer
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
