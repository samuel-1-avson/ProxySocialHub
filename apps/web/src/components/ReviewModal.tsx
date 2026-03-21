"use client";

import React, { useState } from "react";
import { Star, X, CheckCircle2, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/stores";

interface ReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    sessionId: string;
    providerName?: string;
}

export function ReviewModal({ isOpen, onClose, sessionId, providerName }: ReviewModalProps) {
    const { user } = useAuth();
    const toast = useToast();
    const [rating, setRating] = useState(0);
    const [hoverRating, setHoverRating] = useState(0);
    const [comment, setComment] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const handleSubmit = async () => {
        if (!rating) return;
        setIsSubmitting(true);
        
        try {
            // Call API here
            // await submitReview({ sessionId, rating, comment });
            
            // Simulating API call
            await new Promise((resolve) => setTimeout(resolve, 800));
            
            setIsSuccess(true);
            toast.success("Review Submitted", "Thank you for helping keep the network secure.");
            
            setTimeout(() => {
                setIsSuccess(false);
                onClose();
                setRating(0);
                setComment("");
            }, 1500);
        } catch (error) {
            toast.error("Error", "Failed to submit review.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                    onClick={onClose}
                />
                
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-md"
                >
                    <GlassCard className="p-6 sm:p-8 space-y-6">
                        {isSuccess ? (
                            <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: "spring", bounce: 0.5 }}
                                >
                                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 mb-4 mx-auto">
                                        <CheckCircle2 size={32} />
                                    </div>
                                </motion.div>
                                <h2 className="text-xl font-bold">Consensus Accepted</h2>
                                <p className="text-sm text-muted-foreground">Your feedback has been logged to the trust ledger.</p>
                            </div>
                        ) : (
                            <>
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <h2 className="text-xl font-bold flex items-center gap-2">
                                            <ShieldCheck className="text-primary" />
                                            Session Ended
                                        </h2>
                                        <p className="text-sm text-muted-foreground">
                                            How was your connection with {providerName || "this node"}?
                                        </p>
                                    </div>
                                    <button 
                                        onClick={onClose}
                                        className="p-2 rounded-full hover:bg-white/5 transition-colors text-muted-foreground"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>

                                <div className="flex justify-center gap-2 py-4">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <button
                                            key={star}
                                            type="button"
                                            onClick={() => setRating(star)}
                                            onMouseEnter={() => setHoverRating(star)}
                                            onMouseLeave={() => setHoverRating(0)}
                                            className="p-2 transition-transform hover:scale-110 focus:outline-none"
                                        >
                                            <Star
                                                size={32}
                                                className={`transition-colors ${
                                                    star <= (hoverRating || rating)
                                                        ? "fill-primary text-primary"
                                                        : "text-muted-foreground/30"
                                                }`}
                                            />
                                        </button>
                                    ))}
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground">Additional Feedback (Optional)</label>
                                    <textarea
                                        value={comment}
                                        onChange={(e) => setComment(e.target.value)}
                                        placeholder="Did you experience any lag or drops?"
                                        className="w-full h-24 p-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-primary/50 resize-none transition-colors placeholder:text-muted-foreground/50"
                                    />
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={onClose}
                                        className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 font-bold text-sm hover:bg-white/5 transition-colors"
                                    >
                                        Skip
                                    </button>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={!rating || isSubmitting}
                                        className="flex-[2] px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 disabled:opacity-50 transition-all shadow-lg flex items-center justify-center"
                                    >
                                        {isSubmitting ? "Submitting..." : "Submit Review"}
                                    </button>
                                </div>
                            </>
                        )}
                    </GlassCard>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
