'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, X, Send, Clock, Database, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useNotificationStore } from '@/stores';

interface UsageReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    sessionId: string;
    listingTitle?: string;
    providerName?: string;
}

interface EligibilityData {
    eligible: boolean;
    reason?: string;
    used_gb: number;
    duration_days: number;
    can_review: boolean;
}

export function UsageReviewModal({ isOpen, onClose, sessionId, listingTitle, providerName }: UsageReviewModalProps) {
    const { addNotification } = useNotificationStore();
    const [eligibility, setEligibility] = useState<EligibilityData | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    
    // Review form state
    const [rating, setRating] = useState(0);
    const [speedRating, setSpeedRating] = useState(0);
    const [reliabilityRating, setReliabilityRating] = useState(0);
    const [supportRating, setSupportRating] = useState(0);
    const [valueRating, setValueRating] = useState(0);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [wouldRecommend, setWouldRecommend] = useState(true);
    const [step, setStep] = useState<'form' | 'success'>('form');

    // Fetch eligibility
    useEffect(() => {
        if (isOpen && sessionId) {
            fetchEligibility();
        }
    }, [isOpen, sessionId]);

    const fetchEligibility = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/v1/sessions/${sessionId}/review-eligibility`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            });

            if (response.ok) {
                const data = await response.json();
                setEligibility(data);
            }
        } catch (error) {
            console.error('Failed to fetch eligibility:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (rating === 0) {
            addNotification({ type: 'error', title: 'Rating required', message: 'Please select a rating' });
            return;
        }
        if (title.length < 5) {
            addNotification({ type: 'error', title: 'Title too short', message: 'Please enter a title (min 5 chars)' });
            return;
        }
        if (content.length < 20) {
            addNotification({ type: 'error', title: 'Review too short', message: 'Please enter a review (min 20 chars)' });
            return;
        }

        setSubmitting(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/v1/sessions/${sessionId}/review`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    rating,
                    speed_rating: speedRating || undefined,
                    reliability_rating: reliabilityRating || undefined,
                    support_rating: supportRating || undefined,
                    value_rating: valueRating || undefined,
                    title,
                    content,
                    would_recommend: wouldRecommend,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to submit review');
            }

            setStep('success');
            addNotification({ type: 'success', title: 'Review submitted!', message: 'Thank you for your feedback' });

        } catch (error: any) {
            addNotification({ type: 'error', title: 'Failed to submit', message: error.message });
        } finally {
            setSubmitting(false);
        }
    };

    const StarRating = ({ value, onChange, label }: { value: number; onChange: (v: number) => void; label?: string }) => (
        <div className="space-y-1">
            {label && <p className="text-xs text-white/40">{label}</p>}
            <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                    <button
                        key={star}
                        onClick={() => onChange(star)}
                        className="p-1 hover:scale-110 transition-transform"
                    >
                        <Star
                            className={`w-5 h-5 ${star <= value ? 'fill-yellow-400 text-yellow-400' : 'text-white/20'}`}
                        />
                    </button>
                ))}
            </div>
        </div>
    );

    if (step === 'success') {
        return (
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
                        onClick={onClose}
                    >
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-black/90 border border-emerald-500/30 rounded-2xl p-8 max-w-md w-full mx-4 text-center"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                <Check className="w-8 h-8 text-emerald-500" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Thank You!</h3>
                            <p className="text-white/60 mb-6">Your review helps others find great providers.</p>
                            <Button onClick={onClose} className="w-full bg-emerald-500 text-black hover:bg-emerald-400">
                                Close
                            </Button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        );
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 20 }}
                        className="bg-black/95 border border-white/10 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="sticky top-0 bg-black/95 border-b border-white/10 p-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white">Write a Review</h2>
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                                <X className="w-5 h-5 text-white/50" />
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            {loading ? (
                                <div className="animate-pulse space-y-4">
                                    <div className="h-20 bg-white/10 rounded" />
                                    <div className="h-40 bg-white/10 rounded" />
                                </div>
                            ) : eligibility && !eligibility.can_review ? (
                                <div className="text-center py-8">
                                    <p className="text-white/60">{eligibility.reason}</p>
                                </div>
                            ) : (
                                <>
                                    {/* Usage Context */}
                                    {eligibility && (
                                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                                            <p className="text-sm text-emerald-400/80 mb-2">Your experience:</p>
                                            <div className="flex gap-4">
                                                <div className="flex items-center gap-2">
                                                    <Database className="w-4 h-4 text-emerald-400" />
                                                    <span className="text-white font-bold">{Number(eligibility.used_gb || 0).toFixed(1)}GB</span>
                                                    <span className="text-white/40 text-sm">used</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Clock className="w-4 h-4 text-emerald-400" />
                                                    <span className="text-white font-bold">{eligibility.duration_days}</span>
                                                    <span className="text-white/40 text-sm">days</span>
                                                </div>
                                            </div>
                                            <p className="text-xs text-white/40 mt-2">
                                                This context will be shown with your review
                                            </p>
                                        </div>
                                    )}

                                    {/* Provider Info */}
                                    <div>
                                        <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Provider</p>
                                        <p className="text-white font-medium">{providerName || 'Provider'}</p>
                                        {listingTitle && (
                                            <p className="text-sm text-white/60">{listingTitle}</p>
                                        )}
                                    </div>

                                    {/* Overall Rating */}
                                    <div className="text-center">
                                        <p className="text-sm text-white/60 mb-2">Overall Rating</p>
                                        <div className="flex justify-center gap-2">
                                            {[1, 2, 3, 4, 5].map((star) => (
                                                <button
                                                    key={star}
                                                    onClick={() => setRating(star)}
                                                    className="p-2 hover:scale-110 transition-transform"
                                                >
                                                    <Star
                                                        className={`w-8 h-8 ${star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-white/20'}`}
                                                    />
                                                </button>
                                            ))}
                                        </div>
                                        <p className="text-sm text-white/40 mt-1">
                                            {rating > 0 && ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating - 1]}
                                        </p>
                                    </div>

                                    {/* Category Ratings */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <StarRating value={speedRating} onChange={setSpeedRating} label="Speed" />
                                        <StarRating value={reliabilityRating} onChange={setReliabilityRating} label="Reliability" />
                                        <StarRating value={supportRating} onChange={setSupportRating} label="Support" />
                                        <StarRating value={valueRating} onChange={setValueRating} label="Value" />
                                    </div>

                                    {/* Title */}
                                    <div>
                                        <label className="text-xs text-white/40 uppercase tracking-wider mb-1 block">Title</label>
                                        <input
                                            type="text"
                                            value={title}
                                            onChange={(e) => setTitle(e.target.value)}
                                            placeholder="Summarize your experience"
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none"
                                        />
                                    </div>

                                    {/* Content */}
                                    <div>
                                        <label className="text-xs text-white/40 uppercase tracking-wider mb-1 block">Your Review</label>
                                        <Textarea
                                            value={content}
                                            onChange={(e) => setContent(e.target.value)}
                                            placeholder="How was your experience? What worked well? What could be improved?"
                                            className="min-h-[120px] bg-white/5 border-white/10 text-white placeholder:text-white/30"
                                        />
                                    </div>

                                    {/* Would Recommend */}
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={wouldRecommend}
                                            onChange={(e) => setWouldRecommend(e.target.checked)}
                                            className="w-5 h-5 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500"
                                        />
                                        <span className="text-white/80">I would recommend this provider</span>
                                    </label>

                                    {/* Submit */}
                                    <Button
                                        onClick={handleSubmit}
                                        disabled={submitting || rating === 0 || title.length < 5 || content.length < 20}
                                        className="w-full bg-emerald-500 text-black hover:bg-emerald-400 font-bold py-3"
                                    >
                                        {submitting ? (
                                            <span className="flex items-center gap-2">
                                                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                                                    <Clock className="w-4 h-4" />
                                                </motion.div>
                                                Submitting...
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-2">
                                                <Send className="w-4 h-4" />
                                                Submit Review
                                            </span>
                                        )}
                                    </Button>
                                </>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default UsageReviewModal;
