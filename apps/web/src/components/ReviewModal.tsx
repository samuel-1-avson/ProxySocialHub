"use client";

import React, { useState } from "react";
import { Star, CheckCircle2, ShieldCheck } from "lucide-react";
import { useToast } from "@/stores";
import { Modal } from "@/components/patterns/Modal";
import { Button } from "@/components/ui/button";

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  providerName?: string;
}

export function ReviewModal({ isOpen, onClose, sessionId, providerName }: ReviewModalProps) {
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const reset = () => {
    setRating(0);
    setComment("");
    setIsSuccess(false);
    setHoverRating(0);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      reset();
      onClose();
    }
  };

  const handleSubmit = async () => {
    if (!rating) return;
    setIsSubmitting(true);
    try {
      // Placeholder until review API is wired for this surface
      void sessionId;
      await new Promise((resolve) => setTimeout(resolve, 800));
      setIsSuccess(true);
      toast.success("Review submitted", "Thank you for helping keep the network trustworthy.");
      setTimeout(() => {
        reset();
        onClose();
      }, 1200);
    } catch {
      toast.error("Error", "Failed to submit review.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={isSuccess ? "Review recorded" : "Session ended"}
      description={
        isSuccess
          ? "Your feedback has been logged."
          : `How was your connection with ${providerName || "this node"}?`
      }
      footer={
        isSuccess ? null : (
          <>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Skip
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!rating || isSubmitting}
              isLoading={isSubmitting}
            >
              Submit review
            </Button>
          </>
        )
      }
    >
      {isSuccess ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]">
            <CheckCircle2 size={28} aria-hidden />
          </div>
          <p className="text-sm text-muted-foreground">Thank you for your feedback.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
            Rate this session
          </div>

          <div
            className="flex justify-center gap-1"
            role="radiogroup"
            aria-label="Session rating"
          >
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                role="radio"
                aria-checked={rating === star}
                aria-label={`${star} star${star === 1 ? "" : "s"}`}
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                className="rounded-[var(--radius-sm)] p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <Star
                  size={28}
                  className={
                    star <= (hoverRating || rating)
                      ? "fill-primary text-primary"
                      : "text-muted-foreground/30"
                  }
                  aria-hidden
                />
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label htmlFor="review-comment" className="text-xs font-medium text-muted-foreground">
              Additional feedback (optional)
            </label>
            <textarea
              id="review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Did you experience lag or drops?"
              className="h-24 w-full resize-none rounded-[var(--radius-md)] border border-border bg-secondary p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
