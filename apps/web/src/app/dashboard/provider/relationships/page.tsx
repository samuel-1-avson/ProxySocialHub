"use client";

import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
    Gift,
    User,
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
import { Modal } from "@/components/patterns/Modal";
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
    Stat,
    amount,
} from "@/components/workspace/Patterns";

export default function ProviderRelationshipsPage() {
    const { addNotification } = useNotificationStore();
    const [selectedBuyer, setSelectedBuyer] = useState<ProviderBuyerRelationship | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [offerModalOpen, setOfferModalOpen] = useState(false);

    const { data: relationships = [], isLoading: relationshipsLoading, isError: relationshipsError, error: relationshipsQueryError, refetch: refetchRelationships } = useQuery({
        queryKey: relationshipKeys.provider.lists(),
        queryFn: getProviderRelationships,
    });

    const { data: stats, isLoading: statsLoading, isError: statsError, error: statsQueryError, refetch: refetchStats } = useQuery({
        queryKey: relationshipKeys.provider.stats(),
        queryFn: getProviderRelationshipStats,
    });

    const offerMutation = useMutation({
        retry: false,
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
        <div className="ui-page">
            <PageHeading
                eyebrow="Provider workspace"
                title="Customer relationships"
                description="Manage your ongoing buyer connections and send refill offers."
            />

            {statsError && (
                <DataError error={statsQueryError} retry={() => void refetchStats()} />
            )}

            <section className="ui-stats">
                <Stat
                    label="Total customers"
                    value={stats?.total_relationships || 0}
                    detail="Buyers with completed sessions"
                />
                <Stat
                    label="Total bandwidth sold"
                    value={`${amount(stats?.total_bandwidth_sold_gb || 0, 1)} GB`}
                    detail="Across all buyer relationships"
                />
                <Stat
                    label="Total revenue"
                    value={`${amount(stats?.total_revenue || 0, 6)} SOL`}
                    detail="Recorded from buyer sessions"
                />
                <Stat
                    label="Avg sessions per buyer"
                    value={amount(stats?.avg_sessions_per_buyer || 0, 1)}
                    detail="Mean completed sessions"
                />
            </section>

            <label className="ui-field">
                Search customers
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} aria-hidden="true" />
                    <input
                        className="ui-input w-full pl-10"
                        placeholder="Search customers by name or email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </label>

            {relationshipsError && (
                <DataError error={relationshipsQueryError} retry={() => void refetchRelationships()} />
            )}

            {loading ? (
                <Loading label="Loading your customer relationships…" />
            ) : filteredRelationships.length === 0 ? (
                <EmptyState
                    title="No relationships yet"
                    description={
                        searchQuery
                            ? "No customers match your search."
                            : "Complete sessions with buyers to build relationships."
                    }
                />
            ) : (
                <div>
                    {filteredRelationships.map((relationship) => {
                        const tier = getRelationshipTier(
                            relationship.total_spent,
                            relationship.session_count
                        );
                        return (
                            <article key={relationship.buyer_id} className="ui-row">
                                <div className="ui-row-identity">
                                    <span className="ui-region overflow-hidden">
                                        {relationship.buyer_avatar ? (
                                            <img
                                                src={relationship.buyer_avatar}
                                                alt={relationship.buyer_name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <User size={16} aria-hidden="true" />
                                        )}
                                    </span>
                                    <div>
                                        <h3>{relationship.buyer_name}</h3>
                                        <p>{relationship.buyer_email}</p>
                                        <p>
                                            <span className={getTierColor(tier)}>{getTierLabel(tier)}</span>
                                            {" · "}
                                            {formatRelationshipDuration(relationship.first_session_at)}
                                            {" · "}
                                            {amount(relationship.total_bandwidth_gb || 0, 1)} GB
                                            {" · "}
                                            {relationship.session_count || 0} sessions
                                        </p>
                                    </div>
                                </div>
                                <div className="ui-actions">
                                    <div className="text-right">
                                        <div className="ui-stat-value text-[20px]">
                                            {amount(relationship.total_spent || 0, 6)} SOL
                                        </div>
                                        <p className="ui-note">Total spent</p>
                                    </div>
                                    <button
                                        type="button"
                                        className="ui-button secondary"
                                        onClick={() => {
                                            setSelectedBuyer(relationship);
                                            setOfferModalOpen(true);
                                        }}
                                    >
                                        <Gift size={14} aria-hidden="true" />
                                        Offer
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

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
        <Modal
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            title="Send refill offer"
            description={`To: ${buyer.buyer_name}`}
            size="md"
            footer={
                <>
                    <button type="button" className="ui-button secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="ui-button"
                        onClick={() => onSubmit({ discount_percent: discountPercent, bonus_gb: bonusGb, message })}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? "Sending…" : "Send offer"}
                    </button>
                </>
            }
        >
            <div className="ui-page">
                <label className="ui-field">
                    Discount: {discountPercent}%
                    <input
                        type="range"
                        min="5"
                        max="50"
                        value={discountPercent}
                        onChange={(e) => setDiscountPercent(Number(e.target.value))}
                    />
                </label>

                <label className="ui-field">
                    Bonus bandwidth: {bonusGb} GB
                    <input
                        type="range"
                        min="1"
                        max="50"
                        value={bonusGb}
                        onChange={(e) => setBonusGb(Number(e.target.value))}
                    />
                </label>

                <label className="ui-field">
                    Personal message
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="ui-input min-h-[100px]"
                        placeholder="Add a personal message..."
                    />
                </label>
            </div>
        </Modal>
    );
}
