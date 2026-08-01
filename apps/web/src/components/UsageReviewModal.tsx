'use client';

import React, { useState, useEffect } from 'react';
import { Star, Send, Clock, Database, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { getAccessTokenSilently } from '@/lib/auth';
import { useNotificationStore } from '@/stores';
import { Modal } from '@/components/patterns/Modal';

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

export function UsageReviewModal({
  isOpen,
  onClose,
  sessionId,
  listingTitle,
  providerName,
}: UsageReviewModalProps) {
  const { addNotification } = useNotificationStore();
  const [eligibility, setEligibility] = useState<EligibilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rating, setRating] = useState(0);
  const [speedRating, setSpeedRating] = useState(0);
  const [reliabilityRating, setReliabilityRating] = useState(0);
  const [supportRating, setSupportRating] = useState(0);
  const [valueRating, setValueRating] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [wouldRecommend, setWouldRecommend] = useState(true);
  const [step, setStep] = useState<'form' | 'success'>('form');

  useEffect(() => {
    if (isOpen && sessionId) {
      void fetchEligibility();
    }
  }, [isOpen, sessionId]);

  const fetchEligibility = async () => {
    setLoading(true);
    try {
      const token = await getAccessTokenSilently();
      const response = await fetch(`/v1/sessions/${sessionId}/review-eligibility`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.ok) {
        setEligibility(await response.json());
      }
    } catch (error) {
      console.error('Failed to fetch eligibility:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setStep('form');
      onClose();
    }
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      addNotification({ type: 'error', title: 'Rating required', message: 'Please select a rating' });
      return;
    }
    if (title.length < 5) {
      addNotification({
        type: 'error',
        title: 'Title too short',
        message: 'Please enter a title (min 5 chars)',
      });
      return;
    }
    if (content.length < 20) {
      addNotification({
        type: 'error',
        title: 'Review too short',
        message: 'Please enter a review (min 20 chars)',
      });
      return;
    }

    setSubmitting(true);
    try {
      const token = await getAccessTokenSilently();
      const response = await fetch(`/v1/sessions/${sessionId}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
      addNotification({
        type: 'success',
        title: 'Review submitted!',
        message: 'Thank you for your feedback',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to submit';
      addNotification({ type: 'error', title: 'Failed to submit', message });
    } finally {
      setSubmitting(false);
    }
  };

  const StarRating = ({
    value,
    onChange,
    label,
  }: {
    value: number;
    onChange: (v: number) => void;
    label?: string;
  }) => (
    <div className="space-y-1">
      {label ? <p className="text-xs text-muted-foreground">{label}</p> : null}
      <div className="flex gap-1" role="radiogroup" aria-label={label || 'Rating'}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} star${star === 1 ? '' : 's'}`}
            onClick={() => onChange(star)}
            className="rounded-[var(--radius-sm)] p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <Star
              className={`h-5 w-5 ${star <= value ? 'fill-[var(--warning)] text-[var(--warning)]' : 'text-muted-foreground/30'}`}
              aria-hidden
            />
          </button>
        ))}
      </div>
    </div>
  );

  if (step === 'success') {
    return (
      <Modal
        open={isOpen}
        onOpenChange={handleOpenChange}
        title="Thank you"
        description="Your review helps others find great providers."
        footer={
          <Button type="button" className="w-full" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]">
            <Check className="h-7 w-7" aria-hidden />
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={handleOpenChange}
      title="Write a review"
      description={providerName || listingTitle || 'Share your session experience'}
      size="lg"
      footer={
        !loading && eligibility?.can_review !== false ? (
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || rating === 0 || title.length < 5 || content.length < 20}
            isLoading={submitting}
            className="w-full sm:w-auto"
          >
            <Send className="mr-2 h-4 w-4" aria-hidden />
            Submit review
          </Button>
        ) : null
      }
    >
      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-20 rounded-[var(--radius-md)] bg-secondary" />
          <div className="h-40 rounded-[var(--radius-md)] bg-secondary" />
        </div>
      ) : eligibility && !eligibility.can_review ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{eligibility.reason}</p>
      ) : (
        <div className="space-y-5">
          {eligibility ? (
            <div className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--success)_30%,var(--border))] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] p-4">
              <p className="mb-2 text-sm text-muted-foreground">Your experience</p>
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="inline-flex items-center gap-2 font-mono">
                  <Database className="h-4 w-4 text-[var(--success)]" aria-hidden />
                  {Number(eligibility.used_gb || 0).toFixed(1)} GB used
                </span>
                <span className="inline-flex items-center gap-2 font-mono">
                  <Clock className="h-4 w-4 text-[var(--success)]" aria-hidden />
                  {eligibility.duration_days} days
                </span>
              </div>
            </div>
          ) : null}

          <div className="text-center">
            <p className="mb-2 text-sm text-muted-foreground">Overall rating</p>
            <div className="flex justify-center gap-1" role="radiogroup" aria-label="Overall rating">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  role="radio"
                  aria-checked={rating === star}
                  aria-label={`${star} star${star === 1 ? '' : 's'}`}
                  onClick={() => setRating(star)}
                  className="rounded-[var(--radius-sm)] p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <Star
                    className={`h-8 w-8 ${star <= rating ? 'fill-[var(--warning)] text-[var(--warning)]' : 'text-muted-foreground/30'}`}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            {rating > 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating - 1]}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <StarRating value={speedRating} onChange={setSpeedRating} label="Speed" />
            <StarRating value={reliabilityRating} onChange={setReliabilityRating} label="Reliability" />
            <StarRating value={supportRating} onChange={setSupportRating} label="Support" />
            <StarRating value={valueRating} onChange={setValueRating} label="Value" />
          </div>

          <div className="space-y-2">
            <label htmlFor="usage-review-title" className="text-xs font-medium text-muted-foreground">
              Title
            </label>
            <Input
              id="usage-review-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Summarize your experience"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="usage-review-content" className="text-xs font-medium text-muted-foreground">
              Your review
            </label>
            <Textarea
              id="usage-review-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="How was your experience?"
              className="min-h-[120px]"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={wouldRecommend}
              onChange={(e) => setWouldRecommend(e.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            I would recommend this provider
          </label>
        </div>
      )}
    </Modal>
  );
}

export default UsageReviewModal;
